import type { Concern, ConcernReport, WorkState } from "../core/types";

/**
 * Run every concern of a practice against the current work state. Pure function.
 *
 * Concerns differ from checkpoints: they read capturedToolResults (actions that already
 * happened) to localize progress and give forward-looking guidance, never to decide completion.
 */
export function runConcerns(work: WorkState, concerns: readonly Concern[] | undefined): ConcernReport[] {
  if (!concerns || concerns.length === 0) return [];
  return concerns.map((concern) => {
    const outcome = concern.evaluate(work);
    return { id: concern.id, status: outcome.status, guidance: outcome.guidance };
  });
}

/**
 * The subset that gets injected: active + drift WITH non-empty guidance.
 * `satisfied` is always silent (the whole point — don't nag once a stage is done).
 * This is what the prompt hook renders into advisory text.
 */
export function actionableConcerns(work: WorkState, concerns: readonly Concern[] | undefined): ConcernReport[] {
  return runConcerns(work, concerns).filter((report) => report.status !== "satisfied" && report.guidance?.trim());
}
