import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCompletion } from "../extensions/core/completion-check";
import { PRACTICE_IDS } from "../extensions/practices/ids";
import { allPractices } from "../extensions/practices/registry";
import { refactorBehaviorContractMappedCheckpoint, refactorChallengeCheckpoint, refactorChangesCheckpoint, refactorCharacterizationCheckpoint, refactorFilesReadCheckpoint, refactorPlanCheckpoint, refactorProjectImpactCheckpoint, refactorReviewCheckpoint, refactorScopeBoundedCheckpoint } from "../extensions/practices/checkpoints/refactor";
import { releaseAuthorizationRecordedCheckpoint, releaseDeliveryConfigRecordedCheckpoint, releaseExecutionRecordedCheckpoint, releaseFinalStateRecordedCheckpoint, releaseVerificationRecordedCheckpoint } from "../extensions/practices/checkpoints/release";
import { onboardEngineeringContractCheckpoint, onboardExplorationEvidencedCheckpoint, onboardProjectUnderstandingCheckpoint, onboardReleaseContractCheckpoint, onboardTestingContractCheckpoint } from "../extensions/practices/checkpoints/onboard";
import { reviewReadOnlyCheckpoint, reviewScopeEvidencedCheckpoint } from "../extensions/practices/checkpoints/review";
import { verificationCommandPassedCheckpoint } from "../extensions/practices/checkpoints/common";
import { changeFinalizationRecordedCheckpoint } from "../extensions/practices/checkpoints/change";
import { testAssetsPassedIfWrittenCheckpoint } from "../extensions/practices/checkpoints/test-assets";
import type { CapturedToolResult, CapturedUserAnswer, PracticeId, WorkState } from "../extensions/core/types";

const fixtureProjectRoot = mkdtempSync(join(tmpdir(), "cynos-checkpoints-"));
mkdirSync(join(fixtureProjectRoot, "docs"), { recursive: true });
writeFileSync(join(fixtureProjectRoot, "docs", "testing.md"), "# Testing\n");
writeFileSync(join(fixtureProjectRoot, "docs", "release.md"), "# Release\n");
writeFileSync(join(fixtureProjectRoot, "brand-spec.md"), "# Brand\n");

function work(practice: PracticeId, completionEvidence: Record<string, unknown>, capturedToolResults: CapturedToolResult[] = [], cwd = fixtureProjectRoot, capturedUserAnswers: CapturedUserAnswer[] = []): WorkState {
  return {
    schemaVersion: 1,
    id: `work-${practice}`,
    cwd,
    practice,
    objective: `${practice} objective`,
    acceptanceCriteria: [{ id: "criterion-1", description: "criterion one" }],
    status: "active",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completionEvidence,
    capturedToolResults,
    capturedUserAnswers,
  };
}

function bash(toolCallId: string, command: string, isError = false, outputSummary?: string, at = "2026-01-01T00:00:00.000Z"): CapturedToolResult {
  return { toolCallId, toolName: "bash", input: { command }, outputSummary: outputSummary ?? (isError ? "failed" : "passed"), isError, at };
}

function write(toolCallId: string, path: string): CapturedToolResult {
  return { toolCallId, toolName: "write", input: { path }, outputSummary: `wrote ${path}`, isError: false, at: "2026-01-01T00:00:00.000Z" };
}

function readDoc(toolCallId: string, path: string): CapturedToolResult {
  return { toolCallId, toolName: "read", input: { path }, outputSummary: `read ${path}`, isError: false, at: "2026-01-01T00:00:00.000Z" };
}

function subagent(toolCallId: string, agent: "challenger" | "reviewer", isError = false): CapturedToolResult {
  return { toolCallId, toolName: "cynos_subagent", input: { agent }, outputSummary: `${agent} result`, isError, at: "2026-01-01T00:00:00.000Z" };
}

function browser(toolCallId: string, action = "snapshot"): CapturedToolResult {
  return bash(toolCallId, `npx --yes @playwright/cli -s=test-session ${action}`, false, "browser evidence");
}

function mcpBrowser(toolCallId: string, toolName = "playwright_browser_take_screenshot"): CapturedToolResult {
  return { toolCallId, toolName, input: {}, outputSummary: "browser evidence", isError: false, at: "2026-01-01T00:00:00.000Z" };
}

function search(toolCallId: string): CapturedToolResult {
  return { toolCallId, toolName: "cynos_search", input: { query: "node api gateway" }, outputSummary: "search results", isError: false, at: "2026-01-01T00:00:00.000Z" };
}

function subagentReview(toolCallId: string, agent = "reviewer", outputSummary = "# Reviewer Result\nStatus: PASS"): CapturedToolResult {
  return { toolCallId, toolName: "cynos_subagent", input: { agent, task: "review the change" }, outputSummary, isError: false, at: "2026-01-01T00:00:00.000Z" };
}

const coverage = [{ criterionId: "criterion-1", summary: "covered" }];
const docs = [readDoc("read-testing", "docs/testing.md"), readDoc("read-related", "src/file.ts")];
const finalization = { verificationSummary: "npm test passed", gitSummary: "main clean", commit: { status: "not-committed", reason: "review-only, don't commit (test fixture authorization)" } };
const finalizationEvidence = [bash("git-status", "git status --short")];

function developEvidence(overrides: Record<string, unknown> = {}) {
  return {
    criteriaCoverage: coverage,
    develop: {
      context: {
        complexity: "simple",
        reason: "simple local change in one file",
        relatedFilesRead: ["src/file.ts"],
        existingPatterns: ["src/file.ts local pattern"],
        reuseOrDuplicationCheck: "extends existing local pattern; no duplicate implementation",
      },
      plan: { summary: "implement local change", testPlan: ["npm test"] },
      implementation: { summary: "no file writes in checkpoint fixture", noFileChangeReason: "checkpoint fixture" },
    },
    tdd: { used: false, summary: "checkpoint fixture has no production behavior", notApplicableReason: "unit test fixture without implementation write", alternativeVerification: "npm test" },
    review: { result: "pass", summary: "reviewer clean" },
    projectImpact: { durableMemoryUpdateNeeded: false, reason: "localized develop fixture; no durable project memory update" },
    verification: { summary: "npm test passed" },
    report: { summary: "implemented and verified develop fixture", releaseDecision: "not released; use release practice for push/tag/publish/deploy", evidence: ["npm test", "reviewer"] },
    finalization,
    ...overrides,
  };
}

function developWithFiles(filesChanged: string[], overrides: Record<string, unknown> = {}) {
  const base = developEvidence();
  return {
    ...base,
    develop: {
      ...(base.develop as Record<string, unknown>),
      implementation: { summary: `changed ${filesChanged.join(", ")}`, filesChanged },
    },
    ...overrides,
  };
}

function complexDevelopEvidence(overrides: Record<string, unknown> = {}) {
  return developEvidence({
    develop: {
      context: {
        complexity: "complex",
        reason: "cross-module behavior and interface change",
        relatedFilesRead: ["src/file.ts", "src/service.ts"],
        existingPatterns: ["src/service.ts service pattern"],
        tracedFlowOrEdges: ["src/file.ts -> src/service.ts"],
        impactedModules: ["core", "service"],
        reuseOrDuplicationCheck: "extends service boundary instead of duplicating logic",
      },
      plan: {
        summary: "implement cross-module behavior",
        tasks: ["add behavior test", "update service", "wire caller"],
        touchedAreas: ["src/file.ts", "src/service.ts"],
        testPlan: ["npm test"],
        risksOrAssumptions: ["service interface compatibility"],
      },
      challenge: { summary: "challenger approved plan", result: "accepted" },
      implementation: { summary: "no file writes in checkpoint fixture", noFileChangeReason: "checkpoint fixture" },
    },
    ...overrides,
  });
}

function defaultEvidence(overrides: Record<string, unknown> = {}) {
  return {
    criteriaCoverage: coverage,
    default: { work: { summary: "updated repo metadata", filesChanged: [".gitignore"] } },
    verification: { summary: "npm test passed" },
    finalization,
    ...overrides,
  };
}

function docsEvidence(overrides: Record<string, unknown> = {}) {
  return {
    criteriaCoverage: coverage,
    docs: {
      scope: { audience: "maintainers", docType: "guide", filesTargeted: ["docs/guide.md"], behaviorChangeIncluded: false },
      sources: { projectFilesRead: ["src/file.ts"] },
      changes: { filesChanged: ["docs/guide.md"], summary: "documented guide", consistencyNotes: ["aligned with source"] },
    },
    verification: { summary: "npm test passed" },
    finalization,
    ...overrides,
  };
}

function testEvidence(overrides: Record<string, unknown> = {}) {
  return {
    criteriaCoverage: coverage,
    scope: { target: "add()", surface: "unit", plan: "run focused test" },
    runs: [{ kind: "unit", summary: "npm test -- add", outcome: "pass", evidence: "captured bash" }],
    verdict: { summary: "add works", outcome: "pass" },
    report: { summary: "tested add", evidence: ["npm test -- add"] },
    ...overrides,
  };
}

function debugEvidence(overrides: Record<string, unknown> = {}) {
  return {
    criteriaCoverage: coverage,
    debugging: {
      reproduction: { kind: "test", summary: "red failed" },
      diagnostics: { evidenceRead: ["assertion failed at src/file.ts"] },
      investigation: { relatedFilesRead: ["src/file.ts"], flowsTraced: ["test -> src/file.ts -> bad state"] },
      rootCause: { summary: "bad state", evidence: ["trace"] },
      fix: { summary: "correct state transition", filesChanged: ["src/file.ts"] },
      regression: { summary: "red/green" },
    },
    projectImpact: { durableMemoryUpdateNeeded: false, reason: "localized bug; no durable project rule changed" },
    report: { summary: "fixed bug", symptom: "test failed", rootCause: "bad state", fix: "corrected state", verification: "npm test passed", evidence: ["red/green bash"], projectMemoryDecision: "no durable memory update needed" },
    verification: { summary: "npm test passed" },
    finalization,
    ...overrides,
  };
}

describe("practice checkpoints", () => {
  it("practice ids have a single source of truth", () => {
    expect(allPractices().map((practice) => practice.id).sort()).toEqual([...PRACTICE_IDS].sort());
  });

  it("default completes metadata and unknown fallback work with verification and finalization", () => {
    const metadata = checkCompletion(work("default", defaultEvidence(), [readDoc("read-testing", "docs/testing.md"), write("gitignore", ".gitignore"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(metadata.allSatisfied).toBe(true);

    const unknownFallbackEvidence = defaultEvidence({ default: { work: { summary: "updated repository attributes", filesChanged: [".gitattributes"] } } });
    const unknownFallback = checkCompletion(work("default", unknownFallbackEvidence, [write("attrs", ".gitattributes"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(unknownFallback.allSatisfied).toBe(true);
  });

  it("default does not use surface/test-asset shared checkpoints", () => {
    const defaultPractice = allPractices().find((practice) => practice.id === "default");
    expect(defaultPractice?.checkpoints.map((checkpoint) => checkpoint.id)).not.toContain("surface-verification-evidence-if-required");
    expect(defaultPractice?.checkpoints.map((checkpoint) => checkpoint.id)).not.toContain("test-assets-passed-if-written");
  });

  it("default requires work evidence but no longer hard-gates project testing docs", () => {
    const noWork = checkCompletion(work("default", defaultEvidence({ default: {} }), [write("attrs", ".gitattributes"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(noWork.allSatisfied).toBe(false);
    expect(noWork.missing.join("\n")).toContain("default.work");

    const noDocs = checkCompletion(work("default", defaultEvidence(), [write("gitignore", ".gitignore"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(noDocs.allSatisfied).toBe(true);
  });

  it("default accepts metadata paths and absolute in-project paths", () => {
    const evidence = defaultEvidence({ default: { work: { summary: "updated repo metadata", filesChanged: ["LICENSE", ".gitignore", ".editorconfig"] } } });
    const result = checkCompletion(work("default", evidence, [write("license", "LICENSE"), write("gitignore", ".gitignore"), write("editorconfig", ".editorconfig"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);

    const gitignore = join(fixtureProjectRoot, ".gitignore");
    const absoluteEvidence = defaultEvidence({ default: { work: { summary: "updated repo metadata", filesChanged: [gitignore] } } });
    const absoluteResult = checkCompletion(work("default", absoluteEvidence, [write("gitignore", gitignore), bash("test", "npm test"), ...finalizationEvidence]));
    expect(absoluteResult.allSatisfied).toBe(true);
  });

  it("default filesChanged uses real mutation evidence and handles no-delivered-change work", () => {
    const missingWrite = checkCompletion(work("default", defaultEvidence(), [bash("test", "npm test"), ...finalizationEvidence]));
    expect(missingWrite.allSatisfied).toBe(false);
    expect(missingWrite.missing.join("\n")).toContain("no captured mutation");

    const hiddenMutation = defaultEvidence({ default: { work: { summary: "updated repository attributes" } } });
    const hiddenResult = checkCompletion(work("default", hiddenMutation, [write("attrs", ".gitattributes"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(hiddenResult.allSatisfied).toBe(false);
    expect(hiddenResult.missing.join("\n")).toContain("filesChanged[] is empty");

    const temporaryMutation = defaultEvidence({ default: { work: { summary: "checked temporary scratch", noFileChangeReason: "temporary mutation was reverted / non-delivered" } } });
    const temporaryResult = checkCompletion(work("default", temporaryMutation, [write("attrs", ".gitattributes"), bash("rm-attrs", "rm .gitattributes"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(temporaryResult.allSatisfied).toBe(true);

    const noChange = defaultEvidence({ default: { work: { summary: "verified current state", noFileChangeReason: "no project changes to commit" }, }, finalization: { verificationSummary: "npm test passed", gitSummary: "main clean", commit: { status: "not-committed", reason: "no project changes to commit" } } });
    const noChangeResult = checkCompletion(work("default", noChange, [bash("test", "npm test"), ...finalizationEvidence]));
    expect(noChangeResult.allSatisfied).toBe(true);
  });

  it("default blocks owned fact-space mutations but allows unknown fallback", () => {
    const ownedCases: Array<[string, string, string]> = [
      ["src/file.ts", "code", "owned by develop"],
      ["tests/foo.test.ts", "test-file", "owned by test"],
      ["README.md", "readme", "owned by docs"],
      ["package.json", "pkg", "owned by develop"],
      ["docker-compose.yml", "compose", "owned by develop"],
      ["src/README.md", "src-readme", "owned by develop"],
      ["docs/release.md", "release-doc", "owned by release"],
      ["PROJECT.md", "project", "owned by onboard"],
    ];
    for (const [path, id, expected] of ownedCases) {
      const evidence = defaultEvidence({ default: { work: { summary: `changed ${path}`, filesChanged: [path] } } });
      const result = checkCompletion(work("default", evidence, [write(id, path), bash("test", "npm test"), ...finalizationEvidence]));
      expect(result.allSatisfied, path).toBe(false);
      expect(result.missing.join("\n"), path).toContain(expected);
    }

    const unknown = defaultEvidence({ default: { work: { summary: "updated mailmap", filesChanged: [".mailmap"] } } });
    const unknownResult = checkCompletion(work("default", unknown, [write("mailmap", ".mailmap"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(unknownResult.allSatisfied).toBe(true);
  });

  it("default rejects release side-effect attempts as defense in depth", () => {
    const releaseResult = checkCompletion(work("default", defaultEvidence(), [write("gitignore", ".gitignore"), bash("test", "npm test"), bash("push", "git push origin main", true, "rejected"), ...finalizationEvidence]));
    expect(releaseResult.allSatisfied).toBe(false);
    expect(releaseResult.missing.join("\n")).toContain("release side-effect");
  });

  it("docs completes documentation work with finalization and no hard project-docs gate", () => {
    const ok = checkCompletion(work("docs" as PracticeId, docsEvidence(), [readDoc("read-testing", "docs/testing.md"), readDoc("read-source", "src/file.ts"), write("guide", "docs/guide.md"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);

    const absoluteGuide = join(fixtureProjectRoot, "docs", "absolute-guide.md");
    const absoluteEvidence = docsEvidence({ docs: { ...(docsEvidence().docs as any), scope: { audience: "maintainers", docType: "guide", filesTargeted: [absoluteGuide], behaviorChangeIncluded: false }, changes: { filesChanged: [absoluteGuide], summary: "documented guide" } } });
    const absoluteOk = checkCompletion(work("docs" as PracticeId, absoluteEvidence, [readDoc("read-testing", "docs/testing.md"), readDoc("read-source", "src/file.ts"), write("guide-abs", absoluteGuide), bash("test", "npm test"), ...finalizationEvidence]));
    expect(absoluteOk.allSatisfied).toBe(true);

    const noTestingDoc = checkCompletion(work("docs" as PracticeId, docsEvidence(), [readDoc("read-source", "src/file.ts"), write("guide", "docs/guide.md"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(noTestingDoc.allSatisfied).toBe(true);

    const packageWrite = docsEvidence({ docs: { ...(docsEvidence().docs as any), changes: { filesChanged: ["package.json"], summary: "changed package" } } });
    const packageResult = checkCompletion(work("docs" as PracticeId, packageWrite, [readDoc("read-testing", "docs/testing.md"), readDoc("read-source", "src/file.ts"), write("pkg", "package.json"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(packageResult.allSatisfied).toBe(false);
    expect(packageResult.missing.join("\n")).toContain("docs is not allowed to write");

    const ciWrite = docsEvidence({ docs: { ...(docsEvidence().docs as any), changes: { filesChanged: [".github/workflows/ci.yml"], summary: "changed CI" } } });
    const ciResult = checkCompletion(work("docs" as PracticeId, ciWrite, [readDoc("read-testing", "docs/testing.md"), readDoc("read-source", "src/file.ts"), write("ci", ".github/workflows/ci.yml"), bash("test", "npm test"), ...finalizationEvidence]));
    expect(ciResult.allSatisfied).toBe(false);
    expect(ciResult.missing.join("\n")).toContain("docs is not allowed to write");

    const secretDoc = docsEvidence({ docs: { ...(docsEvidence().docs as any), scope: { audience: "maintainers", docType: "config-doc", filesTargeted: ["docs/token.md"], behaviorChangeIncluded: false }, changes: { filesChanged: ["docs/token.md"], summary: "token guide" } } });
    const secretResult = checkCompletion(work("docs" as PracticeId, secretDoc, [readDoc("read-testing", "docs/testing.md"), readDoc("read-source", "src/file.ts"), write("token", "docs/token.md"), bash("test", "npm test"), ...finalizationEvidence]));
    // safety gate removed (v0.17.11): a config-doc no longer needs docs.safety; secret-handling is skill guidance only.
    expect(secretResult.allSatisfied).toBe(true);
  });

  it("test practice accepts PASS and FAIL verdicts with real run evidence", () => {
    const pass = checkCompletion(work("test", testEvidence(), [bash("test-pass", "npm test -- add")]));
    expect(pass.allSatisfied).toBe(true);

    const fail = checkCompletion(work("test", testEvidence({ runs: [{ kind: "unit", summary: "failed", outcome: "fail" }], verdict: { summary: "add is broken", outcome: "fail", failures: ["expected 2 got 3"] } }), [bash("test-fail", "npm test -- add", true, "FAIL add") ]));
    expect(fail.allSatisfied).toBe(true);
  });

  it("test practice treats Playwright CLI as browser evidence but rejects MCP/browser fake tools", () => {
    const cli = checkCompletion(work("test", testEvidence({ runs: [{ kind: "browser", summary: "snapshot passed", outcome: "pass" }], verdict: { summary: "browser flow works", outcome: "pass" } }), [browser("pw-snapshot")]));
    expect(cli.allSatisfied).toBe(true);

    const e2e = checkCompletion(work("test", testEvidence({ runs: [{ kind: "browser", summary: "e2e passed", outcome: "pass" }], verdict: { summary: "browser e2e passed", outcome: "pass" } }), [bash("e2e", "npx playwright test")]));
    expect(e2e.allSatisfied).toBe(true);

    const fakeTool = checkCompletion(work("test", testEvidence({ runs: [{ kind: "browser", summary: "fake browser", outcome: "pass" }], verdict: { summary: "fake browser", outcome: "pass" } }), [mcpBrowser("mcp-shot")]));
    expect(fakeTool.allSatisfied).toBe(false);
    expect(fakeTool.missing.join("\n")).toContain("outcome=pass");
  });

  it("test practice does not let verdict outcome contradict captured run evidence", () => {
    const fakeFail = checkCompletion(work("test", testEvidence({ runs: [{ kind: "unit", summary: "passed", outcome: "fail" }], verdict: { summary: "claims failure", outcome: "fail", failures: ["none evidenced"] } }), [bash("test-pass", "npm test -- add", false, "PASS add") ]));
    expect(fakeFail.allSatisfied).toBe(false);
    expect(fakeFail.missing.join("\n")).toContain("outcome=fail");

    const fakePass = checkCompletion(work("test", testEvidence(), [bash("echo", "echo ok", false, "ok") ]));
    expect(fakePass.allSatisfied).toBe(false);
    expect(fakePass.missing.join("\n")).toContain("outcome=pass");

    const echoMaskedFail = checkCompletion(work("test", testEvidence({ runs: [{ kind: "unit", summary: "failed", outcome: "fail" }], verdict: { summary: "add is broken", outcome: "fail", failures: ["assertion"] } }), [bash("masked", "npm test; echo \"exit:$?\"", false, "FAIL add\nexit:1") ]));
    expect(echoMaskedFail.allSatisfied).toBe(true);
  });

  it("test practice requires flaky verdicts to have flaky or mixed run evidence", () => {
    const fakeFlake = checkCompletion(work("test", testEvidence({ runs: [{ kind: "unit", summary: "passed once", outcome: "flake" }], verdict: { summary: "claims flake", outcome: "flake" } }), [bash("test-pass", "npm test", false, "PASS add") ]));
    expect(fakeFlake.allSatisfied).toBe(false);
    expect(fakeFlake.missing.join("\n")).toContain("outcome=flake");

    const negatedFlakeText = checkCompletion(work("test", testEvidence({ runs: [{ kind: "unit", summary: "passed and not flaky", outcome: "flake" }], verdict: { summary: "claims flake", outcome: "flake" } }), [bash("test-pass", "npm test", false, "PASS add; not flaky") ]));
    expect(negatedFlakeText.allSatisfied).toBe(false);

    const mixed = checkCompletion(work("test", testEvidence({ runs: [{ kind: "unit", summary: "failed then passed", outcome: "flake" }], verdict: { summary: "intermittent", outcome: "flake" } }), [bash("test-fail", "npm test", true, "FAIL add"), bash("test-pass", "npm test", false, "PASS add") ]));
    expect(mixed.allSatisfied).toBe(true);
  });

  it("test practice requires blocked verdict to have a real failed attempt", () => {
    const evidence = testEvidence({
      runs: [{ kind: "api", summary: "server unavailable", outcome: "blocked", attemptedApproaches: ["curl local API"] }],
      verdict: { summary: "blocked", outcome: "blocked", blockedReason: "server would not start", attemptedApproaches: ["curl local API"], alternativeVerification: "read route wiring" },
    });
    const bad = checkCompletion(work("test", evidence, []));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("real captured failed attempt");

    const ok = checkCompletion(work("test", evidence, [bash("curl-fail", "curl http://127.0.0.1:3000/health", true, "connection refused") ]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("test practice allows test assets and .cynos scratch but blocks product/docs/config writes", () => {
    const ok = checkCompletion(work("test", testEvidence({ assets: { throwaway: ["tests/add.test.ts"] }, verdict: { summary: "add fails", outcome: "fail", failures: ["assertion"] } }), [write("test-asset", "tests/add.test.ts"), write("scratch", ".cynos/tmp/result.json"), bash("test-run", "npm test", true, "FAIL add"), bash("delete-throwaway", "rm tests/add.test.ts") ]));
    expect(ok.allSatisfied).toBe(true);

    const srcWrite = checkCompletion(work("test", testEvidence(), [write("src", "src/add.ts"), bash("test-run", "npm test") ]));
    expect(srcWrite.allSatisfied).toBe(false);
    expect(srcWrite.missing.join("\n")).toContain("test-product-readonly");

    const docWrite = checkCompletion(work("test", testEvidence(), [write("doc", "docs/smoke-report.md"), bash("test-run", "npm test") ]));
    expect(docWrite.allSatisfied).toBe(false);
    expect(docWrite.missing.join("\n")).toContain("test-product-readonly");

    const configWrite = checkCompletion(work("test", testEvidence(), [write("playwright-config", "playwright.config.ts"), bash("test-run", "npm test") ]));
    expect(configWrite.allSatisfied).toBe(false);
    expect(configWrite.missing.join("\n")).toContain("test-product-readonly");
  });

  it("test asset execution and finalization are split for test practice", () => {
    const noRun = checkCompletion(work("test", testEvidence({ assets: { retained: ["tests/add.test.ts"] } }), [write("test-asset", "tests/add.test.ts") ]));
    expect(noRun.allSatisfied).toBe(false);
    expect(noRun.missing.join("\n")).toContain("test-assets-executed-if-written");

    const failingRunWithRetained = checkCompletion(work("test", testEvidence({ assets: { retained: ["tests/add.test.ts"] }, verdict: { summary: "add fails", outcome: "fail", failures: ["assertion"] } }), [write("test-asset", "tests/add.test.ts"), bash("test-fail", "npm test", true, "FAIL add"), bash("git-status", "git status --short", false, "?? tests/add.test.ts") ]));
    expect(failingRunWithRetained.allSatisfied).toBe(false);
    expect(failingRunWithRetained.missing.join("\n")).toContain("finalization");

    const withFinalization = checkCompletion(work("test", testEvidence({ assets: { retained: ["tests/add.test.ts"] }, verdict: { summary: "add fails", outcome: "fail", failures: ["assertion"] }, finalization }), [write("test-asset", "tests/add.test.ts"), bash("test-fail", "npm test", true, "FAIL add"), bash("git-status", "git status --short", false, "?? tests/add.test.ts") ]));
    expect(withFinalization.allSatisfied).toBe(true);

    const committedFinalization = { verificationSummary: "npm test failed as expected", gitSummary: "committed tests/add.test.ts", commit: { status: "committed", message: "test: add failing regression fixture" } };
    const withCommit = checkCompletion(work("test", testEvidence({ assets: { retained: ["tests/add.test.ts"] }, verdict: { summary: "add fails", outcome: "fail", failures: ["assertion"] }, finalization: committedFinalization }), [write("test-asset", "tests/add.test.ts"), bash("test-fail", "npm test", true, "FAIL add"), bash("git-status", "git status --short", false, "?? tests/add.test.ts"), bash("git-add", "git add tests/add.test.ts"), bash("git-staged", "git diff --cached --name-only", false, "tests/add.test.ts"), bash("git-commit", "git commit -m 'test: add failing regression fixture'", false, "[main abc123] test: add failing regression fixture") ]));
    expect(withCommit.allSatisfied).toBe(true);

    const unsafeCommit = checkCompletion(work("test", testEvidence({ assets: { retained: ["tests/add.test.ts"] }, verdict: { summary: "add fails", outcome: "fail", failures: ["assertion"] }, finalization: committedFinalization }), [write("test-asset", "tests/add.test.ts"), bash("test-fail", "npm test", true, "FAIL add"), bash("git-status", "git status --short", false, "?? tests/add.test.ts"), bash("git-add", "git add tests/add.test.ts"), bash("git-staged", "git diff --cached --name-only", false, "tests/add.test.ts\nsrc/add.ts"), bash("git-commit", "git commit -m 'test: add failing regression fixture'", false, "[main abc123] test: add failing regression fixture") ]));
    expect(unsafeCommit.allSatisfied).toBe(false);
    expect(unsafeCommit.missing.join("\n")).toContain("test-product-readonly");

    const commitAnswerAsSkipFinalization = { verificationSummary: "npm test passed", gitSummary: "tests/add.test.ts retained", commit: { status: "not-committed", reason: "用户明确指示'提交吧'，授权提交测试资产", userAuthorizedSkip: true } };
    const commitAnswerAsSkip = checkCompletion(work("test", testEvidence({ assets: { retained: ["tests/add.test.ts"] }, finalization: commitAnswerAsSkipFinalization }), [write("test-asset", "tests/add.test.ts"), bash("test-pass", "npm test", false, "PASS add"), bash("git-status", "git status --short", false, "?? tests/add.test.ts") ], fixtureProjectRoot, [{ question: "commit?", answerSummary: "用户要求提交测试文件到 git", at: "2026-01-01T00:00:00.000Z" }]));
    expect(commitAnswerAsSkip.allSatisfied).toBe(false);
    expect(commitAnswerAsSkip.missing.join("\n")).toContain("authorized skipping the commit");
  });

  it("test practice detects bash-created test assets and requires a later execution", () => {
    const bashWrite = bash("bash-write", "cat > tests/add.test.js <<'JS'\nthrow new Error('boom')\nJS", false, "");
    const noLaterRun = checkCompletion(work("test", testEvidence({ assets: { retained: ["tests/add.test.js"] } }), [bash("early-test", "npm test"), bashWrite]));
    expect(noLaterRun.allSatisfied).toBe(false);
    expect(noLaterRun.missing.join("\n")).toContain("no later test command");

    const probeOnly = checkCompletion(work("test", testEvidence({ assets: { retained: ["tests/add.test.js"] }, verdict: { summary: "API responded", outcome: "pass" }, finalization }), [bashWrite, bash("probe", "curl http://127.0.0.1:3000/health", false, "ok"), bash("git-status", "git status --short", false, "?? tests/add.test.js") ]));
    expect(probeOnly.allSatisfied).toBe(false);
    expect(probeOnly.missing.join("\n")).toContain("no later test command");

    const laterRun = checkCompletion(work("test", testEvidence({ assets: { retained: ["tests/add.test.js"] }, verdict: { summary: "asset exposes failure", outcome: "fail", failures: ["boom"] }, finalization }), [bashWrite, bash("test-fail", "npm test", true, "FAIL boom"), bash("git-status", "git status --short", false, "?? tests/add.test.js") ]));
    expect(laterRun.allSatisfied).toBe(true);

    const deletedThrowaway = checkCompletion(work("test", testEvidence({ assets: { throwaway: ["tests/add.test.js"] }, verdict: { summary: "asset exposes failure", outcome: "fail", failures: ["boom"] } }), [bashWrite, bash("test-fail", "npm test", true, "FAIL boom"), bash("rm-test", "rm tests/add.test.js") ]));
    expect(deletedThrowaway.allSatisfied).toBe(true);
  });

  it("review requires evidenced scope and remains read-only", () => {
    const ok = checkCompletion(work("review", {
      criteriaCoverage: coverage,
      reviewScope: { targets: ["src/file.ts"], basis: "user requested file review", targetType: "files" },
      verification: { permission: "read-only", notRunReason: "read-only review" },
      context: { projectDocsRead: [], relatedFilesRead: ["src/file.ts"], normsApplied: [] },
      report: { overall: "pass", summary: "clean", projectMemorySuggestions: [], findings: [], nextSteps: [] },
    }, [readDoc("read-target", "src/file.ts")]));
    expect(ok.allSatisfied).toBe(true);

    const bad = checkCompletion(work("review", {
      criteriaCoverage: coverage,
      reviewScope: { targets: ["src/file.ts"], basis: "user requested file review", targetType: "files" },
      verification: { permission: "read-only", notRunReason: "read-only review" },
      context: { projectDocsRead: [], relatedFilesRead: ["src/file.ts"], normsApplied: [] },
      report: { overall: "pass", summary: "clean", projectMemorySuggestions: [], findings: [], nextSteps: [] },
    }, [readDoc("read-target", "src/file.ts"), write("write-project", "PROJECT.md")]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("tool-write");
  });

  it("develop requires finalization with real git status and verification", () => {
    const ok = checkCompletion(work("develop", developEvidence(), [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);

    const missingGit = checkCompletion(work("develop", developEvidence(), [bash("test", "npm test"), ...docs]));
    expect(missingGit.allSatisfied).toBe(false);
    expect(missingGit.missing.join("\n")).toContain("git status");
  });

  it("not-committed requires user authorization (closes the loophole)", () => {
    // Bug 1 fix: a bare reason like "用户未要求提交" / "改动已验证" must NOT pass. Only explicit
    // skip/not-commit authorization (fresh cynos_ask_user + quoted skip intent, or original-prompt
    // opt-out phrase) allows not-committing.
    const baseFinalization = { verificationSummary: "npm test passed", gitSummary: "main clean" };
    const gitEvidence = [...docs, write("src-write", "src/file.ts"), subagentReview("reviewer-result"), bash("test", "npm test"), bash("git-status", "git status --short")];

    // (a) bare reason, no authorization -> FAIL (this is the f3/f6 loophole case)
    const bareReason = checkCompletion(work("develop", developWithFiles(["src/file.ts"], { finalization: { ...baseFinalization, commit: { status: "not-committed", reason: "用户未要求提交" } } }), gitEvidence));
    expect(bareReason.allSatisfied).toBe(false);
    expect(bareReason.missing.join("\n")).toContain("not-committed requires explicit user authorization");

    // (b) userAuthorizedSkip=true but no capturedUserAnswers -> FAIL
    const skipNoAnswers = checkCompletion(work("develop", developWithFiles(["src/file.ts"], { finalization: { ...baseFinalization, commit: { status: "not-committed", reason: "user said skip commit", userAuthorizedSkip: true } } }), gitEvidence));
    expect(skipNoAnswers.allSatisfied).toBe(false);
    expect(skipNoAnswers.missing.join("\n")).toContain("userAuthorizedSkip=true but no capturedUserAnswers");

    // (c) userAuthorizedSkip=true + capturedUserAnswers + quoted skip intent -> PASS (fresh cynos_ask_user path)
    const skipWithAnswers = checkCompletion(work("develop", developWithFiles(["src/file.ts"], { finalization: { ...baseFinalization, commit: { status: "not-committed", reason: "user said don't commit / skip commit", userAuthorizedSkip: true } } }), gitEvidence, fixtureProjectRoot, [{ question: "skip commit?", answerSummary: "yes, don't commit", at: "2026-01-01T00:00:00.000Z" }]));
    expect(skipWithAnswers.allSatisfied).toBe(true);

    // (c2) userAuthorizedSkip=true cannot turn a commit authorization into skip authorization.
    const commitAnswerAsSkip = checkCompletion(work("develop", developWithFiles(["src/file.ts"], { finalization: { ...baseFinalization, commit: { status: "not-committed", reason: "用户明确指示'提交吧'，授权提交测试资产", userAuthorizedSkip: true } } }), gitEvidence, fixtureProjectRoot, [{ question: "commit?", answerSummary: "用户要求提交测试文件到 git", at: "2026-01-01T00:00:00.000Z" }]));
    expect(commitAnswerAsSkip.allSatisfied).toBe(false);
    expect(commitAnswerAsSkip.missing.join("\n")).toContain("authorized skipping the commit");

    // (d) original-prompt authorization phrase in reason -> PASS (dual-path, no fresh ask needed)
    const promptAuth = checkCompletion(work("develop", developWithFiles(["src/file.ts"], { finalization: { ...baseFinalization, commit: { status: "not-committed", reason: "review-only, don't commit, show me the diff" } } }), gitEvidence));
    expect(promptAuth.allSatisfied).toBe(true);

    // (e) original-prompt authorization phrase in objective -> PASS (dual-path via work.objective)
    const objectiveWork: WorkState = {
      schemaVersion: 1, id: "work-auth-objective", cwd: fixtureProjectRoot, practice: "develop",
      objective: "改一下别提交，只给我看 diff",
      acceptanceCriteria: [{ id: "criterion-1", description: "criterion one" }],
      status: "active", startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      completionEvidence: developWithFiles(["src/file.ts"], { finalization: { ...baseFinalization, commit: { status: "not-committed", reason: "per task" } } }),
      capturedToolResults: gitEvidence, capturedUserAnswers: [],
    };
    const objectiveResult = checkCompletion(objectiveWork);
    expect(objectiveResult.allSatisfied).toBe(true);

    // (f) unrelated Q&A captured but no skip flag + no prompt auth + bare reason -> FAIL.
    // Bug 1 follow-up: capturedUserAnswers is populated by ANY cynos_ask_user, so freshAuth alone
    // must NOT be a sufficient authorization (otherwise a lazy bare reason passes just because
    // some unrelated question was asked mid-work). This locks the !freshAuth && !promptAuth fix.
    const unrelatedAnswers: WorkState = {
      schemaVersion: 1, id: "work-auth-unrelated", cwd: fixtureProjectRoot, practice: "develop",
      objective: "develop objective",
      acceptanceCriteria: [{ id: "criterion-1", description: "criterion one" }],
      status: "active", startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      completionEvidence: developWithFiles(["src/file.ts"], { finalization: { ...baseFinalization, commit: { status: "not-committed", reason: "改动已验证，待用户决定" } } }),
      capturedToolResults: gitEvidence,
      capturedUserAnswers: [{ question: "用方案 A 还是 B？", answerSummary: "A", at: "2026-01-01T00:00:00.000Z" }],  // unrelated Q&A
    };
    const unrelatedResult = checkCompletion(unrelatedAnswers);
    expect(unrelatedResult.allSatisfied).toBe(false);
    expect(unrelatedResult.missing.join("\n")).toContain("not-committed requires explicit user authorization");
  });

  it("no-mutation finalization can be not-committed without skip authorization", () => {
    const noMutationFinalization = { verificationSummary: "npm test passed", gitSummary: "main clean", commit: { status: "not-committed", reason: "no project changes to commit" } };
    for (const practice of ["default", "docs"] as PracticeId[]) {
      const result = changeFinalizationRecordedCheckpoint.check(work(practice, { finalization: noMutationFinalization }, [bash("test", "npm test"), bash("git-status", "git status --short")]));
      expect(result.satisfied, practice).toBe(true);
    }

    const producingDevelop = changeFinalizationRecordedCheckpoint.check(work("develop", { finalization: noMutationFinalization }, [write("src", "src/file.ts"), bash("test", "npm test"), bash("git-status", "git status --short")]));
    expect(producingDevelop.satisfied).toBe(false);
  });

  it("no-mutation finalization accepts any non-empty reason regardless of phrasing (relaxation is phrase-independent)", () => {
    // Regression guard for smoke 20260705102727 R6: a Chinese-preferring model wrote
    // '未改动任何文件，无需提交' which matched the OLD skip-auth path (无需提交) instead of
    // the new no-mutation relaxation. The relaxation must be taken whenever there are zero
    // content mutations, independent of reason wording (the reason is still required non-empty).
    const chineseReasonFinalization = { verificationSummary: "npm test passed", gitSummary: "main clean", commit: { status: "not-committed", reason: "未改动任何文件，无需提交" } };
    const ambiguousReasonFinalization = { verificationSummary: "npm test passed", gitSummary: "main clean", commit: { status: "not-committed", reason: "checked, nothing to do" } };
    for (const reason of [chineseReasonFinalization, ambiguousReasonFinalization]) {
      const result = changeFinalizationRecordedCheckpoint.check(work("default", { finalization: reason }, [bash("test", "npm test"), bash("git-status", "git status --short")]));
      expect(result.satisfied, JSON.stringify(reason)).toBe(true);
    }
  });

  it("modifying practices no longer hard-gate existing project/testing docs or release docs by default", () => {
    const withoutProjectDocs = checkCompletion(work("develop", developEvidence(), [bash("test", "npm test"), readDoc("read-related", "src/file.ts"), subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(withoutProjectDocs.allSatisfied).toBe(true);

    const withoutRelease = checkCompletion(work("develop", developEvidence(), [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(withoutRelease.allSatisfied).toBe(true);
  });

  it("develop requires focused context with real related file reads", () => {
    const bad = checkCompletion(work("develop", developEvidence(), [bash("test", "npm test"), readDoc("read-testing", "docs/testing.md"), ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("relatedFilesRead");

    const missingReuse = developEvidence({
      develop: {
        context: { complexity: "simple", reason: "local", relatedFilesRead: ["src/file.ts"] },
        plan: { summary: "implement local change", testPlan: ["npm test"] },
      },
    });
    const result = checkCompletion(work("develop", missingReuse, [bash("test", "npm test"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("reuseOrDuplicationCheck");
  });

  it("complex develop requires plan details and challenger evidence", () => {
    const missingChallenge = checkCompletion(work("develop", complexDevelopEvidence(), [bash("test", "npm test"), ...docs, readDoc("read-service", "src/service.ts"), ...finalizationEvidence]));
    expect(missingChallenge.allSatisfied).toBe(false);
    expect(missingChallenge.missing.join("\n")).toContain("challenger");

    const ok = checkCompletion(work("develop", complexDevelopEvidence(), [bash("test", "npm test"), ...docs, readDoc("read-service", "src/service.ts"), subagentReview("challenge", "challenger", "Challenger: plan accepted"), subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("complex challenger sequence gate: challenger BEFORE first production write passes", () => {
    // STRONG door — a normal challenger must run before the first production write.
    const evidence = complexDevelopEvidence({ develop: { ...(complexDevelopEvidence().develop as Record<string, unknown>), implementation: { summary: "implement behavior", filesChanged: ["src/file.ts"] } } });
    const before = checkCompletion(work("develop", evidence, [readDoc("read-service", "src/service.ts"), subagentReview("challenge", "challenger", "Challenger: plan accepted"), write("impl", "src/file.ts"), bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(before.allSatisfied).toBe(true);
  });

  it("complex challenger sequence gate: challenger AFTER first production write is rejected (no midStreamUpgrade)", () => {
    // A post-implementation challenger only rubber-stamps a finished design — strong door rejects it.
    const evidence = complexDevelopEvidence({ develop: { ...(complexDevelopEvidence().develop as Record<string, unknown>), implementation: { summary: "implement behavior", filesChanged: ["src/file.ts"] } } });
    const after = checkCompletion(work("develop", evidence, [write("impl", "src/file.ts"), bash("test", "npm test"), ...docs, readDoc("read-service", "src/service.ts"), subagentReview("challenge", "challenger", "Challenger: plan accepted"), subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(after.allSatisfied).toBe(false);
    expect(after.missing.join("\n")).toContain("BEFORE the first production write");
  });

  it("complex challenger sequence gate: no production write (pure investigation) does not trigger the gate", () => {
    // firstProductionWriteIndex is +Infinity when there is no production write, so a challenger at any index passes.
    const noWrite = checkCompletion(work("develop", complexDevelopEvidence(), [bash("test", "npm test"), ...docs, readDoc("read-service", "src/service.ts"), subagentReview("challenge", "challenger", "Challenger: plan accepted"), subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(noWrite.allSatisfied).toBe(true);
  });

  it("complex challenger can fall back after evidenced failures or user authorization", () => {
    const failedOnce = checkCompletion(work("develop", complexDevelopEvidence({ develop: { ...(complexDevelopEvidence().develop as Record<string, unknown>), challenge: { summary: "manual challenge after tool failure", fallbackReason: "challenger timed out twice" } } }), [bash("test", "npm test"), ...docs, readDoc("read-service", "src/service.ts"), { ...subagentReview("challenge-failed", "challenger", "timeout"), isError: true }, ...finalizationEvidence]));
    expect(failedOnce.allSatisfied).toBe(false);
    expect(failedOnce.missing.join("\n")).toContain("at least 2");

    const failedTwice = checkCompletion(work("develop", complexDevelopEvidence({ develop: { ...(complexDevelopEvidence().develop as Record<string, unknown>), challenge: { summary: "manual challenge after tool failure", fallbackReason: "challenger timed out twice" } } }), [bash("test", "npm test"), ...docs, readDoc("read-service", "src/service.ts"), { ...subagentReview("challenge-failed-1", "challenger", "timeout"), isError: true }, { ...subagentReview("challenge-failed-2", "challenger", "timeout"), isError: true }, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(failedTwice.allSatisfied).toBe(true);

    const userSkipped = work("develop", complexDevelopEvidence({ develop: { ...(complexDevelopEvidence().develop as Record<string, unknown>), challenge: { summary: "user authorized skipping challenger", userAuthorizedSkip: true } } }), [bash("test", "npm test"), ...docs, readDoc("read-service", "src/service.ts"), subagentReview("reviewer-result"), ...finalizationEvidence]);
    userSkipped.capturedUserAnswers = [{ question: "Skip challenger?", answerSummary: "User authorized skipping challenger for this test", at: "2026-01-01T00:00:01.000Z" }];
    expect(checkCompletion(userSkipped).allSatisfied).toBe(true);
  });

  it("develop requires reviewer subagent unless fallback is evidenced", () => {
    const noReviewer = developEvidence({ review: { result: "pass", summary: "self-review clean" } });
    const bad = checkCompletion(work("develop", noReviewer, [bash("test", "npm test"), ...docs, ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("reviewer");

    const inferredSubagent = checkCompletion(work("develop", noReviewer, [bash("test", "npm test"), ...docs, ...finalizationEvidence, subagentReview("reviewer-result")]));
    expect(inferredSubagent.allSatisfied).toBe(true);
  });

  it("develop review.toolCallId must point at a reviewer subagent result", () => {
    const claimedWithBash = developEvidence({ review: { result: "pass", summary: "reviewed", toolCallId: "test" } });
    const bad = checkCompletion(work("develop", claimedWithBash, [bash("test", "npm test"), ...docs, ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("cynos_subagent");

    const claimedWithSubagent = developEvidence({ review: { result: "pass", summary: "reviewed", toolCallId: "reviewer-result" } });
    const ok = checkCompletion(work("develop", claimedWithSubagent, [bash("test", "npm test"), ...docs, ...finalizationEvidence, subagentReview("reviewer-result")]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("develop reviewer can fall back after evidenced failures or user authorization", () => {
    const fallback = developEvidence({ review: { result: "fallback", summary: "self-review after reviewer outage", fallbackReason: "reviewer timed out twice", selfReviewAcknowledged: true } });
    const oneFailure = checkCompletion(work("develop", fallback, [bash("test", "npm test"), ...docs, { ...subagentReview("review-fail-1", "reviewer", "timeout"), isError: true }, ...finalizationEvidence]));
    expect(oneFailure.allSatisfied).toBe(false);
    expect(oneFailure.missing.join("\n")).toContain("at least 2");

    const twoFailures = checkCompletion(work("develop", fallback, [bash("test", "npm test"), ...docs, { ...subagentReview("review-fail-1", "reviewer", "timeout"), isError: true }, { ...subagentReview("review-fail-2", "reviewer", "timeout"), isError: true }, ...finalizationEvidence]));
    expect(twoFailures.allSatisfied).toBe(true);

    const userSkipped = work("develop", developEvidence({ review: { result: "skipped-by-user", summary: "user authorized skipping reviewer", userAuthorizedSkip: true } }), [bash("test", "npm test"), ...docs, ...finalizationEvidence]);
    userSkipped.capturedUserAnswers = [{ question: "Skip reviewer?", answerSummary: "User authorized skip", at: "2026-01-01T00:00:01.000Z" }];
    expect(checkCompletion(userSkipped).allSatisfied).toBe(true);
  });

  it("develop TDD evidence requires red/green when used and a reason when skipped", () => {
    const tddUsed = developEvidence({ tdd: { used: true, summary: "red then green" } });
    const missingRed = checkCompletion(work("develop", tddUsed, [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(missingRed.allSatisfied).toBe(false);
    expect(missingRed.missing.join("\n")).toContain("red");

    const ok = checkCompletion(work("develop", tddUsed, [bash("red", "npm test", true, "expected behavior failure"), bash("green", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);

    const missingReason = checkCompletion(work("develop", developEvidence({ tdd: { used: false, summary: "skipped" } }), [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(missingReason.allSatisfied).toBe(false);
    expect(missingReason.missing.join("\n")).toContain("notApplicableReason");
  });

  it("develop TDD sequence gate: red before the implementation write passes", () => {
    const base = developEvidence();
    const tddUsed = developEvidence({ tdd: { used: true, summary: "red then green" }, develop: { ...base.develop, implementation: { summary: "implement feature", filesChanged: ["src/file.ts"] } } });
    const ok = checkCompletion(work("develop", tddUsed, [bash("red", "npm test", true, "expected behavior failure"), write("impl", "src/file.ts"), bash("green", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("develop TDD sequence gate: red AFTER the implementation write is rejected as fake", () => {
    const base = developEvidence();
    const tddUsed = developEvidence({ tdd: { used: true, summary: "red then green" }, develop: { ...base.develop, implementation: { summary: "implement feature", filesChanged: ["src/file.ts"] } } });
    const fake = checkCompletion(work("develop", tddUsed, [write("impl", "src/file.ts"), bash("red", "npm test", true, "expected behavior failure"), bash("green", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(fake.allSatisfied).toBe(false);
    expect(fake.missing.join("\n")).toContain("BEFORE the first implementation write");
  });

  it("develop TDD sequence gate: a test-file write before red does NOT count as implementation (excludeTests)", () => {
    // Real TDD: write the test file → run red (fails, no impl yet) → implement → green. The test-file
    // write must not be treated as "implementation started", or every legitimate TDD flow would fail.
    const base = developEvidence();
    const tddUsed = developEvidence({ tdd: { used: true, summary: "red then green" }, develop: { ...base.develop, implementation: { summary: "implement feature", filesChanged: ["src/file.ts"] } } });
    const ok = checkCompletion(work("develop", tddUsed, [write("test-file", "test/feature.test.js"), bash("red", "npm test", true, "expected behavior failure"), write("impl", "src/file.ts"), bash("green", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("develop TDD sequence gate: used=false (notApplicable) does not trigger even with implementation writes", () => {
    const tddNotUsed = developEvidence({ tdd: { used: false, summary: "not applicable", notApplicableReason: "config-only change", alternativeVerification: "node --check" }, develop: { ...(developEvidence().develop as Record<string, unknown>), implementation: { summary: "config change", filesChanged: ["src/file.ts"] } } });
    const ok = checkCompletion(work("develop", tddNotUsed, [write("impl", "src/file.ts"), bash("check", "node --check src/file.ts"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("develop TDD red must be a failed test/verification command, not any failed bash", () => {
    // After change A: a generic failed bash (git rebase conflict, install error, typo) does not count as red.
    // Only a failed test/verification command qualifies. Locks findFailedVerificationBash so it cannot regress
    // to the looser findFailedBash without a test going red.
    const tddUsed = developEvidence({ tdd: { used: true, summary: "red then green" } });
    const redIsNonVerificationFailure = checkCompletion(work("develop", tddUsed, [
      bash("rebase-fail", "git rebase main", true, "CONFLICT: merge conflict"),
      bash("green", "npm test"),
      ...docs,
      subagentReview("reviewer-result"),
      ...finalizationEvidence,
    ]));
    expect(redIsNonVerificationFailure.allSatisfied).toBe(false);
    expect(redIsNonVerificationFailure.missing.join("\n")).toContain("red");
  });

  it("develop subagent identity is by input.agent field, not outputSummary text", () => {
    // After change B: a non-reviewer subagent whose outputSummary happens to mention 'reviewer' must NOT be
    // accepted as the mandatory reviewer. Locks the field-only check so the outputSummary fallback cannot
    // silently return. (outputSummary contains the full 'reviewer' word so it would match the old regex.)
    const review = developEvidence({ review: { result: "pass", summary: "reviewed" } });
    const explorerMentionsReviewer = { ...subagentReview("explorer-1", "explorer", "Acting as reviewer: I checked the code and the reviewer role finds it clean"), isError: false };
    const result = checkCompletion(work("develop", review, [bash("test", "npm test"), ...docs, explorerMentionsReviewer, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("reviewer");
  });

  it("develop challenge.result enum is validated when present", () => {
    // After change 1: challenge.result is optional, but when present must be one of the 4 legal values.
    // An arbitrary string must be rejected; a missing result must still pass.
    const baseDevelop = complexDevelopEvidence().develop as Record<string, any>;
    const invalidResult = complexDevelopEvidence({ develop: { ...baseDevelop, challenge: { summary: "challenger ran", result: "wibble" } } });
    const invalid = checkCompletion(work("develop", invalidResult, [bash("test", "npm test"), ...docs, readDoc("read-service", "src/service.ts"), subagentReview("challenge", "challenger", "Challenger: plan accepted"), subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(invalid.allSatisfied).toBe(false);
    expect(invalid.missing.join("\n")).toContain("challenge.result");

    const noResult = complexDevelopEvidence({ develop: { ...baseDevelop, challenge: { summary: "challenger ran" } } });
    const ok = checkCompletion(work("develop", noResult, [bash("test", "npm test"), ...docs, readDoc("read-service", "src/service.ts"), subagentReview("challenge", "challenger", "Challenger: plan accepted"), subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("develop explicit greenToolCallId rejects echo-masked pseudo-green (cleanVerificationResult gate)", () => {
    // An echo-masked failing test (isError=false, FAIL in output) passed as explicit greenToolCallId
    // must be rejected — otherwise the agent can bypass the auto-infer clean gate.
    const tddUsed = developEvidence({ tdd: { used: true, summary: "red then green", redToolCallId: "red", greenToolCallId: "pseudo-green" } });
    const result = checkCompletion(work("develop", tddUsed, [
      bash("red", "npm test", true, "expected behavior failure"),
      bash("pseudo-green", 'npm test; echo "exit:$?"', false, "FAIL: expected 2 got 3\nexit:1"),
      ...docs,
      subagentReview("reviewer-result"),
      ...finalizationEvidence,
    ]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("greenToolCallId");
  });

  it("develop explicit redToolCallId rejects non-test failure (isTestOrVerificationCommand gate)", () => {
    // git merge --abort (isError=true) is not a test/verification command. The explicit path
    // must mirror the auto-infer path (findFailedVerificationBash) which requires isTestOrVerificationCommand.
    const tddUsed = developEvidence({ tdd: { used: true, summary: "red then green", redToolCallId: "red", greenToolCallId: "green" } });
    const result = checkCompletion(work("develop", tddUsed, [
      bash("red", "git merge --abort", true, "fatal: not merging"),
      bash("green", "npm test"),
      ...docs,
      subagentReview("reviewer-result"),
      ...finalizationEvidence,
    ]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("test/verification");
  });

  it("develop explicit redToolCallId accepts echo-masked failed test (same as auto-infer red)", () => {
    const tddUsed = developEvidence({ tdd: { used: true, summary: "red then green", redToolCallId: "red", greenToolCallId: "green" } });
    const result = checkCompletion(work("develop", tddUsed, [
      bash("red", 'npm test; echo "exit:$?"', false, "FAIL: expected 2 got 3\nexit:1"),
      bash("green", "npm test", false, "PASS: 5 tests"),
      ...docs,
      subagentReview("reviewer-result"),
      ...finalizationEvidence,
    ]));
    expect(result.allSatisfied).toBe(true);
  });

  it("simple develop with many changed files requires stronger simple rationale", () => {
    const files = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"];
    const manyFiles = developWithFiles(files, { develop: { ...(developWithFiles(files).develop as Record<string, unknown>), context: { complexity: "simple", reason: "quick change", relatedFilesRead: ["src/file.ts"], reuseOrDuplicationCheck: "same local pattern" } } });
    const result = checkCompletion(work("develop", manyFiles, [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence, ...files.map((file, index) => write(`write-${index}`, file))]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("filesChanged");
  });

  it("simple develop touching cross-cutting files must reclassify as complex", () => {
    // After change C: no reason-text exemption. Touching logger/feature-flags/config/middleware/auth/
    // context/bootstrap files forces complex classification regardless of the reason wording.
    const files = ["src/logger.ts", "src/services/featureFlags.ts"];
    const base = developWithFiles(files);
    const context = {
      complexity: "simple",
      reason: "rename only; no runtime behavior change in logger/feature flags",
      relatedFilesRead: files,
      reuseOrDuplicationCheck: "extends existing logger and feature flag pattern",
    };
    const evidence = developWithFiles(files, { develop: { ...(base.develop as Record<string, unknown>), context } });
    const captured = [bash("test", "npm test"), ...docs, readDoc("read-logger", "src/logger.ts"), readDoc("read-flags", "src/services/featureFlags.ts"), subagentReview("reviewer-result"), ...finalizationEvidence, ...files.map((file, index) => write(`write-cross-${index}`, file))];
    const result = checkCompletion(work("develop", evidence, captured));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("cross-cutting concern");
  });

  it("develop implementation filesChanged accepts rm evidence for declared deletions", () => {
    const evidence = developWithFiles(["src/old-extension/ (删除)"]);
    const result = checkCompletion(work("develop", evidence, [
      bash("rm-old", "rm -rf src/old-extension/"),
      bash("test", "npm test"),
      ...docs,
      subagentReview("reviewer-result"),
      ...finalizationEvidence,
    ], "/tmp/project"));
    expect(result.allSatisfied).toBe(true);
  });

  it("develop implementation filesChanged accepts rm evidence without any annotation", () => {
    // Deletion evidence fallback does not depend on string annotation gate: bare path + rm can also pass (in-project deletion scenario).
    const evidence = developWithFiles(["src/old-extension/"]);
    const result = checkCompletion(work("develop", evidence, [
      bash("rm-old", "rm -rf /tmp/project/src/old-extension/"),
      bash("test", "npm test"),
      ...docs,
      subagentReview("reviewer-result"),
      ...finalizationEvidence,
    ], "/tmp/project"));
    expect(result.allSatisfied).toBe(true);
  });

  it("develop implementation filesChanged must have real write evidence", () => {
    const evidence = developWithFiles(["src/file.ts"]);
    const missingWrite = checkCompletion(work("develop", evidence, [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(missingWrite.allSatisfied).toBe(false);
    expect(missingWrite.missing.join("\n")).toContain("filesChanged");

    const ok = checkCompletion(work("develop", evidence, [write("impl", "src/file.ts"), bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("develop logging is skill-guided, not checkpoint-enforced", () => {
    // After change D: logging decision is no longer a checkpoint gate. complex develop with no
    // logging decision and no loggingChanges passes; logging file edits (if any) are just normal
    // filesChanged entries verified by real write evidence.
    const baseDevelop = complexDevelopEvidence().develop as Record<string, any>;
    const noLoggingDecision = complexDevelopEvidence({
      develop: {
        ...baseDevelop,
        plan: { summary: baseDevelop.plan.summary, tasks: baseDevelop.plan.tasks, touchedAreas: baseDevelop.plan.touchedAreas, testPlan: baseDevelop.plan.testPlan, risksOrAssumptions: baseDevelop.plan.risksOrAssumptions },
        implementation: { summary: "changed retry behavior", filesChanged: ["src/file.ts"] },
      },
    });
    const result = checkCompletion(work("develop", noLoggingDecision, [readDoc("read-service", "src/service.ts"), subagentReview("challenge", "challenger"), write("impl", "src/file.ts"), bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);
    expect(result.missing.join("\n")).not.toContain("logging");
  });

  it("develop review result needs-work requires fixesFromReview", () => {
    const needsWork = developEvidence({ review: { result: "needs-work", summary: "reviewer found missing edge case" } });
    const bad = checkCompletion(work("develop", needsWork, [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("fixesFromReview");

    const fixed = developEvidence({ review: { result: "needs-work", summary: "reviewer found missing edge case", fixesFromReview: ["added missing edge case"] } });
    const ok = checkCompletion(work("develop", fixed, [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("develop projectImpact only hard-gates declared durable writes", () => {
    const noReason = checkCompletion(work("develop", developEvidence({ projectImpact: { durableMemoryUpdateNeeded: false } }), [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(noReason.allSatisfied).toBe(true);

    const evidence = developWithFiles(["docs/testing.md"], { projectImpact: { durableMemoryUpdateNeeded: true, reason: "new testing contract", updatedFiles: ["docs/testing.md"] } });
    const missingWrite = checkCompletion(work("develop", evidence, [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(missingWrite.allSatisfied).toBe(false);
    expect(missingWrite.missing.join("\n")).toContain("projectImpact.updatedFiles");

    const ok = checkCompletion(work("develop", evidence, [write("testing-update", "docs/testing.md"), bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("develop report fields are skill-guided ceremony and no longer block completion", () => {
    const missingReport = checkCompletion(work("develop", developEvidence({ report: undefined }), [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(missingReport.allSatisfied).toBe(true);
  });

  it("finalization requires real git commit when status is committed and permits evidenced commit failure", () => {
    const committed = { verificationSummary: "npm test", gitSummary: "main clean", commit: { status: "committed", message: "fix: change" } };
    const bad = checkCompletion(work("develop", developEvidence({ finalization: committed }), [bash("test", "npm test"), ...docs, ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("git commit");

    const ok = checkCompletion(work("develop", developEvidence({ finalization: committed }), [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence, bash("commit", "git commit -m 'fix: change'")]));
    expect(ok.allSatisfied).toBe(true);

    const failed = { verificationSummary: "npm test", gitSummary: "main dirty after commit hook failure", commit: { status: "failed", reason: "pre-commit hook failed; did not bypass" } };
    const failedOk = checkCompletion(work("develop", developEvidence({ finalization: failed }), [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence, bash("commit-failed", "git commit -m 'fix: change'", true, "pre-commit hook failed")]));
    expect(failedOk.allSatisfied).toBe(true);
  });

  it("non-git projects can complete with captured git status failure and explicit summary", () => {
    const nonGit = { verificationSummary: "npm test", gitSummary: "非 git 仓库，无 git repository", commit: { status: "not-committed", reason: "non-git project, nothing to commit (review-only authorization)" } };
    const result = checkCompletion(work("develop", developEvidence({ finalization: nonGit }), [bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), bash("git-status", "git status --short", true, "fatal: not a git repository")]));
    expect(result.allSatisfied).toBe(true);
  });

  it("strong UI writes require direct browser evidence in develop", () => {
    const bad = checkCompletion(work("develop", developWithFiles(["components/Button.tsx"]), [write("ui", "components/Button.tsx"), bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("direct browser evidence");

    const e2eOnly = checkCompletion(work("develop", developWithFiles(["components/Button.tsx"], { surfaceVerification: { summary: "npx playwright test passed" } }), [write("ui", "components/Button.tsx"), bash("e2e", "npx playwright test"), bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(e2eOnly.allSatisfied).toBe(false);
    expect(e2eOnly.missing.join("\n")).toContain("direct browser evidence");

    const openOnly = checkCompletion(work("develop", developWithFiles(["components/Button.tsx"], { surfaceVerification: { summary: "opened page" } }), [write("ui", "components/Button.tsx"), bash("open", "npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:5173"), bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(openOnly.allSatisfied).toBe(false);
    expect(openOnly.missing.join("\n")).toContain("direct browser evidence");

    const ok = checkCompletion(work("develop", developWithFiles(["components/Button.tsx"], { surfaceVerification: { summary: "browser screenshot" } }), [write("ui", "components/Button.tsx"), bash("test", "npm test"), browser("shot"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("strong UI writes can complete only with strict browser blocked fallback", () => {
    const looseEvidence = developWithFiles(["components/Button.tsx"], { surfaceVerification: { blockedReason: "Chromium missing libasound.so.2", alternativeVerification: "code review plus npm test" } });
    const loose = checkCompletion(work("develop", looseEvidence, [write("ui", "components/Button.tsx"), bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(loose.allSatisfied).toBe(false);

    const evidence = developWithFiles(["components/Button.tsx"], { surfaceVerification: { blockedReason: "Chromium missing libasound.so.2", attemptedApproaches: ["open page", "screenshot page"], alternativeVerification: "code review plus npm test", degradedEvidence: "unit tests cover handler but not rendered browser behavior" } });
    const result = checkCompletion(work("develop", evidence, [write("ui", "components/Button.tsx"), bash("b1", "npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:5173", true), bash("b2", "npx --yes @playwright/cli -s=$SESSION screenshot --filename=.cynos/browser-evidence/after.png", true), bash("test", "npm test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);
  });

  it("writing any test asset requires successful clean test execution in modifying practices", () => {
    const bad = checkCompletion(work("develop", developWithFiles(["tests/unit/add.test.ts"]), [write("unit-test", "tests/unit/add.test.ts"), bash("build", "npm run build"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("test-assets-passed-if-written");

    const failing = checkCompletion(work("develop", developWithFiles(["tests/unit/add.test.ts"]), [write("unit-test", "tests/unit/add.test.ts"), bash("test-fail", "npm test", true, "FAIL add"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(failing.allSatisfied).toBe(false);
    expect(failing.missing.join("\n")).toContain("test-assets-passed-if-written");

    const ok = checkCompletion(work("develop", developWithFiles(["tests/e2e/login.spec.ts"], { surfaceVerification: { summary: "npx playwright test" } }), [write("e2e", "tests/e2e/login.spec.ts"), bash("unit", "npm test"), bash("e2e-run", "npx playwright test"), ...docs, subagentReview("reviewer-result"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("debug still supports red/green evidence and no longer requires release docs by default", () => {
    const result = checkCompletion(work("debug", debugEvidence(), [readDoc("inv-read", "src/file.ts"), bash("red", "npm test bug", true, "Error: assertion failed at src/file.ts"), write("fix", "src/file.ts"), bash("green", "npm test bug"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);
  });

  it("debug accepts browser reproduction without failed bash when browser evidence is recorded", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    const browserDebugging = {
      ...baseDebugging,
      reproduction: { kind: "browser", summary: "screenshot shows clipped menu" },
      diagnostics: { browserEvidence: "screenshot shows clipped menu", networkEvidence: "no failed requests" },
      fix: { summary: "constrained menu width", filesChanged: ["src/file.ts"] },
      regression: { unavailableReason: "visual/browser reproduction did not produce failing bash", alternativeVerification: "browser screenshot plus npm test" },
    };
    const result = checkCompletion(work("debug", debugEvidence({ debugging: browserDebugging }), [readDoc("inv-read", "src/file.ts"), browser("browser-repro"), write("fix", "src/file.ts"), browser("browser-final"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);

    const afterOnly = checkCompletion(work("debug", debugEvidence({ debugging: browserDebugging }), [write("fix", "src/file.ts"), browser("browser-after"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(afterOnly.allSatisfied).toBe(false);
    expect(afterOnly.missing.join("\n")).toContain("before the first real fix write");
  });

  it("debug browser reproduction rejects prose-only evidence and non-browser toolCallId", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    const browserDebugging = {
      ...baseDebugging,
      reproduction: { kind: "browser", summary: "screenshot shows clipped menu" },
      diagnostics: { browserEvidence: "I saw the menu clipped", networkEvidence: "no failed requests" },
      fix: { summary: "constrained menu width", filesChanged: ["src/file.ts"] },
      regression: { unavailableReason: "visual/browser reproduction did not produce failing bash", alternativeVerification: "browser screenshot plus npm test" },
    };
    const proseOnly = checkCompletion(work("debug", debugEvidence({ debugging: browserDebugging }), [write("fix", "src/file.ts"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(proseOnly.allSatisfied).toBe(false);
    expect(proseOnly.missing.join("\n")).toContain("captured Playwright CLI direct browser evidence");

    const wrongToolCall = {
      ...browserDebugging,
      reproduction: { kind: "browser", summary: "screenshot shows clipped menu", toolCallId: "verify" },
    };
    const nonBrowserId = checkCompletion(work("debug", debugEvidence({ debugging: wrongToolCall }), [write("fix", "src/file.ts"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(nonBrowserId.allSatisfied).toBe(false);
    expect(nonBrowserId.missing.join("\n")).toContain("toolCallId must reference");

    const lateToolCall = {
      ...browserDebugging,
      reproduction: { kind: "browser", summary: "screenshot shows clipped menu", toolCallId: "browser-after" },
    };
    const lateId = checkCompletion(work("debug", debugEvidence({ debugging: lateToolCall }), [write("fix", "src/file.ts"), browser("browser-after"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(lateId.allSatisfied).toBe(false);
    expect(lateId.missing.join("\n")).toContain("before the first real fix write");
  });

  it("debug strong UI writes can complete when strict browser-blocked fallback is recorded", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    const browserBlockedDebugging = {
      ...baseDebugging,
      reproduction: { kind: "browser", summary: "narrow menu is clipped" },
      diagnostics: { browserBlockedReason: "Chromium missing libasound.so.2", evidenceRead: ["Playwright launch failed: missing libasound.so.2"] },
      fix: { summary: "allow nav wrapping", filesChanged: ["public/index.html"] },
      regression: { unavailableReason: "browser runtime blocked", alternativeVerification: "code review plus npm test" },
    };
    const afterOnly = checkCompletion(work("debug", debugEvidence({ debugging: browserBlockedDebugging, surfaceVerification: { blockedReason: "Chromium missing libasound.so.2", attemptedApproaches: ["open page", "snapshot page"], alternativeVerification: "code review plus npm test", degradedEvidence: "unit tests cover code path but browser rendering remains blocked" } }), [write("fix-ui", "public/index.html"), bash("b1", "npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:5173", true), bash("b2", "npx --yes @playwright/cli -s=$SESSION snapshot", true), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(afterOnly.allSatisfied).toBe(false);

    const result = checkCompletion(work("debug", debugEvidence({ debugging: browserBlockedDebugging, surfaceVerification: { blockedReason: "Chromium missing libasound.so.2", attemptedApproaches: ["open page", "snapshot page"], alternativeVerification: "code review plus npm test", degradedEvidence: "unit tests cover code path but browser rendering remains blocked" } }), [readDoc("inv-read", "src/file.ts"), bash("b1", "npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:5173", true), bash("b2", "npx --yes @playwright/cli -s=$SESSION snapshot", true), write("fix-ui", "public/index.html"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);
  });

  it("debug investigation.relatedFilesRead requires real read evidence", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    const noRead = debugEvidence({ debugging: { ...baseDebugging, investigation: { relatedFilesRead: ["src/never-read.ts"], flowsTraced: ["x"] } } });
    const bad = checkCompletion(work("debug", noRead, [bash("red", "npm test bug", true, "Error: assertion failed"), write("fix", "src/file.ts"), bash("green", "npm test bug"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("src/never-read.ts");
  });

  it("debug investigation.relatedFilesRead rejects non-string or blank entries", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    for (const badValue of [[""], [123], ["", "   "]]) {
      const evidence = debugEvidence({ debugging: { ...baseDebugging, investigation: { relatedFilesRead: badValue as unknown[], flowsTraced: ["x"] } } });
      const result = checkCompletion(work("debug", evidence, [bash("red", "npm test bug", true, "Error: assertion failed"), write("fix", "src/file.ts"), bash("green", "npm test bug"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
      expect(result.allSatisfied, `relatedFilesRead=${JSON.stringify(badValue)}`).toBe(false);
      expect(result.missing.join("\n")).toContain("relatedFilesRead");
    }
  });

  it("debug diagnostics.evidenceRead rejects non-string or blank entries", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    for (const badValue of [[""], [123], ["   "]]) {
      const evidence = debugEvidence({ debugging: { ...baseDebugging, diagnostics: { evidenceRead: badValue as unknown[] } } });
      const result = checkCompletion(work("debug", evidence, [bash("red", "npm test bug", true, "Error: assertion failed"), write("fix", "src/file.ts"), bash("green", "npm test bug"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
      expect(result.allSatisfied, `evidenceRead=${JSON.stringify(badValue)}`).toBe(false);
      expect(result.missing.join("\n")).toContain("diagnostic source");
    }
  });

  it("debug browser-blocked surface fallback requires alternativeVerification, not regression.summary", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    // blocked reason present, but only regression.summary (no alternativeVerification)
    const onlySummary = {
      ...baseDebugging,
      reproduction: { kind: "browser", summary: "narrow menu is clipped" },
      diagnostics: { browserBlockedReason: "Chromium missing libasound.so.2" },
      fix: { summary: "allow nav wrapping", filesChanged: ["public/index.html"] },
      regression: { unavailableReason: "browser runtime blocked", summary: "red/green via npm test" },
    };
    const result = checkCompletion(work("debug", debugEvidence({ debugging: onlySummary }), [write("fix-ui", "public/index.html"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n").toLowerCase()).toContain("surface");
  });

  it("debug requires diagnostics, investigation and fix while report/projectImpact ceremony no longer blocks", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    const noDiagnostics = debugEvidence({ debugging: { ...baseDebugging, diagnostics: {} } });
    const bad = checkCompletion(work("debug", noDiagnostics, [bash("red", "npm test bug", true, "Error: assertion failed"), write("fix", "src/file.ts"), bash("green", "npm test bug"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("diagnostics");

    const noFileChange = debugEvidence({ debugging: { ...baseDebugging, fix: { summary: "environment variable corrected", noFileChangeReason: "external environment configuration fixed" } }, projectImpact: undefined, report: undefined });
    const ok = checkCompletion(work("debug", noFileChange, [bash("red", "npm test bug", true, "Error: missing env"), bash("green", "npm test bug"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("debug projectImpact only hard-gates declared durable writes", () => {
    const noReason = checkCompletion(work("debug", debugEvidence({ projectImpact: { durableMemoryUpdateNeeded: false } }), [readDoc("inv-read", "src/file.ts"), bash("red", "npm test bug", true, "Error: assertion failed"), write("fix", "src/file.ts"), bash("green", "npm test bug"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(noReason.allSatisfied).toBe(true);

    const updated = debugEvidence({ projectImpact: { durableMemoryUpdateNeeded: true, reason: "testing diagnostics changed", updatedFiles: ["docs/testing.md"] } });
    const bad = checkCompletion(work("debug", updated, [bash("red", "npm test bug", true, "Error: assertion failed"), write("fix", "src/file.ts"), bash("green", "npm test bug"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("docs/testing.md");

    const ok = checkCompletion(work("debug", updated, [readDoc("inv-read", "src/file.ts"), bash("red", "npm test bug", true, "Error: assertion failed"), write("fix", "src/file.ts"), write("testing-update", "docs/testing.md"), bash("green", "npm test bug"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("debug explicit passingToolCallId rejects echo-masked pseudo-green (cleanVerificationResult gate)", () => {
    // An echo-masked failing test passed as explicit passingToolCallId must be rejected —
    // otherwise the agent can bypass the auto-infer clean gate.
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    const evidence = debugEvidence({ debugging: { ...baseDebugging, regression: { failingToolCallId: "red", passingToolCallId: "pseudo-green" } } });
    const result = checkCompletion(work("debug", evidence, [
      bash("red", "npm test", true, "Error: assertion failed"),
      bash("pseudo-green", 'npm test; echo "exit:$?"', false, "FAIL: expected 2 got 3\nexit:1"),
      write("fix", "src/file.ts"),
      bash("verify", "npm test"),
      ...docs,
      ...finalizationEvidence,
    ]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("passingToolCallId");
  });

  it("debug explicit failingToolCallId accepts echo-masked failed test (same as auto-infer red)", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    const evidence = debugEvidence({ debugging: { ...baseDebugging, regression: { failingToolCallId: "red", passingToolCallId: "green" } } });
    const result = checkCompletion(work("debug", evidence, [
      readDoc("inv-read", "src/file.ts"),
      bash("red", 'npm test; echo "exit:$?"', false, "FAIL: expected 2 got 3\nexit:1"),
      bash("green", "npm test", false, "PASS: 5 tests"),
      write("fix", "src/file.ts"),
      bash("verify", "npm test"),
      ...docs,
      ...finalizationEvidence,
    ]));
    expect(result.allSatisfied).toBe(true);
  });

  it("debug root-cause-centered: no reproduction needed when root cause is evidenced via logs/stack", () => {
    // Reproduction is ONE path to root cause, not a requirement. A mature logging system / stack
    // trace can pinpoint the cause directly — reproduction can be omitted without it being a failure.
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    const noRepro = debugEvidence({ debugging: { ...baseDebugging, reproduction: {} } });
    const ok = checkCompletion(work("debug", noRepro, [readDoc("inv", "src/file.ts"), bash("diag", "cat logs/app.log", false, "Error: null deref at src/file.ts:42"), write("fix", "src/file.ts"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("debug root-cause-centered: no reproduction → regression also optional (no red to turn green)", () => {
    const baseDebugging = debugEvidence().debugging as Record<string, unknown>;
    const noReproNoRegression = debugEvidence({ debugging: { ...baseDebugging, reproduction: {}, regression: {} } });
    const ok = checkCompletion(work("debug", noReproNoRegression, [readDoc("inv", "src/file.ts"), bash("diag", "cat logs/app.log", false, "stack trace at src/file.ts:42"), write("fix", "src/file.ts"), bash("verify", "npm test"), ...docs, ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

  it("debug investigation sequence gate: root-cause read must precede the fix write (no post-hoc root cause)", () => {
    // All investigation reads land after the fix write → post-hoc rationalization, rejected.
    const result = checkCompletion(work("debug", debugEvidence(), [bash("red", "npm test bug", true, "Error: assertion failed"), write("fix", "src/file.ts"), readDoc("late-read", "src/file.ts"), bash("green", "npm test bug"), bash("verify", "npm test"), ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("BEFORE the fix write");
  });

  it("refactor requires files read, scope, contract, plan, baseline/final, challenge, changes, review and finalization", () => {
    const result = checkCompletion(work("refactor", completeNewRefactorEvidence(), [
      readDoc("parser", "src/parser.ts"),
      bash("baseline", "npm test -- parser"),
      subagent("challenge", "challenger"),
      write("edit", "src/parser.ts"),
      bash("final", "npm test -- parser"),
      subagent("review", "reviewer"),
      ...finalizationEvidence,
    ]));
    expect(result.allSatisfied).toBe(true);
  });

  function newRefactorEvidence(overrides: Record<string, unknown> = {}) {
    return {
      criteriaCoverage: coverage,
      refactor: {
        context: { relatedFilesRead: ["src/parser.ts"] },
        scope: { summary: "parser internals only", inScope: ["src/parser.ts"], outOfScope: ["CLI options"] },
        behaviorContract: { contracts: [{ id: "contract-1", kind: "api", verification: "npm test -- parser" }] },
        plan: { summary: "extract helper", slices: [{ id: "slice-1", summary: "move token normalization" }], verificationPlan: ["npm test -- parser"] },
        characterization: {
          baseline: { summary: "parser tests pass", command: "npm test -- parser" },
          final: { summary: "parser tests pass after refactor", command: "npm test -- parser" },
          contractCoverage: [{ contractId: "contract-1", baselineEvidence: "baseline npm test -- parser", finalEvidence: "final npm test -- parser", result: "same" }],
        },
        challenge: { summary: "challenger accepted", result: "accepted" },
        changes: { summary: "extracted helper", filesChanged: ["src/parser.ts"] },
      },
      review: { summary: "reviewer passed", result: "pass" },
      projectImpact: { durableMemoryUpdateNeeded: false, reason: "internal helper extraction only" },
      verification: { summary: "npm test -- parser" },
      finalization,
      ...overrides,
    };
  }

  function completeNewRefactorEvidence(overrides: Record<string, unknown> = {}) {
    return { ...newRefactorEvidence(), ...overrides };
  }

  it("refactor files-read checkpoint requires real related file reads", () => {
    const ok = refactorFilesReadCheckpoint.check(work("refactor", newRefactorEvidence(), [readDoc("parser", "src/parser.ts")]));
    expect(ok.satisfied).toBe(true);

    const bad = refactorFilesReadCheckpoint.check(work("refactor", newRefactorEvidence()));
    expect(bad.satisfied).toBe(false);
    expect((bad as any).reason).toContain("read evidence");
  });

  it("refactor scope and behavior contract checkpoints are lean but strict", () => {
    expect(refactorScopeBoundedCheckpoint.check(work("refactor", newRefactorEvidence())).satisfied).toBe(true);
    expect(refactorBehaviorContractMappedCheckpoint.check(work("refactor", newRefactorEvidence())).satisfied).toBe(true);

    const duplicate = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), behaviorContract: { contracts: [{ id: "contract-1", kind: "api", verification: "test" }, { id: "contract-1", kind: "api", verification: "test" }] } } });
    expect(refactorBehaviorContractMappedCheckpoint.check(work("refactor", duplicate)).satisfied).toBe(false);

    const badKind = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), behaviorContract: { contracts: [{ id: "contract-1", kind: "frontend", verification: "test" }] } } });
    expect(refactorBehaviorContractMappedCheckpoint.check(work("refactor", badKind)).satisfied).toBe(false);

    const downgradedUi = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), behaviorContract: { contracts: [{ id: "rendered-button", kind: "api", verification: "Playwright screenshot verifies rendered page and viewport" }] } } });
    const downgraded = refactorBehaviorContractMappedCheckpoint.check(work("refactor", downgradedUi));
    expect(downgraded.satisfied).toBe(false);
    expect((downgraded as any).reason).toContain("kind='ui'");

    const cliConsoleContract = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), behaviorContract: { contracts: [{ id: "cli-output", kind: "cli", verification: "console output unchanged for --help" }] } } });
    expect(refactorBehaviorContractMappedCheckpoint.check(work("refactor", cliConsoleContract)).satisfied).toBe(true);
  });

  it("refactor plan checkpoint requires slices and verification plan", () => {
    expect(refactorPlanCheckpoint.check(work("refactor", newRefactorEvidence())).satisfied).toBe(true);
    const noVerificationPlan = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), plan: { summary: "extract", slices: [{ id: "slice-1", summary: "move helper" }], verificationPlan: [] } } });
    expect(refactorPlanCheckpoint.check(work("refactor", noVerificationPlan)).satisfied).toBe(false);
  });

  it("refactor characterization requires baseline before production write and final after production write", () => {
    const ok = refactorCharacterizationCheckpoint.check(work("refactor", newRefactorEvidence(), [bash("baseline", "npm test -- parser"), write("edit", "src/parser.ts"), bash("final", "npm test -- parser")]));
    expect(ok.satisfied).toBe(true);

    const writeBeforeBaseline = refactorCharacterizationCheckpoint.check(work("refactor", newRefactorEvidence(), [write("edit", "src/parser.ts"), bash("baseline", "npm test -- parser"), bash("final", "npm test -- parser")]));
    expect(writeBeforeBaseline.satisfied).toBe(false);

    const noFinal = refactorCharacterizationCheckpoint.check(work("refactor", newRefactorEvidence(), [bash("baseline", "npm test -- parser"), write("edit", "src/parser.ts")]));
    expect(noFinal.satisfied).toBe(false);
  });

  it("refactor characterization rejects non-comparable final verification even when command fields are spoofed", () => {
    const evidence = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), characterization: { ...(newRefactorEvidence().refactor as any).characterization, baseline: { summary: "parser", command: "npm test -- parser" }, final: { summary: "build", command: "npm test -- parser" } } } });
    const bad = refactorCharacterizationCheckpoint.check(work("refactor", evidence, [bash("baseline", "npm test -- parser"), write("edit", "src/parser.ts"), bash("final", "npm run build")]));
    expect(bad.satisfied).toBe(false);
    expect((bad as any).reason).toContain("comparable");
  });

  it("refactor characterization finds a comparable baseline/final pair instead of blindly using the last final", () => {
    const result = refactorCharacterizationCheckpoint.check(work("refactor", newRefactorEvidence(), [bash("baseline", "npm test -- parser"), write("edit", "src/parser.ts"), bash("final", "npm test -- parser"), bash("later-build", "npm run build")]));
    expect(result.satisfied).toBe(true);
  });

  it("refactor characterization allows characterization test writes before baseline but requires test asset path", () => {
    const evidence = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), characterization: { ...(newRefactorEvidence().refactor as any).characterization, characterizationTestsAdded: ["tests/parser.characterization.test.ts"] } } });
    const ok = refactorCharacterizationCheckpoint.check(work("refactor", evidence, [write("test", "tests/parser.characterization.test.ts"), bash("baseline", "npm test -- parser"), write("edit", "src/parser.ts"), bash("final", "npm test -- parser")]));
    expect(ok.satisfied).toBe(true);

    const badPath = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), characterization: { ...(newRefactorEvidence().refactor as any).characterization, characterizationTestsAdded: ["src/parser-helper.ts"] } } });
    expect(refactorCharacterizationCheckpoint.check(work("refactor", badPath, [write("test", "src/parser-helper.ts"), bash("baseline", "npm test -- parser"), write("edit", "src/parser.ts"), bash("final", "npm test -- parser")])).satisfied).toBe(false);
  });

  it("refactor UI contracts require direct browser evidence before/after or strict blocked fallback with real failures", () => {
    const ui = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), behaviorContract: { contracts: [{ id: "contract-1", kind: "ui", verification: "browser screenshot and snapshot" }] }, changes: { summary: "component split", filesChanged: ["src/App.tsx"] } } });
    const ok = refactorCharacterizationCheckpoint.check(work("refactor", ui, [bash("baseline", "npm test -- ui"), bash("browser-before", "npx --yes @playwright/cli -s=$SESSION snapshot"), write("edit", "src/App.tsx"), bash("browser-after", "npx --yes @playwright/cli -s=$SESSION screenshot --filename=.cynos/browser-evidence/after.png"), bash("final", "npm test -- ui")]));
    expect(ok.satisfied).toBe(true);

    const e2eOnly = refactorCharacterizationCheckpoint.check(work("refactor", ui, [bash("baseline", "npm test -- ui"), bash("e2e-before", "npx playwright test"), write("edit", "src/App.tsx"), bash("e2e-after", "npx playwright test"), bash("final", "npm test -- ui")]));
    expect(e2eOnly.satisfied).toBe(false);

    const failedBrowser = refactorCharacterizationCheckpoint.check(work("refactor", ui, [bash("baseline", "npm test -- ui"), bash("browser-before", "npx --yes @playwright/cli -s=$SESSION snapshot"), write("edit", "src/App.tsx"), bash("browser-after", "npx --yes @playwright/cli -s=$SESSION screenshot --filename=.cynos/browser-evidence/after.png", true), bash("final", "npm test -- ui")]));
    expect(failedBrowser.satisfied).toBe(false);

    const bothBefore = refactorCharacterizationCheckpoint.check(work("refactor", ui, [bash("baseline", "npm test -- ui"), bash("browser-before-1", "npx --yes @playwright/cli -s=$SESSION snapshot"), bash("browser-before-2", "npx --yes @playwright/cli -s=$SESSION screenshot --filename=.cynos/browser-evidence/before.png"), write("edit", "src/App.tsx"), bash("final", "npm test -- ui")]));
    expect(bothBefore.satisfied).toBe(false);

    const blocked = { ...ui, surfaceVerification: { blockedReason: "chromium missing system libs", attemptedApproaches: ["open page", "goto page"], alternativeVerification: "component tests", degradedEvidence: "unit tests cover rendered state" } };
    const blockedOk = refactorCharacterizationCheckpoint.check(work("refactor", blocked, [bash("baseline", "npm test -- ui"), bash("b1", "npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:5173", true), bash("b2", "npx --yes @playwright/cli -s=$SESSION goto http://127.0.0.1:5173", true), write("edit", "src/App.tsx"), bash("final", "npm test -- ui")]));
    expect(blockedOk.satisfied).toBe(true);

    const noAttempts = { ...ui, surfaceVerification: { blockedReason: "chromium missing system libs", attemptedApproaches: ["open page"], alternativeVerification: "unit tests", degradedEvidence: "unit tests" } };
    const attemptsBad = refactorCharacterizationCheckpoint.check(work("refactor", noAttempts, [bash("baseline", "npm test -- ui"), bash("b1", "npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:5173", true), bash("b2", "npx --yes @playwright/cli -s=$SESSION snapshot", true), write("edit", "src/App.tsx"), bash("final", "npm test -- ui")]));
    expect(attemptsBad.satisfied).toBe(false);

    const looseBlocked = { ...ui, surfaceVerification: { blockedReason: "chromium missing system libs", attemptedApproaches: ["a", "b"], alternativeVerification: "unit tests", degradedEvidence: "unit tests" } };
    const looseBad = refactorCharacterizationCheckpoint.check(work("refactor", looseBlocked, [bash("baseline", "npm test -- ui"), write("edit", "src/App.tsx"), bash("final", "npm test -- ui")]));
    expect(looseBad.satisfied).toBe(false);
  });

  it("refactor challenge must run before production writes and chooses a valid early challenger", () => {
    expect(refactorChallengeCheckpoint.check(work("refactor", newRefactorEvidence(), [bash("baseline", "npm test -- parser"), subagent("challenge", "challenger"), write("edit", "src/parser.ts")])).satisfied).toBe(true);

    const earlyThenLate = refactorChallengeCheckpoint.check(work("refactor", newRefactorEvidence(), [bash("baseline", "npm test -- parser"), subagent("early-challenge", "challenger"), write("edit", "src/parser.ts"), subagent("late-challenge", "challenger")]));
    expect(earlyThenLate.satisfied).toBe(true);

    const artifactBeforeChallenge = refactorChallengeCheckpoint.check(work("refactor", newRefactorEvidence(), [write("artifact", `${fixtureProjectRoot}/.cynos/browser-evidence/before.png`), bash("cli-cache", "rm -rf .playwright-cli && mv .playwright-cli/a.yml .playwright-cli/b.yml"), subagent("challenge", "challenger"), write("edit", "src/parser.ts")]));
    expect(artifactBeforeChallenge.satisfied).toBe(true);

    const late = refactorChallengeCheckpoint.check(work("refactor", newRefactorEvidence(), [bash("baseline", "npm test -- parser"), write("edit", "src/parser.ts"), subagent("challenge", "challenger")]));
    expect(late.satisfied).toBe(false);
    expect((late as any).reason).toContain("before");
    expect((late as any).reason).toContain("Do not switch to fallback");

    const fallback = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), challenge: { summary: "fallback", result: "fallback", fallbackReason: "subagent unavailable", selfChallengeAcknowledged: true } } });
    const fakeFallback = refactorChallengeCheckpoint.check(work("refactor", fallback, [bash("baseline", "npm test -- parser"), write("edit", "src/parser.ts"), subagent("late-challenge", "challenger")]));
    expect(fakeFallback.satisfied).toBe(false);
    expect((fakeFallback as any).reason).toContain("failed cynos_subagent challenger");
    expect(refactorChallengeCheckpoint.check(work("refactor", fallback, [subagent("c1", "challenger", true), subagent("c2", "challenger", true)])).satisfied).toBe(true);
  });

  it("refactor changes require production writes and complete filesChanged", () => {
    const ok = refactorChangesCheckpoint.check(work("refactor", newRefactorEvidence(), [write("edit", "src/parser.ts")]));
    expect(ok.satisfied).toBe(true);

    const absolute = refactorChangesCheckpoint.check(work("refactor", newRefactorEvidence(), [write("edit", `${fixtureProjectRoot}/src/parser.ts`)]));
    expect(absolute.satisfied).toBe(true);

    const mvEvidence = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), changes: { summary: "rename parser", filesChanged: ["src/parser.ts", "src/parser-new.ts"] } } });
    expect(refactorChangesCheckpoint.check(work("refactor", mvEvidence, [bash("mv", "mv src/parser.ts src/parser-new.ts")])).satisfied).toBe(true);

    const noFiles = newRefactorEvidence({ refactor: { ...(newRefactorEvidence().refactor as any), changes: { summary: "none", filesChanged: [] } } });
    expect(refactorChangesCheckpoint.check(work("refactor", noFiles)).satisfied).toBe(false);

    const unlisted = refactorChangesCheckpoint.check(work("refactor", newRefactorEvidence(), [write("edit", "src/parser.ts"), write("other", "src/other.ts")]));
    expect(unlisted.satisfied).toBe(false);
    expect((unlisted as any).reason).toContain("missing");

    const unlistedMv = refactorChangesCheckpoint.check(work("refactor", newRefactorEvidence(), [write("edit", "src/parser.ts"), bash("mv", "mv src/old.ts src/new.ts")]));
    expect(unlistedMv.satisfied).toBe(false);

    const ignoredArtifacts = refactorChangesCheckpoint.check(work("refactor", newRefactorEvidence(), [write("artifact", `${fixtureProjectRoot}/.cynos/browser-evidence/before.png`), write("cache", `${fixtureProjectRoot}/.playwright-cli/page.yml`), bash("cleanup", `rm -rf ${fixtureProjectRoot}/.playwright-cli && mv ${fixtureProjectRoot}/.cynos/browser-evidence/a.png ${fixtureProjectRoot}/.cynos/browser-evidence/b.png`), write("edit", "src/parser.ts")]));
    expect(ignoredArtifacts.satisfied).toBe(true);
  });

  it("refactor review must run after final verification and chooses a valid later reviewer", () => {
    expect(refactorReviewCheckpoint.check(work("refactor", completeNewRefactorEvidence(), [bash("baseline", "npm test -- parser"), write("edit", "src/parser.ts"), bash("final", "npm test -- parser"), subagent("review", "reviewer")])).satisfied).toBe(true);

    const earlyThenLate = refactorReviewCheckpoint.check(work("refactor", completeNewRefactorEvidence(), [bash("baseline", "npm test -- parser"), subagent("early-review", "reviewer"), write("edit", "src/parser.ts"), bash("final", "npm test -- parser"), subagent("late-review", "reviewer")]));
    expect(earlyThenLate.satisfied).toBe(true);

    const early = refactorReviewCheckpoint.check(work("refactor", completeNewRefactorEvidence(), [bash("baseline", "npm test -- parser"), subagent("review", "reviewer"), write("edit", "src/parser.ts"), bash("final", "npm test -- parser")]));
    expect(early.satisfied).toBe(false);
    expect((early as any).reason).toContain("after");
    expect((early as any).reason).toContain("Do not switch to fallback");

    const fallback = completeNewRefactorEvidence({ review: { summary: "fallback", result: "fallback", fallbackReason: "subagent unavailable", selfReviewAcknowledged: true } });
    const fakeFallback = refactorReviewCheckpoint.check(work("refactor", fallback, [bash("baseline", "npm test -- parser"), subagent("early-review", "reviewer"), write("edit", "src/parser.ts"), bash("final", "npm test -- parser")]));
    expect(fakeFallback.satisfied).toBe(false);
    expect((fakeFallback as any).reason).toContain("failed cynos_subagent reviewer");
    expect(refactorReviewCheckpoint.check(work("refactor", fallback, [subagent("r1", "reviewer", true), subagent("r2", "reviewer", true)])).satisfied).toBe(true);
  });

  it("refactor projectImpact only hard-gates declared durable writes", () => {
    const noReason = completeNewRefactorEvidence({ projectImpact: { durableMemoryUpdateNeeded: false } });
    expect(refactorProjectImpactCheckpoint.check(work("refactor", noReason)).satisfied).toBe(true);

    const updateDocs = completeNewRefactorEvidence({ projectImpact: { durableMemoryUpdateNeeded: true, reason: "module boundary changed", updatedFiles: ["PROJECT.md"] } });
    const bad = refactorProjectImpactCheckpoint.check(work("refactor", updateDocs));
    expect(bad.satisfied).toBe(false);
    expect((bad as any).reason).toContain("PROJECT.md");

    expect(refactorProjectImpactCheckpoint.check(work("refactor", updateDocs, [write("project", "PROJECT.md")])).satisfied).toBe(true);
  });

  function uiEvidence(overrides: Record<string, unknown> = {}) {
    const base = {
      criteriaCoverage: coverage,
      uiDesign: {
        directionDecision: { source: "existing-brand-spec", summary: "followed existing root brand-spec.md" },
        foundation: { mode: "brand-spec-existing", summary: "use existing brand system", brandSpecPath: "brand-spec.md" },
        implementation: { summary: "updated landing page", artifacts: ["src/App.tsx"] },
        designFidelity: { foundationUsed: "brand-spec.md", alignmentSummary: "used the existing color, type, and spacing direction" },
      },
      browserVerification: { summary: "screenshot and console checked" },
      critique: { summary: "passes", overallScore: 8 },
      verification: { summary: "npm run build" },
      finalization,
    } as Record<string, any>;
    const uiOverride = overrides.uiDesign as Record<string, any> | undefined;
    if (uiOverride) {
      base.uiDesign = {
        ...base.uiDesign,
        ...uiOverride,
        directionDecision: { ...base.uiDesign.directionDecision, ...(uiOverride.directionDecision ?? {}) },
        foundation: { ...base.uiDesign.foundation, ...(uiOverride.foundation ?? {}) },
        implementation: { ...base.uiDesign.implementation, ...(uiOverride.implementation ?? {}) },
        designFidelity: { ...base.uiDesign.designFidelity, ...(uiOverride.designFidelity ?? {}) },
      };
    }
    const { uiDesign: _uiDesign, ...rest } = overrides;
    return { ...base, ...rest };
  }

  it("ui-design checkpoint chain uses test-asset gate without project-docs or redundant surface evidence gate", () => {
    const uiPractice = allPractices().find((practice) => practice.id === "ui-design");
    const ids = uiPractice?.checkpoints.map((checkpoint) => checkpoint.id) ?? [];
    expect(ids).not.toContain("project-docs-consulted");
    expect(ids).toContain("test-assets-passed-if-written");
    expect(ids).not.toContain("surface-verification-evidence-if-required");
  });

  it("ui-design uses existing brand spec, project docs, real artifact writes and browser evidence", () => {
    const result = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);
  });

  it("ui-design supports brand-spec creation and design-system-only foundation", () => {
    const created = uiEvidence({ uiDesign: { foundation: { mode: "brand-spec-created", summary: "create brand system", brandSpecPath: "brand-spec.md", brandSpecActionReason: "new branded page" }, implementation: { summary: "created page", artifacts: ["src/App.tsx"] } } });
    const createdResult = checkCompletion(work("ui-design", created, [readDoc("read-testing", "docs/testing.md"), write("brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(createdResult.allSatisfied).toBe(true);

    const designOnly = uiEvidence({ uiDesign: { foundation: { mode: "design-system-only", summary: "one-off prototype", visualDirection: "quiet editorial", brandSpecActionReason: "non-branded throwaway prototype" }, implementation: { summary: "created prototype", artifacts: ["prototype/index.html"] } } });
    const designOnlyResult = checkCompletion(work("ui-design", designOnly, [readDoc("read-testing", "docs/testing.md"), write("proto", "prototype/index.html"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(designOnlyResult.allSatisfied).toBe(true);
  });

  it("ui-design no longer hard-gates project docs but rejects non-root or unread brand spec and invalid artifact declarations", () => {
    const noDocs = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(noDocs.allSatisfied).toBe(true);

    const subdirBrand = uiEvidence({ uiDesign: { foundation: { mode: "brand-spec-created", summary: "bad brand path", brandSpecPath: "docs/brand-spec.md", brandSpecActionReason: "new brand" }, implementation: { summary: "created page", artifacts: ["src/App.tsx"] } } });
    const subdirBrandResult = checkCompletion(work("ui-design", subdirBrand, [readDoc("read-testing", "docs/testing.md"), write("brand", "docs/brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(subdirBrandResult.allSatisfied).toBe(false);
    expect(subdirBrandResult.missing.join("\n")).toContain("brand-spec.md");

    const unreadBrand = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-testing", "docs/testing.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(unreadBrand.allSatisfied).toBe(false);
    expect(unreadBrand.missing.join("\n")).toContain("brand-spec-existing");

    const missingArtifactWrite = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(missingArtifactWrite.allSatisfied).toBe(false);
    expect(missingArtifactWrite.missing.join("\n")).toContain("src/App.tsx");

    const nonUiArtifact = uiEvidence({ uiDesign: { foundation: { mode: "brand-spec-existing", summary: "use existing brand system", brandSpecPath: "brand-spec.md" }, implementation: { summary: "updated docs", artifacts: ["README.md"] } } });
    const nonUiArtifactResult = checkCompletion(work("ui-design", nonUiArtifact, [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("readme", "README.md"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(nonUiArtifactResult.allSatisfied).toBe(false);
    expect(nonUiArtifactResult.missing.join("\n")).toContain("non-UI");
  });

  it("ui-design artifact declarations are positive-only and can use Playwright CLI browser evidence", () => {
    const result = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("scratch", "src/Scratch.tsx"), write("ui", "src/App.tsx"), bash("shot", "npx --yes @playwright/cli screenshot http://localhost:3000 shot.png"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);
  });

  it("ui-design enforces direction decision provenance", () => {
    const missing = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { directionDecision: { source: "", summary: "" } } }), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(missing.allSatisfied).toBe(false);
    expect(missing.missing.join("\n")).toContain("directionDecision.source");

    const invalid = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { directionDecision: { source: "confirmed", summary: "confirmed" } } }), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(invalid.allSatisfied).toBe(false);
    expect(invalid.missing.join("\n")).toContain("user-confirmed|user-delegated|provided-spec|existing-brand-spec|small-tweak");

    const noAnswer = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { directionDecision: { source: "user-confirmed", summary: "User approved v0" } } }), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(noAnswer.allSatisfied).toBe(false);
    expect(noAnswer.missing.join("\n")).toContain("captured user answer");

    const withAnswer = work("ui-design", uiEvidence({ uiDesign: { directionDecision: { source: "user-confirmed", summary: "User approved v0" } } }), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence], fixtureProjectRoot, [{ question: "Approve v0?", answerSummary: "Yes", at: "2026-01-01T00:00:00.000Z" }]);
    expect(checkCompletion(withAnswer).allSatisfied).toBe(true);

    const smallTweak = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { directionDecision: { source: "small-tweak", summary: "local hover-state tweak only" } } }), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(smallTweak.allSatisfied).toBe(true);
  });

  it("ui-design browser evidence must be after the last UI-like production write", () => {
    const beforeOnly = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-brand", "brand-spec.md"), browser("shot"), write("ui", "src/App.tsx"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(beforeOnly.allSatisfied).toBe(false);
    expect(beforeOnly.missing.join("\n")).toContain("after the last UI-like production write");

    const explicitBefore = checkCompletion(work("ui-design", { ...uiEvidence(), browserVerification: { summary: "checked", evidence: [{ kind: "screenshot", summary: "before", toolCallId: "shot" }] } }, [readDoc("read-brand", "brand-spec.md"), browser("shot"), write("ui", "src/App.tsx"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(explicitBefore.allSatisfied).toBe(false);
    expect(explicitBefore.missing.join("\n")).toContain("after the last UI-like production write");

    const unlistedFinalEdit = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "updated landing page", artifacts: ["src/App.tsx"] } } }), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), write("css", "src/styles.css"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(unlistedFinalEdit.allSatisfied).toBe(false);
    expect(unlistedFinalEdit.missing.join("\n")).toContain("src/styles.css");

    const evidenceNoteMentioningUiPath = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("note", "echo \"updated src/App.tsx\" > .cynos/browser-evidence/note.txt"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(evidenceNoteMentioningUiPath.allSatisfied).toBe(true);

    const afterLast = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), write("css", "src/styles.css"), browser("shot-after"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(afterLast.allSatisfied).toBe(true);
  });

  it("ui-design rejects unsafe artifact paths", () => {
    const outside = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "fake", artifacts: ["/tmp/fake.html"] } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", "/tmp/fake.html"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(outside.allSatisfied).toBe(false);
    expect(outside.missing.join("\n")).toContain("outside project");

    const cynosArtifact = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "fake", artifacts: [".cynos/browser-evidence/final.html"] } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", ".cynos/browser-evidence/final.html"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(cynosArtifact.allSatisfied).toBe(false);
    expect(cynosArtifact.missing.join("\n")).toContain("evidence/scratch");

    const playwrightArtifact = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "fake", artifacts: [".playwright-cli/final.html"] } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", ".playwright-cli/final.html"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(playwrightArtifact.allSatisfied).toBe(false);
    expect(playwrightArtifact.missing.join("\n")).toContain("evidence/scratch");

    const absoluteCynosArtifact = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "fake", artifacts: [`${fixtureProjectRoot}/.cynos/browser-evidence/final.html`] } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", `${fixtureProjectRoot}/.cynos/browser-evidence/final.html`), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(absoluteCynosArtifact.allSatisfied).toBe(false);
    expect(absoluteCynosArtifact.missing.join("\n")).toContain("evidence/scratch");

    const absolutePlaywrightArtifact = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "fake", artifacts: [`${fixtureProjectRoot}/.playwright-cli/final.html`] } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", `${fixtureProjectRoot}/.playwright-cli/final.html`), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(absolutePlaywrightArtifact.allSatisfied).toBe(false);
    expect(absolutePlaywrightArtifact.missing.join("\n")).toContain("evidence/scratch");

    const absoluteTmpArtifact = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "fake", artifacts: [`${fixtureProjectRoot}/tmp/final.html`] } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", `${fixtureProjectRoot}/tmp/final.html`), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(absoluteTmpArtifact.allSatisfied).toBe(false);
    expect(absoluteTmpArtifact.missing.join("\n")).toContain("evidence/scratch");

    const docsDesignPlan = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "fake", artifacts: ["docs/design-plan.md"] } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", "docs/design-plan.md"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(docsDesignPlan.allSatisfied).toBe(false);
    expect(docsDesignPlan.missing.join("\n")).toContain("non-UI");
  });

  it("ui-design noFileChangeReason cannot hide real or unsafe UI writes", () => {
    const noChangeEvidence = uiEvidence({ uiDesign: { implementation: { summary: "reviewed existing UI only", artifacts: [], noFileChangeReason: "critique-only browser review; no product file changes" } } });
    const legitimateNoChange = checkCompletion(work("ui-design", noChangeEvidence, [readDoc("read-brand", "brand-spec.md"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(legitimateNoChange.allSatisfied).toBe(true);

    const hiddenWrite = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "updated UI", artifacts: [], noFileChangeReason: "no product file changes needed" } } }), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(hiddenWrite.allSatisfied).toBe(false);
    expect(hiddenWrite.missing.join("\n")).toContain("noFileChangeReason cannot be used");

    const outsideHtml = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "mockup outside project", artifacts: [], noFileChangeReason: "product files unchanged; mockup in /tmp/fake.html" } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", "/tmp/fake.html"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(outsideHtml.allSatisfied).toBe(false);
    expect(outsideHtml.missing.join("\n")).toContain("unsafe/outside UI deliverable");

    const cynosHtml = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "mockup in evidence dir", artifacts: [], noFileChangeReason: "product files unchanged; mockup in evidence dir" } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", ".cynos/browser-evidence/final.html"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(cynosHtml.allSatisfied).toBe(false);
    expect(cynosHtml.missing.join("\n")).toContain("unsafe/outside UI deliverable");

    const playwrightHtml = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { implementation: { summary: "mockup in Playwright scratch dir", artifacts: [], noFileChangeReason: "product files unchanged; mockup in Playwright scratch dir" } } }), [readDoc("read-brand", "brand-spec.md"), write("fake", ".playwright-cli/final.html"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(playwrightHtml.allSatisfied).toBe(false);
    expect(playwrightHtml.missing.join("\n")).toContain("unsafe/outside UI deliverable");

    const browserScreenshotOnly = checkCompletion(work("ui-design", noChangeEvidence, [readDoc("read-brand", "brand-spec.md"), write("shot", ".cynos/browser-evidence/after.png"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(browserScreenshotOnly.allSatisfied).toBe(true);
  });

  it("ui-design requires design fidelity alignment when implementation writes exist", () => {
    const missingFidelity = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { designFidelity: { foundationUsed: "", alignmentSummary: "" } } }), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(missingFidelity.allSatisfied).toBe(false);
    expect(missingFidelity.missing.join("\n")).toContain("designFidelity.foundationUsed");

    const missingAlignment = checkCompletion(work("ui-design", uiEvidence({ uiDesign: { designFidelity: { foundationUsed: "brand-spec.md", alignmentSummary: "" } } }), [readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(missingAlignment.allSatisfied).toBe(false);
    expect(missingAlignment.missing.join("\n")).toContain("designFidelity.alignmentSummary");
  });

  it("ui-design requires real browser evidence and does not accept static or help commands", () => {
    const bad = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(bad.allSatisfied).toBe(false);
    expect(bad.missing.join("\n")).toContain("browser");

    const helpOnly = checkCompletion(work("ui-design", uiEvidence(), [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), bash("help", "npx --yes @playwright/cli console --help"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(helpOnly.allSatisfied).toBe(false);
    expect(helpOnly.missing.join("\n")).toContain("browser");

    const explicitNonBrowser = checkCompletion(work("ui-design", { ...uiEvidence(), browserVerification: { summary: "checked", evidence: [{ kind: "screenshot", summary: "claimed", toolCallId: "build" }] } }, [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(explicitNonBrowser.allSatisfied).toBe(false);
    expect(explicitNonBrowser.missing.join("\n")).toContain("real browser");
  });

  it("ui-design tightens critique or confirmation evidence", () => {
    const noReview = checkCompletion(work("ui-design", uiEvidence({ critique: undefined }), [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(noReview.allSatisfied).toBe(false);
    expect(noReview.missing.join("\n")).toContain("critique.summary");

    const badConfirmation = checkCompletion(work("ui-design", uiEvidence({ critique: undefined, confirmation: { summary: "approved" } }), [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(badConfirmation.allSatisfied).toBe(false);
    expect(badConfirmation.missing.join("\n")).toContain("capturedUserAnswers");

    const confirmationWork = work("ui-design", uiEvidence({ critique: undefined, confirmation: { summary: "user approved the v0" } }), [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]);
    confirmationWork.capturedUserAnswers = [{ question: "Approve v0?", answerSummary: "yes", at: "2026-01-01T00:00:00.000Z" }];
    expect(checkCompletion(confirmationWork).allSatisfied).toBe(true);

    const badScore = checkCompletion(work("ui-design", uiEvidence({ critique: { summary: "overconfident", overallScore: 12 } }), [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(badScore.allSatisfied).toBe(false);
    expect(badScore.missing.join("\n")).toContain("overallScore");
  });

  it("ui-design keeps test assets out of final artifacts but still verifies them when written", () => {
    const badArtifact = uiEvidence({ uiDesign: { implementation: { summary: "updated page and visual spec", artifacts: ["src/App.tsx", "tests/e2e/home.spec.ts"] } } });
    const badArtifactResult = checkCompletion(work("ui-design", badArtifact, [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), write("e2e", "tests/e2e/home.spec.ts"), browser("shot"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(badArtifactResult.allSatisfied).toBe(false);
    expect(badArtifactResult.missing.join("\n")).toContain("test asset");

    const e2eEvidence = uiEvidence({ uiDesign: { implementation: { summary: "updated page and visual spec", artifacts: ["src/App.tsx"] } } });
    const missingE2e = checkCompletion(work("ui-design", e2eEvidence, [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), write("e2e", "tests/e2e/home.spec.ts"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(missingE2e.allSatisfied).toBe(false);
    expect(missingE2e.missing.join("\n")).toContain("test-assets-passed-if-written");

    const ok = checkCompletion(work("ui-design", e2eEvidence, [readDoc("read-testing", "docs/testing.md"), readDoc("read-brand", "brand-spec.md"), write("ui", "src/App.tsx"), write("e2e", "tests/e2e/home.spec.ts"), browser("shot"), bash("test", "npm test"), bash("build", "npm run build"), ...finalizationEvidence]));
    expect(ok.allSatisfied).toBe(true);
  });

function usabilityEvidence(overrides: Record<string, unknown> = {}) {
    return {
      criteriaCoverage: coverage,
      usability: {
        targets: ["mobile 360px"],
        observations: [{
          id: "obs-1",
          severity: "important",
          summary: "menu clipped at 360px",
          area: "responsive / mobile menu",
          before: { screenshot: ".cynos/browser-evidence/before.png", viewport: "360x640" },
          fix: { summary: "constrain menu width", filesChanged: ["src/Menu.tsx"] },
          after: { screenshot: ".cynos/browser-evidence/after.png", viewport: "360x640" },
          status: "fixed",
        }],
        scope: { behaviorPreserved: true, behaviorPreservedSummary: "only CSS changes" },
      },
      report: {
        summary: "usability fix applied",
        observationsSummary: "found 1 important issue",
        fixesSummary: "fixed menu overflow",
        behaviorPreserved: "only CSS changes; no functional behavior change",
        evidence: ["browser snapshot/screenshot", "npm run build"],
      },
      verification: { summary: "npm run build" },
      finalization,
      ...overrides,
    };
  }

  it("usability structured observations with fix and re-observe passes", () => {
    const result = checkCompletion(work("usability", usabilityEvidence(), [browser("before"), write("fix", "src/Menu.tsx"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);

    const screenshotPathOnly = checkCompletion(work("usability", usabilityEvidence(), [write("fix", "src/Menu.tsx"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(screenshotPathOnly.allSatisfied).toBe(false);
    expect(screenshotPathOnly.missing.join("\n")).toContain("before browser evidence");
  });

  it("usability rejects observation missing severity", () => {
    const missingSeverity = checkCompletion(work("usability", usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", summary: "menu clipped", area: "menu", before: {}, status: "deferred" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } }), [browser("before"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(missingSeverity.allSatisfied).toBe(false);
    expect(missingSeverity.missing.join("\n")).toContain("severity");
  });

  it("usability rejects observation missing id or area", () => {
    const missingId = checkCompletion(work("usability", usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ severity: "important", summary: "menu clipped", area: "menu", before: {}, status: "deferred" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } }), [browser("before"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(missingId.allSatisfied).toBe(false);
    expect(missingId.missing.join("\n")).toContain("id");

    const missingArea = checkCompletion(work("usability", usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", before: {}, status: "deferred" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } }), [browser("before"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(missingArea.allSatisfied).toBe(false);
    expect(missingArea.missing.join("\n")).toContain("area");
  });

  it("usability blocking/important deferred without reason fails", () => {
    const deferredBlocking = checkCompletion(work("usability", usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "blocking", summary: "menu clipped", area: "menu", before: {}, status: "deferred" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } }), [browser("before"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(deferredBlocking.allSatisfied).toBe(false);
    expect(deferredBlocking.missing.join("\n")).toContain("deferredReason");

    const withReason = checkCompletion(work("usability", usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "blocking", summary: "menu clipped", area: "menu", before: {}, deferredReason: "needs design decision; user will follow up", status: "deferred" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } }, report: { summary: "observe", observationsSummary: "blocking issue", fixesSummary: "deferred", behaviorPreserved: "no change", evidence: ["browser"], deferredItems: ["obs-1: menu clipped"] } }), [browser("before"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(withReason.allSatisfied).toBe(true);
  });

  it("usability minor deferred passes without fix", () => {
    const minorDeferred = checkCompletion(work("usability", usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "minor", summary: "focus ring faint", area: "accessibility", before: {}, status: "deferred" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } }), [browser("before"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(minorDeferred.allSatisfied).toBe(true);
  });

  it("usability observe-only (all deferred) passes", () => {
    const observeOnly = checkCompletion(work("usability", usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [
      { id: "obs-1", severity: "blocking", summary: "menu clipped", area: "menu", before: {}, deferredReason: "observe-only report requested", status: "deferred" },
      { id: "obs-2", severity: "minor", summary: "focus ring faint", area: "a11y", before: {}, status: "deferred" },
    ], scope: { behaviorPreserved: true, behaviorPreservedSummary: "observe-only" } }, report: { summary: "observe-only", observationsSummary: "2 issues found", fixesSummary: "observe-only, not fixed", behaviorPreserved: "no change made", evidence: ["browser"], deferredItems: ["obs-1: menu clipped"] } }), [browser("before"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(observeOnly.allSatisfied).toBe(true);
  });

  it("usability fix without real write evidence fails", () => {
    const missingWrite = checkCompletion(work("usability", usabilityEvidence(), [browser("before"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(missingWrite.allSatisfied).toBe(false);
    expect(missingWrite.missing.join("\n")).toContain("write/edit");
  });

  it("usability fix without after evidence fails", () => {
    const fixedNoAfter = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", area: "menu", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, status: "fixed" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } });
    const result = checkCompletion(work("usability", fixedNoAfter, [browser("before"), write("fix", "src/Menu.tsx"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("after");
  });

  it("usability scope soft-warns on functional change but still passes", () => {
    const withFunctionalChange = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", area: "menu", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, after: { screenshot: ".cynos/browser-evidence/after.png" }, status: "fixed" }], scope: { behaviorPreserved: false, behaviorPreservedSummary: "added click handler for UX", functionalChangesIntroduced: ["added onClick to Menu.tsx"] } }, report: { summary: "fixed", observationsSummary: "1 issue", fixesSummary: "fixed", behaviorPreserved: "page interaction changed", evidence: ["browser"], functionalChangesIntroduced: ["added onClick to Menu.tsx"] } });
    const result = checkCompletion(work("usability", withFunctionalChange, [browser("before"), write("fix", "src/Menu.tsx"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);
    const scopeCheck = result.results.find((c: any) => c.id === "usability-scope-recorded");
    expect(scopeCheck?.details).toContain("functional changes");
  });

  it("usability scope missing behaviorPreserved fails", () => {
    const missingScope = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", area: "menu", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, after: { screenshot: ".cynos/browser-evidence/after.png" }, status: "fixed" }], scope: { behaviorPreservedSummary: "css only" } } });
    const result = checkCompletion(work("usability", missingScope, [browser("before"), write("fix", "src/Menu.tsx"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("behaviorPreserved");
  });

  it("usability report requires screenshots when browser-evidence writes exist", () => {
    const noScreenshots = usabilityEvidence({ report: { summary: "fixed", observationsSummary: "1 issue", fixesSummary: "fixed", behaviorPreserved: "css only", evidence: ["browser"] } });
    const result = checkCompletion(work("usability", noScreenshots, [browser("before"), write("fix", "src/Menu.tsx"), browser("after"), write("evidence-write", ".cynos/browser-evidence/before.png"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("screenshots");
  });

  it("usability report missing fields fails", () => {
    const noReport = usabilityEvidence({ report: undefined });
    const result = checkCompletion(work("usability", noReport, [browser("before"), write("fix", "src/Menu.tsx"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("report");
  });

  it("usability browserBlocked degrades before/after evidence requirements only with real failed browser attempts", () => {
    const blocked = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "blocking", summary: "menu clipped", area: "menu", before: { degradedEvidence: "static DOM/code inspection; screenshot unavailable" }, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, after: { degradedEvidence: "static DOM/code inspection; screenshot unavailable" }, status: "fixed" }], browserBlocked: { reason: "chromium launch fails: libasound.so.2 missing", attemptedApproaches: ["open page", "snapshot page"], degradedEvidence: "static DOM/code inspection; screenshot unavailable", userAuthorized: false }, scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } });
    const noFailedAttempts = checkCompletion(work("usability", blocked, [write("fix", "src/Menu.tsx"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(noFailedAttempts.allSatisfied).toBe(false);

    const result = checkCompletion(work("usability", blocked, [bash("b1", "npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:5173", true), bash("b2", "npx --yes @playwright/cli -s=$SESSION snapshot", true), write("fix", "src/Menu.tsx"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(true);
  });

  it("usability browserBlocked without degradedEvidence does not degrade", () => {
    const blockedNoDegraded = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "blocking", summary: "menu clipped", area: "menu", before: {}, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, after: {}, status: "fixed" }], browserBlocked: { reason: "chromium launch fails", attemptedApproaches: ["install chromium", "ldd check"], userAuthorized: false }, scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } });
    const result = checkCompletion(work("usability", blockedNoDegraded, [write("fix", "src/Menu.tsx"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("before");
  });

  it("usability browserBlocked with <2 attemptedApproaches does not degrade", () => {
    const blockedTooFew = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "blocking", summary: "menu clipped", area: "menu", before: {}, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, after: {}, status: "fixed" }], browserBlocked: { reason: "chromium launch fails", attemptedApproaches: ["install chromium only"], degradedEvidence: "static DOM/code inspection; screenshot unavailable", userAuthorized: false }, scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } });
    const result = checkCompletion(work("usability", blockedTooFew, [write("fix", "src/Menu.tsx"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("before");
  });

  it("usability rejects browser evidence captured only after the fix or before the last write", () => {
    const afterOnly = checkCompletion(work("usability", usabilityEvidence(), [write("fix", "src/Menu.tsx"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(afterOnly.allSatisfied).toBe(false);
    expect(afterOnly.missing.join("\n")).toContain("before browser evidence");

    const editAfterReobserve = checkCompletion(work("usability", usabilityEvidence(), [browser("before"), write("fix-1", "src/Menu.tsx"), browser("after"), write("fix-2", "src/Menu.tsx"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(editAfterReobserve.allSatisfied).toBe(false);
    expect(editAfterReobserve.missing.join("\n")).toContain("after browser evidence");
  });

  it("usability enforces explicit before/after evidenceToolCallId ordering", () => {
    const lateBefore = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", area: "menu", before: { screenshot: ".cynos/browser-evidence/before.png", evidenceToolCallId: "late-browser" }, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, after: { screenshot: ".cynos/browser-evidence/after.png" }, status: "fixed" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } });
    const lateBeforeResult = checkCompletion(work("usability", lateBefore, [browser("early-browser"), write("fix", "src/Menu.tsx"), browser("late-browser"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(lateBeforeResult.allSatisfied).toBe(false);
    expect(lateBeforeResult.missing.join("\n")).toContain("before.evidenceToolCallId");

    const earlyAfter = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", area: "menu", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, after: { screenshot: ".cynos/browser-evidence/after.png", evidenceToolCallId: "early-browser" }, status: "fixed" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } });
    const earlyAfterResult = checkCompletion(work("usability", earlyAfter, [browser("early-browser"), write("fix", "src/Menu.tsx"), browser("late-browser"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(earlyAfterResult.allSatisfied).toBe(false);
    expect(earlyAfterResult.missing.join("\n")).toContain("after.evidenceToolCallId");
  });

  it("usability rejects outside-project paths as fix files", () => {
    const outsidePath = join(tmpdir(), "fake-usability-fix.css");
    const outsideFix = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", area: "menu", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "claimed outside temp file as fix", filesChanged: [outsidePath] }, after: { screenshot: ".cynos/browser-evidence/after.png" }, status: "fixed" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } });
    const result = checkCompletion(work("usability", outsideFix, [browser("before"), write("outside", outsidePath), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("in-project product file");
  });

  it("usability rejects artifact paths as fix files", () => {
    const artifactFix = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", area: "menu", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "claimed screenshot as fix", filesChanged: [".cynos/browser-evidence/before.png"] }, after: { screenshot: ".cynos/browser-evidence/after.png" }, status: "fixed" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } });
    const result = checkCompletion(work("usability", artifactFix, [browser("before"), write("artifact", ".cynos/browser-evidence/before.png"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("artifact");
  });

  it("usability rejects global browserBlocked degradation after a successful browser evidence", () => {
    const blocked = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", area: "menu", before: { degradedEvidence: "static DOM/code inspection" }, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, after: { degradedEvidence: "static DOM/code inspection" }, status: "fixed" }], browserBlocked: { reason: "chromium launch fails", attemptedApproaches: ["open page", "snapshot page"], degradedEvidence: "static DOM/code inspection", userAuthorized: false }, scope: { behaviorPreserved: true, behaviorPreservedSummary: "css only" } } });
    const result = checkCompletion(work("usability", blocked, [browser("successful-before"), write("fix", "src/Menu.tsx"), bash("b1", "npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:5173", true), bash("b2", "npx --yes @playwright/cli -s=$SESSION snapshot", true), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("after browser evidence");
  });

  it("usability requires structured report fields for declared page or functional changes", () => {
    const pageChangeMissingReport = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "modal background scrolls", area: "modal", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "add scroll lock", filesChanged: ["src/Menu.tsx"] }, after: { screenshot: ".cynos/browser-evidence/after.png" }, status: "fixed" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "page-level scroll behavior only", pageInteractionChanges: ["locked background scroll while modal is open"] } } });
    const missingPageReport = checkCompletion(work("usability", pageChangeMissingReport, [browser("before"), write("fix", "src/Menu.tsx"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(missingPageReport.allSatisfied).toBe(false);
    expect(missingPageReport.missing.join("\n")).toContain("report.pageInteractionChanges");

    const pageChangeReported = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "modal background scrolls", area: "modal", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "add scroll lock", filesChanged: ["src/Menu.tsx"] }, after: { screenshot: ".cynos/browser-evidence/after.png" }, status: "fixed" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "page-level scroll behavior only", pageInteractionChanges: ["locked background scroll while modal is open"] } }, report: { summary: "fixed", observationsSummary: "modal scroll", fixesSummary: "locked background scroll", behaviorPreserved: "business behavior unchanged", evidence: ["browser"], pageInteractionChanges: ["locked background scroll while modal is open"] } });
    const reported = checkCompletion(work("usability", pageChangeReported, [browser("before"), write("fix", "src/Menu.tsx"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(reported.allSatisfied).toBe(true);

    const functionalMissingReport = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "menu clipped", area: "menu", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "constrain", filesChanged: ["src/Menu.tsx"] }, after: { screenshot: ".cynos/browser-evidence/after.png" }, status: "fixed" }], scope: { behaviorPreserved: false, behaviorPreservedSummary: "added click handler", functionalChangesIntroduced: ["added onClick handler"] } } });
    const missingFunctionalReport = checkCompletion(work("usability", functionalMissingReport, [browser("before"), write("fix", "src/Menu.tsx"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(missingFunctionalReport.allSatisfied).toBe(false);
    expect(missingFunctionalReport.missing.join("\n")).toContain("report.functionalChangesIntroduced");
  });

  it("usability report requires deferredItems when blocking is deferred", () => {
    const deferredNoReport = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "blocking", summary: "menu clipped", area: "menu", before: { screenshot: ".cynos/browser-evidence/before.png" }, deferredReason: "needs design decision", status: "deferred" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "observe-only" } }, report: { summary: "observe", observationsSummary: "blocking issue", fixesSummary: "deferred", behaviorPreserved: "no change", evidence: ["browser"] } });
    const result = checkCompletion(work("usability", deferredNoReport, [browser("before"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("deferredItems");
  });

  it("usability rejects status=fixed with noFileChangeReason instead of real writes", () => {
    const configOnlyFix = usabilityEvidence({ usability: { targets: ["mobile 360px"], observations: [{ id: "obs-1", severity: "important", summary: "viewport meta tag missing", area: "responsive / head", before: { screenshot: ".cynos/browser-evidence/before.png" }, fix: { summary: "runtime config-only change, no source file edit", noFileChangeReason: "adjustment made via dev server config" }, after: { screenshot: ".cynos/browser-evidence/after.png" }, status: "fixed" }], scope: { behaviorPreserved: true, behaviorPreservedSummary: "config only" } } });
    const result = checkCompletion(work("usability", configOnlyFix, [browser("before"), browser("after"), bash("build", "npm run build"), ...docs, ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("noFileChangeReason");
  });

  it("release requires guide, authorization, verification, execution and final state", () => {
    const result = checkCompletion(work("release", releaseEvidence(), releaseExecutionCaptured()));
    expect(result.allSatisfied).toBe(true);
  });

  it("release rejects self-reported successful side-effect without real release command", () => {
    const claimedEvidence = releaseEvidence({ release: { mode: "execute", guide: {}, authorization: { summary: "push main", branch: "main", includeUncommitted: false, operations: ["push"], targets: ["origin"] }, execution: { summary: "claimed push", stepsPerformed: [{ operation: "push", result: "succeeded", evidence: "claimed" }], postValidation: [{ kind: "git-remote", result: "passed", evidence: "claimed" }], rollback: "git revert and push" }, finalState: { summary: "claimed", gitStatusSummary: "main clean", localChanges: "none", sideEffectState: "claimed push" } } });
    const result = checkCompletion(work("release", claimedEvidence, [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), ...finalizationEvidence]));
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("real successful release");
  });

  it("release can record missing release guide without inventing one", () => {
    const cwd = mkdtempSync(join(tmpdir(), "cynos-no-release-guide-"));
    writeFileSync(join(cwd, "package.json"), "{}", "utf8");
    const result = checkCompletion(work("release", releaseEvidence({ release: { mode: "execute", guide: { missingReason: "docs/release.md absent in fixture", filesRead: ["package.json"] }, authorization: { summary: "verify only", branch: "main", includeUncommitted: false, operations: ["verify-only"], dryRun: true }, execution: { summary: "verified only", stepsPerformed: [{ operation: "verify-only", result: "succeeded", evidence: "npm run verify" }], releaseNotPerformedReason: "only verified release preconditions in fixture", postValidation: [{ kind: "manual", result: "skipped", reason: "not released" }], rollback: "none; no release side effect" }, finalState: { summary: "no release", gitStatusSummary: "main clean", localChanges: "none", sideEffectState: "not performed" } } }), [readDoc("pkg", "package.json"), bash("verify", "npm run verify"), ...finalizationEvidence], cwd));
    expect(result.allSatisfied).toBe(true);
  });

  function releaseEvidence(overrides: Record<string, unknown> = {}) {
    return {
      criteriaCoverage: coverage,
      release: {
        mode: "execute",
        guide: {},
        authorization: { summary: "push main", branch: "main", includeUncommitted: false, operations: ["push"], targets: ["origin"] },
        execution: { summary: "pushed main", stepsPerformed: [{ operation: "push", result: "succeeded", evidence: "git push origin main" }], postValidation: [{ kind: "git-remote", result: "passed", evidence: "remote main updated" }], rollback: "git revert and push" },
        finalState: { summary: "pushed main", gitStatusSummary: "main clean", localChanges: "none", sideEffectState: "push succeeded" },
      },
      verification: { summary: "npm run verify" },
      ...overrides,
    };
  }

  function releaseExecutionCaptured(extra: CapturedToolResult[] = []) {
    return [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), ...extra, bash("push", "git push origin main"), ...finalizationEvidence];
  }

  it("release authorization records mode/scope and requires high-risk user confirmation", () => {
    expect(releaseAuthorizationRecordedCheckpoint.check(work("release", releaseEvidence())).satisfied).toBe(true);

    const badMode = releaseAuthorizationRecordedCheckpoint.check(work("release", releaseEvidence({ release: { mode: "verify", authorization: { summary: "verify", branch: "main", includeUncommitted: false, operations: ["verify-only"] }, execution: { summary: "n/a", stepsPerformed: [], releaseNotPerformedReason: "n/a", postValidation: [], rollback: "none" }, finalState: { summary: "n/a", localChanges: "none" } } })));
    expect(badMode.satisfied).toBe(false);
    expect((badMode as any).reason).toContain("execute|maintain");

    const highRisk = releaseEvidence({ release: { mode: "execute", guide: {}, authorization: { summary: "publish npm", branch: "main", includeUncommitted: false, operations: ["npm-publish"], targets: ["npm"], highRiskConfirmed: ["user confirmed npm publish"] }, execution: { summary: "dry run", stepsPerformed: [], releaseNotPerformedReason: "not executed", postValidation: [{ kind: "npm-package", result: "skipped", reason: "not published" }], rollback: "none" }, finalState: { summary: "not published", gitStatusSummary: "main clean", localChanges: "none", sideEffectState: "not performed" } } });
    const noUserAnswer = releaseAuthorizationRecordedCheckpoint.check(work("release", highRisk));
    expect(noUserAnswer.satisfied).toBe(false);
    expect((noUserAnswer as any).reason).toContain("capturedUserAnswers");

    const withUser = work("release", highRisk);
    withUser.capturedUserAnswers = [{ question: "Publish npm?", answerSummary: "confirmed npm publish", at: "2026-01-01T00:00:00.000Z" }];
    expect(releaseAuthorizationRecordedCheckpoint.check(withUser).satisfied).toBe(true);
  });

  it("release execution requires ordering, real side-effect evidence and authorized operations", () => {
    const ok = releaseExecutionRecordedCheckpoint.check(work("release", releaseEvidence(), releaseExecutionCaptured()));
    expect(ok.satisfied).toBe(true);

    const claimed = releaseExecutionRecordedCheckpoint.check(work("release", releaseEvidence(), [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify")]));
    expect(claimed.satisfied).toBe(false);
    expect((claimed as any).reason).toContain("real successful release");

    const unauthorized = releaseExecutionRecordedCheckpoint.check(work("release", releaseEvidence(), releaseExecutionCaptured([bash("publish", "npm publish")])));
    expect(unauthorized.satisfied).toBe(false);
    expect((unauthorized as any).reason).toContain("unauthorized");

    const unauthorizedFailedAttempt = releaseExecutionRecordedCheckpoint.check(work("release", releaseEvidence(), [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), bash("publish", "npm publish", true, "403 forbidden"), ...finalizationEvidence]));
    expect(unauthorizedFailedAttempt.satisfied).toBe(false);
    expect((unauthorizedFailedAttempt as any).reason).toContain("unauthorized");

    const noPreflight = releaseExecutionRecordedCheckpoint.check(work("release", releaseEvidence(), [readDoc("release-doc", "docs/release.md"), bash("push", "git push origin main")]));
    expect(noPreflight.satisfied).toBe(false);
    expect((noPreflight as any).reason).toContain("preflight verification");

    const weakExistencePreflight = releaseExecutionRecordedCheckpoint.check(work("release", releaseEvidence({ verification: { summary: "test -f docs/release.md" } }), [readDoc("release-doc", "docs/release.md"), bash("weak", "test -f docs/release.md && echo EXISTS || echo MISSING"), bash("push", "git push origin main"), ...finalizationEvidence]));
    expect(weakExistencePreflight.satisfied).toBe(false);
    expect((weakExistencePreflight as any).reason).toContain("preflight verification");

    const tagPushEvidence = releaseEvidence({ release: { mode: "execute", guide: {}, authorization: { summary: "tag and push", branch: "main", includeUncommitted: false, operations: ["tag", "push"], targets: ["local origin"] }, execution: { summary: "tagged and pushed", stepsPerformed: [{ operation: "tag", result: "succeeded", evidence: "git tag v0.0.1" }, { operation: "push", result: "succeeded", evidence: "git push origin v0.0.1" }], postValidation: [{ kind: "tag", result: "passed", evidence: "git tag -l v0.0.1" }, { kind: "git-remote", result: "passed", evidence: "git ls-remote --tags origin v0.0.1" }], rollback: "git tag -d v0.0.1 && git push origin :refs/tags/v0.0.1" }, finalState: { summary: "tag pushed", gitStatusSummary: "main clean", localChanges: "none", sideEffectState: "tag/push succeeded" } }, verification: { summary: "git status + remote + tag/head checked" } });
    const gitStatePreflight = releaseExecutionRecordedCheckpoint.check(work("release", tagPushEvidence, [readDoc("release-doc", "docs/release.md"), bash("status", "git status --short"), bash("remote", "git remote -v"), bash("tags", "git tag -l v0.0.1"), bash("head", "git log -1 --oneline"), bash("tag", "git tag v0.0.1"), bash("push", "git push origin v0.0.1"), bash("ls-remote", "git ls-remote --tags origin v0.0.1"), ...finalizationEvidence]));
    expect(gitStatePreflight.satisfied, JSON.stringify(gitStatePreflight)).toBe(true);

    const passedNoFailedChecks = releaseEvidence({ verification: { summary: "preflight passed, no failed checks" } });
    const passedNoFailedResult = releaseExecutionRecordedCheckpoint.check(work("release", passedNoFailedChecks, releaseExecutionCaptured()));
    expect(passedNoFailedResult.satisfied, JSON.stringify(passedNoFailedResult)).toBe(true);
  });

  it("release execution handles dry-run verify-only failure, opaque scripts, and postValidation coverage", () => {
    const dryRun = releaseEvidence({ release: { mode: "execute", guide: {}, authorization: { summary: "verify only", branch: "main", includeUncommitted: false, operations: ["verify-only"], dryRun: true }, execution: { summary: "verified only", stepsPerformed: [{ operation: "verify-only", result: "succeeded", evidence: "npm run verify" }], releaseNotPerformedReason: "dry-run only", postValidation: [{ kind: "manual", result: "skipped", reason: "not released" }], rollback: "none needed; no side effect" }, finalState: { summary: "verified only", gitStatusSummary: "main clean", localChanges: "none", sideEffectState: "not performed" } } });
    expect(releaseExecutionRecordedCheckpoint.check(work("release", dryRun, [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify")])).satisfied).toBe(true);
    const gitStatusOnlyReadiness = releaseVerificationRecordedCheckpoint.check(work("release", { ...dryRun, verification: { summary: "git status only" } }, [readDoc("release-doc", "docs/release.md"), bash("status", "git status --short")]));
    expect(gitStatusOnlyReadiness.satisfied).toBe(false);
    expect((gitStatusOnlyReadiness as any).reason).toContain("no real release-relevant verification");
    expect(releaseExecutionRecordedCheckpoint.check(work("release", dryRun, releaseExecutionCaptured())).satisfied).toBe(false);
    expect(releaseExecutionRecordedCheckpoint.check(work("release", dryRun, [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), bash("push-failed", "git push origin main", true, "rejected")])).satisfied).toBe(false);

    const opaque = releaseExecutionRecordedCheckpoint.check(work("release", releaseEvidence(), [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), bash("opaque", "npm run release -- patch")]));
    expect(opaque.satisfied).toBe(false);
    expect((opaque as any).reason).toContain("opaque release script");

    const failedOpaque = releaseExecutionRecordedCheckpoint.check(work("release", releaseEvidence(), [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), bash("opaque", "npm run release -- patch", true, "failed after partial release")]));
    expect(failedOpaque.satisfied).toBe(false);
    expect((failedOpaque as any).reason).toContain("opaque release script");

    const failed = releaseEvidence({ release: { mode: "execute", guide: {}, authorization: { summary: "push main", branch: "main", includeUncommitted: false, operations: ["push"], targets: ["origin"] }, execution: { summary: "done", stepsPerformed: [{ operation: "push", result: "failed", evidence: "git push failed" }], postValidation: [{ kind: "git-remote", result: "skipped", reason: "push failed" }], rollback: "no remote change" }, finalState: { summary: "push failed", gitStatusSummary: "main clean", localChanges: "none", sideEffectState: "push failed" } } });
    const failedResult = releaseExecutionRecordedCheckpoint.check(work("release", failed, [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), bash("push", "git push origin main", true, "remote rejected")]));
    expect(failedResult.satisfied).toBe(false);
    expect((failedResult as any).reason).toContain("failure");

    const chineseFailure = releaseEvidence({ release: { mode: "execute", guide: {}, authorization: { summary: "push main", branch: "main", includeUncommitted: false, operations: ["push"], targets: ["origin"] }, execution: { summary: "推送失败，远端拒绝", stepsPerformed: [{ operation: "push", result: "failed", evidence: "git push failed" }], postValidation: [{ kind: "git-remote", result: "skipped", reason: "push failed" }], rollback: "no remote change" }, finalState: { summary: "push failed", gitStatusSummary: "main clean", localChanges: "none", sideEffectState: "push failed" } } });
    const chineseFailureResult = releaseExecutionRecordedCheckpoint.check(work("release", chineseFailure, [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), bash("push", "git push origin main", true, "remote rejected")]));
    expect(chineseFailureResult.satisfied, JSON.stringify(chineseFailureResult)).toBe(true);

    const missingDeployValidation = releaseEvidence({ release: { mode: "execute", guide: {}, authorization: { summary: "deploy", branch: "main", includeUncommitted: false, operations: ["deploy"], targets: ["prod"], highRiskConfirmed: ["confirmed deploy"] }, execution: { summary: "deployed", stepsPerformed: [{ operation: "deploy", result: "succeeded", evidence: "fly deploy" }], postValidation: [{ kind: "manual", result: "passed", evidence: "operator checked" }], rollback: "fly rollback" }, finalState: { summary: "deployed", gitStatusSummary: "main clean", localChanges: "none", sideEffectState: "deploy succeeded" } } });
    const missingValidation = releaseExecutionRecordedCheckpoint.check(work("release", missingDeployValidation, [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), bash("deploy", "fly deploy")], undefined, [{ question: "Deploy?", answerSummary: "confirmed deploy", at: "2025-12-31T23:59:59.000Z" }]));
    expect(missingValidation.satisfied).toBe(false);
    expect((missingValidation as any).reason).toContain("deploy");

    const lateHighRiskAnswer = releaseExecutionRecordedCheckpoint.check(work("release", { ...missingDeployValidation, release: { ...(missingDeployValidation as any).release, execution: { summary: "deployed", stepsPerformed: [{ operation: "deploy", result: "succeeded", evidence: "fly deploy" }], postValidation: [{ kind: "deploy-url", result: "passed", evidence: "curl https://example.invalid" }], rollback: "fly rollback" } } }, [readDoc("release-doc", "docs/release.md"), bash("verify", "npm run verify"), bash("deploy", "fly deploy")], undefined, [{ question: "Deploy?", answerSummary: "confirmed deploy", at: "2026-01-01T00:00:01.000Z" }]));
    expect(lateHighRiskAnswer.satisfied).toBe(false);
    expect((lateHighRiskAnswer as any).reason).toContain("high-risk release confirmation");
  });

  it("release maintain records delivery config, release verification, and final state", () => {
    const maintain = releaseEvidence({ release: { mode: "maintain", guide: {}, deliveryConfig: { filesChanged: ["docs/release.md", "docs/release"], signalsRead: ["docs/release.md"], summary: "updated runbook" }, authorization: { summary: "maintain release docs only", branch: "main", includeUncommitted: false, operations: ["verify-only"] }, execution: { summary: "maintained docs only", stepsPerformed: [{ operation: "verify-only", result: "succeeded", evidence: "git diff --check" }], releaseNotPerformedReason: "maintain only", postValidation: [{ kind: "manual", result: "skipped", reason: "no release" }], rollback: "revert docs commit" }, finalState: { summary: "committed release docs", gitStatusSummary: "main clean", localChanges: "committed", sideEffectState: "not performed" } }, verification: { summary: "git diff --check" } });
    const captured = [readDoc("release-doc", "docs/release.md"), write("write-release-doc", "docs/release.md"), bash("mkdir-release-dir", "mkdir -p docs/release"), bash("diff-check", "git diff --check"), bash("commit", "git commit -m 'docs: update release runbook'"), bash("git-status", "git status --short")];
    expect(releaseDeliveryConfigRecordedCheckpoint.check(work("release", maintain, captured)).satisfied).toBe(true);
    expect(releaseVerificationRecordedCheckpoint.check(work("release", maintain, captured)).satisfied).toBe(true);
    expect(releaseFinalStateRecordedCheckpoint.check(work("release", maintain, captured)).satisfied).toBe(true);

    const preEditVerification = releaseVerificationRecordedCheckpoint.check(work("release", maintain, [readDoc("release-doc", "docs/release.md"), bash("diff-check", "git diff --check"), write("write-release-doc", "docs/release.md")]));
    expect(preEditVerification.satisfied).toBe(false);
    expect((preEditVerification as any).reason).toContain("after the release-system file mutation");

    const staleStatus = releaseFinalStateRecordedCheckpoint.check(work("release", maintain, [readDoc("release-doc", "docs/release.md"), write("write-release-doc", "docs/release.md"), bash("diff-check", "git diff --check"), bash("git-status", "git status --short"), bash("commit", "git commit -m 'docs: update release runbook'")]));
    expect(staleStatus.satisfied).toBe(false);
    expect((staleStatus as any).reason).toContain("final git status");

    const packageJsonChanged = releaseEvidence({ release: { mode: "maintain", guide: {}, deliveryConfig: { filesChanged: ["package.json"], signalsRead: ["docs/release.md"], summary: "changed package script" }, authorization: { summary: "maintain", branch: "main", includeUncommitted: false, operations: ["verify-only"] }, execution: { summary: "maintain", stepsPerformed: [], releaseNotPerformedReason: "maintain", postValidation: [], rollback: "revert" }, finalState: { summary: "not committed", gitStatusSummary: "main clean", localChanges: "not-committed", localChangeReason: "don't commit", sideEffectState: "none" } } });
    const packageResult = releaseDeliveryConfigRecordedCheckpoint.check(work("release", packageJsonChanged, [readDoc("release-doc", "docs/release.md"), write("pkg", "package.json")]));
    expect(packageResult.satisfied).toBe(false);
    expect((packageResult as any).reason).toContain("not release-owned");

    const maintainWithPush = releaseExecutionRecordedCheckpoint.check(work("release", maintain, [...captured, bash("push", "git push origin main")]));
    expect(maintainWithPush.satisfied).toBe(false);
    expect((maintainWithPush as any).reason).toContain("maintain");
  });

  const initEvidence = () => ({
    criteriaCoverage: coverage,
    init: {
      requirementsSummary: "api",
      requirementsInterview: { problemStatement: "need api", mvpScope: ["api"], successCriteria: ["tests pass"], assumptions: ["node"] },
      recommendation: { options: [{ name: "Hono", summary: "api", recommended: true, reason: "small" }, { name: "Fastify", summary: "api" }], recommendedOption: "Hono", selectedOption: "Hono", rationale: "small" },
      techStackDecision: "Hono",
      finalPlanConfirmation: { confirmed: true, summary: "confirmed" },
      postScaffoldAudit: { auditedFiles: ["package.json"], docsConsistencySummary: "aligned" },
      userConfirmationSummary: "confirmed",
    },
    scaffold: { files: ["package.json", "src/index.ts"] },
    verification: { summary: "npm test" },
    projectMemory: { path: "PROJECT.md" },
    operatingDecisions: {
      testing: { summary: "npm test", selectedStrategy: "unit", signalsChecked: ["package.json"], matrix: [{ changeScope: "src", paths: ["src/**"], currentCommands: ["npm test"], status: "active" }] },
      release: { classification: "none", reason: "not deployed", runbook: "docs/release.md", rollbackStrategy: "remove scaffold" },
      git: { summary: "local commits" },
      ui: { reason: "api only" },
    },
    finalization,
  });

  const initValidCaptured = () => [
    bash("preflight", "ls -la"), write("pkg-write", "package.json"), write("scaffold", "src/index.ts"), write("agents", "AGENTS.md"), readDoc("pkg", "package.json"),
    write("readme", "README.md"), write("project", "PROJECT.md"), write("testing", "docs/testing.md"), write("release", "docs/release.md"),
    bash("test", "npm test"), ...finalizationEvidence,
  ];

  it("init uses generic local finalization and release docs contract", () => {
    const initWork = work("init", initEvidence(), initValidCaptured(), undefined);
    initWork.capturedUserAnswers = [{ question: "Confirm full init plan?", answerSummary: "confirmed", at: "2025-12-31T23:59:59.000Z" }];
    const result = checkCompletion(initWork);
    expect(result.allSatisfied).toBe(true);
    expect(result.missing.join("\n")).not.toContain("releaseImpact");
  });

  it("init final plan confirmation must happen before scaffold writes", () => {
    const initWork = work("init", initEvidence(), initValidCaptured());
    initWork.capturedUserAnswers = [{ question: "Confirm after scaffold?", answerSummary: "confirmed after scaffold", at: "2026-01-01T00:00:01.000Z" }];
    const result = checkCompletion(initWork);
    expect(result.allSatisfied).toBe(false);
    expect(result.missing.join("\n")).toContain("first scaffold");

    const earlyUnrelatedAnswer = work("init", initEvidence(), initValidCaptured());
    earlyUnrelatedAnswer.capturedUserAnswers = [
      { question: "Q1: language?", answerSummary: "User chose TypeScript", at: "2025-12-31T23:59:59.000Z" },
      { question: "Confirm full init plan?", answerSummary: "confirmed full scaffold/testing/release plan", at: "2026-01-01T00:00:01.000Z" },
    ];
    const bypass = checkCompletion(earlyUnrelatedAnswer);
    expect(bypass.allSatisfied).toBe(false);
    expect(bypass.missing.join("\n")).toContain("final plan confirmation is later than the first write");
  });

  it("init requires directory content/status preflight before first scaffold write", () => {
    const noPreflight = work("init", initEvidence(), initValidCaptured().filter((result) => result.toolCallId !== "preflight"));
    noPreflight.capturedUserAnswers = [{ question: "Confirm full init plan?", answerSummary: "confirmed full scaffold/testing/release plan", at: "2025-12-31T23:59:59.000Z" }];
    const missing = checkCompletion(noPreflight);
    expect(missing.allSatisfied).toBe(false);
    expect(missing.missing.join("\n")).toContain("inspect the target directory");

    const pwdOnly = work("init", initEvidence(), [bash("preflight", "pwd"), ...initValidCaptured().slice(1)]);
    pwdOnly.capturedUserAnswers = [{ question: "Confirm full init plan?", answerSummary: "confirmed full scaffold/testing/release plan", at: "2025-12-31T23:59:59.000Z" }];
    const pwdResult = checkCompletion(pwdOnly);
    expect(pwdResult.allSatisfied).toBe(false);
    expect(pwdResult.missing.join("\n")).toContain("pwd alone");

    const readPreflight = work("init", initEvidence(), [readDoc("preflight", "README.md"), ...initValidCaptured().slice(1)]);
    readPreflight.capturedUserAnswers = [{ question: "Confirm full init plan?", answerSummary: "confirmed full scaffold/testing/release plan", at: "2025-12-31T23:59:59.000Z" }];
    expect(checkCompletion(readPreflight).allSatisfied).toBe(true);

    const failedGitStatusPreflight = work("init", initEvidence(), [bash("preflight", "git status --short", true, "fatal: not a git repository"), ...initValidCaptured().slice(1)]);
    failedGitStatusPreflight.capturedUserAnswers = [{ question: "Confirm full init plan?", answerSummary: "confirmed full scaffold/testing/release plan", at: "2025-12-31T23:59:59.000Z" }];
    expect(checkCompletion(failedGitStatusPreflight).allSatisfied).toBe(true);

    const failedTestExistsPreflight = work("init", initEvidence(), [bash("preflight", "test -e package.json", true, ""), ...initValidCaptured().slice(1)]);
    failedTestExistsPreflight.capturedUserAnswers = [{ question: "Confirm full init plan?", answerSummary: "confirmed full scaffold/testing/release plan", at: "2025-12-31T23:59:59.000Z" }];
    expect(checkCompletion(failedTestExistsPreflight).allSatisfied).toBe(true);
  });

  it("init post-scaffold audit must happen after scaffold and before final operational docs", () => {
    const auditBeforeScaffold = work("init", initEvidence(), [bash("preflight", "ls -la"), readDoc("pkg", "package.json"), write("pkg-write", "package.json"), write("scaffold", "src/index.ts"), write("agents", "AGENTS.md"), write("readme", "README.md"), write("project", "PROJECT.md"), write("testing", "docs/testing.md"), write("release", "docs/release.md"), bash("test", "npm test"), ...finalizationEvidence]);
    auditBeforeScaffold.capturedUserAnswers = [{ question: "Confirm full init plan?", answerSummary: "confirmed full scaffold/testing/release plan", at: "2025-12-31T23:59:59.000Z" }];
    const before = checkCompletion(auditBeforeScaffold);
    expect(before.allSatisfied).toBe(false);
    expect(before.missing.join("\n")).toContain("after scaffold");

    const docsBeforeAudit = work("init", initEvidence(), [bash("preflight", "ls -la"), write("pkg-write", "package.json"), write("scaffold", "src/index.ts"), write("agents", "AGENTS.md"), write("readme", "README.md"), write("project", "PROJECT.md"), write("testing", "docs/testing.md"), write("release", "docs/release.md"), readDoc("pkg", "package.json"), bash("test", "npm test"), ...finalizationEvidence]);
    docsBeforeAudit.capturedUserAnswers = [{ question: "Confirm full init plan?", answerSummary: "confirmed full scaffold/testing/release plan", at: "2025-12-31T23:59:59.000Z" }];
    const stale = checkCompletion(docsBeforeAudit);
    expect(stale.allSatisfied).toBe(false);
    expect(stale.missing.join("\n")).toContain("operational docs must be finalized after");
  });

  it("verification-command-passed accepts non-JS verification (go vet / python py_compile / make verify) and no longer forces fake npm test", () => {
    // Regression: a multilingual monorepo used Go and Python verification while
    // the old whitelist only recognized JavaScript runners. The extended whitelist
    // must pass through substantive commands directly.
    const captured = [
      bash("vet", "cd go-service && go vet ./..."),
      bash("py", "cd python-service && python3 -m py_compile app/main.py"),
    ];
    const w = work("init", { verification: { summary: "go vet + py_compile passed" } }, captured);
    const result = verificationCommandPassedCheckpoint.check(w);
    expect(result.satisfied, JSON.stringify(result)).toBe(true);
  });

  it("verification-command-passed requires fresh evidence after the last production write", () => {
    const stale = work("develop", { verification: { summary: "verified" } }, [
      bash("early", "npm test"),
      write("source", "src/file.ts"),
    ]);
    const staleResult = verificationCommandPassedCheckpoint.check(stale);
    expect(staleResult.satisfied).toBe(false);
    expect((staleResult as any).reason).toContain("before the last production write");

    const fresh = work("develop", { verification: { summary: "verified" } }, [
      write("source", "src/file.ts"),
      bash("final", "npm test"),
    ]);
    expect(verificationCommandPassedCheckpoint.check(fresh).satisfied).toBe(true);
  });

  it("verification-command-passed diagnostic stays concise when nothing matches", () => {
    const w = work("default", {}, [bash("ls", "ls -1d sub-project && echo VERIFY PASSED")]);
    const result = verificationCommandPassedCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    const reason = (result as any).reason;
    expect(reason).toContain("docs/testing.md");
    expect(reason).toContain("./scripts/verify.sh");
    expect(reason).toContain("noTestSuite");
    expect(reason.length).toBeLessThan(800);
  });

  it("verification-command-passed suspected diagnostic shows command segment, not truncated raw shell", () => {
    const command = "cd /tmp/cynos-smoke-shared-layer-20260627172627/f1-non-obvious-testing-command && node scripts/deploy.mjs";
    const w = work("develop", { verification: { summary: "custom verification" } }, [bash("custom", command, false, "verification passed")]);
    const result = verificationCommandPassedCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    const reason = (result as any).reason;
    expect(reason).toContain("node scripts/deploy.mjs");
    expect(reason).not.toContain("cynos-smoke-shared-layer");
    expect(reason).not.toContain(" &`");
  });

  it("onboard project-understanding passes a long-but-valid PROJECT.md (lineCount is a quality proxy, not a hard block)", () => {
    // rubric A1: length is a quality proxy, not correctness. A 300-line accurate high-signal
    // PROJECT.md must not be hard-blocked. The real content guard is criticalRisks[]/noCriticalRisksReason.
    const evidence = {
      criteriaCoverage: coverage,
      projectMemory: { path: "PROJECT.md", lineCount: 300, criticalRisks: [{ summary: "version mismatch", evidence: "package.json vs Cargo.toml" }] },
    };
    const w = work("onboard", evidence, []);
    const result = onboardProjectUnderstandingCheckpoint.check(w);
    expect(result.satisfied).toBe(true);
    expect((result as any).details).toContain("lineCount=300");
  });

  it("onboard project-understanding blocks on missing criticalRisks, not on length", () => {
    // When criticalRisks is absent and noCriticalRisksReason is also absent, the gate must fail
    // on the criticalRisks requirement — proving the guard shifted from length to content.
    const evidence = {
      criteriaCoverage: coverage,
      projectMemory: { path: "PROJECT.md", lineCount: 300 },
    };
    const w = work("onboard", evidence, []);
    const result = onboardProjectUnderstandingCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    expect((result as any).reason).toContain("criticalRisks");
  });

  it("onboard dimension checkpoints pass with valid per-dimension evidence", () => {
    // After splitting the operating-contract checkpoint into four dimension checkpoints,
    // each dimension must pass independently with valid evidence for that dimension.
    const testingW = work("onboard", { criteriaCoverage: coverage, testingContract: { summary: "vitest", signalsChecked: ["package.json"], matrix: [{ changeScope: "src", paths: ["src/**"], currentCommands: ["npm test"], status: "active" }] } }, [write("testing", "docs/testing.md"), readDoc("pkg", "package.json")]);
    expect(onboardTestingContractCheckpoint.check(testingW).satisfied).toBe(true);

    const releaseW = work("onboard", { criteriaCoverage: coverage, releaseContract: { classification: "none", signalsChecked: ["package.json"], notApplicableReason: "not deployed" } }, [readDoc("pkg", "package.json")]);
    expect(onboardReleaseContractCheckpoint.check(releaseW).satisfied).toBe(true);

    const engineeringW = work("onboard", { criteriaCoverage: coverage, engineeringContract: { agentsMd: { reviewedExisting: false }, git: { summary: "local commits" }, ui: { reason: "no ui" } } }, [write("agents", "AGENTS.md")]);
    expect(onboardEngineeringContractCheckpoint.check(engineeringW).satisfied).toBe(true);
  });

  it("onboard testing-contract blocks when docs/testing.md is not really written", () => {
    const w = work("onboard", { criteriaCoverage: coverage, testingContract: { summary: "vitest", signalsChecked: ["package.json"], matrix: [{ changeScope: "src", paths: ["src/**"], status: "established" }] } }, [readDoc("pkg", "package.json")]);
    const result = onboardTestingContractCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    expect((result as any).reason).toContain("docs/testing.md");
  });

  it("onboard release-contract requires versionSources for package-release/deploy", () => {
    const w = work("onboard", { criteriaCoverage: coverage, releaseContract: { classification: "package-release", signalsChecked: ["package.json"] } }, [readDoc("pkg", "package.json"), write("rel", "docs/release.md")]);
    const result = onboardReleaseContractCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    expect((result as any).reason).toContain("versionSources");
  });

  it("onboard release-contract accepts a single version source (single-source projects no longer dead-loop)", () => {
    // Regression for the smoke finding: a single-source npm package has only package.json,
    // so versionSources >= 2 dead-looped. Now one source is acceptable (versionConsistency still required).
    const w = work("onboard", { criteriaCoverage: coverage, releaseContract: { classification: "package-release", signalsChecked: ["package.json"], versionSources: [{ source: "package.json", version: "1.0.0" }], versionConsistency: "consistent" } }, [readDoc("pkg", "package.json"), write("rel", "docs/release.md")]);
    expect(onboardReleaseContractCheckpoint.check(w).satisfied).toBe(true);
  });

  it("onboard engineering-contract requires AGENTS.md, then git/ui", () => {
    // missing agentsMd declaration
    const noAgents = work("onboard", { criteriaCoverage: coverage, engineeringContract: { git: { summary: "local commits" }, ui: { reason: "no ui" } } }, [write("agents", "AGENTS.md")]);
    expect(onboardEngineeringContractCheckpoint.check(noAgents).satisfied).toBe(false);
    expect((onboardEngineeringContractCheckpoint.check(noAgents) as any).reason).toContain("agentsMd");

    // AGENTS.md declared but not really written
    const noWrite = work("onboard", { criteriaCoverage: coverage, engineeringContract: { agentsMd: {}, git: { summary: "local commits" }, ui: { reason: "no ui" } } }, []);
    expect(onboardEngineeringContractCheckpoint.check(noWrite).satisfied).toBe(false);
    expect((onboardEngineeringContractCheckpoint.check(noWrite) as any).reason).toContain("AGENTS.md");

    // AGENTS.md written but missing ui
    const noUi = work("onboard", { criteriaCoverage: coverage, engineeringContract: { agentsMd: {}, git: { summary: "local commits" } } }, [write("agents", "AGENTS.md")]);
    expect(onboardEngineeringContractCheckpoint.check(noUi).satisfied).toBe(false);
    expect((onboardEngineeringContractCheckpoint.check(noUi) as any).reason).toContain("ui");
  });

  it("onboard engineering-contract routing-table rule files must really be written (no dangling routes)", () => {
    // routing references docs/conventions.md but it was never written -> fail
    const dangling = work("onboard", { criteriaCoverage: coverage, engineeringContract: { agentsMd: {}, routingEntries: [{ triggers: ["写代码"], ruleFiles: ["docs/conventions.md"] }], git: { summary: "local commits" }, ui: { reason: "no ui" } } }, [write("agents", "AGENTS.md")]);
    const danglingResult = onboardEngineeringContractCheckpoint.check(dangling);
    expect(danglingResult.satisfied).toBe(false);
    expect((danglingResult as any).reason).toContain("docs/conventions.md");

    // passes when the referenced rule file is really written too
    const ok = work("onboard", { criteriaCoverage: coverage, engineeringContract: { agentsMd: {}, routingEntries: [{ triggers: ["写代码"], ruleFiles: ["docs/conventions.md"] }], git: { summary: "local commits" }, ui: { reason: "no ui" } } }, [write("agents", "AGENTS.md"), write("conv", "docs/conventions.md")]);
    const okResult = onboardEngineeringContractCheckpoint.check(ok);
    expect(okResult.satisfied).toBe(true);
    expect((okResult as any).details).toContain("1 rule file");
  });

  it("onboard exploration accepts layerCoverage listing a navigation file not in coreLogicFiles (no formal gymnastics)", () => {
    // smoke 20260627-onboard F1: the old layerCoverage⊆coreLogicFiles cross-field check forced
    // the agent to add navigation files (app/main.py) to coreLogicFiles against its own correct
    // classification. The cross-field check was removed; the read-evidence A-type guard stays.
    const emptyCwd = mkdtempSync(join(tmpdir(), "onboard-expl-nav-"));
    const evidence = {
      criteriaCoverage: coverage,
      exploration: {
        coreFilesRead: ["src/core.ts", "src/nav.ts"],
        readStrategy: {
          projectType: "lib",
          navigationFiles: ["src/nav.ts"],
          coreLogicFiles: ["src/core.ts"],
          layerCoverage: [{ layer: "logic+entry", files: ["src/core.ts", "src/nav.ts"], reason: "core logic and its navigation entry" }],
          followedEdges: [{ from: "src/nav.ts", to: "src/core.ts", reason: "nav calls core" }],
        },
        smallProjectReason: "tiny project: 1 core file + 1 nav file, both fully read",
        flowsTraced: ["nav -> core"],
        docTrustAudit: [],
        docTrustAuditNotApplicableReason: "no project docs in cwd",
      },
    };
    const w = work("onboard", evidence, [readDoc("read-core", "src/core.ts"), readDoc("read-nav", "src/nav.ts")], emptyCwd);
    const result = onboardExplorationEvidencedCheckpoint.check(w);
    expect(result.satisfied).toBe(true);
  });

  it("onboard exploration still rejects a coreLogicFile without a real full read (A-type guard intact)", () => {
    // Removing the cross-field check must NOT weaken the read-evidence guard: a declared
    // coreLogicFile that was never fully read must still be rejected.
    const emptyCwd = mkdtempSync(join(tmpdir(), "onboard-expl-noread-"));
    const evidence = {
      criteriaCoverage: coverage,
      exploration: {
        coreFilesRead: ["src/core.ts", "src/nav.ts"],
        readStrategy: {
          projectType: "lib",
          navigationFiles: ["src/nav.ts"],
          coreLogicFiles: ["src/core.ts"],
          layerCoverage: [{ layer: "logic", files: ["src/core.ts"], reason: "core logic" }],
          followedEdges: [{ from: "src/nav.ts", to: "src/core.ts", reason: "nav calls core" }],
        },
        smallProjectReason: "tiny project",
        flowsTraced: ["nav -> core"],
        docTrustAudit: [],
        docTrustAuditNotApplicableReason: "no project docs in cwd",
      },
    };
    // Only nav.ts is read; src/core.ts (a declared coreLogicFile) has no read evidence.
    const w = work("onboard", evidence, [readDoc("read-nav", "src/nav.ts")], emptyCwd);
    const result = onboardExplorationEvidencedCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    expect((result as any).reason).toContain("src/core.ts");
  });

  it("verification-command-passed ignores read/write-only commands in suspected diagnostics", () => {
    const w = work("develop", { verification: { summary: "checked manually" } }, [
      bash("grep-version", "grep -n 'version' src-tauri/", false, "version check"),
      bash("echo-write", "echo \"test\" > src/test.ts", false, "wrote test"),
    ]);
    const result = verificationCommandPassedCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    const reason = (result as any).reason;
    expect(reason).not.toContain("grep -n");
    expect(reason).not.toContain("echo \"test\" >");
    expect(reason.length).toBeLessThan(700);
  });

  it("verification-command-passed no-test bypass accepts a substantive ad-hoc check", () => {
    const w = work("develop", { verification: { noTestSuite: true, noTestSuiteReason: "project has no test runner" } }, [
      bash("import-check", "python -c \"import requests\""),
    ]);
    const result = verificationCommandPassedCheckpoint.check(w);
    expect(result.satisfied).toBe(true);
  });

  it("verification-command-passed no-test bypass rejects no-op commands", () => {
    const w = work("develop", { verification: { noTestSuite: true, noTestSuiteReason: "no runner" } }, [
      bash("noop", "node -e \"1\""),
    ]);
    const result = verificationCommandPassedCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    expect((result as any).reason).toContain("noTestSuite");
  });

  it("verification-command-passed no-test bypass requires a reason", () => {
    const w = work("develop", { verification: { noTestSuite: true } }, [bash("x", "echo hi")]);
    const result = verificationCommandPassedCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    expect((result as any).reason).toContain("noTestSuiteReason");
  });

  it("test-assets-passed-if-written noTestSuite accommodation avoids deadlock (Bug 3)", () => {
    // Reproduces the F6 deadlock: agent writes a throwaway test file in a no-runner project,
    // runs it via bare `python3 test_add.py`. Before the fix, test-assets demanded a recognized
    // runner (pytest) -> permanent deadlock. Now, with noTestSuite=true, the shared substantive-
    // check standard applies, and bare <lang> <testfile> is recognized as test execution.
    const w = work("develop", {
      verification: { noTestSuite: true, noTestSuiteReason: "no runner in this project" },
    }, [
      write("write-test", "test_add.py"),
      bash("run-test", "python3 test_add.py"),
    ]);
    const result = testAssetsPassedIfWrittenCheckpoint.check(w);
    expect(result.satisfied).toBe(true);
  });

  it("review-read-only rejects write/edit tools (unchanged behavior)", () => {
    const w = work("review" as PracticeId, { reviewScope: { targets: ["src/app.ts"], basis: "file" } }, [write("w", "src/app.ts")]);
    const result = reviewReadOnlyCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
    expect((result as any).reason).toContain("tool-write");
  });

  it("review-read-only rejects bash mutations (sed -i / echo > / rm / npm install / git checkout)", () => {
    for (const [label, command, expectedKind] of [
      ["sed -i", "sed -i 's/a/b/' src/app.ts", "sed-in-place"],
      ["redirect", "echo x > out.txt", "redirect-write"],
      ["rm", "rm src/old.ts", "delete"],
      ["npm install", "npm install lodash", "dependency-mutation"],
      ["git checkout", "git checkout feature", "git-mutation"],
    ] as const) {
      const w = work("review" as PracticeId, { reviewScope: { targets: ["src/app.ts"], basis: "file" } }, [bash(label, command)]);
      const result = reviewReadOnlyCheckpoint.check(w);
      expect(result.satisfied, label).toBe(false);
      expect((result as any).reason, label).toContain(expectedKind);
    }
  });

  it("review-read-only allows read-only git commands review needs (git status/diff/show/log)", () => {
    for (const command of ["git status --short", "git diff", "git diff --cached", "git show HEAD", "git log -1", "git show abc1234"]) {
      const w = work("review" as PracticeId, { reviewScope: { targets: ["HEAD"], basis: "last-commit", targetType: "last-commit" } }, [bash("g", command)]);
      const result = reviewReadOnlyCheckpoint.check(w);
      expect(result.satisfied, command).toBe(true);
    }
  });

  it("review-scope-evidenced accepts ls/find for a directory target (trailing /)", () => {
    for (const command of ["ls src/", "find src -type f", "rg --files src/"]) {
      const w = work("review" as PracticeId, { reviewScope: { targets: ["src/"], basis: "dir review", targetType: "dirs" } }, [bash("d", command)]);
      const result = reviewScopeEvidencedCheckpoint.check(w);
      expect(result.satisfied, command).toBe(true);
    }
  });

  it("review-scope-evidenced rejects ls for a file target (ls a file is not reading content)", () => {
    const w = work("review" as PracticeId, { reviewScope: { targets: ["src/app.ts"], basis: "file review", targetType: "files" } }, [bash("l", "ls src/app.ts")]);
    const result = reviewScopeEvidencedCheckpoint.check(w);
    expect(result.satisfied).toBe(false);
  });
});
