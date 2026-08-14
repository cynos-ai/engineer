// subagent/index.ts - cynos_subagent tool registration
//
// Adapted from pi-ouroboros subagent/index.ts and the pi official subagent example.
// Supports single-agent mode and read-only parallel mode.
//
// Subagent permission boundary:
// - Read-only assistance: no Work modification, no finish, no direct PROJECT.md updates.
// - The main agent decides whether to adopt results and write to completionEvidence.
//
// Parallel mode is limited to read-only agents to prevent concurrent write conflicts.

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { discoverAgents, formatAgentList } from "./agents";
import {
  getResultOutput,
  isFailedResult,
  mapWithConcurrencyLimit,
  MAX_CONCURRENCY,
  MAX_PARALLEL_TASKS,
  MAX_SUBAGENT_TASK_CHARS,
  runSingleAgent,
  truncateOutput,
  type SingleResult,
  type SubagentResultDetails,
} from "./runner";

// Read-only agent set, allowed to run in parallel.
const READONLY_PARALLEL_AGENTS = new Set(["explorer", "researcher", "reviewer", "challenger", "looker"]);

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const SUBAGENT_ROLE_LABELS: Record<string, string> = {
  reviewer: "Review",
  challenger: "Challenge",
  explorer: "Explore",
  researcher: "Research",
  looker: "Vision",
};

function roleLabel(agent: unknown): string {
  if (typeof agent !== "string" || !agent.trim()) return "Unknown";
  return SUBAGENT_ROLE_LABELS[agent] ?? agent.slice(0, 1).toUpperCase() + agent.slice(1);
}

function renderSubagentLabel(agent: unknown, theme: Theme): string {
  return theme.fg("warning", roleLabel(agent)) + theme.fg("muted", " subagent");
}

const TaskItem = Type.Object({
  agent: Type.String({ description: "Read-only agent name." }),
  task: Type.String({ description: "Task prompt." }),
  context: Type.Optional(Type.String({ description: "Optional background information." })),
  focus: Type.Optional(Type.String({ description: "Optional focus direction." })),
});

export function registerSubagentTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "cynos_subagent",
    label: "Cynos Subagent",
    description:
      "Calls the five Cynos read-only subagents: explorer (local exploration), researcher (external references), reviewer (general review), challenger (challenges assumptions), and looker (visual analysis). " +
      "Supports single-agent mode and read-only parallel mode. Subagents only return results and do not modify Work state. Whether to adopt the results and write them into completionEvidence is decided by the main agent.",
    promptSnippet: "Delegate read-only exploration/research/review/challenge/vision to a Cynos subagent",
    promptGuidelines: [
      "Use cynos_subagent when you need independent exploration, research, review, challenge, or visual analysis without polluting the main context.",
      "cynos_subagent results are advisory only — decide yourself whether to adopt them in the final completionEvidence.",
      "Subagents except researcher automatically receive PROJECT.md context when it exists; this is context only and does not replace the main work's responsibility to consult project docs when they affect correctness.",
      "docs/testing.md and docs/release.md are not auto-injected. If verification or release readiness matters, explicitly ask the subagent to read those files in the task.",
      "Use parallel mode (tasks array) for independent read-only investigations; results merge in the main agent.",
    ],
    parameters: Type.Object({
      agent: Type.Optional(Type.String({ description: "Agent name for single-agent mode." })),
      task: Type.Optional(Type.String({ description: "Task prompt for single-agent mode." })),
      context: Type.Optional(Type.String({ description: "Optional background information, e.g. the current goal, known constraints, or existing findings." })),
      focus: Type.Optional(Type.String({ description: "Optional focus direction, e.g. reviewer's implementation/goal/scope/verification/design/delivery." })),
      tasks: Type.Optional(Type.Array(TaskItem, { description: "Read-only parallel task list." })),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agents = discoverAgents().agents;
      const availableAgentNames = new Set(agents.map((a) => a.name));

      const agent = nonEmptyString(params.agent);
      const task = nonEmptyString(params.task);
      const tasks = Array.isArray(params.tasks) ? params.tasks : [];

      const hasSingleMode = Boolean(agent && task);
      const hasParallelMode = tasks.length > 0;
      const modeCount = Number(hasSingleMode) + Number(hasParallelMode);

      if (modeCount !== 1) {
        const details: SubagentResultDetails = { results: [], agent };
        return {
          content: [{ type: "text" as const, text: `Invalid parameters. Specify exactly one mode (agent+task or tasks). Available agents: ${formatAgentList(agents)}` }],
          details,
          isError: true,
        };
      }

      if (hasSingleMode) {
        return await runSingleMode(pi, ctx, agents, agent!, task!, params, signal, onUpdate);
      }

      // parallel mode
      return await runParallelMode(ctx, agents, availableAgentNames, tasks, signal, onUpdate);
    },

    renderCall(args: any, theme: Theme) {
      if (args.tasks?.length) {
        const labels = (args.tasks as any[]).map((t: any) => renderSubagentLabel(t.agent, theme));
        let text = theme.fg("toolTitle", theme.bold("Subagents ")) + theme.fg("accent", `${args.tasks.length} parallel`);
        for (const label of labels) text += `\n  ${label}`;
        return new Text(text, 0, 0);
      }
      const taskPreview = (args.task || "").slice(0, 60);
      const text =
        renderSubagentLabel(args.agent || "?", theme) +
        theme.fg("muted", `: "${taskPreview}${taskPreview.length >= 60 ? "..." : ""}"`);
      return new Text(text, 0, 0);
    },

    renderResult(result: any, { expanded, isPartial }: { expanded: boolean; isPartial: boolean }, theme: Theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Running..."), 0, 0);
      }

      const details = result.details as any;
      const succeeded = details?.succeeded;
      const agent = details?.agent;

      if (agent === "parallel") {
        const total = details?.total ?? 0;
        const ok = details?.succeeded ?? 0;
        const color = ok === total ? "success" : ok > 0 ? "warning" : "error";
        let text = theme.fg(color, `Subagents ${ok}/${total} completed`);
        text += theme.fg("muted", expanded ? " (Ctrl+O to collapse)" : " (Ctrl+O to expand)");
        if (details?.results) {
          for (const r of details.results) {
            const rOk = !isFailedResult(r);
            const marker = theme.fg(rOk ? "success" : "error", rOk ? "✓" : "✗");
            text += `\n  ${marker} ${renderSubagentLabel(r.agent, theme)}`;
          }
        }
        return new Text(text, 0, 0);
      }

      const usage = details?.results?.[0]?.usage;
      let text = `${theme.fg(succeeded ? "success" : "error", succeeded ? "✓" : "✗")} ${renderSubagentLabel(agent || "?", theme)} ${theme.fg(succeeded ? "success" : "error", succeeded ? "completed" : "failed")}`;

      if (usage?.turns) {
        text += theme.fg("muted", ` (${usage.turns} turns, ${formatUsageCost(usage)})`);
      }

      text += theme.fg("muted", expanded ? " (Ctrl+O to collapse)" : " (Ctrl+O to expand)");

      if (expanded) {
        const content = result.content?.[0];
        if (content?.type === "text") {
          const lines = content.text.split("\n");
          const visible = lines.slice(0, 10);
          for (const line of visible) {
            text += `\n  ${theme.fg("dim", line)}`;
          }
          if (lines.length > 10) {
            text += `\n  ${theme.fg("muted", `... (${lines.length - 10} more lines)`)}`;
          }
        }
      }
      return new Text(text, 0, 0);
    },
  });
}

async function runSingleMode(
  pi: ExtensionAPI,
  ctx: any,
  agents: ReturnType<typeof discoverAgents>["agents"],
  agent: string,
  task: string,
  params: any,
  signal: AbortSignal | undefined,
  onUpdate: any,
) {
  if (task.length > MAX_SUBAGENT_TASK_CHARS) {
    return {
      content: [{ type: "text" as const, text: `Task too long (${task.length} chars, limit ${MAX_SUBAGENT_TASK_CHARS}). Split the task.` }],
      details: { results: [], agent } as SubagentResultDetails,
      isError: true,
    };
  }

  // Concatenate context and focus into the task.
  const fullTask = buildFullTask(task, params.context, params.focus);

  onUpdate?.({ content: [{ type: "text" as const, text: `Starting ${agent}: ${task.slice(0, 80)}...` }], details: { results: [], agent } });

  const result = await runSingleAgent({ cwd: ctx.cwd, agents, agentName: agent, task: fullTask, signal });
  const output = getResultOutput(result);

  const details: SubagentResultDetails = { results: [result], agent, succeeded: !isFailedResult(result) };
  return {
    content: [{ type: "text" as const, text: `${output}\n\n---\nThe result is for reference only. Whether to adopt it and write it into completionEvidence is decided by the main agent.` }],
    details,
    isError: isFailedResult(result),
  };
}

async function runParallelMode(
  ctx: any,
  agents: ReturnType<typeof discoverAgents>["agents"],
  availableAgentNames: Set<string>,
  tasks: any[],
  signal: AbortSignal | undefined,
  onUpdate: any,
) {
  if (tasks.length > MAX_PARALLEL_TASKS) {
    return {
      content: [{ type: "text" as const, text: `Too many parallel tasks. Limit ${MAX_PARALLEL_TASKS}.` }],
      details: { results: [], agent: "parallel" } as SubagentResultDetails,
      isError: true,
    };
  }

  const normalized = tasks.map((item: any) => ({
    agent: nonEmptyString(item.agent),
    task: nonEmptyString(item.task),
    context: nonEmptyString(item.context),
    focus: nonEmptyString(item.focus),
  }));

  const malformed = normalized.find((item) => !item.agent || !item.task);
  if (malformed) {
    return {
      content: [{ type: "text" as const, text: "Invalid parallel task. Each task needs a non-empty agent and task." }],
      details: { results: [], agent: "parallel" } as SubagentResultDetails,
      isError: true,
    };
  }

  const tooLong = normalized.find((item) => item.task!.length > MAX_SUBAGENT_TASK_CHARS);
  if (tooLong) {
    return {
      content: [{ type: "text" as const, text: `Task for agent "${tooLong.agent}" is too long (${tooLong.task!.length} chars, limit ${MAX_SUBAGENT_TASK_CHARS}).` }],
      details: { results: [], agent: "parallel" } as SubagentResultDetails,
      isError: true,
    };
  }

  const unknown = normalized.find((item) => !availableAgentNames.has(item.agent!));
  if (unknown) {
    return {
      content: [{ type: "text" as const, text: `Unknown agent: ${unknown.agent}. Available agents: ${formatAgentList(agents)}.` }],
      details: { results: [], agent: "parallel" } as SubagentResultDetails,
      isError: true,
    };
  }

  const invalid = normalized.find((item) => !READONLY_PARALLEL_AGENTS.has(item.agent!));
  if (invalid) {
    return {
      content: [{ type: "text" as const, text: `Agent ${invalid.agent} is not allowed in read-only parallel mode.` }],
      details: { results: [], agent: "parallel" } as SubagentResultDetails,
      isError: true,
    };
  }

  onUpdate?.({ content: [{ type: "text" as const, text: `Running ${normalized.length} agents in parallel...` }], details: { results: [], agent: "parallel" } });

  const results = await mapWithConcurrencyLimit(normalized, MAX_CONCURRENCY, async (item, index) => {
    try {
      const fullTask = buildFullTask(item.task!, item.context, item.focus);
      const result = await runSingleAgent({ cwd: ctx.cwd, agents, agentName: item.agent!, task: fullTask, signal });
      return result;
    } catch (error) {
      const fallback: SingleResult = {
        agent: item.agent!,
        task: item.task!,
        exitCode: 1,
        messages: [],
        stderr: "",
        errorMessage: error instanceof Error ? error.message : String(error),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      };
      return fallback;
    }
  });

  const succeeded = results.filter((r) => !isFailedResult(r)).length;
  const text = `Parallel: ${succeeded}/${results.length} succeeded\n\n${results
    .map((r) => `### ${r.agent} ${isFailedResult(r) ? "FAILED" : "OK"}\n\n${truncateOutput(getResultOutput(r))}`)
    .join("\n\n---\n\n")}`;
  const details: SubagentResultDetails = { results, agent: "parallel", succeeded, total: results.length };
  return { content: [{ type: "text" as const, text }], details, isError: succeeded !== results.length };
}

function buildFullTask(task: string, context?: string, focus?: string): string {
  const parts: string[] = [];
  if (focus) parts.push(`Focus: ${focus}`);
  if (context) parts.push("", "Context:", context);
  parts.push("", "Task:", task);
  return parts.join("\n");
}

function formatUsageCost(usage: any): string {
  if (!usage) return "";
  const total = (usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
  if (total >= 1000000) return `$${(usage.cost || 0).toFixed(2)}`;
  return `${Math.round(total / 1000)}k tokens`;
}
