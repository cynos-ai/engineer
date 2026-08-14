import type { CapturedToolResult, Checkpoint } from "../../core/types";
import { capturedIndex, failedSubagentResults, findCaptured, findDeleteMoveEvidenceForPath, findFailedVerificationBash, findReadEvidenceForPath, findSuccessfulVerificationBash, findWriteEditForPath, firstProductionWriteIndex, isFailedVerificationBashResult, isSubagentResult, isSuccessfulCleanVerificationBashResult, isWriteLike, objectAt, stringAt, stringList, subagentForEvidence } from "../helpers";
import { satisfied, notSatisfied } from "./common";

export const developContextCheckpoint: Checkpoint = {
  id: "develop-context-recorded",
  rule: "develop must record a focused context scan: complexity, related files read, existing-pattern/reuse judgment; complex also needs traced flows and impacted modules.",
  check(work) {
    const context = objectAt(objectAt(work.completionEvidence?.develop)?.context);
    if (!context) return notSatisfied("missing completionEvidence.develop.context");
    const complexity = stringAt(context.complexity);
    if (!["simple", "complex"].includes(complexity)) return notSatisfied("develop.context.complexity must be simple or complex");
    if (!stringAt(context.reason)) return notSatisfied("develop.context.reason must not be empty");

    const relatedFiles = stringList(context.relatedFilesRead);
    if (relatedFiles.length === 0) return notSatisfied("develop.context.relatedFilesRead[] must not be empty");
    for (const file of relatedFiles) {
      if (!findReadEvidenceForPath(work, file)) return notSatisfied(`develop.context.relatedFilesRead missing real read evidence: ${file}. Ensure this file has read/bash read evidence; pre-start reads are carried over, but pre-start bash is not.`);
    }

    if (!stringAt(context.reuseOrDuplicationCheck)) return notSatisfied("develop.context.reuseOrDuplicationCheck must not be empty");

    if (complexity === "complex") {
      if (stringList(context.tracedFlowOrEdges).length === 0) return notSatisfied("complex develop requires develop.context.tracedFlowOrEdges[] recording call/data/state flow tracing");
      if (stringList(context.impactedModules).length === 0) return notSatisfied("complex develop requires develop.context.impactedModules[] recording impacted modules");
    } else {
      const filesChanged = implementationFilesChanged(work);
      if (filesChanged.length > 5) {
        return notSatisfied(`complexity=simple but develop.implementation.filesChanged has ${filesChanged.length} files, exceeding the simple threshold (SKILL rule #4). Next: reclassify complexity as complex and supply the complex-plan requirements (tasks/touchedAreas/risks + challenger).`);
      }
      const crossCutting = crossCuttingConcernFiles([...filesChanged, ...relatedFiles]);
      if (crossCutting.length > 0) {
        return notSatisfied(`complexity=simple but involves cross-cutting concern files (${crossCutting.join(", ")}); SKILL rule #4 forbids simple classification when touching logger/feature-flags/config/middleware/auth/context/bootstrap. Next: reclassify complexity as complex and supply the complex-plan requirements.`);
      }
    }

    return satisfied(`${complexity} context scan recorded, ${relatedFiles.length} related files`);
  },
};

export const developPlanCheckpoint: Checkpoint = {
  id: "develop-plan-recorded",
  rule: "develop must first have a design/plan scaled to simple/complex; complex needs task breakdown, touched areas, and risks.",
  check(work) {
    const develop = objectAt(work.completionEvidence?.develop);
    const context = objectAt(develop?.context);
    const plan = objectAt(develop?.plan ?? work.completionEvidence?.plan);
    if (!plan) return notSatisfied("missing completionEvidence.develop.plan");
    const complexity = stringAt(context?.complexity);
    if (!["simple", "complex"].includes(complexity)) return notSatisfied("develop.plan requires develop.context.complexity=simple|complex");
    if (!stringAt(plan.summary)) return notSatisfied("develop.plan.summary must not be empty");
    if (stringList(plan.testPlan).length === 0) return notSatisfied("develop.plan.testPlan[] must not be empty");

    if (complexity === "complex") {
      if (stringList(plan.tasks).length === 0) return notSatisfied("complex develop requires develop.plan.tasks[]");
      if (stringList(plan.touchedAreas).length === 0) return notSatisfied("complex develop requires develop.plan.touchedAreas[]");
      if (stringList(plan.risksOrAssumptions).length === 0) return notSatisfied("complex develop requires develop.plan.risksOrAssumptions[]");
    }

    return satisfied(complexity === "complex" ? "complex develop plan recorded" : "simple develop micro-plan recorded");
  },
};

export const developChallengeCheckpoint: Checkpoint = {
  id: "develop-challenge-recorded",
  rule: "complex develop must have a challenger audit that runs BEFORE the first production write (sequence-gated: a challenger that runs after implementation started is rejected as a rubber-stamp), or an auditable fallback with real failures / user authorization; simple does not require a challenger.",
  check(work) {
    const develop = objectAt(work.completionEvidence?.develop);
    const complexity = stringAt(objectAt(develop?.context)?.complexity);
    if (complexity !== "complex") return satisfied("simple develop does not require a challenger");

    const challenge = objectAt(develop?.challenge);
    if (!challenge) return notSatisfied("complex develop missing develop.challenge");
    if (!stringAt(challenge.summary)) return notSatisfied("develop.challenge.summary must not be empty");
    const challengeResult = stringAt(challenge.result);
    if (challengeResult && !["accepted", "revised", "fallback", "skipped-by-user"].includes(challengeResult)) {
      return notSatisfied("develop.challenge.result must be accepted / revised / fallback / skipped-by-user when present");
    }

    // Escape paths (no successful challenger, so the sequence gate does not apply): result is
    // fallback/skipped-by-user, user authorized skipping, or a real-failure fallbackReason.
    const hasFallbackReason = Boolean(stringAt(challenge.fallbackReason));
    const isEscapedPath = challengeResult === "fallback" || challengeResult === "skipped-by-user" || challenge.userAuthorizedSkip === true || hasFallbackReason;

    // Resolve the challenger result: explicit toolCallId first, else any captured challenger.
    const explicitId = stringAt(challenge.toolCallId);
    if (explicitId) {
      const result = findCaptured(work, explicitId);
      if (!result) return notSatisfied(`challenge.toolCallId not found in capturedToolResults: ${explicitId}`);
      if (result.isError) return notSatisfied(`referenced challenger tool_result failed: ${explicitId}`);
      if (!isSubagentResult(result, "challenger")) return notSatisfied(`challenge.toolCallId must reference a cynos_subagent challenger result: ${explicitId}`);
    }

    // Sequence gate (STRONG door — no midStreamUpgrade escape). A normal challenger must run
    // BEFORE the first production write. A challenger that runs after implementation started
    // only rubber-stamps a finished design and cannot shape it, which is the whole point of the
    // audit. The honest recovery is to abandon and start a correct complex work (or carry-forward
    // restart if available), NOT to re-challenge in-place.
    if (!isEscapedPath) {
      const firstWriteAt = firstProductionWriteIndex(work);
      const beforeFirstWrite = subagentForEvidence(work, "challenger", (item) => capturedIndex(work, item) < firstWriteAt);
      if (!beforeFirstWrite) {
        return notSatisfied(`Why: complex develop requires the challenger to run BEFORE the first production write (implementation). A challenger that runs after code is already written only rubber-stamps a finished design and cannot shape it. Detected: no challenger was captured before the first implementation write. Next: there is no in-work fix — abandon this work (cynos_abandon_work) and start a fresh complex work that runs challenger → plan → implement in the right order. If you classified as simple by mistake, the skill default is now complex: re-plan and re-challenge before any further implementation.`);
      }
      return satisfied("complex develop challenger ran before implementation", [{ toolCallId: beforeFirstWrite.toolCallId }]);
    }

    // Escape paths only: user-authorized skip, or real-failure fallback.
    if (challenge.userAuthorizedSkip === true) {
      if ((work.capturedUserAnswers ?? []).length === 0) return notSatisfied("challenge.userAuthorizedSkip=true but no capturedUserAnswers user authorization record");
      return satisfied("user authorized skipping challenger, fallback recorded");
    }

    if (stringAt(challenge.fallbackReason)) {
      const failures = failedSubagentResults(work, "challenger");
      if (failures.length >= 2) return satisfied("challenger real failures reached 2, fallback recorded", failures.slice(0, 2).map((result) => ({ toolCallId: result.toolCallId })));
      return notSatisfied("challenge.fallbackReason is the FALLBACK escape only — it requires at least 2 REAL FAILED (isError) cynos_subagent challenger results. Do not run challenger twice on purpose: the normal complex path needs ONE successful challenger. If your challenger calls succeeded, remove fallbackReason and rely on the successful result (auto-inferred).");
    }

    return notSatisfied("complex develop requires ONE successful cynos_subagent challenger that runs BEFORE the first production write (normal path). The result=fallback escape is ONLY for when challenger genuinely fails ≥2 times (real isError captures) or the user authorizes skipping via cynos_ask_user. Do not run challenger twice — one successful call is enough; do not invent a fallbackReason for successful runs.");
  },
};

export const developTddCheckpoint: Checkpoint = {
  id: "develop-tdd-recorded",
  rule: "develop defaults to TDD; used=true needs red/green evidence with the red running BEFORE the first implementation write (sequence-gated — a red captured after implementation is rejected as fake), used=false needs the reason it does not apply and an alternative verification. The checkpoint does not judge the semantic quality of red.",
  check(work) {
    const tdd = objectAt(work.completionEvidence?.tdd);
    if (!tdd) return notSatisfied("missing completionEvidence.tdd");
    if (typeof tdd.used !== "boolean") return notSatisfied("tdd.used must be a boolean");
    if (!stringAt(tdd.summary)) return notSatisfied("tdd.summary must not be empty");

    if (tdd.used === true) {
      // Resolve the red/green pair (explicit toolCallIds first, else inferred from captured bash).
      const redId = stringAt(tdd.redToolCallId);
      const greenId = stringAt(tdd.greenToolCallId);
      let red: CapturedToolResult | undefined;
      let green: CapturedToolResult | undefined;
      let redRef: string;
      let greenRef: string;
      if (redId || greenId) {
        if (!redId || !greenId) return notSatisfied("when using toolCallIds, tdd requires both redToolCallId and greenToolCallId");
        red = findCaptured(work, redId);
        green = findCaptured(work, greenId);
        if (!red || !green) return notSatisfied("tdd red/green referenced tool_result not found");
        if (red.toolName !== "bash" || green.toolName !== "bash") return notSatisfied("tdd red/green references must be bash results");
        if (!isFailedVerificationBashResult(red)) return notSatisfied(`tdd.redToolCallId must reference a failed test/verification command (normal non-zero exit or echo-masked failure with failure output): ${redId}`);
        if (!isSuccessfulCleanVerificationBashResult(green)) return notSatisfied(`tdd.greenToolCallId must reference a successful clean test/verification command; echo-masked failed tests and non-test commands are not valid green: ${greenId}`);
        redRef = redId;
        greenRef = greenId;
      } else {
        red = findFailedVerificationBash(work);
        green = findSuccessfulVerificationBash(work);
        if (!red || !green) return notSatisfied("tdd.used=true requires a failed test/verification command (red) and a successful verification command (green). A generic failed bash (git conflict, install error, typo) does not count as red — the red must be a real test run that fails for the expected reason.");
        redRef = red.toolCallId;
        greenRef = green.toolCallId;
      }

      // Sequence gate: red must run BEFORE the first IMPLEMENTATION write (test files excluded —
      // TDD legitimately writes the test file, runs red, then implements). A red captured after
      // the implementation is already written is fake: the test passes immediately, so it drives
      // nothing. This stops "implement first, fabricate a red afterward". If you implemented
      // before testing, the honest path is tdd.used=false + notApplicableReason, not a fake red.
      const firstImplWriteAt = firstProductionWriteIndex(work, { excludeTests: true });
      if (firstImplWriteAt !== Number.POSITIVE_INFINITY && capturedIndex(work, red) >= firstImplWriteAt) {
        return notSatisfied(`Why: TDD red must run BEFORE the first implementation write. A red captured after the implementation is already written is fake — the test would pass immediately because the code exists, so it drives nothing. Detected: the red test run is at/after the first implementation write. Next: if you implemented before testing you cannot recreate a real red — set tdd.used=false with an honest notApplicableReason (and alternativeVerification) instead of fabricating red. For real TDD next time: write the failing test first, watch it fail (red), then implement to make it pass (green).`);
      }

      return satisfied("TDD red/green evidence recorded (red precedes implementation)", [{ toolCallId: redRef }, { toolCallId: greenRef }]);
    }

    if (!stringAt(tdd.notApplicableReason)) return notSatisfied("when tdd.used=false, tdd.notApplicableReason is required");
    if (hasCapturedWrite(work) && !stringAt(tdd.alternativeVerification)) return notSatisfied("when tdd.used=false and file writes exist, tdd.alternativeVerification is required");
    return satisfied("TDD not-applicable reason and alternative verification recorded");
  },
};

export const developImplementationCheckpoint: Checkpoint = {
  id: "develop-implementation-recorded",
  rule: "develop must record an implementation summary; when files are changed, list filesChanged and back it with real write/edit evidence; when no files are changed, explain why.",
  check(work) {
    const implementation = objectAt(objectAt(work.completionEvidence?.develop)?.implementation);
    if (!implementation) return notSatisfied("missing completionEvidence.develop.implementation");
    if (!stringAt(implementation.summary)) return notSatisfied("develop.implementation.summary must not be empty");

    const filesChanged = stringList(implementation.filesChanged);
    const capturedWrites = successfulWrites(work);
    if (filesChanged.length === 0) {
      if (!stringAt(implementation.noFileChangeReason)) return notSatisfied("develop.implementation needs filesChanged[] or noFileChangeReason");
      if (capturedWrites.length > 0) return notSatisfied("real write/edit detected, but develop.implementation.filesChanged[] is empty");
      return satisfied("no file change reason recorded");
    }

    for (const file of filesChanged) {
      // First look for write/edit; if not found, fall back to rm/mv evidence (delete/move declarations).
      // Does not rely on a string-annotation gate, to avoid introducing a private annotation protocol
      // that the agent would have to be taught.
      const evidence = findWriteEditForPath(work, file) ?? findDeleteMoveEvidenceForPath(work, file);
      if (!evidence) return notSatisfied(`develop.implementation.filesChanged missing real write/edit/rm/mv evidence: ${file}`);
    }

    return satisfied(`implementation recorded, ${filesChanged.length} files`);
  },
};

export const developProjectImpactCheckpoint: Checkpoint = {
  id: "develop-project-impact-recorded",
  rule: "if develop declares updating durable project memory/docs, there must be real write/edit evidence; when no update is declared, completion is not blocked by missing ceremony fields.",
  check(work) {
    const projectImpact = objectAt(work.completionEvidence?.projectImpact);
    if (!projectImpact) return satisfied("no durable project memory/docs update declared; projectImpact description is guided by the skill, not a hard gate");

    const updatedFiles = stringList(projectImpact.updatedFiles);
    if (projectImpact.durableMemoryUpdateNeeded === true || updatedFiles.length > 0) {
      if (updatedFiles.length === 0) return notSatisfied("Why: when develop declares updating durable project memory/docs, it must prove real writes to prevent oral claims of updates. Missing: projectImpact.updatedFiles[] is empty. Next: list the actually updated PROJECT.md/docs files and ensure real write/edit evidence; if not updated, do not declare durableMemoryUpdateNeeded=true.");
      for (const file of updatedFiles) {
        const evidence = findWriteEditForPath(work, file);
        if (!evidence) return notSatisfied(`Why: when develop declares updating durable project memory/docs, it must prove real writes. Missing: projectImpact.updatedFiles missing real write/edit evidence: ${file}. Next: actually write the file, or remove the not-updated file from updatedFiles.`);
        if (!isWriteLike(evidence) || evidence.isError) return notSatisfied(`projectImpact.updatedFiles write evidence invalid: ${file}`);
      }
      return satisfied("real write evidence verified for projectImpact.updatedFiles");
    }
    return satisfied("no durable project memory/docs update declared; projectImpact reason ceremony not required");
  },
};

export const developReviewCheckpoint: Checkpoint = {
  id: "develop-review-recorded",
  rule: "develop must have a reviewer subagent review before completion, or an auditable real-failure/user-authorized fallback.",
  check(work) {
    const review = objectAt(work.completionEvidence?.review);
    return checkMandatoryDevelopReviewer(work, review);
  },
};

function checkMandatoryDevelopReviewer(work: Parameters<Checkpoint["check"]>[0], review: Record<string, unknown> | undefined): ReturnType<Checkpoint["check"]> {
  if (!review) return notSatisfied("missing completionEvidence.review");
  if (!stringAt(review.summary)) return notSatisfied("review.summary must not be empty");
  const fieldsCheck = validateDevelopReviewFields(review);
  if (fieldsCheck) return fieldsCheck;

  const explicitId = stringAt(review.toolCallId);
  if (explicitId) {
    const result = findCaptured(work, explicitId);
    if (!result) return notSatisfied(`review.toolCallId not found in capturedToolResults: ${explicitId}`);
    if (result.isError) return notSatisfied(`referenced reviewer tool_result failed: ${explicitId}`);
    if (!isSubagentResult(result, "reviewer")) return notSatisfied(`review.toolCallId must reference a cynos_subagent reviewer result: ${explicitId}`);
    return satisfied(`referenced real cynos_subagent reviewer result ${explicitId}`, [{ toolCallId: explicitId }]);
  }

  const capturedReviewer = (work.capturedToolResults ?? []).find((result) => isSubagentResult(result, "reviewer"));
  if (capturedReviewer) return satisfied("found cynos_subagent reviewer result", [{ toolCallId: capturedReviewer.toolCallId }]);

  if (review.userAuthorizedSkip === true) {
    if ((work.capturedUserAnswers ?? []).length === 0) return notSatisfied("review.userAuthorizedSkip=true but no capturedUserAnswers user authorization record");
    return satisfied("user authorized skipping reviewer, fallback recorded");
  }

  if (stringAt(review.fallbackReason)) {
    if (review.selfReviewAcknowledged !== true) return notSatisfied("review fallback requires review.selfReviewAcknowledged=true");
    const failures = failedSubagentResults(work, "reviewer");
    if (failures.length >= 2) return satisfied("reviewer real failures reached 2, self-review fallback recorded", failures.slice(0, 2).map((result) => ({ toolCallId: result.toolCallId })));
    return notSatisfied("review.fallbackReason is the FALLBACK escape only — it requires at least 2 REAL FAILED (isError) cynos_subagent reviewer results plus review.selfReviewAcknowledged=true. Do not run reviewer twice on purpose: the normal path needs ONE successful reviewer. If your reviewer call succeeded, remove fallbackReason and rely on the successful result (auto-inferred).");
  }

  return notSatisfied("develop requires ONE successful cynos_subagent reviewer (normal path). The result=fallback escape is ONLY for when reviewer genuinely fails ≥2 times (real isError captures) plus selfReviewAcknowledged, or the user authorizes skipping via cynos_ask_user. Do not run reviewer twice — one successful call is enough; self-review is not an ordinary passing path.");
}

function validateDevelopReviewFields(review: Record<string, unknown>): ReturnType<Checkpoint["check"]> | undefined {
  const result = stringAt(review.result);
  if (!["pass", "needs-work", "blocked", "fallback", "skipped-by-user"].includes(result)) {
    return notSatisfied("review.result must be pass / needs-work / blocked / fallback / skipped-by-user");
  }
  if (["needs-work", "blocked"].includes(result) && stringList(review.fixesFromReview).length === 0) {
    return notSatisfied("review.result=needs-work/blocked requires review.fixesFromReview[] describing handled or still-blocking issues");
  }
  return undefined;
}

function hasCapturedWrite(work: Parameters<Checkpoint["check"]>[0]): boolean {
  return successfulWrites(work).length > 0;
}

function successfulWrites(work: Parameters<Checkpoint["check"]>[0]): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => isWriteLike(result) && !result.isError);
}

function implementationFilesChanged(work: Parameters<Checkpoint["check"]>[0]): string[] {
  const implementation = objectAt(objectAt(work.completionEvidence?.develop)?.implementation);
  return stringList(implementation?.filesChanged);
}

function crossCuttingConcernFiles(files: string[]): string[] {
  const seen = new Set<string>();
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    const base = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (/^(logger|logging|feature-?flags?|config|middleware|auth|context|bootstrap)\.(ts|tsx|js|jsx|mjs|cjs|rs|go|py)$/i.test(base)) {
      seen.add(file);
    }
  }
  return [...seen];
}
