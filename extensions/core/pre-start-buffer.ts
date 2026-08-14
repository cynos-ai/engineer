import type { CapturedToolResult } from "./types";

/**
 * Pre-start buffer: captures context-only tool results produced BEFORE a work is active,
 * so that pre-start reads (PROJECT.md, source, existing docs) count as source evidence
 * once the agent calls cynos_start_work — eliminating the O1 friction
 * ("missing real read evidence" forcing a re-read after start).
 *
 * Design (see docs/reference/pre-start-capture-2026-06.md):
 *  - Session-scoped in-memory Map keyed by cwd. Not persisted.
 *  - Context-only allowlist ONLY (read / cynos_search / cynos_fetch). bash / cynos_subagent /
 *    write / edit / browser_* are NEVER buffered — they would pollute verification /
 *    review / finalization gate semantics (which use reverse-find on capturedToolResults).
 *  - Cleared on before_agent_start (new user prompt boundary), session_start/shutdown,
 *    and drained into work.capturedToolResults on startWork / resumeWork.
 *  - The buffer does NOT inspect work status/practice — it is a dumb pipe (rule-based
 *    record + clear). Business-state awareness lives in state.ts's capture dispatch.
 *  - Soft cap: per-cwd 200 entries; drop oldest (FIFO) when exceeded.
 */

const PRE_START_ALLOWED = new Set(["read", "cynos_search", "cynos_fetch", "cynos_vision"]);
const PRE_START_CAP = 200;

const preStartBuffer = new Map<string, CapturedToolResult[]>();

export function isPreStartAllowed(toolName: string): boolean {
  return PRE_START_ALLOWED.has(toolName);
}

export function appendPreStart(cwd: string, result: CapturedToolResult): void {
  // Defense-in-depth: enforce the allowlist at the buffer boundary too, so any future
  // caller that bypasses the state.ts dispatch still cannot pollute the buffer with
  // bash/subagent/write results (which would fake active verification/review evidence).
  if (!isPreStartAllowed(result.toolName)) return;
  const list = preStartBuffer.get(cwd) ?? [];
  list.push(result);
  if (list.length > PRE_START_CAP) {
    // drop oldest (FIFO)
    list.splice(0, list.length - PRE_START_CAP);
  }
  preStartBuffer.set(cwd, list);
}

/** Remove and return the buffered entries for cwd (oldest-first). Returns [] if empty. */
export function drainPreStart(cwd: string): CapturedToolResult[] {
  const list = preStartBuffer.get(cwd);
  if (!list || list.length === 0) {
    preStartBuffer.delete(cwd);
    return [];
  }
  preStartBuffer.delete(cwd);
  return list;
}

export function clearPreStart(cwd: string): void {
  preStartBuffer.delete(cwd);
}
