import type { Checkpoint } from "../../core/types";
import { arrayAt, capturedResultIndex, extractToolPath, findBrowserEvidence, findCaptured, findReadEvidenceForPath, findUiLikeProductionWrites, findUnsafeUiDeliverableWrites, findWriteEditForPath, isBrowserEvidenceResult, isOutsideProjectPath, isRootFile, isWriteLike, mentionsOriginalPromptAuthorization, objectAt, pathLooksLikeEvidenceOrScratchArtifact, pathLooksLikeTestAsset, pathLooksLikeUiProductionArtifact, stringAt, stringList } from "../helpers";
import { notSatisfied, satisfied } from "./common";

const DIRECTION_SOURCES = ["user-confirmed", "user-delegated", "provided-spec", "existing-brand-spec", "small-tweak"];

export const uiDirectionDecisionCheckpoint: Checkpoint = {
  id: "ui-direction-decision-recorded",
  rule: "ui-design must record how the design direction was chosen; user-confirmed requires at least one real captured user answer, but checkpoint does not parse answer semantics.",
  check(work) {
    const decision = objectAt(objectAt(work.completionEvidence?.uiDesign)?.directionDecision);
    if (!decision) return notSatisfied(`missing uiDesign.directionDecision with source (${DIRECTION_SOURCES.join("|")}) and summary`);
    const source = stringAt(decision.source);
    if (!DIRECTION_SOURCES.includes(source)) return notSatisfied(`uiDesign.directionDecision.source must be one of ${DIRECTION_SOURCES.join("|")}; currently: ${source || "<empty>"}`);
    if (!stringAt(decision.summary)) return notSatisfied("uiDesign.directionDecision.summary must not be empty");
    if (source === "user-confirmed" && (work.capturedUserAnswers ?? []).length === 0) {
      return notSatisfied("uiDesign.directionDecision.source=user-confirmed requires at least one real captured user answer from cynos_ask_user/resume; checkpoint does not parse answer semantics");
    }
    return satisfied(`direction decision recorded via ${source}`);
  },
};

export const rootBrandSpecCheckpoint: Checkpoint = {
  id: "ui-brand-spec-written",
  rule: "ui-design requires a root brand-spec.md / design-system foundation: an existing brand-spec must be really read, and a created/updated one must be really written; a non-brand one-off may provide an explicit designSystem declaration.",
  check(work) {
    const ui = objectAt(work.completionEvidence?.uiDesign);
    const foundation = objectAt(ui?.foundation);
    if (foundation) return checkFoundation(work, foundation);

    // Backward-compatible path for the old top-level schema. Prefer the new
    // uiDesign.foundation schema in skills/smoke; remove this after the next
    // minor or after one full ui-design smoke round uses the new schema.
    const designSystem = objectAt(work.completionEvidence?.designSystem);
    const brandSpec = objectAt(work.completionEvidence?.brandSpec);
    const explicitId = stringAt(brandSpec?.writtenToolCallId);
    if (explicitId) {
      const result = findCaptured(work, explicitId);
      if (result && isWriteLike(result) && !result.isError) {
        const actualPath = extractToolPath(result);
        if (!actualPath || isRootFile(actualPath, "brand-spec.md", work.cwd)) {
          return satisfied("project root brand-spec.md written", [{ toolCallId: explicitId }]);
        }
        return notSatisfied(`brand-spec must be written at the project root: ${actualPath}`);
      }
    }
    const path = stringAt(brandSpec?.path) || (brandSpec ? "brand-spec.md" : "");
    if (path && !isRootFile(path, "brand-spec.md", work.cwd)) return notSatisfied(`brandSpec.path must be the project root brand-spec.md, currently: ${path}`);
    const written = findRootBrandSpecWrite(work);
    if (written) return satisfied("project root brand-spec.md written", [{ toolCallId: written.toolCallId }]);
    const read = findReadEvidenceForPath(work, "brand-spec.md");
    if (brandSpec && read) return satisfied("project root brand-spec.md read", [{ toolCallId: read.toolCallId }]);
    if (designSystem && stringAt(designSystem.summary) && stringAt(designSystem.visualDirection)) return satisfied("designSystem declaration provided");
    return notSatisfied("missing uiDesign.foundation, or root brand-spec.md read/written, or designSystem.summary + visualDirection");
  },
};

export const uiArtifactWrittenCheckpoint: Checkpoint = {
  id: "ui-artifact-written",
  rule: "ui-design must really write the declared final UI assets (pages, components, styles, prototypes, or design-related files); it only positively validates artifacts[], and does not require listing scratch writes.",
  check(work) {
    const ui = objectAt(work.completionEvidence?.uiDesign);
    const implementation = objectAt(ui?.implementation);
    if (implementation) {
      if (!stringAt(implementation.summary)) return notSatisfied("uiDesign.implementation.summary must not be empty");
      const artifacts = stringList(implementation.artifacts);
      const noFileChangeReason = stringAt(implementation.noFileChangeReason);
      if (artifacts.length === 0 && !noFileChangeReason) return notSatisfied("uiDesign.implementation needs artifacts[] or noFileChangeReason");
      if (artifacts.length === 0 && noFileChangeReason && findUiLikeProductionWrites(work).length > 0) {
        return notSatisfied("uiDesign.implementation.noFileChangeReason cannot be used when UI-like production writes exist; list final UI deliverables in artifacts[]");
      }
      const unsafeUiDeliverables = artifacts.length === 0 && noFileChangeReason ? findUnsafeUiDeliverableWrites(work) : [];
      if (unsafeUiDeliverables.length > 0) {
        const path = extractToolPath(unsafeUiDeliverables[0]);
        return notSatisfied(`uiDesign.implementation.noFileChangeReason cannot be used when an unsafe/outside UI deliverable was written${path ? ` (${path})` : ""}; write final UI deliverables inside the project and list them in artifacts[]`);
      }
      for (const artifact of artifacts) {
        const pathProblem = uiArtifactPathProblem(artifact, work.cwd);
        if (pathProblem) return notSatisfied(`uiDesign.implementation.artifacts must list final in-project UI deliverables only: ${artifact} (${pathProblem})`);
        const evidence = findWriteEditForPath(work, artifact);
        if (!evidence) return notSatisfied(`uiDesign.implementation.artifacts missing real write/edit evidence: ${artifact}`);
        if (!isWriteLike(evidence) || evidence.isError) return notSatisfied(`uiDesign.implementation.artifacts write evidence invalid: ${artifact}`);
      }
      return satisfied(artifacts.length > 0 ? `recorded ${artifacts.length} UI artifact writes` : "recorded no-file-change reason");
    }

    // Backward-compatible path for the old uiDesign.summary/artifactToolCallIds schema.
    if (!stringAt(ui?.summary)) return notSatisfied("missing uiDesign.implementation.summary (or legacy uiDesign.summary)");
    const explicitIds = arrayAt(ui?.artifactToolCallIds).map((item) => String(item).trim()).filter(Boolean);
    if (explicitIds.length > 0) {
      const refs = [];
      for (const toolCallId of explicitIds) {
        const result = findCaptured(work, toolCallId);
        if (!result || !isWriteLike(result) || result.isError) return notSatisfied(`uiDesign.artifactToolCallIds missing successful write/edit evidence: ${toolCallId}`);
        const path = extractToolPath(result);
        const pathProblem = uiArtifactPathProblem(path, work.cwd);
        if (pathProblem) return notSatisfied(`uiDesign.artifactToolCallIds must reference final in-project UI deliverables only: ${path || toolCallId} (${pathProblem})`);
        refs.push({ toolCallId });
      }
      return satisfied(`referenced ${explicitIds.length} UI artifact writes`, refs);
    }
    const writes = (work.capturedToolResults ?? []).filter((result) => isWriteLike(result) && !result.isError && !uiArtifactPathProblem(extractToolPath(result), work.cwd));
    if (writes.length === 0) return notSatisfied("no real UI asset write/edit tool results found");
    return satisfied(`found ${writes.length} UI asset writes`, writes.slice(0, 5).map((result) => ({ toolCallId: result.toolCallId })));
  },
};

export const browserEvidenceCheckpoint: Checkpoint = {
  id: "ui-browser-evidence-captured",
  rule: "ui-design must provide real Playwright CLI direct browser evidence (snapshot/screenshot/console/requests/eval); static verification substitutes are not accepted.",
  check(work) {
    const browser = objectAt(work.completionEvidence?.browserVerification);
    const explicitIds = [
      ...arrayAt(browser?.toolCallIds).map((item) => String(item).trim()).filter(Boolean),
      ...arrayAt(browser?.evidence).map((item) => stringAt(objectAt(item)?.toolCallId)).filter(Boolean),
    ];
    if (explicitIds.length > 0) {
      for (const toolCallId of explicitIds) {
        const result = findCaptured(work, toolCallId);
        if (!result) return notSatisfied(`browserVerification referenced tool_result not found: ${toolCallId}`);
        if (!isBrowserEvidenceResult(result)) return notSatisfied(`browserVerification must reference real browser evidence from successful Playwright CLI direct browser evidence (snapshot/screenshot/console/requests/eval), not ordinary verification/help/install commands: ${toolCallId}`);
      }
    }
    const captured = findBrowserEvidence(work);
    if (captured.length === 0) {
      const summary = stringAt(browser?.summary);
      // Functional regex: keeps Chinese phrases agents may use to claim a static substitute.
      if (/等效静态.*替代|静态验证.*替代|用静态.*替代浏览器|equivalent static|static verification.*instead|无法启动浏览器.*(tsc|build|test)/i.test(summary)) {
        return notSatisfied("no successful browser/screenshot/console evidence found; browserVerification.summary indicates a static verification substitute is being used, which ui-design does not accept");
      }
      return notSatisfied("no successful Playwright CLI direct browser evidence found; ui-design requires real browser verification via snapshot/screenshot/console/requests/eval");
    }
    const uiWrites = findUiLikeProductionWrites(work);
    if (uiWrites.length > 0) {
      const lastUiWrite = Math.max(...uiWrites.map((result) => capturedResultIndex(work, result)).filter((index) => index >= 0));
      const hasAfter = captured.some((result) => capturedResultIndex(work, result) > lastUiWrite);
      if (!hasAfter) {
        const lastPath = extractToolPath(uiWrites.find((result) => capturedResultIndex(work, result) === lastUiWrite) ?? uiWrites[uiWrites.length - 1]);
        return notSatisfied(`ui-design browser evidence must be captured after the last UI-like production write${lastPath ? ` (${lastPath})` : ""}; run Playwright/browser snapshot/screenshot/console on the final rendered UI after all UI edits`);
      }
    }
    return satisfied(`found ${captured.length} browser evidence items`, captured.slice(0, 5).map((result) => ({ toolCallId: result.toolCallId })));
  },
};

export const critiqueOrConfirmationCheckpoint: Checkpoint = {
  id: "ui-critique-recorded",
  rule: "ui-design requires a design critique result or user confirmation before completion; an unrelated user answer cannot masquerade as the final design confirmation.",
  check(work) {
    const critique = objectAt(work.completionEvidence?.critique);
    const fidelityProblem = designFidelityProblemIfImplementationWritten(work);
    if (critique && stringAt(critique.summary)) {
      if (fidelityProblem) return notSatisfied(fidelityProblem);
      const score = critique.overallScore;
      if (score !== undefined && (typeof score !== "number" || score < 0 || score > 10)) return notSatisfied("critique.overallScore must be a number between 0 and 10");
      return satisfied("critique summary recorded");
    }

    const confirmation = stringAt(objectAt(work.completionEvidence?.confirmation)?.summary);
    if (confirmation) {
      if (fidelityProblem) return notSatisfied(fidelityProblem);
      if ((work.capturedUserAnswers ?? []).length > 0 || mentionsOriginalPromptAuthorization(confirmation)) return satisfied("user confirmation recorded");
      return notSatisfied("confirmation.summary needs capturedUserAnswers evidence, or an explicit statement that the user authorized/confirmed in the original prompt; an unrelated Q&A cannot masquerade as the final design confirmation");
    }

    return notSatisfied("missing critique.summary or confirmation.summary");
  },
};

function uiArtifactPathProblem(path: string, cwd?: string): string {
  if (!path) return "empty path";
  if (isOutsideProjectPath(path, cwd)) return "outside project";
  if (pathLooksLikeEvidenceOrScratchArtifact(path, cwd)) return "evidence/scratch/cache path";
  if (pathLooksLikeTestAsset(path)) return "test asset; use testAssetsPassedIfWrittenCheckpoint instead";
  if (!pathLooksLikeUiProductionArtifact(path, cwd)) return "non-UI asset path";
  return "";
}

function designFidelityProblemIfImplementationWritten(work: Parameters<Checkpoint["check"]>[0]): string {
  const uiWrites = findUiLikeProductionWrites(work);
  const artifacts = stringList(objectAt(objectAt(work.completionEvidence?.uiDesign)?.implementation)?.artifacts);
  if (uiWrites.length === 0 && artifacts.length === 0) return "";
  const fidelity = objectAt(objectAt(work.completionEvidence?.uiDesign)?.designFidelity);
  if (!stringAt(fidelity?.foundationUsed)) return "uiDesign.designFidelity.foundationUsed is required when UI implementation writes exist; record which brand-spec/design foundation was used in the critique/alignment report";
  if (!stringAt(fidelity?.alignmentSummary)) return "uiDesign.designFidelity.alignmentSummary is required when UI implementation writes exist; record how the implemented UI aligns with the foundation, or list intentional deviations";
  return "";
}

function checkFoundation(work: Parameters<Checkpoint["check"]>[0], foundation: Record<string, any>) {
  const mode = stringAt(foundation.mode);
  if (!mode) return notSatisfied("uiDesign.foundation.mode must not be empty");
  const summary = stringAt(foundation.summary);
  if (!summary) return notSatisfied("uiDesign.foundation.summary must not be empty");

  if (mode === "brand-spec-existing") {
    const path = stringAt(foundation.brandSpecPath);
    if (!isRootFile(path, "brand-spec.md", work.cwd)) return notSatisfied(`uiDesign.foundation.brandSpecPath must be the project root brand-spec.md, currently: ${path || "<empty>"}`);
    const read = findReadEvidenceForPath(work, "brand-spec.md");
    if (!read) return notSatisfied("mode=brand-spec-existing requires really reading the project root brand-spec.md");
    return satisfied("read existing root brand-spec.md", [{ toolCallId: read.toolCallId }]);
  }

  if (mode === "brand-spec-created" || mode === "brand-spec-updated") {
    const path = stringAt(foundation.brandSpecPath);
    if (!isRootFile(path, "brand-spec.md", work.cwd)) return notSatisfied(`uiDesign.foundation.brandSpecPath must be the project root brand-spec.md, currently: ${path || "<empty>"}`);
    if (!stringAt(foundation.brandSpecActionReason)) return notSatisfied("when creating/updating brand-spec.md, uiDesign.foundation.brandSpecActionReason is required");
    const written = findRootBrandSpecWrite(work);
    if (!written) return notSatisfied("no real write/edit tool result for project root brand-spec.md found");
    const missingAssetEvidence = stringList(foundation.assetPaths).filter((path) => !findWriteEditForPath(work, path) && !findReadEvidenceForPath(work, path));
    if (missingAssetEvidence.length > 0) return notSatisfied(`uiDesign.foundation.assetPaths missing real read/write evidence: ${missingAssetEvidence.join(", ")}`);
    return satisfied(`${mode === "brand-spec-created" ? "created" : "updated"} root brand-spec.md`, [{ toolCallId: written.toolCallId }]);
  }

  if (mode === "design-system-only") {
    if (!stringAt(foundation.visualDirection)) return notSatisfied("mode=design-system-only requires uiDesign.foundation.visualDirection");
    if (!stringAt(foundation.brandSpecActionReason)) return notSatisfied("mode=design-system-only needs to explain why brand-spec.md is not written (brandSpecActionReason)");
    return satisfied("design-system-only foundation recorded");
  }

  return notSatisfied(`unknown uiDesign.foundation.mode: ${mode}; expected brand-spec-existing|brand-spec-created|brand-spec-updated|design-system-only`);
}

function findRootBrandSpecWrite(work: Parameters<Checkpoint["check"]>[0]) {
  const result = findWriteEditForPath(work, "brand-spec.md");
  if (!result || result.isError || !isWriteLike(result)) return undefined;
  const actualPath = extractToolPath(result);
  if (actualPath && !isRootFile(actualPath, "brand-spec.md", work.cwd)) return undefined;
  return result;
}

