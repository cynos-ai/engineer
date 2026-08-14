import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { pathExists } from "../infra/fs-utils";
import { packageRoot, workPath } from "../infra/paths";
import { getLanguagePreference, getWorkAwareCompactionSettings, languageInstruction } from "../infra/config";
import { loadCurrentWork, readLastOutcome, clearPreStartBuffer } from "../core/state";
import { allPractices, getPractice } from "../practices/registry";
import { actionableConcerns } from "../practices/concern-runner";
import { isReleaseSideEffectCommand } from "../practices/helpers";
import { evaluateNoWorkMutation } from "../practices/no-work-gate";
import { evaluateActiveWorkScope } from "../practices/active-work-scope-guard";

export function registerResourcesHook(pi: ExtensionAPI): void {
  pi.on("resources_discover", async () => {
    return { skillPaths: [path.join(packageRoot(), "skills")] };
  });
}

export function registerSessionHook(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    // Pre-start buffer is session-scoped (in-memory); clear on session start so a previous
    // session's exploration cannot leak in. Goes through the per-cwd mutex.
    await clearPreStartBuffer(ctx.cwd).catch(() => undefined);
    try {
      const loaded = await loadCurrentWork(ctx.cwd);
      if (loaded.kind === "valid") {
        const work = loaded.work;

        safeSend(pi, {
          customType: "cynos-reminder",
          content: [
            "📋 An in-progress Cynos work was detected.",
            `Objective: ${work.objective}`,
            `Practice: ${work.practice} | Status: ${work.status}`,
            `Captured tool results: ${work.capturedToolResults?.length ?? 0}`,
            work.pendingQuestion ? `Pending question: ${work.pendingQuestion}` : undefined,
            "",
            "Use /cynos-report or cynos_work_status to see the full state.",
          ].filter(Boolean).join("\n"),
          display: true,
        });
      } else if (loaded.kind === "corrupted") {
        safeSend(pi, {
          customType: "cynos-reminder",
          content: `⚠️ Cynos state corrupted: ${loaded.reason}\n${loaded.details}\n\nPlease handle the leftover files manually before continuing.`,
          display: true,
        });
      }
    } catch {
      // best-effort
    }
  });

  // Session teardown: clear the pre-start buffer so a reused/reloaded extension instance
  // cannot leak the previous session's exploration. Goes through the per-cwd mutex.
  pi.on("session_shutdown", async (_event, ctx) => {
    await clearPreStartBuffer(ctx.cwd).catch(() => undefined);
  });
}

export function registerPromptHook(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    // New user prompt boundary: clear the pre-start buffer so the previous prompt's
    // exploration cannot contaminate this prompt's work. Goes through the per-cwd mutex
    // to avoid racing an in-flight capture. See pre-start-capture-2026-06.md.
    await clearPreStartBuffer(ctx.cwd);
    let protocol = `
## Cynos

Audited engineering work must use a Cynos work record: start with cynos_start_work and finish with cynos_check_completion. Generic Q&A, chat-only advice, project-external personal/agent config, or follow-up clarification that does not require new audited work may be answered directly.
`;

    try {
      const language = await getLanguagePreference(ctx.cwd);
      protocol += `\n## User language preference\n\n${languageInstruction(language)}\n`;
    } catch {
      // best-effort
    }

    try {
      const loaded = await loadCurrentWork(ctx.cwd);
      if (loaded.kind === "valid") {
        const work = loaded.work;
        protocol +=
          `Active Cynos work detected (${work.practice} practice). Objective: ${work.objective}\n` +
          `Status: ${work.status} | Captured tool results: ${work.capturedToolResults?.length ?? 0}\n` +
          `Continue the work freely; finish with cynos_check_completion({ completionEvidence }). Do not claim completion unless the check passes.\n` +
          `If you need the user, decide why first: use cynos_ask_user only when the answer blocks safe progress, authorizes risky work, records a durable decision, or has audit value. Ask normally for non-blocking clarification.\n`;
        if (work.status === "waiting-for-user" && work.pendingQuestion) {
          protocol += [
            `This work is waiting for the user's answer: ${work.pendingQuestion}`,
            "Classify the user message first:",
            "A. Answer to the pending question -> call cynos_resume_work with an answerSummary, then continue.",
            "B. Cancellation, task switch, or unrelated new request -> do not start working; explain there is waiting work and ask whether to abandon it, or call cynos_abandon_work if cancellation is explicit.",
            "C. Insufficient answer -> ask a follow-up question without mutating files.",
            "While waiting-for-user, do not modify, verify, or claim completion until cynos_resume_work returns the work to active.",
          ].join("\n") + "\n";
        }
        if (work.lastCheck && !work.lastCheck.allSatisfied) {
          protocol += `Previous completion check failed: ${work.lastCheck.missing.join("; ")}\nAddress the missing evidence/actions and run cynos_check_completion again, or cynos_abandon_work.\n`;
        }

        // Forward-looking in-process coaching (concern layer). Based on actions already captured,
        // advise the agent where it is / what to do next / whether it is drifting — before the
        // terminal check fails. Advisory only: never blocks and never decides completion.
        // Pilot: injected at prompt boundaries. If smoke shows the agent needs mid-prompt
        // updates (e.g. it reads then writes within one prompt), upgrade to the `context` hook.
        try {
          const practice = getPractice(work.practice);
          const actionable = actionableConcerns(work, practice.concerns);
          if (actionable.length > 0) {
            protocol += "\n## Cynos concerns (advisory — forward-looking, not blocking)\n\n";
            protocol += actionable.map((c) => `- [${c.status}] ${c.guidance}`).join("\n");
            protocol += "\n";
          }
        } catch {
          // best-effort: never let concern rendering break the prompt protocol
        }
      } else if (loaded.kind === "none") {
        const last = await readLastOutcome(ctx.cwd);
        const practiceLines = allPractices().map((p) => `- ${p.id}: ${p.guidance.whenToUse}`).join("\n");
        if (last) {
          protocol +=
            `No active Cynos work. Classify the user message:\n` +
            `A. Normal question or follow-up that only needs explanation/summary/reasoning/tradeoffs -> answer directly; if evidence is needed, read the archive at ${last.archivePath ?? "archive"}.\n` +
            `B. New audited engineering work (modify, verify, commit, release, update files, or execute prior review suggestions) -> choose a practice and call cynos_start_work:\n${practiceLines}\n` +
            `Routing: follow the Cynos skill routing rules. Existing-object judgment -> review; written docs/reports -> docs; implementation/runtime config -> develop or a specific modifying practice; chat-only advice, generic Q&A, and project-external personal/agent config need no project practice.\n` +
            `Previous work (${last.practice}): ${last.objective}\n`;
        } else {
          protocol += `No active Cynos work. New audited engineering work must call cynos_start_work first. Available practices:\n${practiceLines}\nRouting: follow the Cynos skill routing rules. Existing-object judgment -> review; written docs/reports -> docs; implementation/runtime config -> develop or a specific modifying practice; chat-only advice, generic Q&A, and project-external personal/agent config need no project practice.\n`;
        }
      } else {
        protocol += `Cynos state is corrupted: ${loaded.reason}. ${loaded.details}\nResolve the state files manually before continuing.\n`;
      }
    } catch {
      // best-effort
    }

    return { systemPrompt: event.systemPrompt + protocol };
  });
}

// The workId of the last work that triggered compaction. Different works are allowed to trigger again after completion.
let lastCompactedWorkId = "";

export function registerCompactionHook(pi: ExtensionAPI): void {
  pi.on("turn_end", async (_event, ctx) => {
    const settings = await getWorkAwareCompactionSettings(ctx.cwd);
    if (!settings.enabled) return;
    const loaded = await loadCurrentWork(ctx.cwd);
    if (loaded.kind !== "none") return;
    const last = await readLastOutcome(ctx.cwd);
    if (!last) return;
    if (last.workId === lastCompactedWorkId) return;  // do not compact the same work twice
    const usage = ctx.getContextUsage?.();
    if (!usage || usage.percent === null || usage.percent < settings.minContextPercent) return;
    lastCompactedWorkId = last.workId;
    ctx.compact?.({
      customInstructions: [
        "Cynos work-aware compaction.",
        `Previous work ${last.workId} has already been archived under .cynos/archive; keep only its outcome and archive path, not low-level implementation chatter.`,
        "For later questions about previous work, prefer reading .cynos/last-outcome.json and the archived work JSON for evidence instead of relying on compressed conversation memory.",
        "Preserve any current user request and constraints verbatim.",
      ].join("\n"),
    });
  });
}

function safeSend(pi: ExtensionAPI, msg: Parameters<ExtensionAPI["sendMessage"]>[0]): void {
  try { pi.sendMessage(msg); } catch { /* ctx stale after reload — safe to ignore */ }
}


export function registerProtocolGate(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    const decision = await evaluateProtocolGate(ctx.cwd, event.toolName, (event as any).input ?? {});
    if (!decision.block) return undefined;
    return {
      block: true,
      reason: decision.reason,
      message: {
        customType: "cynos-gate",
        display: true,
        content: decision.message,
      },
    };
  });
}

export async function evaluateProtocolGate(cwd: string, toolName: string, input: Record<string, unknown> = {}): Promise<{ block: false } | { block: true; reason: string; message: string }> {
  try {
    const loaded = await loadCurrentWork(cwd);
    if (loaded.kind === "valid") {
      if (loaded.work.status === "active") {
        if (loaded.work.practice !== "release" && toolName === "bash" && isReleaseSideEffectCommand(String(input?.command ?? ""))) {
          return {
            block: true,
            reason: "Cynos gate: release side-effect commands require release practice.",
            message:
              "Cynos gate blocked a release side-effect command.\n\n" +
              "Push, tag, publish, deploy, CI/CD release, and production delivery commands require release practice authorization.\n" +
              "Finish or abandon the current work; after the user confirms the release scope, start cynos_start_work(practice=\"release\").",
          };
        }
        const scope = evaluateActiveWorkScope(cwd, loaded.work, toolName, input);
        if (scope.block) return scope;
        return { block: false };
      }
      if (loaded.work.status === "waiting-for-user") {
        const allowedWaitingPe = new Set(["cynos_resume_work", "cynos_abandon_work", "cynos_work_status"]);
        const readOnly = isReadOnlyTool(toolName);
        if (readOnly || allowedWaitingPe.has(toolName)) return { block: false };
        return {
          block: true,
          reason: "Cynos gate: current work is waiting-for-user. Resume or abandon before mutating/finishing.",
          message:
            "⏸️ **Cynos guardrail: the current work is waiting for the user's answer.**\n\n" +
            "- If this message answers the pending question: first call `cynos_resume_work`.\n" +
            "- If the user wants to cancel/switch tasks: call `cynos_abandon_work`, or first confirm whether to abandon.\n" +
            "- During waiting-for-user, do not continue modifying, verifying, or calling `cynos_check_completion`, to avoid producing uncaptured evidence.",
        };
      }
      return { block: false };
    }
    if (loaded.kind === "corrupted") return { block: false };
  } catch {
    if (await pathExists(workPath(cwd)).catch(() => false)) return { block: false };
  }

  // No active work: blocklist guardrail. Blocks "modifying project content" and "commit/release";
  // exploration, build/test/lint, and read/write of paths outside the project are all allowed (see no-work-gate.ts for details).
  const decision = evaluateNoWorkMutation(cwd, toolName, input);
  if (!decision.block) return { block: false };
  return {
    block: true,
    reason: decision.reason!,
    message: decision.message!,
  };
}

// Read-only tool check for the waiting-for-user branch: only core read-only tools are allowed; bash is always treated as non-read-only
// (during waiting-for-user, no bash should run at all, to avoid uncaptured evidence).
function isReadOnlyTool(toolName: string): boolean {
  const whitelist = new Set(["read", "grep", "find", "ls", "cynos_search", "cynos_fetch", "cynos_vision"]);
  return whitelist.has(toolName);
}
