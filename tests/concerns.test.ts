import { describe, expect, it } from "vitest";
import type { CapturedToolResult, CapturedUserAnswer, WorkState } from "../extensions/core/types";
import { runConcerns, actionableConcerns } from "../extensions/practices/concern-runner";
import { onboardConcerns, onboardStagePreflightConcern, onboardStageExplorationConcern, onboardStageWritingConcern } from "../extensions/practices/concerns/onboard";
import { developConcerns } from "../extensions/practices/concerns/develop";
import { getPractice } from "../extensions/practices/registry";

// ── fixtures ──────────────────────────────────────────────────────────────

function mkResult(partial: Partial<CapturedToolResult> & { toolCallId: string; toolName: string }): CapturedToolResult {
  return { input: {}, outputSummary: "", isError: false, at: "2026-01-01T00:00:00.000Z", ...partial };
}
function readResult(toolCallId: string, path: string): CapturedToolResult {
  return mkResult({ toolCallId, toolName: "read", input: { path }, metadata: { path }, outputSummary: `read ${path}` });
}
function bashResult(toolCallId: string, command: string, isError = false): CapturedToolResult {
  return mkResult({ toolCallId, toolName: "bash", input: { command }, outputSummary: isError ? "failed" : "ok", isError });
}
function writeResult(toolCallId: string, path: string): CapturedToolResult {
  return mkResult({ toolCallId, toolName: "write", input: { path }, metadata: { path }, outputSummary: `wrote ${path}` });
}
function answer(question: string): CapturedUserAnswer {
  return { question, answerSummary: "ok", at: "2026-01-01T00:00:00.000Z" };
}
function onboardWork(
  capturedToolResults: CapturedToolResult[] = [],
  capturedUserAnswers: CapturedUserAnswer[] = [],
  completionEvidence: Record<string, unknown> = {},
): WorkState {
  return {
    schemaVersion: 1,
    id: "w1",
    practice: "onboard",
    objective: "onboard this project",
    acceptanceCriteria: [],
    status: "active",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    capturedToolResults,
    capturedUserAnswers,
    completionEvidence,
  };
}

function statusOf(concernId: string, work: WorkState): string {
  const report = runConcerns(work, onboardConcerns).find((r) => r.id === concernId);
  return report?.status ?? "<missing>";
}

// ── runner ────────────────────────────────────────────────────────────────

describe("concern runner", () => {
  it("returns [] for a practice with no concerns / undefined", () => {
    expect(runConcerns(onboardWork(), undefined)).toEqual([]);
    expect(runConcerns(onboardWork(), [])).toEqual([]);
  });

  it("actionableConcerns drops satisfied and empty-guidance reports", () => {
    const work = onboardWork(); // fresh — only preflight is active
    const actionable = actionableConcerns(work, onboardConcerns);
    // preflight active; exploration & writing satisfied → only one injected
    expect(actionable.map((r) => r.id)).toEqual(["onboard-stage-preflight"]);
  });

  it("practices without concerns produce no actionable output", () => {
    // practices without a concerns array (develop and onboard now have concerns)
    for (const id of ["refactor", "review", "debug", "docs"] as const) {
      expect(getPractice(id).concerns, id).toBeUndefined();
      expect(actionableConcerns(onboardWork(), getPractice(id).concerns)).toEqual([]);
    }
  });
});

// ── onboard stage transitions (the anti-noise state machine) ──────────────

describe("onboard concern stage transitions", () => {
  it("fresh work: only the preflight coach is active", () => {
    const work = onboardWork();
    expect(statusOf("onboard-stage-preflight", work)).toBe("active");
    expect(statusOf("onboard-stage-exploration", work)).toBe("satisfied");
    expect(statusOf("onboard-stage-writing", work)).toBe("satisfied");
  });

  it("git status alone is scouting, NOT exploration — preflight stays active", () => {
    // Regression guard for the onboard investigation: an agent that only runs `git status`
    // (then tries to hand-write a confirmation) must still be coached to actually read code.
    const work = onboardWork([bashResult("g1", "git status")]);
    expect(statusOf("onboard-stage-preflight", work)).toBe("active");
    expect(statusOf("onboard-stage-exploration", work)).toBe("satisfied");
  });

  it("git show/diff counts as reading code content (enters exploration)", () => {
    const work = onboardWork([bashResult("g1", "git show HEAD:src/index.ts")]);
    expect(statusOf("onboard-stage-preflight", work)).toBe("satisfied");
    expect(statusOf("onboard-stage-exploration", work)).toBe("active");
  });

  it("once real reads start, preflight goes silent and exploration coaches", () => {
    const work = onboardWork([readResult("r1", "src/index.ts")]);
    expect(statusOf("onboard-stage-preflight", work)).toBe("satisfied");
    expect(statusOf("onboard-stage-exploration", work)).toBe("active");
    expect(statusOf("onboard-stage-writing", work)).toBe("satisfied");
  });

  it("writing memory after too few reads is DRIFT (caught before the terminal check)", () => {
    const work = onboardWork([
      readResult("r1", "src/index.ts"),
      writeResult("w1", "PROJECT.md"),
    ]);
    expect(statusOf("onboard-stage-exploration", work)).toBe("drift");
  });

  it("writing memory after enough reads hands off to the writing coach", () => {
    const work = onboardWork([
      readResult("r1", "src/index.ts"),
      readResult("r2", "src/core/engine.ts"),
      readResult("r3", "src/core/state.ts"),
      writeResult("w1", "PROJECT.md"),
    ], [answer("scope?"), answer("memory ok?")]);
    expect(statusOf("onboard-stage-exploration", work)).toBe("satisfied");
    expect(statusOf("onboard-stage-writing", work)).toBe("active");
  });

  it("human-assisted writing with <2 user confirmations is DRIFT", () => {
    const work = onboardWork([
      readResult("r1", "src/index.ts"),
      readResult("r2", "src/core/engine.ts"),
      readResult("r3", "src/core/state.ts"),
      writeResult("w1", "PROJECT.md"),
    ], [answer("scope?")]); // only 1 confirmation
    expect(statusOf("onboard-stage-writing", work)).toBe("drift");
  });

  it("auto mode does not require user confirmations for writing", () => {
    const work = onboardWork([
      readResult("r1", "src/index.ts"),
      readResult("r2", "src/core/engine.ts"),
      readResult("r3", "src/core/state.ts"),
      writeResult("w1", "PROJECT.md"),
    ], [], { onboardMode: "auto" });
    expect(statusOf("onboard-stage-writing", work)).toBe("active");
  });
});

// ── forward-looking guidance quality (the anti-noise contract) ────────────
// A concern that only restates "X is missing" is noise. These assert the guidance
// carries an actionable next step or a named drift + correction.

describe("onboard concern guidance is forward-looking, not a checklist mirror", () => {
  it("preflight active guidance names the concrete next steps (git status + scope + entry files)", () => {
    const outcome = onboardStagePreflightConcern.evaluate(onboardWork());
    expect(outcome.status).toBe("active");
    expect(outcome.guidance).toMatch(/git status/);
    expect(outcome.guidance).toMatch(/call chain/);
    // it must NOT read like a checkpoint failure ("missing"/"insufficient")
    expect(outcome.guidance).not.toMatch(/missing|insufficient/i);
  });

  it("exploration active guidance tells the agent HOW to read (read tool, not grep/head)", () => {
    const work = onboardWork([readResult("r1", "src/index.ts")]);
    const outcome = onboardStageExplorationConcern.evaluate(work);
    expect(outcome.status).toBe("active");
    expect(outcome.guidance).toMatch(/read tool/);
    expect(outcome.guidance).not.toMatch(/missing|insufficient/i);
  });

  it("exploration drift guidance names the deviation AND the correction", () => {
    const work = onboardWork([readResult("r1", "src/index.ts"), writeResult("w1", "PROJECT.md")]);
    const outcome = onboardStageExplorationConcern.evaluate(work);
    expect(outcome.status).toBe("drift");
    expect(outcome.guidance).toMatch(/Direction drift/);
    expect(outcome.guidance).toMatch(/read more core logic files/);
  });

  it("writing drift guidance points to the specific missing action (cynos_ask_user)", () => {
    const work = onboardWork([
      readResult("r1", "src/index.ts"),
      readResult("r2", "src/core/engine.ts"),
      readResult("r3", "src/core/state.ts"),
      writeResult("w1", "PROJECT.md"),
    ], [answer("scope?")]);
    const outcome = onboardStageWritingConcern.evaluate(work);
    expect(outcome.status).toBe("drift");
    expect(outcome.guidance).toMatch(/cynos_ask_user/);
    expect(outcome.guidance).toMatch(/at least 2/);
  });

  it("no guidance string equals a generic checkpoint-style failure ('X is missing/insufficient')", () => {
    // Sweep every state's guidance across the transition fixtures and assert none collapses
    // into checklist noise.
    const works: WorkState[] = [
      onboardWork(),
      onboardWork([readResult("r1", "src/index.ts")]),
      onboardWork([readResult("r1", "src/index.ts"), writeResult("w1", "PROJECT.md")]),
      onboardWork([readResult("r1", "a"), readResult("r2", "b"), readResult("r3", "c"), writeResult("w1", "PROJECT.md")], [answer("s"), answer("m")]),
    ];
    for (const work of works) {
      for (const report of runConcerns(work, onboardConcerns)) {
        if (report.status === "satisfied") continue;
        expect(report.guidance, `${report.id}/${report.status}`).toBeTruthy();
        expect(report.guidance, `${report.id}/${report.status}`).not.toMatch(/^(missing|insufficient|incomplete)\b/i);
      }
    }
  });
});

// ── develop concern coaching (sequence gate companion) ────────────────────

function developWork(capturedToolResults: CapturedToolResult[] = []): WorkState {
  return { ...onboardWork(capturedToolResults), practice: "develop", objective: "implement a feature" };
}
function developStatusOf(concernId: string, work: WorkState): string {
  return runConcerns(work, developConcerns).find((r) => r.id === concernId)?.status ?? "<missing>";
}
function challengerResult(toolCallId: string): CapturedToolResult {
  return mkResult({ toolCallId, toolName: "cynos_subagent", input: { agent: "challenger" }, outputSummary: "challenger ok" });
}

describe("develop concern coaching", () => {
  it("fresh work: context coach active, challenger silent", () => {
    const w = developWork([]);
    expect(developStatusOf("develop-context-before-write", w)).toBe("active");
    expect(developStatusOf("develop-challenger-before-write", w)).toBe("satisfied");
  });

  it("reading without writing: both satisfied (planning stage is skill-guided)", () => {
    const w = developWork([readResult("r1", "src/file.ts"), readResult("r2", "src/service.ts")]);
    expect(developStatusOf("develop-context-before-write", w)).toBe("satisfied");
    expect(developStatusOf("develop-challenger-before-write", w)).toBe("satisfied");
  });

  it("drift: writing before reading enough context", () => {
    const w = developWork([writeResult("w1", "src/file.ts")]); // 0 reads before first write
    expect(developStatusOf("develop-context-before-write", w)).toBe("drift");
  });

  it("active: one write without challenger — might still be simple, coach toward challenger if growing", () => {
    const w = developWork([readResult("r1", "src/file.ts"), readResult("r2", "src/service.ts"), writeResult("w1", "src/file.ts")]);
    expect(developStatusOf("develop-challenger-before-write", w)).toBe("active");
  });

  it("drift: 3+ writes without challenger — looks complex, sequence gate will reject", () => {
    const w = developWork([
      readResult("r1", "src/file.ts"), readResult("r2", "src/service.ts"),
      writeResult("w1", "src/file.ts"), writeResult("w2", "src/service.ts"), writeResult("w3", "src/index.ts"),
    ]);
    expect(developStatusOf("develop-challenger-before-write", w)).toBe("drift");
  });

  it("writing with challenger present: satisfied", () => {
    const w = developWork([
      readResult("r1", "src/file.ts"),
      challengerResult("c1"),
      writeResult("w1", "src/file.ts"), writeResult("w2", "src/service.ts"), writeResult("w3", "src/index.ts"),
    ]);
    expect(developStatusOf("develop-challenger-before-write", w)).toBe("satisfied");
  });
});
