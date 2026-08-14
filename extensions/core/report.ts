// report.ts — task completion quality analysis report generator
//
// Used by the /cynos-report command; outputs execution analysis of the current/most recent task.
// Goal: help diagnose whether practices/skills need optimization (routing correctness, checkpoint retry loops, etc.).
// Does not draw conclusions for the user; only provides observations + heuristic suspect causes.

import type { WorkState, CheckAttempt, CapturedToolResult } from "./types";

type LoadedResult = Awaited<ReturnType<typeof import("./state").loadCurrentWork>>;
type LastOutcome = Awaited<ReturnType<typeof import("./state").readLastOutcome>>;

export function buildReportSummary(loaded: LoadedResult, last: LastOutcome): string {
  if (loaded.kind === "corrupted") {
    return `⚠️ Cynos state corrupted: ${loaded.reason}\n${loaded.details}`;
  }
  if (loaded.kind === "none") {
    if (!last) return "No active work and no history.";
    return renderOutcomeOnly(last);
  }

  const work = loaded.work;
  const lines: string[] = [];
  lines.push("═══ Cynos task report ═══");
  lines.push("");
  lines.push("[Task]");
  lines.push(`  Practice:    ${work.practice}`);
  lines.push(`  Objective:   ${work.objective}`);
  lines.push(`  Status:      ${work.status}`);
  lines.push(`  Started:     ${fmtTime(work.startedAt)}`);
  if (work.finishedAt) lines.push(`  Finished:    ${fmtTime(work.finishedAt)}`);
  lines.push(`  Duration:    ${fmtDuration(work.startedAt, work.finishedAt ?? work.updatedAt)}`);
  lines.push(`  Criteria:    ${work.acceptanceCriteria.length} item(s)`);
  lines.push("");

  // execution
  const captured = work.capturedToolResults ?? [];
  const toolStats = countByTool(captured);
  const bashFailures = captured.filter((r) => r.toolName === "bash" && r.isError).length;
  const askedUser = (work.capturedUserAnswers?.length ?? 0) > 0;
  lines.push("[Execution]");
  lines.push(`  Tool calls:  ${formatToolStats(toolStats)}`);
  lines.push(`  Bash failed: ${bashFailures} time(s)`);
  lines.push(`  Asked user:  ${askedUser ? `yes (${work.capturedUserAnswers!.length} time(s))` : "no"}`);
  lines.push(`  Captured:    ${captured.length} item(s)`);
  lines.push("");

  // completion check
  const attempts = work.checkAttempts ?? [];
  const lastCheck = work.lastCheck;
  lines.push("[Completion check]");
  lines.push(`  Attempts:    ${attempts.length} time(s)`);
  if (lastCheck) {
    const passed = lastCheck.results.filter((r) => r.satisfied).length;
    const total = lastCheck.results.length;
    lines.push(`  Status:      ${lastCheck.allSatisfied ? "✅ all passed" : `✗ not passed (${passed}/${total})`}`);
  } else {
    lines.push(`  Status:      not checked`);
  }

  // failure pattern analysis
  const repeated = findRepeatedFailures(attempts, lastCheck);
  if (repeated.length > 0 || (lastCheck && !lastCheck.allSatisfied)) {
    lines.push("  Failure patterns:");
    if (lastCheck && !lastCheck.allSatisfied) {
      for (const id of lastCheck.missing) {
        const repeat = repeated.find((r) => r.id === id);
        const tag = repeat ? ` ← repeated ${repeat.count} time(s)` : "";
        const result = lastCheck.results.find((r) => r.id === id);
        const reason = result?.reason ? ` (${firstLine(result.reason, 80)})` : "";
        lines.push(`    ✗ ${id}${tag}${reason}`);
      }
    }
    // previously repeated failures now passed
    for (const r of repeated) {
      if (lastCheck && !lastCheck.missing.includes(r.id)) {
        lines.push(`    ↻ ${r.id} ← passed after ${r.count} failure(s)`);
      }
    }
  }
  lines.push("");

  // diagnostic suggestions
  const diagnostics = diagnose(work);
  if (diagnostics.length > 0) {
    lines.push("[Diagnostics]");
    for (const d of diagnostics) lines.push(`  ${d}`);
    lines.push("");
  }

  lines.push("[Debug info]");
  lines.push(`  Work ID:     ${work.id}`);
  lines.push(`  Updated:     ${fmtTime(work.updatedAt)}`);
  if (work.pendingQuestion) lines.push(`  Pending:     ${work.pendingQuestion}`);
  if (attempts.length > 0) {
    lines.push("  Past attempts:");
    for (const a of attempts.slice(-5)) {
      lines.push(`    - ${fmtTime(a.checkedAt)}: missing=${a.missing.length > 0 ? a.missing.join("; ") : "none"}; keys=${a.evidenceKeys.length > 0 ? a.evidenceKeys.join(",") : "none"}; captured=${a.capturedToolResultCount}`);
    }
  }

  return lines.join("\n");
}

function renderOutcomeOnly(last: NonNullable<LastOutcome>): string {
  const lines: string[] = [];
  lines.push("═══ Cynos task report ═══");
  lines.push("");
  lines.push("[Last task]");
  lines.push(`  Work ID:     ${last.workId}`);
  lines.push(`  Practice:    ${last.practice}`);
  lines.push(`  Status:      ${last.status}`);
  lines.push(`  Objective:   ${last.objective}`);
  lines.push(`  Summary:     ${last.summary}`);
  lines.push(`  Started:     ${fmtTime(last.startedAt)}`);
  lines.push(`  Finished:    ${fmtTime(last.finishedAt)}`);
  lines.push(`  Duration:    ${fmtDuration(last.startedAt, last.finishedAt)}`);
  lines.push(`  Archive:     ${last.archivePath ?? "n/a"}`);
  return lines.join("\n");
}

// ---- analysis helpers ----

interface RepeatedFailure {
  id: string;
  count: number;
}

function findRepeatedFailures(attempts: CheckAttempt[], lastCheck: WorkState["lastCheck"]): RepeatedFailure[] {
  const counts = new Map<string, number>();
  for (const a of attempts) {
    for (const m of a.missing) {
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
  }
  if (attempts.length === 0 && lastCheck && !lastCheck.allSatisfied) {
    for (const m of lastCheck.missing) counts.set(m, 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, count }));
}

function diagnose(work: WorkState): string[] {
  const findings: string[] = [];
  const attempts = work.checkAttempts ?? [];
  const lastCheck = work.lastCheck;
  const repeated = findRepeatedFailures(attempts, lastCheck);

  // repeatedly-failed checkpoints
  for (const r of repeated) {
    const stillFailing = !lastCheck?.allSatisfied && lastCheck?.missing.includes(r.id);
    if (stillFailing) {
      findings.push(`⚠ ${r.id} failed ${r.count} time(s) in a row → the checkpoint rule may be unclear, or the skill does not teach the agent how to satisfy it. Consider reviewing the corresponding skill.`);
    }
  }

  // passed after multiple attempts
  if (lastCheck?.allSatisfied && attempts.length >= 3) {
    findings.push(`ℹ Passed after ${attempts.length} attempts → the rule is understandable but the agent needs several tries; consider improving the hint.`);
  }

  // bash failures
  const bashFailures = (work.capturedToolResults ?? []).filter((r) => r.toolName === "bash" && r.isError).length;
  if (bashFailures >= 2) {
    findings.push(`⚠ ${bashFailures} bash failure(s) → likely an environment/command issue; check whether the practice should prompt a preflight.`);
  }

  // long-running incomplete
  if (work.status === "active") {
    const elapsedMin = computeMinutes(work.startedAt, work.updatedAt);
    if (elapsedMin !== null && elapsedMin > 60) {
      findings.push(`⚠ Task has been running for ${elapsedMin} minutes without completing → it may be stuck; check for a loop or blockage.`);
    }
  }

  return findings;
}

// ---- formatting helpers ----

function countByTool(captured: CapturedToolResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of captured) counts[r.toolName] = (counts[r.toolName] ?? 0) + 1;
  return counts;
}

function formatToolStats(stats: Record<string, number>): string {
  const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "none";
  return entries.map(([name, count]) => `${name} ×${count}`).join(", ");
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function fmtDuration(startIso: string, endIso: string): string {
  const min = computeMinutes(startIso, endIso);
  if (min === null) return "unknown";
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h${min % 60}m`;
}

function computeMinutes(startIso: string, endIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60000);
}

function firstLine(text: string, max: number): string {
  const line = text.split("\n")[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

// ---- formatCheckAttempts: agent-visible text for cynos_work_status (not the report) ----

export function formatCheckAttempts(work: Pick<WorkState, "checkAttempts">): string[] {
  const attempts = work.checkAttempts ?? [];
  if (attempts.length === 0) return [];
  const lines = ["", "Recent failed check attempts:"];
  for (const attempt of attempts.slice(-5)) {
    const missing = attempt.missing.length > 0 ? attempt.missing.join("; ") : "none";
    const keys = attempt.evidenceKeys.length > 0 ? attempt.evidenceKeys.join(", ") : "none";
    lines.push(`- ${attempt.checkedAt}: missing=${missing}; evidenceKeys=${keys}; capturedToolResults=${attempt.capturedToolResultCount}`);
  }
  return lines;
}
