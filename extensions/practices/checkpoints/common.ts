import type { Checkpoint, WorkState } from "../../core/types";
import { capturedIndex, findCaptured, findSuspectedUnrecognizedCommands, commandSegments, findSuccessfulSubstantiveCheck, isTestOrVerificationCommand, isWriteLike, findWriteEditForPath, extractToolPath, isRootFile, lastProductionWriteIndex, objectAt, stringAt, cleanVerificationResult } from "../helpers";

export function satisfied(details?: string, refs?: Array<{ toolCallId?: string; criterionId?: string }>): ReturnType<Checkpoint["check"]> {
  return details || refs ? { satisfied: true, details, refs } : { satisfied: true };
}

export function notSatisfied(reason: string): ReturnType<Checkpoint["check"]> {
  return { satisfied: false, reason };
}

export const criteriaCoverageCompleteCheckpoint: Checkpoint = {
  id: "criteria-coverage-complete",
  rule: "completionEvidence.criteriaCoverage must cover every item in acceptanceCriteria.",
  check(work) {
    const coverage = parseCriteriaCoverage(work.completionEvidence?.criteriaCoverage);
    const uncovered = work.acceptanceCriteria.filter((criterion) => {
      const item = coverage.find((entry) => entry.criterionId === criterion.id);
      return !item?.summary?.trim();
    });
    if (uncovered.length > 0) {
      return notSatisfied(`uncovered acceptance criteria: ${uncovered.map((item) => `${item.id} ${item.description}`).join("; ")}`);
    }
    return satisfied(`covered ${work.acceptanceCriteria.length} acceptance criteria`);
  },
};


export const verificationCommandPassedCheckpoint: Checkpoint = {
  id: "verification-command-passed",
  rule: "A real successful bash test/verification command tool_result with clean output must exist.",
  why: "Prevents 'claimed verification passed but no evidence'. init/develop/debug etc. must run one real successful verification command with clean output; 'should pass' is not enough.",
  recoveryHint: "Go back to the verification strategy you defined in docs/testing.md and run a real successful verification command with clean output (do not create a package.json / test script the project does not need, just to pass the checkpoint). toolCallId may be left empty; the system auto-infers the final clean verification from capturedToolResults.",
  check(work) {
    return requireSuccessfulVerification(work);
  },
};



export const projectMemoryWrittenCheckpoint: Checkpoint = {
  id: "project-memory-written",
  rule: "A real write/edit tool result for the project root PROJECT.md is required.",
  check(work) {
    const projectMemory = objectAt(work.completionEvidence?.projectMemory);
    const evidencePath = stringAt(projectMemory?.path) || "PROJECT.md";
    if (!isRootFile(evidencePath, "PROJECT.md", work.cwd)) {
      return notSatisfied(`projectMemory.path must be the project root PROJECT.md, currently: ${evidencePath}`);
    }
    const explicitId = stringAt(projectMemory?.writtenToolCallId);
    let result = explicitId ? findCaptured(work, explicitId) : undefined;
    if (!result) result = findWriteEditForPath(work, "PROJECT.md");
    if (!result) {
      return notSatisfied("no real write/edit tool result for project root PROJECT.md found");
    }
    if (!isWriteLike(result)) return notSatisfied(`referenced tool result is not write/edit: ${result.toolCallId}`);
    if (result.isError) return notSatisfied(`PROJECT.md write failed: ${result.toolCallId}`);
    const actualPath = extractToolPath(result);
    if (actualPath && !isRootFile(actualPath, "PROJECT.md", work.cwd)) {
      return notSatisfied(`referenced write is not project root PROJECT.md: ${actualPath}`);
    }
    return satisfied("project root PROJECT.md written", [{ toolCallId: result.toolCallId }]);
  },
};


export function requireCapturedRefs(work: WorkState, toolCallIds: string[], label: string): ReturnType<Checkpoint["check"]> {
  for (const toolCallId of toolCallIds) {
    const result = findCaptured(work, toolCallId);
    if (!result) return notSatisfied(`${label} referenced tool_result not found: ${toolCallId}`);
    if (result.isError) return notSatisfied(`${label} referenced tool_result failed: ${toolCallId}`);
  }
  return satisfied(`referenced ${toolCallIds.length} real tool results`, toolCallIds.map((toolCallId) => ({ toolCallId })));
}

export function requireSuccessfulWriteRefs(work: WorkState, toolCallIds: string[], label: string): ReturnType<Checkpoint["check"]> {
  for (const toolCallId of toolCallIds) {
    const result = findCaptured(work, toolCallId);
    if (!result) return notSatisfied(`${label} referenced tool_result not found: ${toolCallId}`);
    if (!isWriteLike(result)) return notSatisfied(`${label} reference must be write/edit: ${toolCallId}`);
    if (result.isError) return notSatisfied(`${label} referenced write/edit failed: ${toolCallId}`);
  }
  return satisfied(`referenced ${toolCallIds.length} real write results`, toolCallIds.map((toolCallId) => ({ toolCallId })));
}

function parseCriteriaCoverage(value: unknown): Array<{ criterionId: string; summary: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      criterionId: typeof item?.criterionId === "string" ? item.criterionId : "",
      summary: typeof item?.summary === "string" ? item.summary : "",
    }))
    .filter((item) => item.criterionId);
}

function requireSuccessfulVerification(work: WorkState): ReturnType<Checkpoint["check"]> {
  const verification = objectAt(work.completionEvidence?.verification);
  const lastWriteAt = lastProductionWriteIndex(work);

  // no-test bypass: when the project has no automated test suite, declare noTestSuite=true + a reason,
  // and run an ad-hoc command that "really loads/compiles/inspects the changed object"; it does not need to be a recognized test runner.
  // The substantive gate is enforced by isAdHocCheckCommand (blocks no-ops like `node -e 1`).
  if (verification?.noTestSuite === true) {
    const reason = stringAt(verification.noTestSuiteReason);
    if (!reason) return notSatisfied(`when verification.noTestSuite=true, verification.noTestSuiteReason must be filled explaining why this project has no automated test suite`);
    const adHoc = findSuccessfulSubstantiveCheck(work, lastWriteAt);
    if (adHoc) {
      return satisfied(`no-test bypass: found a real and clean check command: ${String(adHoc.input.command)}`, [{ toolCallId: adHoc.toolCallId }]);
    }
    return notSatisfied(`noTestSuite declared but no successful substantive check command found. Run a command that really loads/compiles/inspects the changed object, e.g. node -e "require('./x')", python -c "import x", pip show x, node --check x.js, python -m py_compile x.py, test -f .env; a bare no-op like node -e 1 does not count.`);
  }

  const requestedId = stringAt(verification?.testToolCallId).trim();
  if (requestedId) {
    const exact = findCaptured(work, requestedId);
    if (!exact) return notSatisfied(`completionEvidence.verification.testToolCallId=${requestedId} not found in capturedToolResults; if you do not know the real tool ID, remove this field and the system will auto-infer from successful verification bash — do not page through session logs to find an ID`);
    if (lastWriteAt >= 0 && capturedIndex(work, exact) <= lastWriteAt) return notSatisfied("referenced verification evidence occurred before the last production write; rerun the final verification after the delivered files are written");
    if (exact.toolName !== "bash") return notSatisfied(`referenced tool_result is not bash: ${requestedId}`);
    if (exact.isError) return notSatisfied(`referenced test command failed: ${requestedId}`);
    const clean = cleanVerificationResult(exact);
    if (!clean.ok) return notSatisfied(`referenced test command ${clean.reason}: ${requestedId}`);
    return satisfied(`referenced real and clean test result ${requestedId}`, [{ toolCallId: requestedId }]);
  }

  // Take the "last" successful and clean verification bash (not the first): the engineering-meaningful "final verification" is usually near the wrap-up phase.
  // If production writes exist, the verification must also be after the last one; an earlier green
  // result proves the pre-change state, not the delivered state.
  const inferred = [...(work.capturedToolResults ?? [])].reverse().find((result) => {
    const command = String(result.input.command ?? "");
    return result.toolName === "bash"
      && !result.isError
      && isTestOrVerificationCommand(command)
      && cleanVerificationResult(result).ok
      && (lastWriteAt < 0 || capturedIndex(work, result) > lastWriteAt);
  });
  if (inferred) {
    return satisfied(`found a real and clean verification command: ${String(inferred.input.command ?? "")}`, [{ toolCallId: inferred.toolCallId }]);
  }
  if (lastWriteAt >= 0) {
    return notSatisfied("successful verification evidence exists only before the last production write; rerun the final verification after the delivered files are written");
  }

  // Dynamic diagnosis: is there a bash that "looks like verification" but was rejected? Give the agent specific clues, not a generic npm hint.
  // (Problem 3: extracted to the shared findSuspectedUnrecognizedCommands helper. The helper uses
  // the UNIFIED isTestOrVerificationCommand filter, so commands Problem 1 newly recognizes no
  // longer appear here — the diagnostic shrinks as recognition widens.)
  const suspected = findSuspectedUnrecognizedCommands(work, { isSuccess: true });
  const detail = suspected.length > 0
    ? `saw suspected verification commands but none were recognized: ${suspected.slice(0, 2).map((r) => `\`${unrecognizedVerificationSegment(String(r.input.command ?? ""))}\``).join("; ")}`
    : "no successful test/verification bash tool_result with clean output found";
  return notSatisfied(`${detail}. Next: run a real successful verification command with clean output (npm test / pytest / cargo test / node --check / ./scripts/verify.sh etc.), or check the project's defined verification strategy in docs/testing.md. If this project has no automated test suite, set completionEvidence.verification.noTestSuite=true, fill noTestSuiteReason, and run a lightweight but substantive check command (e.g. test -f <changed-file>, node --check <file>, python -m py_compile <file>). toolCallId may be left empty; the system auto-infers the final clean verification from capturedToolResults.`);
}

function unrecognizedVerificationSegment(command: string): string {
  const segments = commandSegments(command).filter((segment) => !/^cd\b/.test(segment));
  const segment = segments.find((item) => /\b(test|verify|check|lint|build|vet|smoke|validate|spec|ci|unit|integration)\b/i.test(item))
    ?? segments.sort((a, b) => b.length - a.length)[0]
    ?? command.split("\n")[0]
    ?? "";
  return segment.length > 120 ? `${segment.slice(0, 117)}...` : segment;
}

