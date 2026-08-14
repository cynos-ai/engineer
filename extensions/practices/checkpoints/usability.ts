import type { Checkpoint, WorkState } from "../../core/types";
import { capturedResultIndex, findCaptured, findBrowserEvidence, findFailedBrowserAttempts, findWriteEditsForPath, extractToolPath, isBrowserEvidenceResult, isOutsideProjectPath, isWriteLike, normalizePath, objectAt, arrayAt, stringAt, toProjectRelativePath } from "../helpers";
import { satisfied, notSatisfied } from "./common";

/**
 * Whether usability.browserBlocked holds: requires reason, degradedEvidence, attemptedApproaches >=2,
 * and at least two real failed browser attempts to prevent a one-sentence bypass.
 */
export function usabilityBrowserBlocked(work: WorkState): boolean {
  const blocked = objectAt(objectAt(work.completionEvidence?.usability)?.browserBlocked);
  if (!blocked) return false;
  if (findBrowserEvidence(work).length > 0) return false;
  return Boolean(stringAt(blocked.reason))
    && Boolean(stringAt(blocked.degradedEvidence))
    && arrayAt(blocked.attemptedApproaches).length >= 2
    && findFailedBrowserAttempts(work).length >= 2;
}

/**
 * Whether an evidence object (before/after) contains explicit evidence fields (screenshot/snapshot/console/network paths).
 * viewport alone does not count as evidence (it is just metadata).
 */
function evidenceObjectHasDeclaredFields(evidenceObj: unknown): boolean {
  const obj = objectAt(evidenceObj);
  if (!obj) return false;
  return Boolean(stringAt(obj.screenshot))
    || Boolean(stringAt(obj.snapshot))
    || arrayAt(obj.consoleErrors).length > 0
    || arrayAt(obj.networkErrors).length > 0;
}

/**
 * Whether before/after has browser evidence:
 * 1. explicit evidenceToolCallId reference (present and direct Playwright CLI browser evidence);
 * 2. when browserBlocked, accept a degraded single-evidence type (the object just needs to exist);
 * 3. otherwise require captured direct browser evidence somewhere in the work.
 * Declared screenshot/snapshot path strings are metadata only; they do not prove browser evidence by themselves.
 */
function observationEvidenceHasProof(work: WorkState, evidenceObj: unknown, browserBlocked: boolean): boolean {
  const obj = objectAt(evidenceObj);
  if (!obj) return false;
  const toolCallId = stringAt(obj.evidenceToolCallId);
  if (toolCallId) {
    const result = findCaptured(work, toolCallId);
    if (!result || result.isError) return false;
    return isBrowserEvidenceResult(result);
  }
  const hasDeclaredFields = evidenceObjectHasDeclaredFields(obj);
  if (browserBlocked) return hasDeclaredFields || Object.keys(obj).length > 0;
  return findBrowserEvidence(work).length > 0;
}

function pathIsUsabilityArtifact(path: string, cwd?: string): boolean {
  const normalized = normalizePath(toProjectRelativePath(path, cwd)).replace(/^\.\//, "");
  if (!normalized) return false;
  return normalized.startsWith(".cynos/")
    || normalized.startsWith(".playwright-cli/")
    || normalized.startsWith(".cache/")
    || normalized.startsWith("tmp/")
    || normalized.startsWith("temp/")
    || normalized.startsWith("scratch/");
}

function capturedIndex(work: WorkState, result: unknown): number {
  if (!result || typeof result !== "object") return -1;
  return capturedResultIndex(work, result as any);
}

function fixWriteEvidenceForObservation(work: WorkState, observation: Record<string, any>): { filesChanged: string[]; writes: any[]; outsidePath?: string; artifactPath?: string; missingPath?: string } {
  const fix = objectAt(observation.fix);
  const filesChanged = arrayAt(fix?.filesChanged).map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  const writes: any[] = [];
  for (const file of filesChanged) {
    if (isOutsideProjectPath(file, work.cwd)) return { filesChanged, writes, outsidePath: file };
    if (pathIsUsabilityArtifact(file, work.cwd)) return { filesChanged, writes, artifactPath: file };
    const matches = findWriteEditsForPath(work, file);
    if (matches.length === 0) return { filesChanged, writes, missingPath: file };
    writes.push(...matches);
  }
  return { filesChanged, writes };
}

function browserEvidenceIndexForToolCall(work: WorkState, toolCallId: string): number {
  const result = findCaptured(work, toolCallId);
  if (!result || result.isError || !isBrowserEvidenceResult(result)) return -1;
  return capturedResultIndex(work, result);
}

function failedBrowserAttemptsBefore(work: WorkState, boundaryIndex: number): boolean {
  return findFailedBrowserAttempts(work).filter((result) => capturedResultIndex(work, result) >= 0 && capturedResultIndex(work, result) < boundaryIndex).length >= 2;
}

export const usabilityObservationsCheckpoint: Checkpoint = {
  id: "usability-observations-structured",
  rule: "usability must record target viewports/scenarios and structured observations; each observation has id/severity/summary/area/before browser evidence/status; blocking/important fixed ones need fix+after, deferred/wontfix ones need a reason.",
  check(work) {
    const usability = objectAt(work.completionEvidence?.usability);
    if (!usability) return notSatisfied("missing completionEvidence.usability");
    if (arrayAt(usability.targets).length === 0) return notSatisfied("usability.targets needs at least 1 item");

    const observations = arrayAt(usability.observations);
    if (observations.length === 0) return notSatisfied("usability.observations needs at least 1 item");

    const browserBlocked = usabilityBrowserBlocked(work);

    for (const [index, observation] of observations.entries()) {
      const item = objectAt(observation);
      if (!item) return notSatisfied(`observation #${index + 1} is not an object`);
      const id = stringAt(item.id);
      const label = id || `#${index + 1}`;
      if (!id) return notSatisfied(`observation #${index + 1} missing id (e.g. 'obs-1')`);
      const severity = stringAt(item.severity);
      if (!["blocking", "important", "minor"].includes(severity))
        return notSatisfied(`observation ${label} missing severity; it must be blocking / important / minor`);
      if (!stringAt(item.summary)) return notSatisfied(`observation ${label} missing summary`);
      if (!stringAt(item.area)) return notSatisfied(`observation ${label} missing area (e.g. 'responsive / mobile menu')`);

      if (!observationEvidenceHasProof(work, item.before, browserBlocked))
        return notSatisfied(`observation ${label} missing before browser evidence${browserBlocked ? "" : " (screenshot/snapshot/console etc.)"}`);

      const status = stringAt(item.status);
      if (!["fixed", "deferred", "wontfix"].includes(status))
        return notSatisfied(`observation ${label} missing status; it must be fixed / deferred / wontfix`);

      if (status === "fixed") {
        if (!objectAt(item.fix)) return notSatisfied(`observation ${label} status=fixed but missing fix (fix content is validated by usability-fixes-evidenced)`);
        if (!objectAt(item.after)) return notSatisfied(`observation ${label} status=fixed but missing after (browser evidence of re-checking the same scenario)`);
      } else if (severity === "blocking" || severity === "important") {
        if (!stringAt(item.deferredReason))
          return notSatisfied(`observation ${label} is ${severity} but status=${status}; deferredReason must be filled (blocking/important issues must not be silently skipped)`);
      }
    }
    return satisfied(`recorded ${observations.length} structured usability observations`);
  },
};

export const usabilityFixesCheckpoint: Checkpoint = {
  id: "usability-fixes-evidenced",
  rule: "usability status=fixed observations must have fix (summary + real product filesChanged writes) and after browser evidence; observe-only (no fixed observation) is allowed to pass.",
  check(work) {
    const usability = objectAt(work.completionEvidence?.usability);
    if (!usability) return notSatisfied("missing completionEvidence.usability");

    const observations = arrayAt(usability.observations).map((obs) => objectAt(obs)).filter((obs): obs is Record<string, any> => Boolean(obs));
    const fixedObservations = observations.filter((obs) => stringAt(obs?.status) === "fixed");

    if (fixedObservations.length === 0) {
      return satisfied("observe-only mode: no status=fixed observation, skipping fix/re-observe requirements");
    }

    const browserBlocked = usabilityBrowserBlocked(work);
    const allFixWrites: any[] = [];

    for (const obs of fixedObservations) {
      const id = stringAt(obs.id);
      const label = id || "observation";
      const fix = objectAt(obs.fix);
      if (!fix) return notSatisfied(`${label} status=fixed but missing fix`);
      if (!stringAt(fix.summary)) return notSatisfied(`${label} fix.summary must not be empty`);

      const fixWrites = fixWriteEvidenceForObservation(work, obs);
      if (fixWrites.filesChanged.length === 0) {
        if (stringAt(fix.noFileChangeReason)) {
          return notSatisfied(`${label} status=fixed cannot use noFileChangeReason as the fix boundary; record a real filesChanged[] write/edit or mark the observation deferred for observe-only work`);
        }
        return notSatisfied(`${label} fix needs filesChanged[] with real project file writes`);
      }
      if (fixWrites.outsidePath) return notSatisfied(`${label} fix.filesChanged must be an in-project product file: ${fixWrites.outsidePath}`);
      if (fixWrites.artifactPath) return notSatisfied(`${label} fix.filesChanged cannot use evidence/cache/scratch artifact as a fix file: ${fixWrites.artifactPath}`);
      if (fixWrites.missingPath) return notSatisfied(`${label} fix.filesChanged missing real write/edit evidence: ${fixWrites.missingPath}`);
      allFixWrites.push(...fixWrites.writes);

      const writeIndexes = fixWrites.writes.map((result) => capturedIndex(work, result)).filter((index) => index >= 0);
      const firstObservationWrite = Math.min(...writeIndexes);
      const lastObservationWrite = Math.max(...writeIndexes);
      const beforeToolCallId = stringAt(objectAt(obs.before)?.evidenceToolCallId);
      if (beforeToolCallId) {
        const beforeIndex = browserEvidenceIndexForToolCall(work, beforeToolCallId);
        if (beforeIndex < 0 || beforeIndex >= firstObservationWrite) {
          return notSatisfied(`${label} before.evidenceToolCallId must point to Playwright CLI browser evidence before this observation's first fix write`);
        }
      }
      const afterToolCallId = stringAt(objectAt(obs.after)?.evidenceToolCallId);
      if (afterToolCallId) {
        const afterIndex = browserEvidenceIndexForToolCall(work, afterToolCallId);
        if (afterIndex < 0 || afterIndex <= lastObservationWrite) {
          return notSatisfied(`${label} after.evidenceToolCallId must point to Playwright CLI browser evidence after this observation's last fix write`);
        }
      }

      if (!observationEvidenceHasProof(work, obs.after, browserBlocked)) {
        return notSatisfied(`${label} status=fixed but missing after browser evidence${browserBlocked ? "" : " (snapshot/screenshot/console etc. of re-checking the same scenario)"}`);
      }
    }
    const writeIndexes = allFixWrites.map((result) => capturedIndex(work, result)).filter((index) => index >= 0);
    if (writeIndexes.length > 0) {
      const firstFixWrite = Math.min(...writeIndexes);
      const lastFixWrite = Math.max(...writeIndexes);
      if (browserBlocked) {
        if (!failedBrowserAttemptsBefore(work, firstFixWrite)) {
          return notSatisfied("usability browserBlocked fallback requires at least two real failed Playwright CLI attempts before the first fix write");
        }
      } else {
        const browserIndexes = findBrowserEvidence(work).map((result) => capturedResultIndex(work, result)).filter((index) => index >= 0);
        if (!browserIndexes.some((index) => index < firstFixWrite)) {
          return notSatisfied("usability before browser evidence must be captured before the first fix write; observe the page before changing files");
        }
        if (!browserIndexes.some((index) => index > lastFixWrite)) {
          return notSatisfied("usability after browser evidence must be captured after the last fix write; re-observe after all page changes");
        }
      }
    }
    return satisfied(`recorded fix content and re-check evidence for ${fixedObservations.length} fixes`);
  },
};

export const usabilityScopeCheckpoint: Checkpoint = {
  id: "usability-scope-recorded",
  rule: "usability must explicitly declare whether business/product behavior is preserved (scope.behaviorPreserved + summary); declared functional changes produce a soft warning in details but do not block.",
  check(work) {
    const scope = objectAt(objectAt(work.completionEvidence?.usability)?.scope);
    if (!scope) return notSatisfied("missing completionEvidence.usability.scope");
    if (typeof scope.behaviorPreserved !== "boolean") return notSatisfied("usability.scope.behaviorPreserved must be a boolean");
    if (!stringAt(scope.behaviorPreservedSummary)) return notSatisfied("usability.scope.behaviorPreservedSummary must not be empty");

    const functionalChanges = arrayAt(scope.functionalChangesIntroduced).filter((item) => typeof item === "string" && item.trim());
    if (functionalChanges.length > 0) {
      return satisfied(`soft warning in details: usability declared functional changes (${functionalChanges.join("; ")}), which may belong in develop`, undefined);
    }
    return satisfied("scope declared: functional behavior preserved");
  },
};

export const usabilityReportCheckpoint: Checkpoint = {
  id: "usability-report-structured",
  rule: "usability must provide a structured report: summary, observationsSummary, fixesSummary, behaviorPreserved, evidence; when browser-evidence files are written, screenshots must not be empty.",
  check(work) {
    const report = objectAt(work.completionEvidence?.report);
    if (!report) return notSatisfied("missing completionEvidence.report");
    for (const field of ["summary", "observationsSummary", "fixesSummary", "behaviorPreserved"]) {
      if (!stringAt(report[field])) return notSatisfied(`report.${field} must not be empty`);
    }
    if (arrayAt(report.evidence).length === 0) return notSatisfied("report.evidence[] must not be empty");

    const scope = objectAt(objectAt(work.completionEvidence?.usability)?.scope);
    if (arrayAt(scope?.pageInteractionChanges).length > 0 && arrayAt(report.pageInteractionChanges).length === 0) {
      return notSatisfied("usability.scope.pageInteractionChanges[] was declared, but report.pageInteractionChanges[] is empty");
    }
    if (arrayAt(scope?.functionalChangesIntroduced).length > 0 && arrayAt(report.functionalChangesIntroduced).length === 0) {
      return notSatisfied("usability.scope.functionalChangesIntroduced[] was declared, but report.functionalChangesIntroduced[] is empty");
    }

    const artifactWrites = (work.capturedToolResults ?? []).filter((result) => {
      if (!isWriteLike(result) || result.isError) return false;
      return /\.cynos\/browser-evidence\//.test(extractToolPath(result));
    });
    if (artifactWrites.length > 0 && arrayAt(report.screenshots).length === 0) {
      return notSatisfied(".cynos/browser-evidence/ writes detected, but report.screenshots[] is empty");
    }

    const usability = objectAt(work.completionEvidence?.usability);
    const deferredBlockingOrImportant = arrayAt(usability?.observations)
      .map((obs) => objectAt(obs))
      .filter((obs): obs is Record<string, any> => {
        if (!obs) return false;
        const severity = stringAt(obs.severity);
        const status = stringAt(obs.status);
        return (severity === "blocking" || severity === "important") && (status === "deferred" || status === "wontfix");
      });
    if (deferredBlockingOrImportant.length > 0 && arrayAt(report.deferredItems).length === 0) {
      return notSatisfied("blocking/important observations were deferred/wontfix, but report.deferredItems[] is empty");
    }
    return satisfied("structured usability report recorded");
  },
};
