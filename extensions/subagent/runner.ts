// subagent/runner.ts - subprocess runner
//
// Adapted from pi-ouroboros subagent/runner.ts and the pi official subagent example.
// Uses --mode json to capture structured event stream (message_end, tool_result_end),
// rather than --print plain text, to capture metadata like usage, stopReason.
//
// Permission boundary (§34): child processes flag themselves via PE_CHILD=1 env var;
// main-agent-only tools (e.g. cynos_subagent itself, vision guard) are not registered in children.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentConfig } from "./agents";
import { formatAgentList } from "./agents";
import { getSubagentTimeoutMs } from "../infra/config";
import { readToolsVisionModel } from "../infra/tools-config-reader";
import { readProjectMd } from "../infra/project-context";
import { MAX_CONCURRENCY, MAX_PARALLEL_TASKS, MAX_SUBAGENT_TASK_CHARS, SUBAGENT_PER_RESULT_CAP } from "../infra/limits";

export { MAX_PARALLEL_TASKS, MAX_CONCURRENCY, MAX_SUBAGENT_TASK_CHARS };

export type FailureCategory = "ENV_ERROR" | "MODEL_ERROR" | "ABORTED" | "AGENT_REPORTED_FAILURE" | "UNKNOWN";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface SingleResult {
  agent: string;
  task: string;
  exitCode: number;
  messages: any[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  failureCategory?: FailureCategory;
  failureReason?: string;
}

export interface SubagentResultDetails {
  results: SingleResult[];
  agent?: string;
  succeeded?: boolean | number;
  total?: number;
}

export async function buildSubagentSystemPrompt(agent: AgentConfig, cwd: string): Promise<string> {
  // PROJECT.md is short project memory: except for researcher (external search, avoid
  // polluting the search task), subagents auto-receive a truncated PROJECT.md context.
  // docs/testing.md / docs/release.md are NOT auto-injected; the main agent must explicitly request them in the task.
  const project = agent.name === "researcher" ? null : await readProjectMd(cwd);
  return project?.available && project.content
    ? `${agent.systemPrompt}\n\n# PROJECT.md context\n\n${project.content}`
    : agent.systemPrompt;
}

export function getFinalOutput(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    for (const part of msg.content || []) {
      if (part.type === "text") return part.text;
    }
  }
  return "";
}

export function isFailedResult(result: SingleResult): boolean {
  return (
    result.exitCode !== 0 ||
    result.stopReason === "error" ||
    result.stopReason === "aborted" ||
    !!result.errorMessage
  );
}

function failureText(result: SingleResult): string {
  return [result.errorMessage, result.stderr, getFinalOutput(result.messages)].filter(Boolean).join("\n");
}

export function classifyFailure(result: SingleResult): { category: FailureCategory; reason: string } | undefined {
  const text = failureText(result);
  const lower = text.toLowerCase();

  if (result.stopReason === "aborted") return { category: "ABORTED", reason: "Subagent process was aborted by the caller." };
  if (/\b(enoent|eacces)\b/i.test(text) || lower.includes("command not found") || lower.includes("permission denied") || lower.includes("no such file or directory")) {
    return { category: "ENV_ERROR", reason: "Failure text indicates a missing command/file or permission problem." };
  }
  if (/\b429\b/.test(text) || lower.includes("rate limit") || lower.includes("context length") || lower.includes("model not found") || lower.includes("api key") || lower.includes("authentication")) {
    return { category: "MODEL_ERROR", reason: "Failure text indicates a model/API/provider problem." };
  }
  if (isFailedResult(result)) return { category: "UNKNOWN", reason: "Subagent failed without a recognized category." };
  return undefined;
}

function applyFailureClassification(result: SingleResult): void {
  const classified = classifyFailure(result);
  if (!classified) return;
  result.failureCategory = classified.category;
  result.failureReason = classified.reason;
}

export function getResultOutput(result: SingleResult): string {
  const finalOutput = getFinalOutput(result.messages);
  if (result.errorMessage) return result.errorMessage;
  if (finalOutput) return finalOutput;
  if (result.stderr) return result.stderr;
  return "(no output)";
}

export function truncateOutput(output: string): string {
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes <= SUBAGENT_PER_RESULT_CAP) return output;
  let truncated = output.slice(0, SUBAGENT_PER_RESULT_CAP);
  while (Buffer.byteLength(truncated, "utf8") > SUBAGENT_PER_RESULT_CAP) truncated = truncated.slice(0, -1);
  return `${truncated}\n\n[Output truncated: ${bytes - Buffer.byteLength(truncated, "utf8")} bytes omitted.]`;
}

// Handle one line of pi --mode json output.
export function processPiJsonLine(result: SingleResult, line: string): void {
  if (!line.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  const event = parsed as {
    type?: string;
    message?: {
      role?: string;
      usage?: Partial<UsageStats> & { totalTokens?: number; cost?: { total?: number } };
      model?: string;
      stopReason?: string;
      errorMessage?: string;
      content?: unknown;
    };
  };

  if (event.type === "message_end" && event.message) {
    const msg = event.message;
    result.messages.push(msg);
    if (msg.role === "assistant") {
      result.usage.turns++;
      const usage = msg.usage;
      if (usage) {
        result.usage.input += usage.input || 0;
        result.usage.output += usage.output || 0;
        result.usage.cacheRead += usage.cacheRead || 0;
        result.usage.cacheWrite += usage.cacheWrite || 0;
        result.usage.cost += usage.cost?.total || 0;
        result.usage.contextTokens = usage.totalTokens || result.usage.contextTokens;
      }
      if (!result.model && msg.model) result.model = msg.model;
      if (msg.stopReason) result.stopReason = msg.stopReason;
      if (msg.errorMessage) result.errorMessage = msg.errorMessage;
    }
  }

  if ((event.type === "tool_result_end" || event.type === "tool_result") && event.message) {
    result.messages.push(event.message);
  }
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let next = 0;

  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
  return { command: "pi", args };
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pe-subagent-"));
  const filePath = path.join(tmpDir, `system-${agentName.replace(/[^\w.-]+/g, "_")}.md`);
  await fsp.writeFile(filePath, prompt, { encoding: "utf8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

const VISION_MODEL_PLACEHOLDER = "__PE_VISION_MODEL__";

export async function runSingleAgent(options: {
  cwd: string;
  agents: AgentConfig[];
  agentName: string;
  task: string;
  signal?: AbortSignal;
}): Promise<SingleResult> {
  const { cwd, agents, agentName, task, signal } = options;

  const agent = agents.find((candidate) => candidate.name === agentName);
  const emptyUsage: UsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
  if (!agent) {
    return {
      agent: agentName,
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: ${agentName}. Available agents: ${(typeof formatAgentList === "function" ? formatAgentList(agents) : agents.map((a) => a.name).join(", "))}.`,
      usage: emptyUsage,
      failureCategory: "UNKNOWN",
      failureReason: "Requested agent is not available.",
    };
  }

  if (task.length > MAX_SUBAGENT_TASK_CHARS) {
    return {
      agent: agent.name,
      task,
      exitCode: 1,
      messages: [],
      stderr: `Task too long (${task.length} chars, limit ${MAX_SUBAGENT_TASK_CHARS}). Split the task or reduce the context.`,
      usage: emptyUsage,
      failureCategory: "ENV_ERROR",
      failureReason: "Subagent task exceeds maximum length; may cause E2BIG when spawning pi.",
    };
  }

  // --mode json captures the event stream; --no-session avoids child session polluting main session.
  const args = ["--mode", "json", "-p", "--no-session"];
  const devExtensionPath = process.env.PE_DEV_EXTENSION_PATH;
  if (devExtensionPath) args.push("-e", devExtensionPath);

  // vision model resolution: looker uses the visionModel configured in @cynos-ai/tools.
  let agentModel = agent.model;
  if (agentModel === VISION_MODEL_PLACEHOLDER) {
    agentModel = await readToolsVisionModel();
    if (!agentModel) {
      return {
        agent: agent.name,
        task,
        exitCode: 1,
        messages: [],
        stderr: `visionModel is not configured. Run /cynos-tools-config to choose a vision model, or set it in the tools config file (~/.pi/agent/cynos-tools.json):\n{ "visionModel": "provider/model-id" }\nNote: visionModel must be a multimodal model that supports image input.`,
        usage: emptyUsage,
        failureCategory: "ENV_ERROR",
        failureReason: "looker requires a configured visionModel before it can run.",
      };
    }
  }
  if (agentModel) args.push("--model", agentModel);
  if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;
  // Timeout-related variables hoisted outside try for finally cleanup.
  let timeoutTimer: NodeJS.Timeout | undefined;
  let internalController: AbortController | undefined;
  let onExternalAbort: (() => void) | undefined;

  const result: SingleResult = {
    agent: agent.name,
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: emptyUsage,
    model: agentModel,
  };

  try {
    // Assemble system prompt: role prompt + PROJECT.md context (except for researcher).
    const systemPrompt = await buildSubagentSystemPrompt(agent, cwd);

    if (systemPrompt.trim()) {
      const tmp = await writePromptToTempFile(agent.name, systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPromptPath);
    }

    args.push(`Task: ${task}`);

    // Execution timeout: force abort when a subagent runs away.
    // Take whichever fires first vs. the outer signal: either abort kills the child.
    // Default SUBAGENT_TIMEOUT_MINUTES, overridable by config.subagentTimeoutMinutes.
    const timeoutMs = await getSubagentTimeoutMs(cwd);
    internalController = new AbortController();
    timeoutTimer = setTimeout(() => internalController!.abort(), timeoutMs);
    onExternalAbort = () => internalController!.abort();
    if (signal) {
      if (signal.aborted) internalController.abort();
      else signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      let closed = false;
      let killTimer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (killTimer) clearTimeout(killTimer);
      };

      const proc = spawn(invocation.command, invocation.args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // Mark as child process: main-agent-only tools won't register.
          PE_CHILD: "1",
          PE_AGENT_NAME: agentName,
          // Neutral role for @cynos-ai/tools activation: tells Tools which subset
          // (if any) to register in this subagent. researcher gets search/fetch;
          // others get nothing and rely on the --tools whitelist instead.
          CYNOS_AGENT_ROLE: agentName,
        },
      });

      let buffer = "";
      const processLine = (line: string) => processPiJsonLine(result, line);

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        result.stderr += data.toString();
      });

      proc.on("close", (code) => {
        cleanup();
        closed = true;
        if (buffer.trim()) processLine(buffer);
        resolve(code ?? 0);
      });

      proc.on("error", (error) => {
        cleanup();
        closed = true;
        result.errorMessage = error instanceof Error ? error.message : String(error);
        resolve(1);
      });

      internalController!.signal.addEventListener(
        "abort",
        () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          killTimer = setTimeout(() => { if (!closed) proc.kill("SIGKILL"); }, 5000);
        },
        { once: true },
      );
    });

    result.exitCode = exitCode;
    if (wasAborted) result.stopReason = "aborted";
    // Mark whether aborted due to timeout (externalAborted stays false when outer signal fires).
    if (wasAborted && !(signal?.aborted)) result.failureReason = `Subagent exceeded the execution timeout (${timeoutMs} ms) and was aborted.`;
    applyFailureClassification(result);
    return result;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (signal && onExternalAbort) signal.removeEventListener("abort", onExternalAbort);
    if (tmpPromptPath) try { fs.unlinkSync(tmpPromptPath); } catch { /* ignore */ }
    if (tmpPromptDir) try { fs.rmdirSync(tmpPromptDir); } catch { /* ignore */ }
  }
}
