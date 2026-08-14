import type { Checkpoint } from "../../core/types";
import { objectAt, stringAt, isGitCommitCommand, isGitStatusCommand } from "../helpers";
import { listProjectContentMutations } from "../mutation-targets";
import { satisfied, notSatisfied } from "./common";

export const changeFinalizationRecordedCheckpoint: Checkpoint = {
  id: "change-finalization-recorded",
  rule: "Before a modifying work completes, it must record verification, git status, and a local commit decision; committed requires a real git commit, and git status evidence is required (non-git projects may explain).",
  check(work) {
    const finalization = objectAt(work.completionEvidence?.finalization);
    if (!finalization) return notSatisfied("missing completionEvidence.finalization");
    if (!stringAt(finalization.verificationSummary)) return notSatisfied("finalization.verificationSummary must not be empty");
    const gitSummary = stringAt(finalization.gitSummary);
    if (!gitSummary) return notSatisfied("finalization.gitSummary must not be empty (at least describe branch, working-tree status, and whether there are uncommitted changes; non-git projects must explain)");

    const commit = objectAt(finalization.commit);
    if (!commit) return notSatisfied("missing finalization.commit");
    const status = stringAt(commit.status);
    if (!["committed", "not-committed", "failed"].includes(status)) return notSatisfied("finalization.commit.status must be committed / not-committed / failed");

    const gitStatus = findSuccessfulGitStatus(work);
    const notGit = findNonGitStatusAttempt(work);
    // Functional regex: keeps Chinese keywords (非 git/无 git) that agents may write in gitSummary.
    if (!gitStatus && !(notGit && /非\s*git|not\s+a\s+git|no\s+git|无\s*git/i.test(gitSummary))) {
      return notSatisfied("missing real git status evidence; for non-git projects, run git status to capture the failure and explain in gitSummary that it is not a git repository");
    }

    if (status === "committed") {
      if (!stringAt(commit.commitHash) && !stringAt(commit.message)) return notSatisfied("when commit.status=committed, commitHash or message is required");
      const commitResult = findSuccessfulGitCommit(work);
      if (!commitResult) return notSatisfied("commit.status=committed but no real successful git commit bash result found");
      return satisfied("verification, git status, and real local commit recorded", [{ toolCallId: gitStatus?.toolCallId ?? notGit?.toolCallId }, { toolCallId: commitResult.toolCallId }]);
    }

    if (status === "failed") {
      if (!stringAt(commit.reason)) return notSatisfied("when commit.status=failed, commit.reason is required explaining why git commit failed (e.g. hook/config/disk space); do not bypass the failure");
      const failedCommit = findFailedGitCommit(work);
      if (!failedCommit) return notSatisfied("commit.status=failed but no real failed git commit bash result found");
      return satisfied("verification, git status, and failed local commit attempt recorded", [{ toolCallId: gitStatus?.toolCallId ?? notGit?.toolCallId }, { toolCallId: failedCommit.toolCallId }]);
    }

    const notCommittedReason = stringAt(commit.reason);
    if (!notCommittedReason) return notSatisfied("when commit.status=not-committed, commit.reason is required");
    // No-content-mutation relaxation: if the work produced zero delivered project content
    // mutations, there is objectively nothing to commit. The reason is still required (above)
    // for audit, but its specific phrasing is not gated — this is an objective fact, not a
    // user-authorization question. This must be checked BEFORE the skip-authorization path
    // below, otherwise a no-mutation work can pass via the skip-auth phrase path and mask
    // the fact that this relaxation branch was never exercised (smoke 20260705102727 R6).
    if (listProjectContentMutations(work).length === 0) {
      return satisfied("verification, git status, and no-project-content-mutations not-committed reason recorded", [{ toolCallId: gitStatus?.toolCallId ?? notGit?.toolCallId }]);
    }
    // Not-committing a producing work must be a user decision, not the agent's default.
    // Dual-path authorization (mirrors ui.ts:115 confirmation gate): either a fresh
    // cynos_ask_user answer, OR explicit authorization stated in the original task prompt
    // / commit.reason (e.g. "don't commit / review-only / 别提交 / show me the diff").
    // This closes the loophole where a bare reason like "用户未要求提交" passes while still
    // honoring the common "帮我改一下别提交" class of legitimate requests.
    const freshAuth = (work.capturedUserAnswers ?? []).length > 0;
    const skipAuth = mentionsCommitSkipAuthorization(stringAt(commit.reason))
      || mentionsCommitSkipAuthorization(stringAt(work.objective));
    if (commit.userAuthorizedSkip === true && !freshAuth) {
      return notSatisfied("commit.userAuthorizedSkip=true but no capturedUserAnswers user authorization record");
    }
    if (commit.userAuthorizedSkip === true && !skipAuth) {
      return notSatisfied("commit.userAuthorizedSkip=true means the user authorized skipping the commit; quote the skip/not-commit authorization in commit.reason (e.g. 'don't commit / skip commit / 别提交'). If the user asked you to commit, run git commit and set status=committed.");
    }
    // freshAuth alone is NOT sufficient: capturedUserAnswers is populated by ANY cynos_ask_user
    // (unrelated Q&A like 'which file?' also fills it). Only an explicit skip/not-commit phrase in
    // the original objective or commit.reason authorizes not-committing. This avoids reopening the
    // loophole where a lazy bare reason passes just because some unrelated Q&A happened, and also
    // blocks the inverse false green where a user says "commit it" but the agent records a skip.
    if (commit.userAuthorizedSkip !== true && !skipAuth) {
      return notSatisfied("commit.status=not-committed requires explicit user authorization to skip the commit: either (a) run cynos_ask_user to confirm skipping and set commit.userAuthorizedSkip=true, or (b) the user pre-stated skip authorization in the original task (quote it in commit.reason, e.g. 'review-only / don't commit / 别提交 / show me the diff'). A bare reason like '用户未要求提交' or an answer asking you to commit is NOT skip authorization. If you simply haven't committed yet, run git commit and set status=committed.");
    }
    return satisfied("verification, git status, and user-authorized not-committed reason recorded", [{ toolCallId: gitStatus?.toolCallId ?? notGit?.toolCallId }]);
  },
};

function mentionsCommitSkipAuthorization(summary: string): boolean {
  return /(do\s+not|don'?t|dont|skip|hold\s+off\s+on|leave\s+.*uncommitted)\s*(the\s+)?(commit|committing|git\s+commit)|review[-\s]?only|show\s+(me\s+)?the\s+diff|跳过\s*提交|不\s*提交|别\s*提交|不要\s*提交|不用\s*提交|无需\s*提交|只\s*看|仅\s*看|不\s*动\s*git|给我看\s*diff/i.test(summary);
}

function findSuccessfulGitStatus(work: Parameters<Checkpoint["check"]>[0]) {
  return (work.capturedToolResults ?? []).find((result) => result.toolName === "bash" && !result.isError && isGitStatusCommand(String(result.input.command ?? "")));
}

function findNonGitStatusAttempt(work: Parameters<Checkpoint["check"]>[0]) {
  return (work.capturedToolResults ?? []).find((result) => {
    if (result.toolName !== "bash" || !isGitStatusCommand(String(result.input.command ?? ""))) return false;
    return result.isError || /not a git repository|不是\s*git|非\s*git|fatal:/i.test(result.outputSummary);
  });
}

function findSuccessfulGitCommit(work: Parameters<Checkpoint["check"]>[0]) {
  return (work.capturedToolResults ?? []).find((result) => result.toolName === "bash" && !result.isError && isGitCommitCommand(String(result.input.command ?? "")));
}

function findFailedGitCommit(work: Parameters<Checkpoint["check"]>[0]) {
  return (work.capturedToolResults ?? []).find((result) => result.toolName === "bash" && result.isError && isGitCommitCommand(String(result.input.command ?? "")));
}
