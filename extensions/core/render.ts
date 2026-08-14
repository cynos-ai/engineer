// render.ts - TUI collapse rendering for cynos_start_work / cynos_check_completion / cynos_work_status
//
// Follows the collapse-display pattern from subagent/index.ts and search/render.ts:
// - Collapsed: one-line summary (practice / status / counts)
// - Expanded: shows details, still truncated, with Ctrl+O expand/collapse hint at the end
// - content (full schema/rules for agent) is kept in tools.ts toolText; here only the human view
//
// Note: pi's ToolExecution component responds to app.tools.expand (default Ctrl+O) for all tools with renderResult.
// But the "(Ctrl+O to expand)" hint must be appended by each tool in renderResult; the framework does not add it uniformly.

import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { CheckResult, WorkState } from "../core/types";
import { getPractice } from "../practices/registry";

interface RenderOptions {
  expanded: boolean;
  isPartial: boolean;
}

const EXPAND_HINT_COLLAPSED = "(Ctrl+O to expand)";
const EXPAND_HINT_EXPANDED = "(Ctrl+O to collapse)";

/** Append a muted expand hint in collapsed state. Show collapse hint when expanded. */
function expandHint(theme: Theme, expanded: boolean): string {
  return theme.fg("muted", expanded ? EXPAND_HINT_EXPANDED : EXPAND_HINT_COLLAPSED);
}

/** Append multi-line body into Text (with dim prefix). Returns fragment for appending to main text. */
function detailLines(lines: string[], theme: Theme, max: number): string {
  const visible = lines.slice(0, max);
  let text = "";
  for (const line of visible) text += `\n  ${theme.fg("dim", line)}`;
  if (lines.length > max) text += `\n  ${theme.fg("muted", `... (${lines.length - max} more lines)`)}`;
  return text;
}

// ---- cynos_start_work ----

export function renderStartResult(work: WorkState | undefined, options: RenderOptions, theme: Theme): Text {
  const { expanded } = options;
  if (!work) return new Text(theme.fg("muted", "Cynos Start Work"), 0, 0);
  const practice = getPractice(work.practice);
  const criteriaCount = work.acceptanceCriteria.length;
  const checkpointCount = practice.checkpoints.length;

  let text = theme.fg("success", "✓ Work started");
  text += theme.fg("accent", ` ${work.practice}`);
  text += theme.fg("muted", ` — ${truncateMiddle(work.objective, 60)}`);
  text += theme.fg("muted", ` (${criteriaCount} criteria, ${checkpointCount} checkpoints)`);

  if (expanded) {
    text += `\n  ${theme.fg("dim", `objective: ${work.objective}`)}`;
    if (criteriaCount > 0) {
      text += `\n  ${theme.fg("dim", "criteria:")}`;
      for (const c of work.acceptanceCriteria) {
        text += `\n    ${theme.fg("dim", `${c.id}: ${c.description}`)}`;
      }
    }
    const ids = practice.checkpoints.map((c) => c.id);
    text += `\n  ${theme.fg("dim", "checkpoints:")}`;
    text += detailLines(ids, theme, 8);
    text += `\n  ${theme.fg("muted", "completionEvidence schema: see the cynos_start_work return content (already sent to the agent)")}`;
    text += ` ${expandHint(theme, expanded)}`;
  } else {
    text += ` ${expandHint(theme, expanded)}`;
  }

  return new Text(text, 0, 0);
}

// ---- cynos_check_completion ----

export function renderCheckResult(
  work: WorkState | undefined,
  check: CheckResult | undefined,
  archived: boolean,
  archivePath: string | undefined,
  options: RenderOptions,
  theme: Theme,
): Text {
  const { expanded } = options;
  if (!work || !check) return new Text(theme.fg("muted", "Cynos Check Completion"), 0, 0);

  if (archived) {
    let text = theme.fg("success", "✓ Done and archived");
    if (archivePath) text += theme.fg("muted", ` — ${archivePath}`);
    return new Text(text, 0, 0);
  }

  const total = check.results.length;
  const failed = check.results.filter((r) => !r.satisfied);
  const failedCount = failed.length;

  let text = theme.fg("warning", `↻ Keep working — ${failedCount}/${total} checkpoints need attention`);
  if (failedCount > 0) {
    const ids = failed.map((r) => r.id);
    text += theme.fg("muted", ` — ${ids.slice(0, 3).join(", ")}${ids.length > 3 ? `, +${ids.length - 3}` : ""}`);
  }

  if (expanded) {
    if (failedCount > 0) {
      text += `\n  ${theme.fg("dim", "needs attention:")}`;
      for (const r of failed) {
        const reason = (r.reason || "").split("\n")[0];
        text += `\n    ${theme.fg("warning", "•")} ${theme.fg("dim", `${r.id}`)}`;
        if (reason) text += `\n      ${theme.fg("dim", truncateMiddle(reason, 100))}`;
      }
    }
    const passed = check.results.filter((r) => r.satisfied);
    if (passed.length > 0) {
      text += `\n  ${theme.fg("dim", `passed (${passed.length}):`)}`;
      text += detailLines(passed.map((r) => r.id), theme, 6);
    }
    text += `\n  ${theme.fg("muted", "Details: see the cynos_check_completion return content; schema: see cynos_start_work")}`;
    text += ` ${expandHint(theme, expanded)}`;
  } else {
    text += ` ${expandHint(theme, expanded)}`;
  }

  return new Text(text, 0, 0);
}

// ---- cynos_work_status ----

export function renderStatusResult(work: WorkState | undefined, options: RenderOptions, theme: Theme): Text {
  const { expanded } = options;
  if (!work) {
    return new Text(theme.fg("muted", "No active work"), 0, 0);
  }

  const reads = uniquePaths(work, "read");
  const writes = uniquePaths(work, "write-edit");
  const bashCount = work.capturedToolResults?.filter((r) => r.toolName === "bash").length ?? 0;

  let text = theme.fg(work.status === "active" ? "success" : "warning", `${work.status}`);
  text += theme.fg("accent", ` ${work.practice}`);
  text += theme.fg("muted", ` — ${truncateMiddle(work.objective, 50)}`);
  text += theme.fg("muted", ` (r:${reads.length} w:${writes.length} bash:${bashCount})`);

  if (expanded) {
    if (reads.length > 0) {
      text += `\n  ${theme.fg("dim", "reads:")}`;
      text += detailLines(reads, theme, 6);
    }
    if (writes.length > 0) {
      text += `\n  ${theme.fg("dim", "writes:")}`;
      text += detailLines(writes, theme, 6);
    }
    if (work.lastCheck && !work.lastCheck.allSatisfied) {
      text += `\n  ${theme.fg("warning", "last check needs attention:")}`;
      text += detailLines(work.lastCheck.missing, theme, 4);
    }
    text += ` ${expandHint(theme, expanded)}`;
  } else {
    text += ` ${expandHint(theme, expanded)}`;
  }

  return new Text(text, 0, 0);
}

// ---- helpers ----

function truncateMiddle(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function evidencePath(result: { metadata?: { path?: string }; input?: Record<string, unknown> }): string {
  const value = result.metadata?.path ?? result.input?.path ?? result.input?.filePath ?? result.input?.filename ?? result.input?.target;
  return typeof value === "string" ? value : "";
}

function uniquePaths(work: WorkState, kind: "read" | "write-edit"): string[] {
  const results = work.capturedToolResults ?? [];
  const filtered = kind === "read"
    ? results.filter((r) => r.toolName === "read" && !r.isError)
    : results.filter((r) => ["write", "edit"].includes(r.toolName) && !r.isError);
  return [...new Set(filtered.map(evidencePath).filter(Boolean))];
}
