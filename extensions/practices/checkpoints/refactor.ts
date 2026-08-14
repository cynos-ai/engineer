import type { Checkpoint, WorkState, CapturedToolResult } from "../../core/types";
import { arrayAt, browserBlockedFallback, capturedIndex, commandSegments, extractToolPath, failedSubagentResults, findDeleteMoveEvidenceForPath, findReadEvidenceForPath, findSuccessfulSubstantiveCheck, findWriteEditForPath, hasBrowserEvidenceAfter, hasBrowserEvidenceBefore, isBrowserEvidenceResult, isSubagentResult, isSuccessfulCleanVerificationBashResult, isWriteLike, maxIndex, minIndex, objectAt, sameProjectPath, stringAt, stringList, subagentForEvidence, toProjectRelativePath } from "../helpers";
import { satisfied, notSatisfied } from "./common";

const CONTRACT_KINDS = ["api", "cli", "ui", "data", "error", "storage", "performance", "other"];

export const refactorFilesReadCheckpoint: Checkpoint = {
  id: "refactor-files-read",
  rule: "refactor must read related code files before claiming scope/contracts; each relatedFilesRead path needs real read evidence.",
  check(work) {
    const context = objectAt(objectAt(work.completionEvidence?.refactor)?.context);
    if (!context) return notSatisfied("missing refactor.context");
    const relatedFiles = stringList(context.relatedFilesRead);
    if (relatedFiles.length === 0) return notSatisfied("refactor.context.relatedFilesRead[] must not be empty");
    for (const file of relatedFiles) {
      if (!findReadEvidenceForPath(work, file)) return notSatisfied(`refactor.context.relatedFilesRead missing real read evidence: ${file}`);
    }
    return satisfied(`refactor related code reads recorded: ${relatedFiles.length} files`);
  },
};

export const refactorScopeBoundedCheckpoint: Checkpoint = {
  id: "refactor-scope-bounded",
  rule: "refactor must bound the code-change scope with non-empty inScope and outOfScope lists.",
  check(work) {
    const scope = objectAt(objectAt(work.completionEvidence?.refactor)?.scope);
    if (!scope) return notSatisfied("missing refactor.scope");
    if (stringList(scope.inScope).length === 0) return notSatisfied("refactor.scope.inScope[] must not be empty");
    if (stringList(scope.outOfScope).length === 0) return notSatisfied("refactor.scope.outOfScope[] must not be empty");
    return satisfied("refactor scope is bounded");
  },
};

export const refactorBehaviorContractMappedCheckpoint: Checkpoint = {
  id: "refactor-behavior-contract-mapped",
  rule: "refactor must define behavior contracts with id/kind/verification; kind drives surface-verification expectations.",
  check(work) {
    const contracts = behaviorContracts(work);
    if (contracts.length === 0) return notSatisfied("refactor.behaviorContract.contracts[] must not be empty");
    const seen = new Set<string>();
    for (const contract of contracts) {
      const id = stringAt(contract.id);
      if (!id) return notSatisfied("behaviorContract.contracts[] each item needs id");
      if (seen.has(id)) return notSatisfied(`behaviorContract contract id duplicated: ${id}`);
      seen.add(id);
      const kind = stringAt(contract.kind);
      if (!CONTRACT_KINDS.includes(kind)) return notSatisfied(`contract ${id} kind must be one of ${CONTRACT_KINDS.join("|")}`);
      const verification = stringAt(contract.verification);
      if (!verification) return notSatisfied(`contract ${id} missing verification`);
      if (kind !== "ui" && looksLikeDirectBrowserUiContract(`${id} ${verification}`)) {
        return notSatisfied(`contract ${id} describes browser/rendered UI verification but kind is ${kind}; use kind='ui' instead of downgrading UI behavior`);
      }
    }
    return satisfied(`${contracts.length} behavior contracts recorded`);
  },
};

export const refactorPlanCheckpoint: Checkpoint = {
  id: "refactor-plan-recorded",
  rule: "refactor must have a concise plan with slices and verification plan before implementation.",
  check(work) {
    const plan = objectAt(objectAt(work.completionEvidence?.refactor)?.plan);
    if (!plan) return notSatisfied("missing refactor.plan");
    if (!stringAt(plan.summary)) return notSatisfied("refactor.plan.summary must not be empty");
    const slices = arrayAt(plan.slices).map(objectAt).filter(Boolean) as Array<Record<string, unknown>>;
    if (slices.length === 0) return notSatisfied("refactor.plan.slices[] must not be empty");
    const seen = new Set<string>();
    for (const slice of slices) {
      const id = stringAt(slice.id);
      if (!id) return notSatisfied("refactor.plan.slices[] each item needs id");
      if (seen.has(id)) return notSatisfied(`refactor.plan.slices id duplicated: ${id}`);
      seen.add(id);
      if (!stringAt(slice.summary)) return notSatisfied(`refactor.plan.slices ${id} missing summary`);
    }
    if (stringList(plan.verificationPlan).length === 0) return notSatisfied("refactor.plan.verificationPlan[] must not be empty");
    return satisfied(`refactor plan recorded, ${slices.length} slices`);
  },
};

export const refactorCharacterizationCheckpoint: Checkpoint = {
  id: "refactor-characterization-evidenced",
  rule: "refactor must prove behavior preservation with comparable baseline-before-write and final-after-write evidence covering every behavior contract.",
  check(work) {
    const characterization = objectAt(objectAt(work.completionEvidence?.refactor)?.characterization);
    if (!characterization) return notSatisfied("missing refactor.characterization");
    const contracts = behaviorContracts(work);
    if (contracts.length === 0) return notSatisfied("characterization requires behaviorContract.contracts[]");

    for (const file of stringList(characterization.characterizationTestsAdded)) {
      if (!pathLooksLikeTestAsset(file)) return notSatisfied(`characterizationTestsAdded must look like a test asset path: ${file}`);
      if (!findWriteEditForPath(work, file)) return notSatisfied(`characterizationTestsAdded missing real write/edit evidence: ${file}`);
    }

    const mutations = productionMutations(work);
    if (mutations.length === 0) return notSatisfied("refactor requires at least one production write; plan-only/no-write requests should not use refactor");

    const firstWriteIndex = minIndex(work, mutations);
    const lastWriteIndex = maxIndex(work, mutations);
    const selected = selectComparableEvidencePair(work, firstWriteIndex, lastWriteIndex);
    if (!selected.ok) return notSatisfied(selected.reason);

    const coverageCheck = requireCoverageForContracts(contracts, arrayAt(characterization.contractCoverage));
    if (coverageCheck) return coverageCheck;

    const uiContracts = contracts.filter((contract) => stringAt(contract.kind) === "ui");
    if (uiContracts.length > 0 && !hasDirectBrowserEvidenceAroundProductionWrites(work, firstWriteIndex, lastWriteIndex) && !strictSurfaceBlockedFallback(work)) {
      return notSatisfied(`UI behavior contracts require direct browser evidence before and after production writes, or strict blocked fallback with real failed attempts: ${uiContracts.map((item) => stringAt(item.id)).join(", ")}`);
    }

    return satisfied(`baseline/final characterization covers ${contracts.length} contracts`, [{ toolCallId: selected.baseline.toolCallId }, { toolCallId: selected.final.toolCallId }]);
  },
};

export const refactorChallengeCheckpoint: Checkpoint = {
  id: "refactor-challenge-recorded",
  rule: "refactor must have a challenger before production writes, or audited real-failure/user-authorized fallback.",
  check(work) {
    const challenge = objectAt(objectAt(work.completionEvidence?.refactor)?.challenge);
    if (!challenge) return notSatisfied("missing refactor.challenge");
    if (!stringAt(challenge.summary)) return notSatisfied("refactor.challenge.summary must not be empty");
    const result = stringAt(challenge.result);
    if (!["accepted", "revised", "fallback", "skipped-by-user"].includes(result)) return notSatisfied("refactor.challenge.result must be accepted / revised / fallback / skipped-by-user");
    const checked = requireSubagentOrFallback(work, challenge, "challenger", "challenge", "selfChallengeAcknowledged");
    if (!checked.satisfied) return checked;
    if (result !== "fallback" && result !== "skipped-by-user" && challenge.userAuthorizedSkip !== true) {
      const mutations = productionMutations(work);
      const firstWriteIndex = mutations.length > 0 ? minIndex(work, mutations) : Number.POSITIVE_INFINITY;
      const subagentResult = subagentForEvidence(work, "challenger", (item) => capturedIndex(work, item) < firstWriteIndex);
      if (!subagentResult) return notSatisfied("A successful challenger result exists only after the first production refactor write, or no successful challenger was captured before it. Do not switch to fallback/skipped unless the user explicitly authorized skipping or the challenger genuinely failed twice. Check whether temporary evidence/artifact writes are being counted as production writes.");
    }
    return checked;
  },
};

export const refactorChangesCheckpoint: Checkpoint = {
  id: "refactor-changes-recorded",
  rule: "refactor must record production files changed; filesChanged must be non-empty and backed by real write/edit/rm/mv evidence.",
  check(work) {
    const changes = objectAt(objectAt(work.completionEvidence?.refactor)?.changes);
    if (!changes) return notSatisfied("missing refactor.changes");
    if (!stringAt(changes.summary)) return notSatisfied("refactor.changes.summary must not be empty");
    const filesChanged = stringList(changes.filesChanged);
    if (filesChanged.length === 0) return notSatisfied("refactor.changes.filesChanged[] must not be empty; no-write/plan-only requests should not use refactor");
    for (const file of filesChanged) {
      const evidence = findWriteEditForPath(work, file) ?? findDeleteMoveEvidenceForPath(work, file);
      if (!evidence) return notSatisfied(`refactor.changes.filesChanged missing real write/edit/rm/mv evidence: ${file}`);
    }
    const missing = productionMutationPaths(work).filter((path) => !filesChanged.some((listed) => pathsMatch(work, path, listed)));
    if (missing.length > 0) return notSatisfied(`captured production writes/rm/mv are missing from refactor.changes.filesChanged[]: ${missing.join(", ")}`);
    return satisfied(`refactor changes recorded, ${filesChanged.length} files`);
  },
};

export const refactorReviewCheckpoint: Checkpoint = {
  id: "refactor-review-recorded",
  rule: "refactor must have a reviewer after final verification, or audited real-failure/user-authorized fallback.",
  check(work) {
    const review = objectAt(work.completionEvidence?.review);
    if (!review) return notSatisfied("missing completionEvidence.review");
    if (!stringAt(review.summary)) return notSatisfied("review.summary must not be empty");
    const result = stringAt(review.result);
    if (!["pass", "needs-work", "blocked", "fallback", "skipped-by-user"].includes(result)) return notSatisfied("review.result must be pass / needs-work / blocked / fallback / skipped-by-user");
    if (["needs-work", "blocked"].includes(result) && stringList(review.fixesFromReview).length === 0) return notSatisfied("review.result=needs-work/blocked requires review.fixesFromReview[]");
    const checked = requireSubagentOrFallback(work, review, "reviewer", "review", "selfReviewAcknowledged");
    if (!checked.satisfied) return checked;
    if (result !== "fallback" && result !== "skipped-by-user" && review.userAuthorizedSkip !== true) {
      const final = selectedFinalEvidence(work);
      const finalIndex = final ? capturedIndex(work, final) : -1;
      const reviewer = subagentForEvidence(work, "reviewer", (item) => finalIndex >= 0 && capturedIndex(work, item) > finalIndex);
      if (!reviewer) return notSatisfied("A successful reviewer result exists only before final verification, or no successful reviewer was captured after it. Do not switch to fallback/skipped unless the user explicitly authorized skipping or the reviewer genuinely failed twice. Run final verification, then run reviewer again; if artifacts moved the boundary, fix production-write tracking.");
    }
    return checked;
  },
};

export const refactorProjectImpactCheckpoint: Checkpoint = {
  id: "refactor-project-impact-recorded",
  rule: "if refactor declares durable project memory/docs updates, those updatedFiles must have real write/edit evidence.",
  check(work) {
    const projectImpact = objectAt(work.completionEvidence?.projectImpact);
    if (!projectImpact) return satisfied("no durable project memory/docs update declared; projectImpact is skill-guided unless updatedFiles are listed");
    const updatedFiles = stringList(projectImpact.updatedFiles);
    if (projectImpact.durableMemoryUpdateNeeded === true || updatedFiles.length > 0) {
      if (updatedFiles.length === 0) return notSatisfied("projectImpact declares durableMemoryUpdateNeeded=true but updatedFiles[] is empty");
      for (const file of updatedFiles) {
        if (!findWriteEditForPath(work, file)) return notSatisfied(`projectImpact.updatedFiles missing real write/edit evidence: ${file}`);
      }
      return satisfied("real write evidence verified for projectImpact.updatedFiles");
    }
    return satisfied("no durable project memory/docs update declared");
  },
};

function requireSubagentOrFallback(work: WorkState, evidence: Record<string, unknown>, expectedAgent: "reviewer" | "challenger", label: "review" | "challenge", selfAcknowledgedField: "selfReviewAcknowledged" | "selfChallengeAcknowledged"): ReturnType<Checkpoint["check"]> {
  const result = stringAt(evidence.result);
  if (evidence.userAuthorizedSkip === true || result === "skipped-by-user") {
    if ((work.capturedUserAnswers ?? []).length === 0) return notSatisfied(`${label} userAuthorizedSkip/skipped-by-user requires a capturedUserAnswers user authorization record`);
    return satisfied(`user authorized skipping ${expectedAgent}, fallback recorded`);
  }
  if (result === "fallback" || stringAt(evidence.fallbackReason)) {
    if (evidence[selfAcknowledgedField] !== true) return notSatisfied(`${label} fallback requires ${selfAcknowledgedField}=true`);
    const failures = failedSubagentResults(work, expectedAgent);
    if (failures.length >= 2) return satisfied(`${expectedAgent} real failures reached 2, fallback recorded`, failures.slice(0, 2).map((item) => ({ toolCallId: item.toolCallId })));
    return notSatisfied(`${label} fallback requires at least 2 real failed cynos_subagent ${expectedAgent} captured results`);
  }
  const captured = (work.capturedToolResults ?? []).find((item) => isSubagentResult(item, expectedAgent));
  if (captured) return satisfied(`found cynos_subagent ${expectedAgent} result`, [{ toolCallId: captured.toolCallId }]);
  return notSatisfied(`refactor requires one successful cynos_subagent ${expectedAgent}, or an audited real-failure/user-authorized fallback`);
}

function behaviorContracts(work: WorkState): Array<Record<string, unknown>> {
  return arrayAt(objectAt(objectAt(work.completionEvidence?.refactor)?.behaviorContract)?.contracts)
    .map(objectAt)
    .filter(Boolean) as Array<Record<string, unknown>>;
}

function looksLikeDirectBrowserUiContract(text: string): boolean {
  return /\b(browser|playwright|cypress|screenshot|viewport)\b|rendered\s+(page|ui|screen|view)|user\s+flow|browser\s+console|console\s+(errors?|messages?)|network\s+(requests?|panel|traffic)|console\/?network/i.test(text);
}

function requireCoverageForContracts(contracts: Array<Record<string, unknown>>, coverageItems: unknown[]): ReturnType<Checkpoint["check"]> | undefined {
  const coverage = coverageItems.map(objectAt).filter(Boolean) as Array<Record<string, unknown>>;
  const covered = new Set<string>();
  for (const item of coverage) {
    const id = stringAt(item.contractId);
    if (!id) return notSatisfied("refactor.characterization.contractCoverage[] each item needs contractId");
    if (stringAt(item.result) !== "same") return notSatisfied(`refactor.characterization.contractCoverage ${id} result must be same`);
    if (!stringAt(item.baselineEvidence)) return notSatisfied(`refactor.characterization.contractCoverage ${id} missing baselineEvidence`);
    if (!stringAt(item.finalEvidence)) return notSatisfied(`refactor.characterization.contractCoverage ${id} missing finalEvidence`);
    covered.add(id);
  }
  for (const contract of contracts) {
    const id = stringAt(contract.id);
    if (!covered.has(id)) return notSatisfied(`refactor.characterization.contractCoverage did not cover behavior contract: ${id}`);
  }
  return undefined;
}

function selectedFinalEvidence(work: WorkState): CapturedToolResult | undefined {
  const mutations = productionMutations(work);
  if (mutations.length === 0) return undefined;
  const selected = selectComparableEvidencePair(work, minIndex(work, mutations), maxIndex(work, mutations));
  return selected.ok ? selected.final : undefined;
}

function selectComparableEvidencePair(work: WorkState, firstWriteIndex: number, lastWriteIndex: number): { ok: true; baseline: CapturedToolResult; final: CapturedToolResult } | { ok: false; reason: string } {
  const candidates = acceptableVerificationEvidence(work);
  const baselines = candidates.filter((item) => capturedIndex(work, item) < firstWriteIndex);
  const finals = candidates.filter((item) => capturedIndex(work, item) > lastWriteIndex);
  if (baselines.length === 0) return { ok: false, reason: "refactor.characterization requires real baseline verification evidence before production writes" };
  if (finals.length === 0) return { ok: false, reason: "refactor.characterization requires real final verification evidence after production writes" };
  for (const final of [...finals].reverse()) {
    for (const baseline of baselines) {
      if (baseline !== final && verificationEvidenceComparable(work, baseline, final)) return { ok: true, baseline, final };
    }
  }
  return { ok: false, reason: "baseline/final verification must be comparable: rerun the same baseline command after the refactor, or run a clear superset verification" };
}

function acceptableVerificationEvidence(work: WorkState): CapturedToolResult[] {
  const allowSubstantive = objectAt(work.completionEvidence?.verification)?.noTestSuite === true;
  const evidence = (work.capturedToolResults ?? []).filter((result) => isSuccessfulCleanVerificationBashResult(result) || isSurfaceEvidence(result) || (allowSubstantive && findSuccessfulSubstantiveCheck({ ...work, capturedToolResults: [result] })));
  return evidence;
}

function isSurfaceEvidence(result: CapturedToolResult): boolean {
  return isBrowserEvidenceResult(result);
}

function verificationEvidenceComparable(work: WorkState, baseline: CapturedToolResult, final: CapturedToolResult): boolean {
  if (isSurfaceEvidence(baseline) && isSurfaceEvidence(final)) return true;
  if (baseline.toolName === "bash" && final.toolName === "bash") {
    const baselineCommand = normalizeCommand(String(baseline.input.command ?? ""));
    const finalCommand = normalizeCommand(String(final.input.command ?? ""));
    if (baselineCommand && baselineCommand === finalCommand) return true;
    if (baselineCommand && finalCommand && commandIsClearSuperset(baselineCommand, finalCommand)) return true;
  }
  return false;
}

function commandIsClearSuperset(baselineCommand: string, finalCommand: string): boolean {
  if (baselineCommand === finalCommand) return true;
  if (/^npm test\b|^npm run test\b|^pnpm test\b|^yarn test\b/.test(finalCommand) && /\b(test|vitest|jest|mocha|pytest)\b/.test(baselineCommand)) return true;
  return false;
}

function hasDirectBrowserEvidenceAroundProductionWrites(work: WorkState, firstWriteIndex: number, lastWriteIndex: number): boolean {
  return hasBrowserEvidenceBefore(work, firstWriteIndex) && hasBrowserEvidenceAfter(work, lastWriteIndex);
}

function strictSurfaceBlockedFallback(work: WorkState): boolean {
  return !!browserBlockedFallback(work);
}

function productionMutations(work: WorkState): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => {
    if (result.isError) return false;
    if (isWriteLike(result)) {
      const path = extractToolPath(result);
      return !!path && !pathIsExcludedFromProduction(work, path);
    }
    if (result.toolName !== "bash") return false;
    return bashMutationPaths(work, result).length > 0;
  });
}

function productionMutationPaths(work: WorkState): string[] {
  const paths: string[] = [];
  for (const result of work.capturedToolResults ?? []) {
    if (result.isError) continue;
    if (isWriteLike(result)) {
      const path = extractToolPath(result);
      if (path && !pathIsExcludedFromProduction(work, path)) paths.push(path);
    } else if (result.toolName === "bash") {
      paths.push(...bashMutationPaths(work, result));
    }
  }
  return [...new Set(paths.map(normalizeForCompare))];
}

function bashMutationPaths(work: WorkState, result: CapturedToolResult): string[] {
  const paths: string[] = [];
  for (const segment of commandSegments(String(result.input.command ?? ""))) {
    if (/^git\s+rm\b/.test(segment)) paths.push(...extractPathArgs(segment.replace(/^git\s+rm\b/, "")));
    else if (/^rm\s/.test(segment)) paths.push(...extractPathArgs(segment.replace(/^rm\b/, "")));
    else if (/^mv\s/.test(segment)) paths.push(...extractPathArgs(segment.replace(/^mv\b/, "")));
  }
  return paths.filter((path) => !pathIsExcludedFromProduction(work, path));
}

function extractPathArgs(argString: string): string[] {
  return argString.trim().split(/\s+/).filter((token) => token && !token.startsWith("-")).map((token) => token.replace(/^['\"]|['\"]$/g, ""));
}

function pathIsExcludedFromProduction(work: WorkState, path: string): boolean {
  const normalized = projectRelativeForCompare(work, path);
  if (normalized === ".cynos" || normalized.startsWith(".cynos/")) return true;
  if (normalized === ".playwright-cli" || normalized.startsWith(".playwright-cli/")) return true;
  const testsAdded = stringList(objectAt(objectAt(work.completionEvidence?.refactor)?.characterization)?.characterizationTestsAdded);
  if (testsAdded.some((item) => pathsMatch(work, path, item))) return true;
  const projectImpactFiles = stringList(objectAt(work.completionEvidence?.projectImpact)?.updatedFiles);
  if (projectImpactFiles.some((item) => pathsMatch(work, path, item))) return true;
  return false;
}

function projectRelativeForCompare(work: WorkState, path: string): string {
  return normalizeForCompare(toProjectRelativePath(path, work.cwd));
}

function pathLooksLikeTestAsset(path: string): boolean {
  const normalized = normalizeForCompare(path);
  return /(^|\/)(__tests__|tests?|spec|e2e)\//.test(normalized) || /\.(test|spec|e2e)\.[a-z0-9]+$/i.test(normalized);
}

function normalizeForCompare(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function pathsMatch(work: WorkState, actualPath: string, expectedPath: string): boolean {
  if (work.cwd) return sameProjectPath(actualPath, expectedPath, work.cwd);
  return normalizeForCompare(actualPath) === normalizeForCompare(expectedPath) || normalizeForCompare(actualPath).endsWith(normalizeForCompare(expectedPath));
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

export { behaviorContracts as refactorBehaviorContracts, productionMutations as refactorProductionMutations };
