import type { Checkpoint, CapturedToolResult } from "../../core/types";
import { changeFinalizationRecordedCheckpoint } from "./change";
import { notSatisfied, satisfied } from "./common";
import { detectProjectMutationTargets } from "../mutation-targets";
import { cleanVerificationResult, commandSegments, extractToolPath, findSuccessfulCleanTestExecution, isBrowserEvidenceResult, isTestExecutionCommand, isWriteLike, objectAt, pathAllowedForTest, pathLooksLikeTestAsset, stringAt, stringList } from "../helpers";
import { findRetainedTestAssetPaths, findTestAssetWrites } from "../test-asset-mutations";
import { isAllowedTestFinalizationGitCommand } from "../test-git-finalization";

export const testVerdictRecordedCheckpoint: Checkpoint = {
  id: "test-verdict-recorded",
  rule: "test practice must record real run evidence and a verdict; PASS requires a successful run, FAIL/FLAKE may use a failed run as evidence, and BLOCKED requires a real failed attempt + alternative/degraded evidence.",
  check(work) {
    const verdict = objectAt(work.completionEvidence?.verdict);
    if (!verdict) return notSatisfied("missing completionEvidence.verdict");
    const outcome = stringAt(verdict.outcome).toLowerCase();
    if (!stringAt(verdict.summary)) return notSatisfied("verdict.summary must not be empty");
    if (!["pass", "fail", "flake", "blocked"].includes(outcome)) return notSatisfied("verdict.outcome must be pass / fail / flake / blocked");

    if (outcome === "blocked") return requireBlockedVerdict(work, verdict);

    const run = findRunEvidence(work, outcome as "pass" | "fail" | "flake");
    if (!run) {
      return notSatisfied(`no real run evidence found for outcome=${outcome}. PASS requires a successful bash/browser/API/CLI run; FAIL/FLAKE requires failed/flaky run evidence, not just verdict text.`);
    }
    return satisfied(`recorded test verdict=${outcome} and found real run evidence`, [{ toolCallId: run.toolCallId }]);
  },
};

export const testProductReadonlyCheckpoint: Checkpoint = {
  id: "test-product-readonly",
  rule: "test practice may only write test assets or .cynos/ scratch; it must not modify product src/runtime config/package/CI/docs/report files.",
  check(work) {
    const violations: string[] = [];
    for (const result of work.capturedToolResults ?? []) {
      if (result.isError) continue;
      for (const target of mutationTargetsForResult(work.cwd, result)) {
        if (target.kind === "git-mutation" && work.cwd && isAllowedTestFinalizationGitCommand(String(result.input.command ?? ""), work.cwd, work)) continue;
        if (pathAllowedForTest(target.path, work.cwd)) continue;
        violations.push(`${target.path} (${target.kind})`);
      }
    }
    if (violations.length > 0) {
      return notSatisfied(`test practice found out-of-scope project writes: ${violations.slice(0, 10).join(", ")}. Found a bug -> report only; fixing product code/config/docs must be separate develop/debug/docs work.`);
    }
    return satisfied("test practice found no out-of-scope product/docs/config writes; only test assets/.cynos scratch allowed");
  },
};

export const testAssetsExecutedIfWrittenCheckpoint: Checkpoint = {
  id: "test-assets-executed-if-written",
  rule: "If test practice writes test assets, it must actually run the test command or browser verification; success/failure is explained by the test verdict.",
  check(work) {
    const writes = findTestAssetWrites(work);
    if (writes.length === 0) return satisfied("no test assets written");
    const lastWriteIndex = Math.max(...writes.map((write) => write.index));
    const evidence = findTestAssetExecutionAfter(work, lastWriteIndex);
    if (!evidence) return notSatisfied(`test assets were written but no later test command/browser verification was run: ${writes.map((item) => item.path).filter(Boolean).join(", ")}`);
    return satisfied("tests were run after test assets were written", [{ toolCallId: evidence.toolCallId }]);
  },
};

export const testFinalizationIfAssetsWrittenCheckpoint: Checkpoint = {
  id: "test-finalization-if-assets-written",
  rule: "test practice requires git status and a local commit decision only when durable test assets are retained; pure runs/deleted temporary tests skip this.",
  check(work) {
    if (!hasRetainedTestAsset(work)) return satisfied("no retained test assets found; skipping test finalization ceremony");
    const delegated = changeFinalizationRecordedCheckpoint.check(work);
    if (!delegated.satisfied) return notSatisfied(`retained test assets require finalization: ${delegated.reason}`);
    return satisfied(`retained test assets; finalization complete: ${delegated.details ?? "ok"}`, delegated.refs);
  },
};

function requireBlockedVerdict(work: Parameters<Checkpoint["check"]>[0], verdict: Record<string, unknown>) {
  if (!stringAt(verdict.blockedReason)) return notSatisfied("when verdict.outcome=blocked, verdict.blockedReason must be filled");
  if (stringList(verdict.attemptedApproaches).length === 0) return notSatisfied("when verdict.outcome=blocked, attemptedApproaches[] must be filled, with at least one real failed attempt");
  if (!stringAt(verdict.alternativeVerification) && !stringAt(verdict.degradedEvidence)) return notSatisfied("when verdict.outcome=blocked, alternativeVerification or degradedEvidence must be filled");
  const failed = findBlockedAttemptEvidence(work);
  if (!failed) return notSatisfied("verdict.outcome=blocked requires at least one real captured failed attempt (failed bash or errored browser/API attempt), not just blockedReason/attemptedApproaches text");
  return satisfied("blocked verdict and real failed-attempt evidence recorded", [{ toolCallId: failed.toolCallId }]);
}

function findRunEvidence(work: Parameters<Checkpoint["check"]>[0], outcome: "pass" | "fail" | "flake"): CapturedToolResult | undefined {
  if (outcome === "pass") return findSuccessfulTestLikeRun(work);
  if (outcome === "fail") return findFailedTestLikeRun(work);
  return findFlakyTestLikeRun(work);
}

function findFailedTestLikeRun(work: Parameters<Checkpoint["check"]>[0]): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find((result) => isRunnableEvidence(result) && result.isError)
    ?? (work.capturedToolResults ?? []).find((result) => isRunnableEvidence(result) && outputLooksFailed(result.outputSummary ?? ""));
}

function findFlakyTestLikeRun(work: Parameters<Checkpoint["check"]>[0]): CapturedToolResult | undefined {
  const runnable = (work.capturedToolResults ?? []).filter(isRunnableEvidence);
  const explicitFlake = runnable.find((result) => outputLooksFlaky(result.outputSummary ?? ""));
  if (explicitFlake) return explicitFlake;
  const failed = runnable.find((result) => result.isError || outputLooksFailed(result.outputSummary ?? ""));
  const passed = runnable.find((result) => !result.isError && (result.toolName !== "bash" || cleanVerificationResult(result).ok));
  return failed && passed ? failed : undefined;
}

function findSuccessfulTestLikeRun(work: Parameters<Checkpoint["check"]>[0]): CapturedToolResult | undefined {
  return findSuccessfulCleanTestExecution(work) ?? (work.capturedToolResults ?? []).find((result) => {
    if (!isRunnableEvidence(result) || result.isError) return false;
    return result.toolName !== "bash" || cleanVerificationResult(result).ok;
  });
}

function findBlockedAttemptEvidence(work: Parameters<Checkpoint["check"]>[0]): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find((result) => isRunnableEvidence(result) && result.isError);
}

function isRunnableEvidence(result: CapturedToolResult): boolean {
  if (isBrowserEvidenceResult(result)) return true;
  if (result.toolName !== "bash") return false;
  const command = String(result.input.command ?? "");
  if (!command.trim()) return false;
  if (isTestExecutionCommand(command)) return true;
  if (isReadOnlyBash(command) || isAdministrativeBash(command)) return false;
  return isSubstantiveProbeCommand(command);
}

function outputLooksFailed(output: string): boolean {
  return /\b(FAIL|FAILED|AssertionError|Command failed)\b/i.test(output)
    || /Traceback \(most recent call last\)/m.test(output)
    || /^Error:\s/m.test(output)
    || /\b[A-Z_]*EXIT[:_\s]+[1-9]\d*|exit\s+code[:\s]+[1-9]\d*/i.test(output);
}

function outputLooksFlaky(output: string): boolean {
  if (/\b(no|not|without)\s+(flaky|flake|intermittent|nondeterministic|non-deterministic)\b/i.test(output)) return false;
  return /\b(flaky|flake|intermittent|nondeterministic|non-deterministic|sometimes fails)\b/i.test(output);
}

function findTestAssetExecutionAfter(work: Parameters<Checkpoint["check"]>[0], afterIndex: number): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find((result, index) => index > afterIndex && isTestAssetExecutionEvidence(result));
}

function isTestAssetExecutionEvidence(result: CapturedToolResult): boolean {
  if (isBrowserEvidenceResult(result)) return true;
  if (result.toolName !== "bash") return false;
  return isTestExecutionCommand(String(result.input.command ?? ""));
}

function isReadOnlyBash(command: string): boolean {
  const first = firstCommandSegment(command);
  return /^(cat|grep|rg|sed|awk|head|tail|less|more|bat|ls|find|git\s+(status|diff|log|show|rev-parse|ls-files|grep)\b)\b/.test(first);
}

function isAdministrativeBash(command: string): boolean {
  const first = firstCommandSegment(command);
  return /^(echo|printf|pwd|true|false|sleep|mkdir|touch|rm|rmdir|cp|mv|tee|git\s+(add|commit|checkout|switch|merge|rebase|reset|stash|tag|push|pull|fetch)\b)\b/.test(first);
}

function isSubstantiveProbeCommand(command: string): boolean {
  return commandSegments(command).some((segment) => {
    if (/^(curl|wget|http|httpie)\b/.test(segment)) return true;
    if (/^(node|python3?|ruby|php|lua)\s+\S+/.test(segment) && !/\s+-[ce]\b/.test(segment)) return true;
    if (/^go\s+run\b/.test(segment)) return true;
    if (/^cargo\s+run\b/.test(segment)) return true;
    if (/^dotnet\s+run\b/.test(segment)) return true;
    if (/^(npm|pnpm|yarn|bun)\s+(start|run\s+(start|dev|serve|smoke|check|validate|verify))\b/.test(segment)) return true;
    if (/^(psql|sqlite3|mysql|redis-cli)\b/.test(segment)) return true;
    return false;
  });
}

function firstCommandSegment(command: string): string {
  return commandSegments(command).find((segment) => !/^cd\b/.test(segment)) ?? "";
}

function mutationTargetsForResult(cwd: string | undefined, result: CapturedToolResult) {
  if (!cwd) {
    if (isWriteLike(result)) {
      const p = extractToolPath(result);
      return p ? [{ path: p, kind: result.toolName === "write" ? "tool-write" as const : "tool-edit" as const }] : [];
    }
    return [];
  }
  return detectProjectMutationTargets(cwd, result.toolName, result.input);
}


function hasRetainedTestAsset(work: Parameters<Checkpoint["check"]>[0]): boolean {
  const declared = [
    ...stringList(objectAt(work.completionEvidence?.assets)?.retained),
    ...stringList(work.completionEvidence?.retainedTestAssets),
  ].some((path) => pathLooksLikeTestAsset(path));
  if (declared) return true;

  if (findRetainedTestAssetPaths(work).length > 0) return true;

  return (work.capturedToolResults ?? []).some((result) => {
    if (result.toolName !== "bash" || result.isError) return false;
    const command = String(result.input.command ?? "");
    if (!/git\s+status\b/.test(command)) return false;
    return statusOutputMentionsRetainedTestAsset(result.outputSummary);
  });
}

function statusOutputMentionsRetainedTestAsset(output: string): boolean {
  return output.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!/^(\?\?|[ MADRCU?!]{1,2})\s+/.test(trimmed)) return false;
    const path = trimmed.replace(/^(\?\?|[ MADRCU?!]{1,2})\s+/, "").replace(/^"|"$/g, "");
    return pathLooksLikeTestAsset(path);
  });
}

