import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { CapturedToolResult, Checkpoint } from "../../core/types";
import { findMutationEvidenceForPath, listProjectMutationTargets, type ProjectMutationEvidence } from "../mutation-targets";
import { arrayAt, capturedResultIndex, classifyReleaseSideEffectCommand, commandSegments, findReadEvidenceForPath, isGitCommitCommand, isGitStatusCommand, isReleaseSideEffectCommand, isTestOrVerificationCommand, objectAt, pathLooksLikeReleaseOwned, stringAt, stringList, toProjectRelativePath, type ReleaseOperation } from "../helpers";
import { satisfied, notSatisfied } from "./common";

const allowedModes = new Set(["execute", "maintain"]);
const allowedOperations = new Set(["verify-only", "push", "tag", "npm-publish", "deploy", "github-release", "ci-trigger"]);
const sideEffectOperations = new Set(["push", "tag", "npm-publish", "deploy", "github-release", "ci-trigger"]);
const highRiskOperations = new Set(["npm-publish", "deploy", "github-release", "ci-trigger"]);

export const releaseGuideReadCheckpoint: Checkpoint = {
  id: "release-guide-read",
  rule: "release must really read docs/release.md; if missing, it must factually record missing/unknown, not fabricate a process.",
  check(work) {
    const release = objectAt(work.completionEvidence?.release);
    if (!release) return notSatisfied("missing completionEvidence.release");
    const guide = objectAt(release.guide);
    const cwd = work.cwd ?? process.cwd();
    if (existsSync(resolve(cwd, "docs/release.md"))) {
      const evidence = findReadEvidenceForPath(work, "docs/release.md");
      if (!evidence) return notSatisfied("docs/release.md exists, but there is no real read evidence");
    } else if (!stringAt(guide?.missingReason) && !stringAt(release.releaseGuideMissingReason)) {
      return notSatisfied("when docs/release.md does not exist, release.guide.missingReason is required to explain the absence and record user/project facts");
    }

    const filesRead = stringList(guide?.filesRead);
    for (const file of filesRead) {
      if (!findReadEvidenceForPath(work, file)) return notSatisfied(`release.guide.filesRead[] lists ${file}, but there is no real read evidence for that file`);
    }

    return satisfied(existsSync(resolve(cwd, "docs/release.md")) ? "docs/release.md read" : "docs/release.md missing recorded factually");
  },
};

export const releaseAuthorizationRecordedCheckpoint: Checkpoint = {
  id: "release-authorization-recorded",
  rule: "release must record mode and a structured authorization scope: branch, whether to include uncommitted code, operations, targets/version/dryRun; high-risk releases must have real user confirmation.",
  check(work) {
    const release = objectAt(work.completionEvidence?.release);
    if (!release) return notSatisfied("missing completionEvidence.release");
    const mode = stringAt(release.mode);
    if (!allowedModes.has(mode)) return notSatisfied("release.mode must be execute|maintain");

    const authorization = objectAt(release.authorization);
    if (!authorization) return notSatisfied("missing release.authorization");
    if (!stringAt(authorization.summary)) return notSatisfied("release.authorization.summary must not be empty");
    if (!stringAt(authorization.branch)) return notSatisfied("release.authorization.branch must not be empty");
    if (typeof authorization.includeUncommitted !== "boolean") return notSatisfied("release.authorization.includeUncommitted must be explicitly a boolean");

    const operations = releaseOperations(authorization.operations);
    if (operations.length === 0) return notSatisfied("release.authorization.operations[] must not be empty");
    const invalid = operations.filter((operation) => !allowedOperations.has(operation));
    if (invalid.length > 0) return notSatisfied(`release.authorization.operations contains unknown operations (allowed: verify-only|push|tag|npm-publish|deploy|github-release|ci-trigger): ${invalid.join(", ")}`);

    if (mode === "maintain" && operations.some((operation) => sideEffectOperations.has(operation))) {
      return notSatisfied("release.mode=maintain is for editing release-system files only; use operations=['verify-only'] and do not authorize push/tag/publish/deploy/CI side effects. If release execution is needed, finish maintain first and start a fresh mode=execute work.");
    }

    const highRisk = operations.filter((operation) => highRiskOperations.has(operation));
    if (highRisk.length > 0) {
      if (stringList(authorization.highRiskConfirmed).length === 0) return notSatisfied(`high-risk release operations require authorization.highRiskConfirmed[]: ${highRisk.join(", ")}`);
      if ((work.capturedUserAnswers ?? []).length === 0) return notSatisfied(`high-risk release operations require real capturedUserAnswers confirmation: ${highRisk.join(", ")}`);
    }

    const targetWarning = operations.some((operation) => highRiskOperations.has(operation)) && stringList(authorization.targets).length === 0
      ? "; reminder: for high-risk releases, recording authorization.targets[] is recommended"
      : "";
    return satisfied(`release authorization recorded, mode=${mode}, operations=${operations.join(", ")}${targetWarning}`);
  },
};

export const releaseDeliveryConfigRecordedCheckpoint: Checkpoint = {
  id: "release-delivery-config-recorded",
  rule: "release maintain work may edit only release-system files, must prove those mutations, must read the grounding release signals, and must not execute release delivery side effects.",
  check(work) {
    const release = objectAt(work.completionEvidence?.release);
    if (!release) return notSatisfied("missing completionEvidence.release");
    const mode = stringAt(release.mode);
    const deliveryConfig = objectAt(release.deliveryConfig);
    const mutations = releaseRelevantMutations(work);
    const releaseOwnedMutations = mutations.filter((mutation) => pathLooksLikeReleaseOwned(toProjectRelativePath(mutation.path, work.cwd)));
    const shouldCheck = mode === "maintain" || Boolean(deliveryConfig) || releaseOwnedMutations.length > 0;
    if (!shouldCheck) return satisfied("no release-system maintenance changes declared or detected");

    if (mode === "maintain" && releaseSideEffectCommands(work, false).length + releaseSideEffectCommands(work, true).length > 0) {
      return notSatisfied("release.mode=maintain must not execute release delivery side effects. Maintaining release files is not authorization to release; finish this maintain work, then start a fresh mode=execute work if publishing/deploying is needed.");
    }

    if (!deliveryConfig) return notSatisfied("release.deliveryConfig is required for release-system maintenance changes");
    if (!stringAt(deliveryConfig.summary)) return notSatisfied("release.deliveryConfig.summary must not be empty");

    const filesChanged = stringList(deliveryConfig.filesChanged);
    if (mode === "maintain" && filesChanged.length === 0) return notSatisfied("release.deliveryConfig.filesChanged[] must list the release-owned files changed in maintain mode");
    for (const file of filesChanged) {
      const normalized = toProjectRelativePath(file, work.cwd);
      if (!pathLooksLikeReleaseOwned(normalized)) return notSatisfied(`release.deliveryConfig.filesChanged[] may list only release-owned files; ${file} is not release-owned. package.json/src/tests/ordinary CI/build/runtime files belong to develop/docs/debug or a split work.`);
      const mutation = findMutationEvidenceForPath(work, normalized, { allowBroadGitMutation: false });
      if (!mutation) return notSatisfied(`release.deliveryConfig.filesChanged[] lists ${file}, but there is no real write/edit/bash mutation evidence for that path`);
    }

    const signalsRead = stringList(deliveryConfig.signalsRead);
    if (signalsRead.length === 0) return notSatisfied("release.deliveryConfig.signalsRead[] must list the release docs/workflows/scripts/package signals actually read");
    for (const file of signalsRead) {
      if (!findReadEvidenceForPath(work, file)) return notSatisfied(`release.deliveryConfig.signalsRead[] lists ${file}, but there is no real read evidence for that file/signal`);
    }

    if (mode === "maintain") {
      const nonReleaseOwned = mutations.filter((mutation) => !pathLooksLikeReleaseOwned(toProjectRelativePath(mutation.path, work.cwd)));
      if (nonReleaseOwned.length > 0) {
        return notSatisfied(`release.mode=maintain changed non-release-owned files: ${nonReleaseOwned.map((mutation) => mutation.path).join(", ")}. Use develop/docs/debug/another practice, or split the work. Authorized release execute scripts may mutate version/lockfile/changelog, but maintain mode may not.`);
      }
    }

    const changedReleaseSubdocs = filesChanged.some((file) => /^docs\/release\//.test(toProjectRelativePath(file, work.cwd)));
    if (changedReleaseSubdocs && !findReadEvidenceForPath(work, "docs/release.md") && !findMutationEvidenceForPath(work, "docs/release.md")) {
      return notSatisfied("docs/release/** changed, but docs/release.md was not read or updated as the stable release entrypoint/index");
    }

    return satisfied(`release delivery config recorded, filesChanged=${filesChanged.join(", ") || "none"}`);
  },
};

export const releaseVerificationRecordedCheckpoint: Checkpoint = {
  id: "release-verification-recorded",
  rule: "release must run real release-relevant verification, and execute-mode verification must precede release side effects.",
  check(work) {
    const release = objectAt(work.completionEvidence?.release);
    if (!release) return notSatisfied("missing completionEvidence.release");
    const mode = stringAt(release.mode);
    const verification = objectAt(work.completionEvidence?.verification);
    if (!stringAt(verification?.summary)) return notSatisfied("verification.summary must record the release preflight/maintenance verification performed");

    const firstSideEffect = firstReleaseSideEffect(work);
    const verificationResults = releaseVerificationCommands(work, { allowExistenceChecks: mode === "maintain", allowGitReleaseStateChecks: Boolean(firstSideEffect) });
    if (verificationResults.length === 0) {
      return notSatisfied("no real release-relevant verification command found. Run a captured check such as runbook/project preflight, npm run verify, npm pack --dry-run, npm publish --dry-run, actionlint/YAML check, node --check for release scripts, git diff --check for release docs, or maintain-mode referenced-file existence checks. Execute-mode side effects need substantive preflight; a bare test -f docs/release.md is not enough.");
    }

    if (mode === "execute" && firstSideEffect) {
      const firstSideEffectIndex = capturedResultIndex(work, firstSideEffect);
      const before = verificationResults.find((result) => capturedResultIndex(work, result) < firstSideEffectIndex);
      if (!before) return notSatisfied("release preflight verification must run before the first release side effect; later verification cannot prove the release was safe before execution. Abandon/restart or ask the user how to handle already-executed side effects.");
      const authorized = releaseOperations(objectAt(release.authorization)?.operations);
      if (!hasSubstantiveExecutePreflightBefore(work, firstSideEffectIndex, authorized)) {
        return notSatisfied("release execute preflight before side effects must be substantive: run the project/runbook verification or dry-run, or for tag/push-only releases check git status plus remote and tag/head/branch state. A bare file-existence check such as test -f docs/release.md is not enough.");
      }
    }

    if (mode === "maintain") {
      const releaseOwnedMutations = releaseRelevantMutations(work).filter((mutation) => pathLooksLikeReleaseOwned(toProjectRelativePath(mutation.path, work.cwd)));
      const lastMutationIndex = maxCapturedIndex(releaseOwnedMutations.map((mutation) => mutation.toolResult), work);
      if (lastMutationIndex >= 0 && !verificationResults.some((result) => capturedResultIndex(work, result) > lastMutationIndex)) {
        return notSatisfied("release maintain verification must run after the release-system file mutation; pre-edit verification does not prove the changed runbook/workflow/script is valid");
      }
    }

    const refs = verificationResults.slice(0, 3).map((result) => ({ toolCallId: result.toolCallId }));
    return satisfied(`release verification recorded, commands=${verificationResults.length}`, refs);
  },
};

export const releaseExecutionRecordedCheckpoint: Checkpoint = {
  id: "release-execution-recorded",
  rule: "release must record execution evidence, authorization boundaries, failure status, post-release validation, and rollback; it must not publish out of scope or disguise failures as success.",
  check(work) {
    const release = objectAt(work.completionEvidence?.release);
    if (!release) return notSatisfied("missing completionEvidence.release");
    const mode = stringAt(release.mode);
    const authorization = objectAt(release.authorization);
    const execution = objectAt(release.execution);
    if (!authorization) return notSatisfied("missing release.authorization");
    if (!execution) return notSatisfied("missing release.execution");
    if (!stringAt(execution.summary)) return notSatisfied("release.execution.summary must not be empty");

    const authorized = new Set(releaseOperations(authorization.operations));
    const steps = arrayAt(execution.stepsPerformed).map((item) => objectAt(item)).filter(Boolean) as Record<string, unknown>[];
    if (steps.length === 0 && !stringAt(execution.releaseNotPerformedReason) && !stringAt(release.releaseNotPerformedReason)) return notSatisfied("release.execution.stepsPerformed[] must not be empty; if no release was performed, fill release.execution.releaseNotPerformedReason");

    const successfulSideEffects = releaseSideEffectCommands(work, false);
    const failedSideEffects = releaseSideEffectCommands(work, true);
    const allSideEffects = [...successfulSideEffects, ...failedSideEffects];
    const executedOperations = uniqueOperations(successfulSideEffects.flatMap((result) => classifyReleaseSideEffectCommand(String(result.input.command ?? ""))));
    const attemptedOperations = uniqueOperations(allSideEffects.flatMap((result) => classifyReleaseSideEffectCommand(String(result.input.command ?? ""))));

    if (mode === "maintain" && allSideEffects.length > 0) {
      return notSatisfied("release.mode=maintain must not execute release delivery side effects; split into maintain first, then a fresh mode=execute release work.");
    }

    const opaque = opaqueReleaseExecutionCommands(work);
    if (opaque.length > 0) {
      return notSatisfied(`opaque release script command cannot be accepted as release execution evidence: ${String(opaque[0].input.command ?? "")}. Decompose into classifier-recognized push/tag/publish/deploy commands, run a documented dry-run, or add a conservative classifier/test first.`);
    }

    if ((authorization.dryRun === true || (authorized.size === 1 && authorized.has("verify-only"))) && allSideEffects.length > 0) {
      return notSatisfied("when authorization.dryRun=true or operations=verify-only, no release side-effect commands may be attempted, even if they fail");
    }

    const unauthorized = attemptedOperations.filter((operation) => !authorized.has(operation));
    if (unauthorized.length > 0) return notSatisfied(`attempted unauthorized release operations: ${unauthorized.join(", ")}`);

    const firstSideEffect = firstReleaseSideEffect(work);
    if (firstSideEffect) {
      const firstSideEffectIndex = capturedResultIndex(work, firstSideEffect);
      const guideOrSignalRead = releaseGuideOrSignalReads(work, release).find((result) => capturedResultIndex(work, result) < firstSideEffectIndex);
      if (!guideOrSignalRead) return notSatisfied("release must read docs/release.md or real release signals before the first side effect; later reads cannot repair this ordering. Abandon/restart or ask the user how to handle already-executed side effects.");
      const preflight = releaseVerificationCommands(work, { allowExistenceChecks: false, allowGitReleaseStateChecks: true }).find((result) => capturedResultIndex(work, result) < firstSideEffectIndex);
      if (!preflight) return notSatisfied("release preflight verification must happen before the first side effect; later verification cannot repair this ordering. Abandon/restart or ask the user how to handle already-executed side effects.");
      if (!hasSubstantiveExecutePreflightBefore(work, firstSideEffectIndex, releaseOperations(authorization.operations))) {
        return notSatisfied("release execute preflight before side effects must be substantive: run the project/runbook verification or dry-run, or for tag/push-only releases check git status plus remote and tag/head/branch state. A bare file-existence check such as test -f docs/release.md is not enough.");
      }
      const highRiskAuthorized = releaseOperations(authorization.operations).some((operation) => highRiskOperations.has(operation));
      if (highRiskAuthorized && !userAnswerBefore(work, firstSideEffect)) {
        return notSatisfied("high-risk release confirmation must be captured before the first release side-effect attempt; later approval cannot authorize an already-executed publish/deploy/release. Abandon/restart or ask the user how to handle already-executed side effects.");
      }
    }

    for (const step of steps) {
      const operation = stringAt(step.operation);
      const result = stringAt(step.result);
      if (!operation || !allowedOperations.has(operation)) return notSatisfied("execution.stepsPerformed[].operation must be an allowed release operation");
      if (!["succeeded", "failed", "skipped"].includes(result)) return notSatisfied("execution.stepsPerformed[].result must be succeeded / failed / skipped");
      if (result === "succeeded" && sideEffectOperations.has(operation) && !successfulSideEffects.some((command) => classifyReleaseSideEffectCommand(String(command.input.command ?? "")).includes(operation as ReleaseOperation))) {
        return notSatisfied(`execution step claims ${operation} succeeded, but there is no matching real successful release side-effect command`);
      }
    }

    if (successfulSideEffects.length === 0 && failedSideEffects.length === 0 && !stringAt(execution.releaseNotPerformedReason) && !stringAt(release.releaseNotPerformedReason)) {
      return notSatisfied("no real release side-effect commands found; if no release was performed this time, fill release.execution.releaseNotPerformedReason");
    }

    const failedSteps = steps.filter((step) => stringAt(step.result) === "failed");
    if (failedSideEffects.length > 0 || failedSteps.length > 0) {
      const failureText = `${stringAt(execution.summary)} ${stringList(execution.failuresOrSkipped).join(" ")}`;
      if (!/fail|failed|失败|blocked|阻塞|error|错误|拒绝/i.test(failureText)) return notSatisfied("when release has failed steps/commands, execution.summary or failuresOrSkipped[] must clearly indicate failure, not disguise it as success");
    }

    const postValidation = arrayAt(execution.postValidation).map((item) => objectAt(item)).filter(Boolean) as Record<string, unknown>[];
    for (const operation of authorized) {
      if (operation === "verify-only") continue;
      const expectedKinds = postValidationKinds(operation);
      if (!postValidation.some((item) => expectedKinds.includes(stringAt(item.kind)))) {
        return notSatisfied(`release.execution.postValidation missing validation for ${operation} (needs ${expectedKinds.join(" or ")})`);
      }
    }
    for (const item of postValidation) {
      const result = stringAt(item.result);
      if (!["passed", "failed", "blocked", "skipped"].includes(result)) return notSatisfied("postValidation[].result must be passed / failed / blocked / skipped");
      if (["passed", "failed"].includes(result) && !stringAt(item.evidence)) return notSatisfied("postValidation passed/failed items need evidence");
      if (["blocked", "skipped"].includes(result) && !stringAt(item.reason) && !stringAt(item.evidence)) return notSatisfied("postValidation blocked/skipped items need a reason or evidence");
    }

    if (!stringAt(execution.rollback)) return notSatisfied("release.execution.rollback must not be empty");

    const refs = [...successfulSideEffects, ...failedSideEffects].slice(0, 5).map((result) => ({ toolCallId: result.toolCallId }));
    return satisfied(`release execution recorded, side-effect attempts=${allSideEffects.length}, operations=${attemptedOperations.join(", ") || "none"}`, refs);
  },
};

export const releaseFinalStateRecordedCheckpoint: Checkpoint = {
  id: "release-final-state-recorded",
  rule: "release must record final git/local-change state and side-effect state without forcing generic commit ceremony for pure release execution.",
  check(work) {
    const release = objectAt(work.completionEvidence?.release);
    if (!release) return notSatisfied("missing completionEvidence.release");
    const mode = stringAt(release.mode);
    const finalState = objectAt(release.finalState);
    if (!finalState) return notSatisfied("missing release.finalState");
    if (!stringAt(finalState.summary)) return notSatisfied("release.finalState.summary must not be empty");

    const gitSummary = stringAt(finalState.gitStatusSummary);
    const localChanges = stringAt(finalState.localChanges);
    if (!["none", "committed", "not-committed", "commit-failed"].includes(localChanges)) return notSatisfied("release.finalState.localChanges must be none|committed|not-committed|commit-failed");

    const localMutations = localFileMutations(work);
    const sideEffects = [...releaseSideEffectCommands(work, false), ...releaseSideEffectCommands(work, true)];
    const lastLocalMutationIndex = maxCapturedIndex(localMutations.map((mutation) => mutation.toolResult), work);
    const lastSideEffectIndex = maxCapturedIndex(sideEffects, work);
    let requiredStatusAfter = Math.max(lastLocalMutationIndex, lastSideEffectIndex);

    if (localMutations.length > 0 && localChanges === "none") {
      return notSatisfied("release.finalState.localChanges=none is invalid because local file mutations were captured; record committed, not-committed, or commit-failed");
    }

    let commitRef: CapturedToolResult | undefined;
    if (localChanges === "committed") {
      commitRef = findSuccessfulGitCommit(work);
      if (!commitRef) return notSatisfied("release.finalState.localChanges=committed but no real successful git commit bash result found");
      requiredStatusAfter = Math.max(requiredStatusAfter, capturedResultIndex(work, commitRef));
    }

    if (localChanges === "commit-failed") {
      if (!stringAt(finalState.localChangeReason)) return notSatisfied("release.finalState.localChangeReason is required when localChanges=commit-failed");
      commitRef = findFailedGitCommit(work);
      if (!commitRef) return notSatisfied("release.finalState.localChanges=commit-failed but no real failed git commit bash result found");
      requiredStatusAfter = Math.max(requiredStatusAfter, capturedResultIndex(work, commitRef));
    }

    if (localChanges === "not-committed") {
      const localEditsRequireCommitDecision = mode === "maintain" || localMutations.length > 0;
      if (localEditsRequireCommitDecision) {
        const reason = stringAt(finalState.localChangeReason);
        if (!reason) return notSatisfied("release.finalState.localChangeReason is required when local changes are not committed");
        if (!mentionsCommitSkipAuthorization(reason) && !mentionsCommitSkipAuthorization(stringAt(work.objective))) {
          return notSatisfied("maintain-mode or local file changes must be committed by default; localChanges=not-committed requires explicit skip/not-commit authorization quoted in release.finalState.localChangeReason or the original request");
        }
      }
    }

    const gitStatus = findSuccessfulGitStatusAfter(work, requiredStatusAfter);
    const notGit = findNonGitStatusAttemptAfter(work, requiredStatusAfter);
    if (!gitStatus && !(notGit && /not\s+a\s+git|no\s+git/i.test(gitSummary))) {
      return notSatisfied("release.finalState requires final git status evidence after the relevant local mutations, commit attempts, and release side-effect attempts; for non-git projects, run git status after those actions and explain the failure in finalState.gitStatusSummary");
    }

    const refs = [{ toolCallId: gitStatus?.toolCallId ?? notGit?.toolCallId }];
    if (commitRef) refs.push({ toolCallId: commitRef.toolCallId });
    return satisfied("release final state recorded", refs);
  },
};

function releaseOperations(value: unknown): string[] {
  return stringList(value);
}

function uniqueOperations(operations: ReleaseOperation[]): ReleaseOperation[] {
  return [...new Set(operations)];
}

function releaseSideEffectCommands(work: Parameters<Checkpoint["check"]>[0], failed: boolean): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => result.toolName === "bash" && result.isError === failed && isReleaseSideEffectCommand(String(result.input.command ?? "")));
}

function firstReleaseSideEffect(work: Parameters<Checkpoint["check"]>[0]): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find((result) => result.toolName === "bash" && isReleaseSideEffectCommand(String(result.input.command ?? "")));
}

function releaseGuideOrSignalReads(work: Parameters<Checkpoint["check"]>[0], release: Record<string, unknown>): CapturedToolResult[] {
  const paths = new Set<string>(["docs/release.md"]);
  const guide = objectAt(release.guide);
  for (const path of stringList(guide?.filesRead)) paths.add(path);
  const deliveryConfig = objectAt(release.deliveryConfig);
  for (const path of stringList(deliveryConfig?.signalsRead)) paths.add(path);
  return [...paths].map((path) => findReadEvidenceForPath(work, path)).filter(Boolean) as CapturedToolResult[];
}

function releaseVerificationCommands(work: Parameters<Checkpoint["check"]>[0], options: { allowExistenceChecks?: boolean; allowGitReleaseStateChecks?: boolean } = {}): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => result.toolName === "bash" && !result.isError && commandLooksLikeReleaseVerification(String(result.input.command ?? ""), options));
}

function commandLooksLikeReleaseVerification(command: string, options: { allowExistenceChecks?: boolean; allowGitReleaseStateChecks?: boolean } = {}): boolean {
  return commandSegments(command).some((segment) => {
    if (commandLooksLikeSubstantiveExecutePreflight(segment)) return true;
    if (/^git\s+diff\s+--check\b/.test(segment)) return true;
    if (/^actionlint\b/.test(segment)) return true;
    if (options.allowGitReleaseStateChecks === true && commandLooksLikeGitReleaseStatePreflight(segment)) return true;
    if (options.allowExistenceChecks === true && /^(test|\[)\s+(-e|-f|-d)\s+/.test(segment)) return true;
    return false;
  });
}

function commandLooksLikeSubstantiveExecutePreflight(command: string): boolean {
  return commandSegments(command).some((segment) => {
    if (isTestOrVerificationCommand(segment)) return true;
    if (/^actionlint\b/.test(segment)) return true;
    if (/^(npm|pnpm|yarn|bun)\s+(run\s+)?(pack:dry-run|pack|changelog:check|release:dry-run)\b/.test(segment)) return true;
    if (/^(npm|pnpm)\s+pack\b/.test(segment) && /\s--dry-run\b/.test(segment)) return true;
    if (/^(npm|pnpm)\s+publish\b/.test(segment) && /\s--dry-run\b/.test(segment)) return true;
    if (/^node\s+--check\s+.*scripts\/.*(release|publish|deploy|changelog)/.test(segment)) return true;
    if (/^(python3?|ruby|node)\b/.test(segment) && /ya?ml|json|workflow|release|publish|deploy|scripts\//i.test(segment)) return true;
    return false;
  });
}

function commandLooksLikeGitReleaseStatePreflight(command: string): boolean {
  return commandSegments(command).some((segment) => gitReleaseStatePreflightKinds(segment).length > 0);
}

function gitReleaseStatePreflightKinds(command: string): string[] {
  const kinds = new Set<string>();
  for (const segment of commandSegments(command)) {
    if (/^git\s+status\b/.test(segment)) kinds.add("status");
    if (/^git\s+remote\s+(-v|show\b|get-url\b)/.test(segment)) kinds.add("remote");
    if (/^git\s+branch\b/.test(segment) || /^git\s+rev-parse\s+--abbrev-ref\s+HEAD\b/.test(segment)) kinds.add("branch");
    if (/^git\s+tag\s+(?:-l|--list)\b/.test(segment) || /^git\s+tag\s*$/.test(segment)) kinds.add("tag");
    if (/^git\s+(?:log\b|rev-parse\s+HEAD\b|show\s+--no-patch\b)/.test(segment)) kinds.add("head");
  }
  return [...kinds];
}

function hasSubstantiveExecutePreflightBefore(work: Parameters<Checkpoint["check"]>[0], beforeIndex: number, operations: string[]): boolean {
  const before = (work.capturedToolResults ?? []).filter((result) => result.toolName === "bash" && !result.isError && capturedResultIndex(work, result) < beforeIndex);
  if (before.some((result) => commandLooksLikeSubstantiveExecutePreflight(String(result.input.command ?? "")))) return true;

  const sideEffectOps = operations.filter((operation) => sideEffectOperations.has(operation));
  const tagPushOnly = sideEffectOps.length > 0 && sideEffectOps.every((operation) => operation === "tag" || operation === "push");
  if (!tagPushOnly) return false;

  const gitKinds = new Set(before.flatMap((result) => gitReleaseStatePreflightKinds(String(result.input.command ?? ""))));
  return gitKinds.has("status") && gitKinds.has("remote") && (gitKinds.has("tag") || gitKinds.has("head") || gitKinds.has("branch"));
}

function opaqueReleaseExecutionCommands(work: Parameters<Checkpoint["check"]>[0]): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => {
    if (result.toolName !== "bash") return false;
    const command = String(result.input.command ?? "");
    if (/\s--dry-run\b|\bdry-run\b/.test(command)) return false;
    return commandSegments(command).some((segment) => {
      if (/^(npm|pnpm|yarn|bun)\s+(run\s+)?release\b/.test(segment)) return true;
      if (/^node\s+scripts\/.*release\.[cm]?js\b/.test(segment)) return true;
      return false;
    });
  });
}

function releaseRelevantMutations(work: Parameters<Checkpoint["check"]>[0]): ProjectMutationEvidence[] {
  return listProjectMutationTargets(work, { excludeEvidenceArtifacts: true }).filter((mutation) => mutation.path !== "." && mutation.kind !== "git-mutation");
}

function localFileMutations(work: Parameters<Checkpoint["check"]>[0]): ProjectMutationEvidence[] {
  return releaseRelevantMutations(work).filter((mutation) => !isReleaseSideEffectCommand(String(mutation.toolResult.input.command ?? "")));
}

function userAnswerBefore(work: Parameters<Checkpoint["check"]>[0], result: CapturedToolResult): boolean {
  const resultTime = Date.parse(result.at);
  return (work.capturedUserAnswers ?? []).some((answer) => {
    const answerTime = Date.parse(answer.at);
    return Number.isFinite(answerTime) && Number.isFinite(resultTime) && answerTime < resultTime;
  });
}

function maxCapturedIndex(results: CapturedToolResult[], work: Parameters<Checkpoint["check"]>[0]): number {
  return results.reduce((max, result) => Math.max(max, capturedResultIndex(work, result)), -1);
}

function postValidationKinds(operation: string): string[] {
  switch (operation) {
    case "push": return ["git-remote", "ci"];
    case "tag": return ["tag", "git-remote"];
    case "github-release": return ["github-release"];
    case "npm-publish": return ["npm-package"];
    case "deploy": return ["deploy-url"];
    case "ci-trigger": return ["ci"];
    default: return [];
  }
}

function findSuccessfulGitStatusAfter(work: Parameters<Checkpoint["check"]>[0], afterIndex: number) {
  return (work.capturedToolResults ?? []).find((result) => result.toolName === "bash" && !result.isError && isGitStatusCommand(String(result.input.command ?? "")) && capturedResultIndex(work, result) > afterIndex);
}

function findNonGitStatusAttemptAfter(work: Parameters<Checkpoint["check"]>[0], afterIndex: number) {
  return (work.capturedToolResults ?? []).find((result) => {
    if (capturedResultIndex(work, result) <= afterIndex) return false;
    if (result.toolName !== "bash" || !isGitStatusCommand(String(result.input.command ?? ""))) return false;
    return result.isError || /not a git repository|fatal:/i.test(result.outputSummary);
  });
}

function findSuccessfulGitCommit(work: Parameters<Checkpoint["check"]>[0]) {
  return (work.capturedToolResults ?? []).find((result) => result.toolName === "bash" && !result.isError && isGitCommitCommand(String(result.input.command ?? "")));
}

function findFailedGitCommit(work: Parameters<Checkpoint["check"]>[0]) {
  return (work.capturedToolResults ?? []).find((result) => result.toolName === "bash" && result.isError && isGitCommitCommand(String(result.input.command ?? "")));
}

function mentionsCommitSkipAuthorization(summary: string): boolean {
  return /(do\s+not|don'?t|dont|skip|hold\s+off\s+on|leave\s+.*uncommitted)\s*(the\s+)?(commit|committing|git\s+commit)|review[-\s]?only|show\s+(me\s+)?the\s+diff/i.test(summary);
}
