import type { Concern, CapturedToolResult, WorkState } from "../../core/types";
import { extractToolPath, isSubagentResult, isWriteLike, minIndex, pathLooksLikeEvidenceOrScratchArtifact } from "../helpers";

// Develop's concerns are stage-based and FORWARD-LOOKING (anti-noise: they are NOT a checklist
// mirror of the completion checkpoints). They coach the agent to respect the develop sequence
// (scan → plan → [complex: challenger] → implement) and to catch a simple-misclassification
// EARLY — before the strong challenger sequence gate makes the only recovery an abandon-and-restart.
//
// Stage inference is purely from capturedToolResults (actions that already happened):
//   stage 0 (scanning)     → no production write yet
//   stage 1 (implementing) → production writes started
//
// The challenger-before-write concern is the high-value one: it detects "writing multiple files
// without a pre-write challenger" — the exact drift the strong sequence gate will later reject.
// Flagging it here (advisory, mid-work) lets the agent course-correct BEFORE the gate forces a
// restart. These concerns intentionally do NOT read completionEvidence.develop.context.complexity
// (which is only filled at completion); they infer "looks complex" from the write count itself —
// which is also the signal the agent admitted ignoring ("I didn't count the files").

// Looser than the checkpoint's >5 hard threshold on purpose: a concern must flag drift BEFORE
// the terminal check fails. Tunable via smoke.
const COMPLEX_LIKELY_WRITE_THRESHOLD = 3;
const MIN_READS_BEFORE_WRITING = 2;

function isSubstantiveRead(result: CapturedToolResult): boolean {
  if (result.isError) return false;
  if (result.toolName === "read") return true;
  if (result.toolName === "bash") {
    const command = String(result.input.command ?? "");
    // git show/diff surface real code content → counts; git status/log are metadata → do not.
    if (/\bgit\s+(show|diff)\b/.test(command)) return true;
    if (/\bgit\s+(status|log)\b/.test(command)) return false;
    return /\b(cat|sed|head|tail|rg|grep|awk|less|more|bat)\b/.test(command);
  }
  return false;
}

function productionWrites(work: WorkState): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => {
    if (result.isError || !isWriteLike(result)) return false;
    const path = extractToolPath(result);
    return !!path && !pathLooksLikeEvidenceOrScratchArtifact(path, work.cwd);
  });
}

// Distinct substantive reads — the context-depth signal. Optionally bounded to reads before a
// given captured index (used to ask "how much was read before the first write?").
function distinctReadCount(work: WorkState, beforeIndex?: number): number {
  const keys = new Set<string>();
  for (const [index, result] of (work.capturedToolResults ?? []).entries()) {
    if (beforeIndex !== undefined && index >= beforeIndex) break;
    if (!isSubstantiveRead(result)) continue;
    const path = extractToolPath(result);
    keys.add(path || (result.toolName === "bash" ? String(result.input.command ?? "") : result.outputSummary));
  }
  return keys.size;
}

function hasChallenger(work: WorkState): boolean {
  return (work.capturedToolResults ?? []).some((result) => isSubagentResult(result, "challenger"));
}

export const developContextBeforeWriteConcern: Concern = {
  id: "develop-context-before-write",
  rule: "scan related code (not just grep) before writing, so implementation reuses existing boundaries",
  evaluate(work) {
    const writes = productionWrites(work);
    if (writes.length === 0) {
      if (distinctReadCount(work) === 0) {
        return {
          status: "active",
          guidance:
            "Before planning, do a focused context scan: read the target files and related modules with the read tool (not just grep hits), and find existing patterns plus calling/data-flow edges. This is so your implementation reuses existing boundaries instead of duplicating them.",
        };
      }
      return { status: "satisfied" };
    }
    // Writes exist — did enough reads precede the first write?
    const firstWriteIndex = minIndex(work, writes);
    const readsBeforeWrite = distinctReadCount(work, firstWriteIndex);
    if (readsBeforeWrite < MIN_READS_BEFORE_WRITING) {
      return {
        status: "drift",
        guidance:
          `Direction drift: implementation started (first production write), but only ${readsBeforeWrite} file(s) were read beforehand. What you write now risks duplicating or fighting existing boundaries. Pause writing, read the target and related modules completely first, then resume.`,
      };
    }
    return { status: "satisfied" };
  },
};

export const developChallengerBeforeWriteConcern: Concern = {
  id: "develop-challenger-before-write",
  rule: "complex work runs challenger before the first production write; catch a simple-misclassification before the sequence gate makes it expensive",
  evaluate(work) {
    const writes = productionWrites(work);
    // Nothing to coach during planning — plan/challenger ordering is skill-guided until the first
    // write makes the sequence gate relevant.
    if (writes.length === 0) return { status: "satisfied" };

    if (hasChallenger(work)) return { status: "satisfied" };

    if (writes.length >= COMPLEX_LIKELY_WRITE_THRESHOLD) {
      return {
        status: "drift",
        guidance:
          `Direction drift: ${writes.length} production files written and no challenger yet. This looks COMPLEX — and complex work must run the challenger BEFORE the first write. The checkpoint sequence-gates this: a challenger captured after the first write is rejected as a rubber-stamp, and there is no in-work fix (only abandon-and-restart). Course-correct NOW: stop writing, run challenger to audit what's already written plus the remaining plan, then continue. If you classified as simple, reclassify to complex — the >5-files / cross-cutting thresholds reject a wrong simple call at completion anyway.`,
      };
    }
    return {
      status: "active",
      guidance:
        `Implementation has started (${writes.length} file${writes.length > 1 ? "s" : ""}). If this will exceed 5 files or touch cross-cutting concerns (logger/feature-flags/config/middleware/auth/context/bootstrap), it is complex — run challenger BEFORE writing more. The challenger must precede your first write; a post-write challenger is rejected by the sequence gate.`,
    };
  },
};

export const developConcerns: Concern[] = [developContextBeforeWriteConcern, developChallengerBeforeWriteConcern];
