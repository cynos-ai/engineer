import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getPractice } from "../practices/registry";
import { formatCheckAttempts } from "./report";
import { PRACTICE_IDS } from "../practices/ids";
import { isBrowserEvidenceResult } from "../practices/helpers";
import { submitCompletionEvidence } from "./completion-check";
import { abandonWork, askUser, loadCurrentWork, readLastOutcome, resumeWork, startWork } from "./state";
import { renderCheckResult, renderStartResult, renderStatusResult } from "./render";
import type { CapturedToolResult, CheckResult, WorkState } from "./types";
import type { Theme } from "@earendil-works/pi-coding-agent";

export function registerWorkTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "cynos_start_work",
    label: "Cynos Start Work",
    description: "Create a Cynos work record with a selected practice, objective, and acceptance criteria. Refuses when another work is active or state is corrupted.",
    promptSnippet: "Start a Cynos work with a practice, objective, and acceptance criteria",
    promptGuidelines: [
      "Use cynos_start_work when the user asks for engineering work that changes, reviews, or validates something.",
      "Follow the Cynos routing rules and choose the most specific practice: review, test, docs, onboard, init, debug, develop, refactor, ui-design, usability, release. Use default only as a lightweight fallback after no specific practice fits; .gitignore/.editorconfig/root LICENSE* are examples, not the full identity of default. Pure verification-as-deliverable uses test.",
      "Chat-only advice, generic Q&A, and project-external personal/agent configuration need no project practice. Testing/validating existing behavior by running it uses test; written docs/reports use docs; runtime config and implementation use develop or a more specific modifying practice.",
      "Write concrete acceptanceCriteria. These become criterion-1, criterion-2, ... and must be covered in cynos_check_completion completionEvidence.criteriaCoverage.",
    ],
    parameters: Type.Object({
      practice: Type.Optional(Type.Union(PRACTICE_IDS.map((id) => Type.Literal(id)))),
      objective: Type.String(),
      acceptanceCriteria: Type.Array(Type.String()),
      acknowledgeDirtyTree: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const p = params as any;
        const work = await startWork(ctx.cwd, {
          practice: p.practice,
          objective: p.objective,
          acceptanceCriteria: p.acceptanceCriteria,
          acknowledgeDirtyTree: p.acknowledgeDirtyTree === true,
        });
        return toolText("Cynos Start Work", formatStart(work), { work });
      } catch (error) {
        return toolError("Cynos Start Work", error);
      }
    },
    renderResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme) {
      return renderStartResult(result.details?.work as WorkState | undefined, options, theme);
    },
  });

  pi.registerTool({
    name: "cynos_work_status",
    label: "Cynos Work Status",
    description: "Read the current work, the last outcome, and the most recent completion-check status.",
    promptSnippet: "Check current Cynos work status, captured tool results, and checkpoints",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      try {
        const loaded = await loadCurrentWork(ctx.cwd);
        const last = await readLastOutcome(ctx.cwd);
        const work = loaded.kind === "valid" ? loaded.work : undefined;
        return toolText("Cynos Work Status", formatStatus(loaded, last), { work });
      } catch (error) {
        return toolError("Cynos Work Status", error);
      }
    },
    renderResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme) {
      const work = result.details?.work as WorkState | undefined;
      return renderStatusResult(work, options, theme);
    },
  });

  pi.registerTool({
    name: "cynos_check_completion",
    label: "Cynos Check Completion",
    description:
      "Submit completionEvidence once and run the completion checkpoints; if all pass, it automatically marks done and archives, otherwise it returns the gaps and the evidence structure expected by the current practice." +
      "The structure of completionEvidence is determined by the practice. General requirement: criteriaCoverage must be an array [{criterionId, summary}], and criterionId must match the id in work.acceptanceCriteria.",
    promptSnippet: "Submit completion evidence, check checkpoints, and finish if all pass",
    promptGuidelines: [
      "Call cynos_check_completion only when you believe the work is ready to finish.",
      "This call submits completionEvidence and checks it in one step. There is no separate finish tool.",
      "For default work, do not claim completion unless a real successful verification command exists in capturedToolResults. Run npm test/build/verify (or equivalent) first.",
      "For review work, report.overall must be pass | needs-work | blocked; finding.severity must be blocking | important | minor.",
    ],
    parameters: Type.Object({
      completionEvidence: Type.Record(Type.String(), Type.Any()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const result = await submitCompletionEvidence(ctx.cwd, (params as any).completionEvidence ?? {});
        return toolText("Cynos Check Completion", formatCheckResult(result.work, result.check, result.archived, result.archivePath), {
          work: result.work,
          check: result.check,
          archived: result.archived,
          archivePath: result.archivePath,
        });
      } catch (error) {
        return toolError("Cynos Check Completion", error);
      }
    },
    renderResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme) {
      const d = result.details;
      return renderCheckResult(d?.work as WorkState | undefined, d?.check as CheckResult | undefined, d?.archived as boolean, d?.archivePath as string | undefined, options, theme);
    },
  });

  pi.registerTool({
    name: "cynos_ask_user",
    label: "Cynos Ask User",
    description: "Pause the active work as waiting-for-user and record the pendingQuestion. Use it only when the user's answer would block the next safe step, involves authorization / long-term decisions, or needs an audit record; do not use it for ordinary non-blocking questions.",
    promptSnippet: "Pause active work for a blocking/auditable user decision",
    promptGuidelines: [
      "Use cynos_ask_user when the WHY is correctness risk, authorization risk, durable-memory/audit value, or a true pause before continuing active work.",
      "Do not use cynos_ask_user for every question. If the question is non-blocking, conversational, before work starts, or after work is done, ask normally.",
      "If you call cynos_ask_user, stop working until cynos_resume_work records the user's answer.",
    ],
    parameters: Type.Object({ question: Type.String() }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const work = await askUser(ctx.cwd, (params as any).question);
        return toolText("Cynos Ask User", `Work ${work.id} is waiting for user:\n${work.pendingQuestion}`);
      } catch (error) {
        return toolError("Cynos Ask User", error);
      }
    },
  });

  pi.registerTool({
    name: "cynos_resume_work",
    label: "Cynos Resume Work",
    description: "Resume the waiting-for-user current work and record the user's answer summary.",
    promptSnippet: "Resume current work with the user's answer summary",
    parameters: Type.Object({ answerSummary: Type.String() }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const work = await resumeWork(ctx.cwd, (params as any).answerSummary);
        return toolText("Cynos Resume Work", `Work ${work.id} resumed. Status: ${work.status}`);
      } catch (error) {
        return toolError("Cynos Resume Work", error);
      }
    },
  });

  pi.registerTool({
    name: "cynos_abandon_work",
    label: "Cynos Abandon Work",
    description: "Explicitly abandon the current work and archive the abandoned work.",
    promptSnippet: "Abandon and archive the current Cynos work",
    parameters: Type.Object({ reason: Type.String() }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const work = await loadCurrentWork(ctx.cwd);
        const last = await abandonWork(ctx.cwd, (params as any).reason);
        return toolText("Cynos Abandon Work", `Abandoned: ${last.workId}\nArchive: ${last.archivePath}`);
      } catch (error) {
        return toolError("Cynos Abandon Work", error);
      }
    },
  });
}

function formatStart(work: WorkState): string {
  const practice = getPractice(work.practice);
  const dirtyNote = work.dirtyTreeAtStart && work.dirtyTreeAtStart.length > 0
    ? [
        "",
        "⚠️ At start the working tree had leftover uncommitted changes the user confirmed to keep (recorded for audit):",
        ...work.dirtyTreeAtStart.slice(0, 15).map((file) => `  - ${file}`),
        ...(work.dirtyTreeAtStart.length > 15 ? [`  ...(and ${work.dirtyTreeAtStart.length - 15} more omitted)`] : []),
        "When finalizing the commit, clarify whether these are committed together (see the local commit policy).",
      ]
    : [];
  return [
    `Work ID: ${work.id}`,
    `Practice: ${work.practice}`,
    `Objective: ${work.objective}`,
    "",
    "Acceptance Criteria:",
    ...work.acceptanceCriteria.map((criterion) => `- ${criterion.id}: ${criterion.description}`),
    "",
    "Checkpoints:",
    ...practice.checkpoints.map((checkpoint) => `- ${checkpoint.id}: ${checkpoint.rule}`),
    "",
    `Methodology: ${practice.methodology}`,
    `Guidance: ${practice.guidance.whenToUse}`,
    ...dirtyNote,
    "",
    "completionEvidence expected structure (must be strictly followed when submitting to cynos_check_completion):",
    practice.evidenceSchema,
  ].join("\n");
}

function formatStatus(loaded: Awaited<ReturnType<typeof loadCurrentWork>>, last: Awaited<ReturnType<typeof readLastOutcome>>): string {
  if (loaded.kind === "none") {
    return last ? `No active work. Last: ${last.workId} ${last.status} ${last.objective}` : "No active work.";
  }
  if (loaded.kind === "corrupted") return `Corrupted work: ${loaded.reason}\n${loaded.details}`;
  const work = loaded.work;
  const lines = [
    `Work ID: ${work.id}`,
    `Practice: ${work.practice}`,
    `Status: ${work.status}`,
    `Objective: ${work.objective}`,
    "Acceptance Criteria:",
    ...work.acceptanceCriteria.map((criterion) => `- ${criterion.id}: ${criterion.description}`),
    `Captured tool results: ${work.capturedToolResults?.length ?? 0}`,
    ...formatCapturedEvidenceSummary(work),
  ];
  if (work.pendingQuestion) lines.push(`Pending question: ${work.pendingQuestion}`);
  if (work.lastCheck) lines.push("", formatCheck(work.lastCheck));
  lines.push(...formatCheckAttempts(work));
  return lines.join("\n");
}

function formatCapturedEvidenceSummary(work: WorkState): string[] {
  const results = work.capturedToolResults ?? [];
  if (results.length === 0 && (work.capturedUserAnswers?.length ?? 0) === 0) return [];

  const reads = unique(results
    .filter((result) => result.toolName === "read" && !result.isError)
    .map((result) => evidencePath(result))
    .filter(Boolean));
  const writes = unique(results
    .filter((result) => ["write", "edit"].includes(result.toolName) && !result.isError)
    .map((result) => evidencePath(result))
    .filter(Boolean));
  const bash = results
    .filter((result) => result.toolName === "bash")
    .map((result) => `${evidenceCommand(result)} ${result.isError ? "❌" : "✅"}`)
    .filter((item) => item.trim() !== (item.endsWith("✅") ? "✅" : "❌"));
  const browser = results.filter((result) => isBrowserEvidenceResult(result)).length;
  const users = work.capturedUserAnswers?.length ?? 0;

  return [
    "Captured evidence:",
    `  Reads: ${formatList(reads)}`,
    `  Writes: ${formatList(writes)}`,
    `  Bash: ${formatList(bash)}`,
    `  Browser: ${browser}`,
    `  User answers: ${users}`,
  ];
}

function evidencePath(result: CapturedToolResult): string {
  const value = result.metadata?.path ?? result.input.path ?? result.input.filePath ?? result.input.filename ?? result.input.target;
  return typeof value === "string" ? value : "";
}

function evidenceCommand(result: CapturedToolResult): string {
  const value = result.metadata?.command ?? result.input.command;
  return typeof value === "string" ? compact(value, 100) : "";
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function formatList(items: string[], max = 8): string {
  if (items.length === 0) return "none";
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown}, ... (+${items.length - max})` : shown;
}

function compact(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function formatCheckResult(work: WorkState, check: CheckResult, archived: boolean, archivePath?: string): string {
  const lines = [
    `Work ID: ${work.id}`,
    `Practice: ${work.practice}`,
    `All satisfied: ${check.allSatisfied ? "yes" : "no"}`,
    formatCheck(check),
  ];
  if (archived) {
    lines.push("", `Done and archived: ${archivePath}`);
  } else {
    const practice = getPractice(work.practice);
    lines.push(
      "",
      "Work remains active. Address missing checkpoints and call cynos_check_completion again.",
      "",
      "How to fix: first follow the Missing reason above to add real evidence or tool calls; do not read Cynos source, checkpoint source, or session logs to guess internal implementation / find toolCallId. toolCallId-like fields are all optional enhancements; if you do not know them, delete/leave them empty and the system will auto-infer from capturedToolResults by path, command, and browser evidence.",
      "",
      "completionEvidence expected structure (strictly follow):",
      practice.evidenceSchema,
    );
  }
  return lines.join("\n");
}

function formatCheck(check: CheckResult): string {
  const lines = ["Checkpoint results:"];
  for (const result of check.results) {
    lines.push(`- ${result.id}: ${result.satisfied ? "✅" : "❌"}${result.reason ? ` ${result.reason}` : ""}${result.details ? ` (${result.details})` : ""}`);
  }
  if (check.missing.length > 0) lines.push("Missing:", ...check.missing.map((item) => `- ${item}`));
  return lines.join("\n");
}

function toolText(title: string, text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text: `${title}\n\n${text}` }], details };
}

function toolError(title: string, error: unknown) {
  return { content: [{ type: "text" as const, text: `${title} failed: ${error instanceof Error ? error.message : String(error)}` }], details: {}, isError: true };
}
