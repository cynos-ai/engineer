import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeToolResultEvent, shouldCaptureToolResult } from "../extensions/core/tool-result-capture";
import {
  abandonWork,
  appendCapturedToolResult,
  askUser,
  clearPreStartBuffer,
  loadCurrentWork,
  readLastOutcome,
  resumeWork,
  startWork,
} from "../extensions/core/state";
import { drainPreStart, appendPreStart, clearPreStart, isPreStartAllowed } from "../extensions/core/pre-start-buffer";
import { submitCompletionEvidence } from "../extensions/core/completion-check";
import { verificationCommandPassedCheckpoint } from "../extensions/practices/checkpoints/common";
import { workPath } from "../extensions/infra/paths";

let tmp = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cynos-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function capturedBash(toolCallId: string, command: string, isError = false) {
  return normalizeToolResultEvent({
    toolCallId,
    toolName: "bash",
    input: { command },
    content: [{ type: "text", text: isError ? "Command exited with code 1" : "143 passed" }],
    details: { fullOutputPath: `/tmp/${toolCallId}.log` },
    isError,
  });
}

describe("tool result capture", () => {
  it("captures read and external research results so evidence checkpoints can see tool usage", () => {
    expect(shouldCaptureToolResult("read")).toBe(true);
    expect(shouldCaptureToolResult("cynos_search")).toBe(true);
    expect(shouldCaptureToolResult("cynos_fetch")).toBe(true);
  });

  it("sanitizes large write/edit inputs and records structured metadata", () => {
    const captured = normalizeToolResultEvent({
      toolCallId: "call-write",
      toolName: "write",
      input: { path: "src/file.ts", content: "line1\nline2" },
      content: [{ type: "text", text: "wrote src/file.ts" }],
      isError: false,
    });

    expect(String(captured.input.content)).toContain("omitted");
    expect(captured.metadata?.path).toBe("src/file.ts");
    expect(captured.metadata?.outputLines).toBe(1);

    const edited = normalizeToolResultEvent({
      toolCallId: "call-edit",
      toolName: "edit",
      input: { path: "src/file.ts", oldText: "old\ntext", newText: "new\ntext" },
      content: [{ type: "text", text: "edited src/file.ts" }],
      isError: false,
    });
    expect(String(edited.input.oldText)).toContain("omitted");
    expect(String(edited.input.newText)).toContain("omitted");
    expect(edited.metadata?.path).toBe("src/file.ts");
  });

  it("summarizes large external research outputs instead of storing them verbatim", () => {
    const longOutput = `${"search result line\n".repeat(600)}tail marker`;
    const captured = normalizeToolResultEvent({
      toolCallId: "call-search",
      toolName: "cynos_search",
      input: { query: "node api gateway trends" },
      content: [{ type: "text", text: longOutput }],
      isError: false,
    });

    expect(captured.outputSummary.length).toBeLessThan(longOutput.length);
    expect(captured.outputSummary).toContain("truncated middle of cynos_search output");
    expect(captured.metadata?.outputBytes).toBeGreaterThan(captured.outputSummary.length);
  });
});

describe("current work store and completion checkpoints", () => {
  it("starts a default work with acceptance criteria", async () => {
    const work = await startWork(tmp, {
      practice: "default",
      objective: "implement feature",
      acceptanceCriteria: ["feature works", "verified"],
    });

    expect(work.practice).toBe("default");
    expect(work.acceptanceCriteria.map((item) => item.id)).toEqual(["criterion-1", "criterion-2"]);
    const loaded = await loadCurrentWork(tmp);
    expect(loaded.kind).toBe("valid");
  });

  it("default completion requires real successful verification tool_result", async () => {
    await startWork(tmp, { practice: "default", objective: "implement feature", acceptanceCriteria: ["verified"] });

    const missing = await submitCompletionEvidence(tmp, {
      criteriaCoverage: [{ criterionId: "criterion-1", summary: "implemented and verified" }],
      verification: { testToolCallId: "call-test" },
    });

    expect(missing.archived).toBe(false);
    expect(missing.check.allSatisfied).toBe(false);
    expect(missing.check.missing.join("\n")).toContain("not found in capturedToolResults");

    await appendCapturedToolResult(tmp, capturedBash("call-test", "npm test"));
    await appendCapturedToolResult(tmp, capturedBash("call-git-status", "git status --short"));
    const done = await submitCompletionEvidence(tmp, {
      criteriaCoverage: [{ criterionId: "criterion-1", summary: "implemented and verified" }],
      default: { work: { summary: "verified current state", noFileChangeReason: "state test fixture does not modify files" } },
      verification: { summary: "npm test passed" },
      finalization: { verificationSummary: "npm test passed", gitSummary: "clean", commit: { status: "not-committed", reason: "review-only, don't commit (unit test authorization)" } },
    });

    expect(done.archived).toBe(true);
    expect(done.check.allSatisfied).toBe(true);
    expect(await loadCurrentWork(tmp)).toEqual({ kind: "none" });
    const last = await readLastOutcome(tmp);
    expect(last?.status).toBe("done");
    expect(last?.archivePath).toBeTruthy();
  });

  it("criteria coverage uses stable criterion ids", async () => {
    await startWork(tmp, {
      practice: "review",
      objective: "review recent commit",
      acceptanceCriteria: ["cover last commit", "give overall"],
    });

    const result = await submitCompletionEvidence(tmp, {
      criteriaCoverage: [{ criterionId: "criterion-1", summary: "covered git show HEAD" }],
      reviewScope: { targets: ["inline:user-message"], basis: "unit test inline review scope", targetType: "inline" },
      verification: { permission: "read-only", notRunReason: "unit test read-only review" },
      context: { projectDocsRead: [], relatedFilesRead: [], normsApplied: [] },
      report: { findings: [], overall: "pass", summary: "unit test pass", projectMemorySuggestions: [], nextSteps: [] },
    });

    expect(result.archived).toBe(false);
    expect(result.check.missing.join("\n")).toContain("criterion-2 give overall");
    expect(result.work.checkAttempts).toHaveLength(1);
    expect(result.work.checkAttempts?.[0]?.evidenceKeys).toContain("report");
  });

  it("review validates structured report and archives when complete", async () => {
    await startWork(tmp, {
      practice: "review",
      objective: "review recent commit",
      acceptanceCriteria: ["cover last commit", "give overall"],
    });

    const result = await submitCompletionEvidence(tmp, {
      criteriaCoverage: [
        { criterionId: "criterion-1", summary: "covered git show HEAD" },
        { criterionId: "criterion-2", summary: "overall=needs-work" },
      ],
      reviewScope: { targets: ["inline:user-message"], basis: "unit test inline review scope", targetType: "inline" },
      verification: { permission: "read-only", notRunReason: "unit test read-only review" },
      context: { projectDocsRead: [], relatedFilesRead: [], normsApplied: [] },
      report: {
        overall: "needs-work",
        summary: "unit test needs-work",
        projectMemorySuggestions: [],
        nextSteps: ["example fix finding"],
        findings: [
          { severity: "important", category: "maintainability", location: "extensions/core/state.ts:1", summary: "example finding", evidence: "unit test evidence", impact: "unit test impact", recommendation: "unit test recommendation", confidence: "high" },
        ],
      },
    });

    expect(result.archived).toBe(true);
    expect(result.check.allSatisfied).toBe(true);
    expect(await fs.stat(result.archivePath!)).toBeTruthy();
    expect(await exists(workPath(tmp))).toBe(false);
  });

  it("waiting-for-user can be resumed with captured user answer", async () => {
    await startWork(tmp, { practice: "review", objective: "confirm review perspective", acceptanceCriteria: ["get review perspective"] });

    const waiting = await askUser(tmp, "Confirm the review focus: correctness or security?");
    expect(waiting.status).toBe("waiting-for-user");

    const resumed = await resumeWork(tmp, "User asks to prioritize correctness.");
    expect(resumed.status).toBe("active");
    expect(resumed.pendingQuestion).toBeUndefined();
    expect(resumed.capturedUserAnswers?.[0].answerSummary).toBe("User asks to prioritize correctness.");
  });

  it("abandon archives current work", async () => {
    await startWork(tmp, { practice: "default", objective: "abandon task", acceptanceCriteria: ["can abandon"] });
    const last = await abandonWork(tmp, "user cancelled");
    expect(last.status).toBe("abandoned");
    expect(await loadCurrentWork(tmp)).toEqual({ kind: "none" });
  });

  it("appends captured tool results serially without dropping entries", async () => {
    await startWork(tmp, { practice: "default", objective: "concurrent capture", acceptanceCriteria: ["record all results"] });

    await Promise.all([
      appendCapturedToolResult(tmp, capturedBash("call-1", "npm test")),
      appendCapturedToolResult(tmp, capturedBash("call-2", "npm run verify")),
      appendCapturedToolResult(tmp, capturedBash("call-3", "npm run build")),
    ]);

    const loaded = await loadCurrentWork(tmp);
    expect(loaded.kind).toBe("valid");
    if (loaded.kind === "valid") {
      expect(loaded.work.capturedToolResults?.map((item) => item.toolCallId).sort()).toEqual(["call-1", "call-2", "call-3"]);
    }
  });
});

function capturedRead(toolCallId: string, filePath: string) {
  return normalizeToolResultEvent({
    toolCallId,
    toolName: "read",
    input: { path: filePath },
    content: [{ type: "text", text: `contents of ${filePath}` }],
    isError: false,
  });
}

describe("pre-start buffer (O1 fix)", () => {
  beforeEach(async () => {
    // Buffer is module-global; ensure clean between tests.
    clearPreStart(tmp);
  });

  it("buffers context-only reads (read/cynos_search/cynos_fetch) when no active work; drains into work on start", async () => {
    // pre-start read before any work exists
    await appendCapturedToolResult(tmp, capturedRead("pre-1", "PROJECT.md"));
    await appendCapturedToolResult(tmp, capturedRead("pre-2", "src/file.ts"));

    let loaded = await loadCurrentWork(tmp);
    expect(loaded.kind).toBe("none");

    const work = await startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] });
    // drained reads land in capturedToolResults (front of array)
    expect(work.capturedToolResults?.map((r) => r.toolCallId)).toEqual(["pre-1", "pre-2"]);

    loaded = await loadCurrentWork(tmp);
    if (loaded.kind === "valid") {
      expect(loaded.work.capturedToolResults?.map((r) => r.toolCallId)).toEqual(["pre-1", "pre-2"]);
    }
    // buffer drained
    expect(drainPreStart(tmp)).toEqual([]);
  });

  it("does NOT buffer bash/cynos_subagent/write (avoids polluting verification/review/finalization)", async () => {
    // pre-start bash (e.g. npm test) must NOT be buffered — would fake active verification evidence
    await appendCapturedToolResult(tmp, capturedBash("pre-test", "npm test"));
    await appendCapturedToolResult(tmp, normalizeToolResultEvent({
      toolCallId: "pre-sub",
      toolName: "cynos_subagent",
      input: { role: "reviewer" },
      content: [{ type: "text", text: "review ok" }],
      isError: false,
    }));

    const work = await startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] });
    expect(work.capturedToolResults).toEqual([]);
    expect(drainPreStart(tmp)).toEqual([]);
  });

  it("clearPreStartBuffer (before_agent_start boundary) drops previous prompt's reads", async () => {
    await appendCapturedToolResult(tmp, capturedRead("old-1", "PROJECT.md"));
    await clearPreStartBuffer(tmp);

    const work = await startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] });
    expect(work.capturedToolResults).toEqual([]);
  });

  it("drains waiting-for-user-period reads on resume", async () => {
    const work = await startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] });
    await askUser(tmp, "which approach?");
    // now waiting-for-user; a read during this period buffers
    await appendCapturedToolResult(tmp, capturedRead("wait-1", "src/other.ts"));

    const resumed = await resumeWork(tmp, "use approach A");
    expect(resumed.capturedToolResults?.map((r) => r.toolCallId)).toEqual(["wait-1"]);
    expect(drainPreStart(tmp)).toEqual([]);
  });

  it("active-period reads still write work directly, buffer untouched", async () => {
    const work = await startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] });
    await appendCapturedToolResult(tmp, capturedRead("active-1", "src/a.ts"));

    const loaded = await loadCurrentWork(tmp);
    if (loaded.kind === "valid") {
      expect(loaded.work.capturedToolResults?.map((r) => r.toolCallId)).toEqual(["active-1"]);
    }
    expect(drainPreStart(tmp)).toEqual([]);
  });

  it("soft cap: drops oldest beyond 200", async () => {
    for (let i = 0; i < 205; i++) {
      appendPreStart(tmp, capturedRead(`r-${i}`, `f-${i}.ts`));
    }
    const drained = drainPreStart(tmp);
    expect(drained).toHaveLength(200);
    // oldest 5 dropped
    expect(drained[0].toolCallId).toBe("r-5");
    expect(drained[199].toolCallId).toBe("r-204");
  });

  it("appendPreStart enforces allowlist defense-in-depth (direct bash not buffered)", () => {
    appendPreStart(tmp, normalizeToolResultEvent({
      toolCallId: "direct-bash",
      toolName: "bash",
      input: { command: "npm test" },
      content: [{ type: "text", text: "ok" }],
      isError: false,
    }));
    expect(drainPreStart(tmp)).toEqual([]);
  });

  it("verification gate is NOT satisfied by pre-start npm test (no active verification)", async () => {
    // pre-start npm test succeeds — must NOT be buffered, so it can't fake active verification.
    await appendCapturedToolResult(tmp, capturedBash("pre-test", "npm test"));
    const work = await startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] });
    // The pre-start bash was not carried over (not context-only), so capturedToolResults is empty.
    expect(work.capturedToolResults).toEqual([]);
    // The verification checkpoint, given no successful verification bash in the work, cannot infer a pass.
    const checked = verificationCommandPassedCheckpoint.check({
      ...work,
      completionEvidence: { verification: { summary: "npm test passed" } },
    } as any);
    expect(checked.satisfied).toBe(false);
  });

  it("isPreStartAllowed allowlist", () => {
    expect(isPreStartAllowed("read")).toBe(true);
    expect(isPreStartAllowed("cynos_search")).toBe(true);
    expect(isPreStartAllowed("cynos_fetch")).toBe(true);
    expect(isPreStartAllowed("bash")).toBe(false);
    expect(isPreStartAllowed("cynos_subagent")).toBe(false);
    expect(isPreStartAllowed("write")).toBe(false);
    expect(isPreStartAllowed("edit")).toBe(false);
    expect(isPreStartAllowed("playwright_browser_navigate")).toBe(false);
  });
});

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
