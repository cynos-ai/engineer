import { getPractice } from "../practices/registry";
import type { CheckResult, Checkpoint, WorkState } from "./types";
import { archiveCompletedWork, flushCapturedToolResults, requireActiveWork, saveWork } from "./state";

export function checkCompletion(work: WorkState): CheckResult {
  const practice = getPractice(work.practice);
  const checkedAt = new Date().toISOString();
  const results = practice.checkpoints.map((checkpoint) => {
    const result = checkpoint.check(work);
    const reason = result.satisfied ? undefined : renderCheckpointReason(result.reason, checkpoint);
    return {
      id: checkpoint.id,
      rule: checkpoint.rule,
      satisfied: result.satisfied,
      reason,
      details: result.satisfied ? result.details : undefined,
      refs: result.satisfied ? result.refs : undefined,
    };
  });
  const missing = results.filter((result) => !result.satisfied).map((result) => `${result.id}: ${result.reason}`);
  return { allSatisfied: missing.length === 0, results, missing, checkedAt };
}

// Concatenate the dynamic failure reason with the checkpoint's static why/recoveryHint into a single reason text.
// - why: static explanation of what this checkpoint guards against (so the agent doesn't treat it as a form burden).
// - recoveryHint: guides the agent back to the correct engineering action, rather than field-padding to bypass.
// Dynamic diagnosis (why it failed this time) should be written directly into the reason text returned by check(), not in a separate field.
function renderCheckpointReason(rawReason: string, checkpoint: Checkpoint): string {
  const parts = [rawReason.trim()];
  const why = checkpoint.why?.trim();
  const hint = checkpoint.recoveryHint?.trim();
  if (why) parts.push(`Why: ${why}`);
  if (hint) parts.push(`Next: ${hint}`);
  return parts.filter(Boolean).join(" | ");
}

export async function submitCompletionEvidence(
  cwd: string,
  completionEvidence: Record<string, unknown>,
): Promise<{ work: WorkState; check: CheckResult; archived: boolean; archivePath?: string }> {
  await flushCapturedToolResults(cwd);
  const current = await requireActiveWork(cwd);
  const now = new Date().toISOString();
  const work: WorkState = {
    ...structuredClone(current),
    completionEvidence: structuredClone(completionEvidence),
    updatedAt: now,
  };
  const check = checkCompletion(work);

  if (!check.allSatisfied) {
    work.lastCheck = check;
    work.checkAttempts = appendCheckAttempt(current.checkAttempts, work, check);
    await saveWork(cwd, work);
    return { work, check, archived: false };
  }

  const done: WorkState = {
    ...work,
    status: "done",
    finishedAt: check.checkedAt,
    updatedAt: check.checkedAt,
    lastCheck: check,
  };
  await saveWork(cwd, done);
  const last = await archiveCompletedWork(cwd, done, summarizeCompletion(done));
  return { work: done, check, archived: true, archivePath: last.archivePath };
}

function appendCheckAttempt(previous: WorkState["checkAttempts"], work: WorkState, check: CheckResult): WorkState["checkAttempts"] {
  const attempt = {
    checkedAt: check.checkedAt,
    allSatisfied: check.allSatisfied,
    missing: check.missing,
    evidenceKeys: Object.keys(work.completionEvidence ?? {}).sort(),
    capturedToolResultCount: work.capturedToolResults?.length ?? 0,
  };
  return [...(previous ?? []), attempt].slice(-5);
}

function summarizeCompletion(work: WorkState): string {
  const criteria = work.acceptanceCriteria.map((item) => item.description).join("; ");
  return `${work.practice} completed: ${work.objective}${criteria ? ` (acceptance: ${criteria})` : ""}`;
}
