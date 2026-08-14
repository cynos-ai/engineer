import type { CapturedToolResult, Checkpoint } from "../../core/types";
import {
  arrayAt,
  browserBlockedFallback,
  debugBlock,
  capturedResultIndex,
  findBrowserEvidence,
  findCaptured,
  findFailedBash,
  findFailedBrowserAttempts,
  findReadEvidenceForPath,
  findSuccessfulVerificationBash,
  findWriteEditForPath,
  isBrowserEvidenceResult,
  isFailedBashResult,
  isSuccessfulCleanVerificationBashResult,
  objectAt,
  stringAt,
  stringList,
} from "../helpers";
import { satisfied, notSatisfied } from "./common";

export const debugReproductionCheckpoint: Checkpoint = {
  id: "debug-reproduction-evidenced",
  rule: "reproduction is OPTIONAL — root cause can be evidenced through logs/stack/tracing without reproducing (a mature logging system may pinpoint the cause directly). When reproduction IS declared, it must be a real failure result (or an unreproducible reason).",
  check(work) {
    const debug = debugBlock(work);
    if (!debug) return notSatisfied("missing completionEvidence.debugging");
    const reproduction = objectAt(debug.reproduction);
    // Reproduction is ONE path to root cause, not a requirement. A mature logging system, a stack
    // trace, or source tracing can pinpoint the cause without reproduction. If nothing is declared,
    // pass — rootCause carries the hard evidence requirement, and the investigation sequence gate
    // ensures the investigation preceded the fix.
    if (!reproductionDeclared(reproduction)) {
      return satisfied("no reproduction declared — root cause evidenced through logs/stack/tracing (reproduction is one path, not required)");
    }
    const kind = stringAt(reproduction?.kind);
    const toolCallId = stringAt(reproduction?.toolCallId);
    if (kind === "unreproducible") {
      if (stringAt(reproduction?.unreproducibleReason)) return satisfied("recorded unreproducible reason");
      return notSatisfied("when reproduction.kind=unreproducible, unreproducibleReason is required");
    }
    if (stringAt(reproduction?.unreproducibleReason)) return satisfied("recorded unreproducible reason");

    if (toolCallId) {
      const result = findCaptured(work, toolCallId);
      if (!result) return notSatisfied(`reproduction toolCallId not found: ${toolCallId}`);
      if (kind === "browser") {
        if (!isBrowserEvidenceResult(result)) return notSatisfied(`browser reproduction toolCallId must reference successful Playwright CLI direct browser evidence (snapshot/screenshot/console/requests/eval), not prose or a non-browser command: ${toolCallId}`);
        const firstFixWriteIndex = firstRealFixWriteIndex(work, debug);
        if (firstFixWriteIndex !== undefined && capturedResultIndex(work, result) >= firstFixWriteIndex) {
          return notSatisfied("browser reproduction evidence must be captured before the first real fix write; run the reported browser scenario before changing files, then verify again after the fix");
        }
        return satisfied(`referenced browser reproduction evidence ${toolCallId}`, [{ toolCallId }]);
      }
      if (kind === "manual") {
        if (result.isError) return notSatisfied(`reproduction referenced tool result failed: ${toolCallId}`);
        return satisfied(`referenced reproduction evidence ${toolCallId}`, [{ toolCallId }]);
      }
      if (result.toolName !== "bash") return notSatisfied(`reproduction is not a bash result: ${toolCallId}`);
      if (!result.isError) return notSatisfied(`reproduction should be a failed result, but this bash succeeded: ${toolCallId}`);
      return satisfied(`referenced reproduction evidence ${toolCallId}`, [{ toolCallId }]);
    }

    if (kind === "browser") {
      if (!stringAt(reproduction?.summary)) return notSatisfied("browser reproduction requires reproduction.summary plus captured Playwright CLI direct browser evidence or strict blocked fallback");
      const firstFixWriteIndex = firstRealFixWriteIndex(work, debug);
      const allDirectEvidence = findBrowserEvidence(work);
      const directEvidence = allDirectEvidence.filter((result) => firstFixWriteIndex === undefined || capturedResultIndex(work, result) < firstFixWriteIndex);
      if (directEvidence.length > 0) return satisfied("browser reproduction with captured Playwright CLI direct browser evidence before the fix", [{ toolCallId: directEvidence[0].toolCallId }]);
      const blocked = browserBlockedFallbackBeforeFix(work, firstFixWriteIndex);
      if (blocked) return satisfied(`browser reproduction environment blocked before the fix with strict fallback recorded: ${blocked}`);
      if (firstFixWriteIndex !== undefined && allDirectEvidence.length > 0) return notSatisfied("browser reproduction evidence must be captured before the first real fix write; run the reported browser scenario before changing files, then verify again after the fix");
      if (firstFixWriteIndex !== undefined && browserBlockedFallback(work)) return notSatisfied("browser-blocked reproduction attempts must be captured before the first real fix write; failed browser attempts after the fix do not prove reproduction");
      return notSatisfied("browser reproduction requires captured Playwright CLI direct browser evidence (snapshot/screenshot/console/requests/eval) or strict blocked fallback with >=2 real failed browser attempts; diagnostics.browserEvidence/networkEvidence text is only a summary");
    }

    if (kind === "manual") {
      const hasManualSteps = arrayAt(reproduction?.steps).length > 0 && stringAt(reproduction?.expected) && stringAt(reproduction?.actual);
      if (stringAt(reproduction?.summary) || hasManualSteps) return satisfied("manual reproduction recorded");
      return notSatisfied("manual reproduction requires summary, or steps + expected + actual");
    }

    const failed = findFailedBash(work);
    if (!failed) return notSatisfied("missing failed reproduction evidence: first run a command that reproduces the issue (a failed bash), or provide browser/manual reproduction evidence or reproduction.unreproducibleReason");
    return satisfied("inferred reproduction failure evidence", [{ toolCallId: failed.toolCallId }]);
  },
};

export const debugDiagnosticsCheckpoint: Checkpoint = {
  id: "debug-diagnostics-recorded",
  rule: "debug must record the diagnostic evidence sources for the bug; failed tests/commands need a key error/log/stack excerpt, and browser/user-flow needs browser/network evidence or a blocked reason.",
  check(work) {
    const debug = debugBlock(work);
    if (!debug) return notSatisfied("missing completionEvidence.debugging");
    const diagnostics = objectAt(debug.diagnostics);
    if (!diagnostics) return notSatisfied("missing diagnostics");

    const evidenceRead = stringList(diagnostics.evidenceRead);
    const browserEvidence = stringAt(diagnostics.browserEvidence);
    const browserBlockedReason = stringAt(diagnostics.browserBlockedReason ?? diagnostics.blockedReason);
    const networkEvidence = stringAt(diagnostics.networkEvidence);

    const hasDiagnosticSource = evidenceRead.length > 0 || Boolean(browserEvidence) || Boolean(networkEvidence) || Boolean(browserBlockedReason) || Boolean(browserBlockedFallback(work));
    if (!hasDiagnosticSource) {
      return notSatisfied("diagnostics must record at least one diagnostic source: evidenceRead[] (key error/log/stack/db excerpt, sanitized) or browserEvidence/networkEvidence/browserBlockedReason");
    }

    const hasBrowserNetworkEvidence = Boolean(browserEvidence) || Boolean(networkEvidence);
    const failedWithErrorLikeOutput = (work.capturedToolResults ?? []).some((result) => isFailedBashWithErrorLikeOutput(result));
    const issueHasReferencedFailure = referencedFailureHasErrorLikeOutput(work, debug);
    const shouldRequireErrorSummary = issueHasReferencedFailure || (failedWithErrorLikeOutput && !hasBrowserNetworkEvidence);
    if (shouldRequireErrorSummary && evidenceRead.length === 0) {
      return notSatisfied("reproduction/verification output contains error/stack/log signals, but diagnostics.evidenceRead[] is empty; summarize the key error, log, or stack");
    }

    const reproduction = objectAt(debug.reproduction);
    if (stringAt(reproduction?.kind) === "browser" && !browserEvidence && !networkEvidence && !browserBlockedReason && !browserBlockedFallback(work)) {
      return notSatisfied("this is a browser/user-flow reproduction, but diagnostics is missing browserEvidence/networkEvidence or a strict browser-blocked fallback");
    }

    return satisfied("diagnostic evidence recorded");
  },
};

function firstRealFixWriteIndex(work: Parameters<Checkpoint["check"]>[0], debug: Record<string, any>): number | undefined {
  const fix = objectAt(debug.fix);
  const writes = arrayAt(fix?.filesChanged)
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean)
    .map((file) => findWriteEditForPath(work, file))
    .filter((result): result is CapturedToolResult => Boolean(result))
    .map((result) => capturedResultIndex(work, result))
    .filter((index) => index >= 0);
  return writes.length > 0 ? Math.min(...writes) : undefined;
}

// Whether the agent declared any reproduction field at all. Reproduction is optional — when this
// returns false, the reproduction and regression checkpoints skip (root cause may be evidenced
// through logs/stack/tracing without reproduction).
function reproductionDeclared(reproduction: Record<string, unknown> | undefined): boolean {
  if (!reproduction) return false;
  return Boolean(stringAt(reproduction.kind) || stringAt(reproduction.toolCallId) || stringAt(reproduction.summary) || stringAt(reproduction.unreproducibleReason) || arrayAt(reproduction.steps).length > 0);
}


function browserBlockedFallbackBeforeFix(work: Parameters<Checkpoint["check"]>[0], firstFixWriteIndex: number | undefined): string {
  const blocked = browserBlockedFallback(work);
  if (!blocked) return "";
  if (firstFixWriteIndex === undefined) return blocked;
  const attemptsBeforeFix = findFailedBrowserAttempts(work).filter((result) => capturedResultIndex(work, result) >= 0 && capturedResultIndex(work, result) < firstFixWriteIndex);
  return attemptsBeforeFix.length >= 2 ? blocked : "";
}

function isFailedBashWithErrorLikeOutput(result: CapturedToolResult): boolean {
  if (result.toolName !== "bash" || !result.isError) return false;
  return /error|exception|stack|trace|fail|failed/i.test(result.outputSummary);
}

function referencedFailureHasErrorLikeOutput(work: Parameters<Checkpoint["check"]>[0], debug: Record<string, any>): boolean {
  const reproduction = objectAt(debug.reproduction);
  const regression = objectAt(debug.regression);
  const ids = [stringAt(reproduction?.toolCallId), stringAt(regression?.failingToolCallId)].filter(Boolean);
  if (ids.length === 0) return false;
  return ids.some((id) => {
    const result = findCaptured(work, id);
    return result ? isFailedBashWithErrorLikeOutput(result) : false;
  });
}

export const debugInvestigationCheckpoint: Checkpoint = {
  id: "debug-investigation-recorded",
  rule: "debug must record targeted investigation: related source/test files actually read. The symptom->root-cause tracing chain is skill-guided and recorded in rootCause.evidence rather than a separate hard-gated field.",
  check(work) {
    const debug = debugBlock(work);
    if (!debug) return notSatisfied("missing completionEvidence.debugging");
    const investigation = objectAt(debug.investigation);
    if (!investigation) return notSatisfied("missing investigation");
    const relatedFilesRead = stringList(investigation.relatedFilesRead);
    if (relatedFilesRead.length === 0) return notSatisfied("missing investigation.relatedFilesRead[]: list the source/test files you read to locate the root cause");
    for (const file of relatedFilesRead) {
      if (!findReadEvidenceForPath(work, file)) {
        return notSatisfied(`investigation.relatedFilesRead missing real read evidence: ${file}. Ensure this file has a read tool result (pre-start reads are carried over; pre-start bash is not).`);
      }
    }
    // Sequence gate: root-cause investigation must happen BEFORE the fix write. A root cause
    // "found" after the fix is already written is post-hoc rationalization — it cannot have shaped
    // the fix. At least one relatedFilesRead must precede the first real fix write.
    const firstFixWriteIndex = firstRealFixWriteIndex(work, debug);
    if (firstFixWriteIndex !== undefined) {
      const readBeforeFix = relatedFilesRead.some((file) => {
        const evidence = findReadEvidenceForPath(work, file);
        const idx = evidence ? capturedResultIndex(work, evidence) : -1;
        return idx >= 0 && idx < firstFixWriteIndex;
      });
      if (!readBeforeFix) {
        return notSatisfied(`Why: root-cause investigation (reading the relevant source/log files) must happen BEFORE the fix write. All investigation.relatedFilesRead reads are at/after the first fix write — that is post-hoc rationalization, not investigation that could shape the fix. Next: if the fix was written before investigating, it was a guess-fix; re-investigate from the logs/source to form an evidence-backed root cause before trusting it.`);
      }
    }
    return satisfied(`investigation recorded, ${relatedFilesRead.length} related files read`);
  },
};

export const debugRootCauseCheckpoint: Checkpoint = {
  id: "debug-root-cause-recorded",
  rule: "debug must record rootCause.summary and an evidence chain, not just describe symptoms or guess fixes.",
  check(work) {
    const debug = debugBlock(work);
    if (!debug) return notSatisfied("missing completionEvidence.debugging");
    const rootCause = objectAt(debug.rootCause);
    if (!stringAt(rootCause?.summary)) return notSatisfied("missing rootCause.summary");
    if (arrayAt(rootCause?.evidence).length === 0) {
      return notSatisfied("missing rootCause.evidence[]: list root-cause evidence in an array (stack, log, read source, traced flow), do not just describe the symptom");
    }
    return satisfied("root cause recorded");
  },
};

export const debugFixCheckpoint: Checkpoint = {
  id: "debug-fix-recorded",
  rule: "debug must record a fix summary; when files are changed, list filesChanged, and when no files are changed, explain noFileChangeReason.",
  check(work) {
    const debug = debugBlock(work);
    if (!debug) return notSatisfied("missing completionEvidence.debugging");
    const fix = objectAt(debug.fix);
    if (!fix) return notSatisfied("missing fix");
    if (!stringAt(fix.summary)) return notSatisfied("missing fix.summary");
    const filesChanged = arrayAt(fix.filesChanged).map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
    if (filesChanged.length === 0 && !stringAt(fix.noFileChangeReason)) {
      return notSatisfied("fix needs filesChanged[] or noFileChangeReason");
    }
    for (const file of filesChanged) {
      const evidence = findWriteEditForPath(work, file);
      if (!evidence) return notSatisfied(`fix.filesChanged missing real write/edit evidence: ${file}`);
    }
    return satisfied(`fix recorded${filesChanged.length > 0 ? `, ${filesChanged.length} files changed` : " (no file change)"}`);
  },
};

export const debugRegressionCheckpoint: Checkpoint = {
  id: "debug-regression-evidenced",
  rule: "regression red/green is OPTIONAL when there is no reproduction (root cause evidenced via logs/stack/tracing has no red to turn green). When the bug WAS reproduced, red/green (or an unavailable reason) is expected.",
  check(work) {
    const debug = debugBlock(work);
    if (!debug) return notSatisfied("missing completionEvidence.debugging");
    const reproduction = objectAt(debug.reproduction);
    const regression = objectAt(debug.regression);
    // Regression red/green only makes sense when the bug was reproduced (there is a red to turn
    // green). When root cause was evidenced through logs/stack/tracing without reproduction, there
    // is no red — regression does not apply. verification (fix doesn't break existing functionality)
    // still covers fix safety.
    if (!reproductionDeclared(reproduction)) {
      return satisfied("no reproduction → regression red/green not applicable; verification covers fix safety");
    }
    const failingId = stringAt(regression?.failingToolCallId);
    const passingId = stringAt(regression?.passingToolCallId);
    if (failingId || passingId) {
      if (!failingId || !passingId) return notSatisfied("regression requires both failingToolCallId and passingToolCallId");
      const failing = findCaptured(work, failingId);
      const passing = findCaptured(work, passingId);
      if (!failing || !passing) return notSatisfied("regression referenced tool_result not found");
      if (failing.toolName !== "bash" || passing.toolName !== "bash") return notSatisfied("regression references must be bash results");
      if (!isFailedBashResult(failing)) return notSatisfied(`regression.failingToolCallId must reference failed reproduction/regression evidence (normal failed bash or echo-masked test/verification failure with failure output): ${failingId}`);
      if (!isSuccessfulCleanVerificationBashResult(passing)) return notSatisfied(`regression.passingToolCallId must reference a successful clean test/verification command; echo-masked failed tests and non-test commands are not valid green: ${passingId}`);
      return satisfied("regression red/green evidence recorded", [{ toolCallId: failingId }, { toolCallId: passingId }]);
    }
    if (stringAt(regression?.unavailableReason) && stringAt(regression?.alternativeVerification)) {
      return satisfied("regression automation unavailable; reason and alternative verification recorded");
    }
    const failed = findFailedBash(work);
    const passing = findSuccessfulVerificationBash(work);
    if (!failed || !passing) {
      return notSatisfied("missing red/green regression test evidence: first capture one failed bash (red), then run one successful verification command after the fix (green); or provide unavailableReason + alternativeVerification");
    }
    return satisfied("inferred regression red/green evidence", [{ toolCallId: failed.toolCallId }, { toolCallId: passing.toolCallId }]);
  },
};

export const debugProjectImpactCheckpoint: Checkpoint = {
  id: "debug-project-impact-recorded",
  rule: "if debug declares updating durable project memory/docs, there must be real write/edit evidence; when no update is declared, completion is not blocked by missing ceremony fields.",
  check(work) {
    const projectImpact = objectAt(work.completionEvidence?.projectImpact);
    if (!projectImpact) return satisfied("no durable project memory/docs update declared; projectImpact description is guided by the skill, not a hard gate");

    const updatedFiles = arrayAt(projectImpact.updatedFiles).map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
    if (projectImpact.durableMemoryUpdateNeeded === true || updatedFiles.length > 0) {
      if (updatedFiles.length === 0) return notSatisfied("Why: when debug declares updating durable project memory/docs, it must prove real writes to prevent oral claims of updates. Missing: projectImpact.updatedFiles[] is empty. Next: list the actually updated PROJECT.md/docs files and ensure real write/edit evidence; if not updated, do not declare durableMemoryUpdateNeeded=true.");
      for (const file of updatedFiles) {
        const evidence = findWriteEditForPath(work, file);
        if (!evidence) return notSatisfied(`Why: when debug declares updating durable project memory/docs, it must prove real writes. Missing: projectImpact.updatedFiles missing real write/edit evidence: ${file}. Next: actually write the file, or remove the not-updated file from updatedFiles.`);
      }
      return satisfied("real write evidence verified for projectImpact.updatedFiles");
    }
    return satisfied("no durable project memory/docs update declared; projectImpact reason ceremony not required");
  },
};
