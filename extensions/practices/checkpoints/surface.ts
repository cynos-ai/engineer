import type { Checkpoint, WorkState } from "../../core/types";
import { browserBlockedFallback, extractToolPath, findBrowserEvidence, findFailedBrowserAttempts, isWriteLike, objectAt, pathLooksLikeStrongUiArtifact, stringAt, stringList } from "../helpers";
import { notSatisfied, satisfied } from "./common";

export const surfaceVerificationEvidenceIfRequiredCheckpoint: Checkpoint = {
  id: "surface-verification-evidence-if-required",
  rule: "When strong-UI files are written, direct browser evidence is required; generic verification/e2e commands are not enough to prove frontend behavior.",
  check(work) {
    const uiWrites = strongUiWrites(work);
    if (uiWrites.length === 0) return satisfied("no strong-UI file writes detected; skipping the direct-browser-evidence hard requirement");
    const evidence = surfaceVerificationEvidence(work);
    if (evidence.length === 0) {
      const blocked = browserBlockedFallback(work);
      if (blocked) return satisfied(`direct browser environment blocked with strict fallback recorded: ${blocked}`);
      return notSatisfied(`strong-UI file writes detected but no direct browser evidence: ${uiWrites.map((item) => extractToolPath(item)).filter(Boolean).join(", ")}. Either capture direct browser evidence, or record strict blocked fallback (${browserBlockedFallbackProblem(work)}).`);
    }
    return satisfied(`found ${evidence.length} direct browser evidence items`, evidence.slice(0, 5).map((result) => ({ toolCallId: result.toolCallId })));
  },
};

function strongUiWrites(work: WorkState) {
  return (work.capturedToolResults ?? []).filter((result) => isWriteLike(result) && !result.isError && pathLooksLikeStrongUiArtifact(extractToolPath(result)));
}

export { browserBlockedFallback };

function browserBlockedFallbackProblem(work: WorkState): string {
  const surfaceVerification = objectAt(work.completionEvidence?.surfaceVerification);
  if (!surfaceVerification) return "missing surfaceVerification.blockedReason, attemptedApproaches[] >= 2, alternativeVerification, degradedEvidence, and >=2 real failed browser attempts";
  const missing: string[] = [];
  if (!stringAt(surfaceVerification.blockedReason)) missing.push("blockedReason");
  if (stringList(surfaceVerification.attemptedApproaches).length < 2) missing.push("attemptedApproaches[] >= 2");
  if (!stringAt(surfaceVerification.alternativeVerification)) missing.push("alternativeVerification");
  if (!stringAt(surfaceVerification.degradedEvidence)) missing.push("degradedEvidence");
  const failedAttempts = findFailedBrowserAttempts(work).length;
  if (failedAttempts < 2) missing.push(`>=2 real failed browser attempts (found ${failedAttempts})`);
  return missing.length > 0 ? `missing ${missing.join(", ")}` : "strict fallback fields are present but were not accepted";
}

export function surfaceVerificationEvidence(work: WorkState) {
  return findBrowserEvidence(work);
}
