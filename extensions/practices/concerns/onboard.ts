import type { Concern, CapturedToolResult, WorkState } from "../../core/types";
import { extractToolPath, normalizePath, isWriteLike, pathLooksLikeProjectMemory, existingOnboardAuditDocs, stringAt, objectAt } from "../helpers";

// Onboard's concerns are organized by STAGE, not one-per-checkpoint. A stage coach stays
// `active` with forward-looking guidance while the agent is in that stage, flips to `drift`
// if it catches a direction error early, and goes `satisfied` (silent) once the stage is past.
// This is the anti-noise design: three coaches, not six checklist items mirroring checkpoints.
//
// Stage transition is inferred purely from capturedToolResults (actions that already happened):
//   stage 0 (preflight)  → no substantive read yet
//   stage 1 (exploration) → reads happening, no memory written yet
//   stage 2 (writing)     → memory files being written
//
// Drift detection is cross-validation of actions: "a write appeared, but too few reads
// preceded it" / "memory written, but too few user confirmations captured".

// Advisory threshold for the "writing too early" drift. Looser than the checkpoint's terminal
// requirement (coreLogicFiles 1+, default target 4+) on purpose: a concern must flag drift
// BEFORE the terminal check fails. Tunable via smoke results.
const MIN_READS_BEFORE_WRITING_MEMORY = 3;

function isSubstantiveReadResult(result: CapturedToolResult): boolean {
  if (result.isError) return false;
  if (result.toolName === "read") return true;
  if (result.toolName === "bash") {
    const command = String(result.input.command ?? "");
    // git show/diff surface real code content → counts as reading. git status/log only show
    // state/metadata → do NOT count (they are preflight scouting, not understanding code).
    if (/\bgit\s+(show|diff)\b/.test(command)) return true;
    if (/\bgit\s+(status|log)\b/.test(command)) return false;
    return /\b(cat|sed|head|tail|rg|grep|awk|less|more|bat)\b/.test(command);
  }
  return false;
}

// Distinct substantive reads so far — the exploration-depth signal. The read tool (the
// recommended path) carries a machine-readable path; bash reads like `git show` may not,
// so fall back to the command text as the dedup key so they still count toward depth.
function substantiveReadCount(work: WorkState): number {
  const keys = new Set<string>();
  for (const result of work.capturedToolResults ?? []) {
    if (!isSubstantiveReadResult(result)) continue;
    const filePath = extractToolPath(result);
    const key = filePath || (result.toolName === "bash" ? String(result.input.command ?? "") : result.outputSummary);
    if (key) keys.add(normalizePath(key));
  }
  return keys.size;
}

function hasAnyRead(work: WorkState): boolean {
  return (work.capturedToolResults ?? []).some(isSubstantiveReadResult);
}

function hasWrittenMemory(work: WorkState): boolean {
  return (work.capturedToolResults ?? []).some((result) => {
    if (!isWriteLike(result) || result.isError) return false;
    const filePath = normalizePath(extractToolPath(result));
    return pathLooksLikeProjectMemory(filePath) || /(^|\/)docs\/(testing|release)\.md$/.test(filePath);
  });
}

function onboardMode(work: WorkState): "human-assisted" | "auto" {
  const mode = stringAt(work.completionEvidence?.onboardMode ?? objectAt(work.completionEvidence?.preflight)?.mode);
  return mode === "auto" ? "auto" : "human-assisted";
}

export const onboardStagePreflightConcern: Concern = {
  id: "onboard-stage-preflight",
  rule: "before deep reading: clean-tree check + scope confirmation, then enter exploration from navigation files",
  evaluate(work) {
    // Already reading code → past preflight, stay silent.
    if (hasAnyRead(work)) return { status: "satisfied" };

    const mode = onboardMode(work);
    const scopeHint = mode === "human-assisted"
      ? "human-assisted mode needs one real cynos_ask_user to confirm scope before deep reading"
      : "auto mode records the autonomous scope judgment in preflight.scopeConfirmationSummary";
    return {
      status: "active",
      guidance:
        `No project files read yet. Do preflight first: run git status to confirm a clean tree, then confirm scope (${scopeHint}). ` +
        `Then enter exploration from navigation files — package.json / README / the main entry point. From there you will follow the call chain to locate the core logic files.`,
    };
  },
};

export const onboardStageExplorationConcern: Concern = {
  id: "onboard-stage-exploration",
  rule: "exploration depth: read core logic completely (read tool, not grep/head), follow call-chain edges; flag writing memory before reading enough",
  evaluate(work) {
    const readCount = substantiveReadCount(work);
    const writing = hasWrittenMemory(work);

    // Not in exploration yet (preflight owns this) — silent.
    if (readCount === 0 && !writing) return { status: "satisfied" };

    // Drift: writing started but too few files read → what gets written will lack code backing.
    if (writing && readCount < MIN_READS_BEFORE_WRITING_MEMORY) {
      return {
        status: "drift",
        guidance:
          `Direction drift: you started writing project memory, but only ${readCount} project file(s) have been read. What you write now will not be backed by code. ` +
          `Pause writing, read more core logic files completely first (the read tool — partial reads with offset/limit, and grep/head, do not count), then resume.`,
      };
    }

    // Past exploration (writing + read enough) — hand off to the writing-stage concern.
    if (writing) return { status: "satisfied" };

    // Active: mid-exploration.
    const auditDocs = existingOnboardAuditDocs(work.cwd);
    const auditHint = auditDocs.length > 0
      ? ` The project has auditable docs (${auditDocs.join(", ")}); remember the docTrustAudit — read the high-value ones and verify their claims against code as you go.`
      : "";
    return {
      status: "active",
      guidance:
        `Exploration in progress — ${readCount} file(s) read. Next: locate the core logic files and read them completely with the read tool (grep/head/offset+limit reads don't count toward understanding). ` +
        `Follow call-chain edges from navigation/entry files into core logic, and trace at least one core flow end to end.${auditHint}`,
    };
  },
};

export const onboardStageWritingConcern: Concern = {
  id: "onboard-stage-writing",
  rule: "writing stage: ensure exploration sufficient and collect required user confirmations (human-assisted) as you write memory",
  evaluate(work) {
    const readCount = substantiveReadCount(work);
    const writing = hasWrittenMemory(work);

    // Not writing yet, or still too under-read (exploration concern owns the drift) — silent.
    if (!writing || readCount < MIN_READS_BEFORE_WRITING_MEMORY) return { status: "satisfied" };

    const mode = onboardMode(work);
    const answers = work.capturedUserAnswers?.length ?? 0;

    // Drift: writing memory but not enough user confirmations for human-assisted.
    if (mode === "human-assisted" && answers < 2) {
      return {
        status: "drift",
        guidance:
          `Direction drift: you are writing project memory but only ${answers} user confirmation(s) captured. human-assisted onboard needs at least 2 — ` +
          `1 scope confirmation (before deep reading) and 1 long-term-memory / operating-contract confirmation (before writing PROJECT.md). Ask via cynos_ask_user before finishing the memory.`,
      };
    }

    return {
      status: "active",
      guidance:
        `Writing the maintenance baseline (${readCount} files read). Four independent dimensions, each its own deliverable: (1) project understanding — PROJECT.md with criticalRisks[] or noCriticalRisksReason; (2) verification contract — docs/testing.md (write it even if no tests yet, record current state + plan); (3) release contract — docs/release.md only when there is a release flow; ` +
        `(4) engineering contract — AGENTS.md at the project root (pi auto-loads it; keep it short: tech-stack + a routing table of triggers→docs/*.md rule files + behavior basics; read any existing AGENTS.md first, then rewrite it wholesale, do not patch).`,
    };
  },
};

export const onboardConcerns: Concern[] = [
  onboardStagePreflightConcern,
  onboardStageExplorationConcern,
  onboardStageWritingConcern,
];
