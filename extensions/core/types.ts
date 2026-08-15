// ============================================================
// Cynos current core domain types
//
// Current architecture: practice + completion checkpoints + runtime-captured tool results.
// No longer tracks activity / goalProgress / per-activity evidence.
// ============================================================

import type { PracticeId } from "../practices/ids";
export type { PracticeId } from "../practices/ids";
export type WorkStatus = "active" | "waiting-for-user" | "done" | "abandoned";
export type OnboardMode = "human-assisted" | "auto";

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface CapturedToolResult {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  outputSummary: string;
  fullOutputRef?: string;
  isError: boolean;
  at: string;
  metadata?: {
    path?: string;
    command?: string;
    exitCode?: number;
    inputBytes?: number;
    outputBytes?: number;
    outputLines?: number;
  };
}

export interface CapturedUserAnswer {
  question: string;
  answerSummary: string;
  at: string;
}

export interface WorkState {
  schemaVersion: 1;
  id: string;
  // Project root directory. Used by completion checkpoints for strict absolute-path write validation; legacy archives may lack this field.
  cwd?: string;
  practice: PracticeId;
  objective: string;
  acceptanceCriteria: AcceptanceCriterion[];
  status: WorkStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  completionEvidence?: Record<string, unknown>;
  capturedToolResults?: CapturedToolResult[];
  capturedUserAnswers?: CapturedUserAnswer[];
  pendingQuestion?: string;
  // Uncommitted dirty-tree snapshot at work start (git status --porcelain lines).
  // Preserved for audit even after acknowledgeDirtyTree; undefined when clean or non-git.
  dirtyTreeAtStart?: string[];
  lastCheck?: CheckResult;
  // Recent failed completion check summaries for diagnosing stuck/loop issues; no large evidence blobs stored.
  checkAttempts?: CheckAttempt[];
}

export interface CheckAttempt {
  checkedAt: string;
  allSatisfied: boolean;
  missing: string[];
  evidenceKeys: string[];
  capturedToolResultCount: number;
}

export interface LastOutcome {
  schemaVersion: 1;
  workId: string;
  practice: PracticeId;
  objective: string;
  status: "done" | "abandoned";
  summary: string;
  startedAt: string;
  finishedAt: string;
  archivePath?: string;
}

export interface CheckpointSatisfied {
  satisfied: true;
  details?: string;
  refs?: Array<{ toolCallId?: string; criterionId?: string }>;
}

export interface CheckpointNotSatisfied {
  satisfied: false;
  reason: string;
}

export type CheckpointResult = CheckpointSatisfied | CheckpointNotSatisfied;

export interface Checkpoint {
  id: string;
  rule: string;
  // Why this checkpoint exists: what serious drift / evidence fabrication / boundary violation it prevents.
  // Shown to the agent on failure to avoid treating the checkpoint as extra form-filling burden.
  why?: string;
  // Default recovery hint: guides the agent back to the correct engineering action on failure (not field-padding bypass).
  // Can be overridden by a not_satisfied result's recoveryHint.
  recoveryHint?: string;
  check(work: WorkState): CheckpointResult;
}

// ============================================================
// Concern: forward-looking, in-process coaching
//
// A concern is NOT a checkpoint mirror ("X is still missing"). It is a
// forward-looking coach that, based on actions already captured in
// capturedToolResults, tells the agent where it is and what to do next, or
// flags a direction drift EARLY — before the terminal check fails.
//
// Three states (deliberately NOT the checkpoint's satisfied/not-satisfied):
//   active    — the current stage's focus + HOW to do it right. Forward-looking:
//               "you are here; next do Y; watch out for Z."
//   drift     — you started Y but are headed wrong; specific correction.
//               "you started writing PROJECT.md but only read git status — what you
//                write will lack code backing; read core logic first."
//   satisfied — this stage is done; STAY SILENT (never injected).
//
// HARD RULE: guidance MUST be an actionable next step or a specific drift,
// never a checklist-style restatement of what a checkpoint would fail on
// ("exploration insufficient", "verification missing"). If a concern only
// echoes a checkpoint's missing item, it is noise and the agent learns to
// ignore the whole concern layer. Drift guidance must name the concrete
// deviation + the concrete correction.
//
// Runs mid-work (injected via the prompt hook, computed from
// capturedToolResults). It never decides completion and never archives a
// work. Concerns and checkpoints are deliberately separate: concerns coach
// the next action, while checkpoints make the final completion decision.
// ============================================================

export type ConcernStatus = "active" | "drift" | "satisfied";

export interface ConcernOutcome {
  status: ConcernStatus;
  // active: "you are at stage X; next do Y; watch out for Z"
  // drift:  "you started A but B is not yet in place / headed wrong; do C first"
  // satisfied: guidance omitted (silent — not injected)
  guidance?: string;
}

export interface Concern {
  id: string;
  // What progress/direction this concern watches. Human-facing intent; NOT injected to the agent.
  rule: string;
  // Progress localization + drift detection. Reads capturedToolResults (facts that already
  // happened) first, completionEvidence (declared state) second. Must stay forward-looking.
  evaluate(work: WorkState): ConcernOutcome;
}

export interface ConcernReport {
  id: string;
  status: ConcernStatus;
  guidance?: string;
}

export interface PracticeDefinition {
  id: PracticeId;
  title: string;
  methodology: string;
  guidance: {
    whenToUse: string;
    mentalModel: string;
  };
  checkpoints: Checkpoint[];
  // Forward-looking in-process coaching (optional; pilot period). Based on capturedToolResults,
  // injected mid-work to guide the next step or flag drift early. Never decides completion.
  // See the Concern type doc above for the hard "no checklist mirror" rule.
  concerns?: Concern[];
  // Precise structure description for completionEvidence, exposed to the agent via tool descriptions and failure feedback.
  evidenceSchema: string;
}

export interface CheckResult {
  allSatisfied: boolean;
  results: Array<{
    id: string;
    rule: string;
    satisfied: boolean;
    reason?: string;
    details?: string;
    refs?: Array<{ toolCallId?: string; criterionId?: string }>;
  }>;
  missing: string[];
  checkedAt: string;
}

export type CurrentWorkLoadResult =
  | { kind: "none" }
  | { kind: "valid"; work: WorkState }
  | { kind: "corrupted"; reason: string; details: string };
