import type { CapturedToolResult, Checkpoint, WorkState } from "../../core/types";
import { findReadEvidenceForPath, objectAt, arrayAt, stringAt, isTestOrVerificationCommand } from "../helpers";
import { detectProjectMutationTargets } from "../mutation-targets";
import { satisfied, notSatisfied } from "./common";

function bashCommands(work: WorkState): string[] {
  return (work.capturedToolResults ?? [])
    .filter((result) => result.toolName === "bash")
    .map((result) => String(result.input.command ?? ""));
}

function hasBash(work: WorkState, pattern: RegExp): boolean {
  return bashCommands(work).some((command) => pattern.test(command));
}

function targetText(target: string, targetType?: string): string {
  return `${targetType ?? ""} ${target}`.toLowerCase();
}

function hasGitEvidenceForTarget(work: WorkState, target: string, targetType?: string): boolean {
  const text = targetText(target, targetType);
  if (/inline|prompt|user-message/.test(text)) return true;
  if (/staged/.test(text)) return hasBash(work, /\bgit\s+diff\s+(--cached|--staged)\b/i);
  if (/current-diff|current diff|working tree|worktree|uncommitted|未提交/.test(text)) return hasBash(work, /\bgit\s+(status\b|diff\b)/i);
  if (/last-commit|last commit|head|最近一次提交/.test(text)) return hasBash(work, /\bgit\s+(show\s+HEAD\b|log\s+-1\b)/i);
  if (/branch-diff|range|\.\.|\.\.\.|pr\b|pull request/.test(text)) return hasBash(work, /\bgit\s+(diff|show|log)\b/i);
  if (/\bcommit\b|^[0-9a-f]{7,40}$/i.test(target.trim()) || targetType === "commit") return hasBash(work, /\bgit\s+show\b/i);
  return false;
}

function findCommandEvidence(work: WorkState, command: string): CapturedToolResult | undefined {
  const normalized = command.trim();
  if (!normalized) return undefined;
  return (work.capturedToolResults ?? []).find((result) => {
    if (result.toolName !== "bash") return false;
    const actual = String(result.input.command ?? "").trim();
    return actual.length > 0 && (actual.includes(normalized) || normalized.includes(actual));
  });
}

function unsafeReviewVerificationCommand(command: string, evidence: CapturedToolResult): string | undefined {
  const output = evidence.outputSummary ?? "";
  if (/\bnpx\b/i.test(command) && /(will be installed|need to install|install the following package|package was not found)/i.test(output)) {
    return "review must not use npx to auto-install missing tools; use an existing npm/pnpm/yarn/bun script, ./node_modules/.bin/<tool>, or first prove the tool exists via package.json/command -v";
  }
  if (/\bnpm\s+exec\b/i.test(command) && !/\bnpm\s+exec\s+--no\b/i.test(command)) return "when review uses npm exec, it must include --no to avoid auto-installing missing tools";
  if (/\b(find\s+\/|sudo\s+find\s+\/)\b/i.test(command)) return "review should not run a whole-disk find / for a toolchain; use command -v <tool> or check common project config";
  return undefined;
}

export const reviewReadOnlyCheckpoint: Checkpoint = {
  id: "review-read-only",
  rule: "review is a read-only review: it must not modify code, docs, PROJECT.md, or config (including bash writes such as sed -i / echo > / tee / cp / mv / rm / touch / mkdir / npm install / git checkout); fixes/doc updates must be split into a follow-up work.",
  check(work) {
    const cwd = work.cwd ?? "";
    for (const result of work.capturedToolResults ?? []) {
      if (result.isError) continue;
      const mutations = detectProjectMutationTargets(cwd, result.toolName, (result.input as Record<string, unknown>) ?? {});
      if (mutations.length > 0) {
        const m = mutations[0];
        const detail = m.segment ?? (String(result.input.command ?? result.input.path ?? result.input.filePath ?? "") || result.toolCallId);
        return notSatisfied(`review practice cannot perform modifying operations (found ${m.kind}: ${detail}); review is read-only, including bash writes (sed -i / echo > / tee / cp / mv / rm / touch / mkdir / npm install / git checkout, etc.); undo the change and treat fixes/doc updates as report suggestions or a follow-up work`);
      }
    }
    return satisfied("review remained read-only");
  },
};

export const reviewScopeEvidencedCheckpoint: Checkpoint = {
  id: "review-scope-evidenced",
  rule: "review must define an explicit scope and prove it read the review targets with real read/bash tool results; when the scope is unclear, ask the user first instead of guessing.",
  check(work) {
    const scope = objectAt(work.completionEvidence?.reviewScope ?? work.completionEvidence?.scope);
    if (!scope) return notSatisfied("missing completionEvidence.reviewScope/scope: record targets[], basis/source; if the user did not give a scope, first ask whether it is current diff, staged diff, last commit, specific files/commit/PR, or previous work");
    const targets = arrayAt(scope.targets).map((item) => String(item).trim()).filter(Boolean);
    if (targets.length === 0) return notSatisfied("review scope.targets needs at least 1 item");
    if (!stringAt(scope.basis ?? scope.source)) return notSatisfied("review scope.basis/source must not be empty");
    const targetType = stringAt(scope.targetType);

    const refs: Array<{ toolCallId?: string }> = [];
    for (const target of targets) {
      if (/^inline:|^prompt:|^user-message$/i.test(target) || targetType === "inline") continue;
      if (hasGitEvidenceForTarget(work, target, targetType)) {
        const gitEvidence = (work.capturedToolResults ?? []).find((result) => result.toolName === "bash" && /\bgit\s+(status|diff|show|log)\b/i.test(String(result.input.command ?? "")));
        if (gitEvidence) refs.push({ toolCallId: gitEvidence.toolCallId });
        continue;
      }
      const exact = findReadEvidenceForPath(work, target);
      if (exact) {
        refs.push({ toolCallId: exact.toolCallId });
        continue;
      }
      return notSatisfied(`review scope target missing matching real read evidence: ${target}; for current diff use git diff/status, for staged diff use git diff --cached, for last commit use git show HEAD, for commit/range/branch/PR use git show/diff/log, for files use read or cat/rg/grep, and for directory targets end with / (e.g. src/) and use ls/find/rg`);
    }
    return satisfied(`review scope targets=${targets.length}`, refs.slice(0, 5));
  },
};

export const reviewVerificationRecordedCheckpoint: Checkpoint = {
  id: "review-verification-recorded",
  rule: "review must record the testing/verification permission and execution; when not run, explain why, and when commands are run there must be real bash evidence.",
  check(work) {
    const verification = objectAt(work.completionEvidence?.verification);
    if (!verification) return notSatisfied("missing completionEvidence.verification: record permission, and commandsRun[] or notRunReason");
    const validPermissions = new Set(["read-only", "local-safe", "ask-before-running", "full-project"]);
    const permission = stringAt(verification.permission);
    if (!validPermissions.has(permission)) return notSatisfied("verification.permission must be read-only / local-safe / ask-before-running / full-project; do not use static-only anymore; if you are not running commands, use read-only + notRunReason");

    const commandsRun = arrayAt(verification.commandsRun);
    if (permission === "read-only") {
      if (commandsRun.length > 0) return notSatisfied("verification.permission=read-only means read-only code/docs, and running verification commands is not allowed; remove commandsRun and fill notRunReason, or change permission to local-safe/ask-before-running/full-project (requires user authorization)");
      const verificationBash = (work.capturedToolResults ?? []).find((result) => result.toolName === "bash" && isTestOrVerificationCommand(String(result.input.command ?? "")));
      if (verificationBash) return notSatisfied(`verification.permission=read-only but a verification command was actually run: ${String(verificationBash.input.command ?? "")}`);
    }

    if (commandsRun.length === 0) {
      if (!stringAt(verification.notRunReason)) return notSatisfied("when verification.commandsRun is empty, notRunReason must be filled (e.g.: user chose read-only, doing a static review only)");
      return satisfied(`verification permission=${permission}, no commands run`);
    }

    for (const [index, item] of commandsRun.entries()) {
      const command = stringAt((item as any)?.command);
      if (!command) return notSatisfied(`verification.commandsRun #${index + 1} missing command`);
      if (!stringAt((item as any)?.purpose)) return notSatisfied(`verification.commandsRun #${index + 1} missing purpose`);
      if (!stringAt((item as any)?.result)) return notSatisfied(`verification.commandsRun #${index + 1} missing result`);
      const evidence = findCommandEvidence(work, command);
      if (!evidence) return notSatisfied(`verification.commandsRun #${index + 1} missing real bash evidence: ${command}`);
      const unsafeReason = unsafeReviewVerificationCommand(command, evidence);
      if (unsafeReason) return notSatisfied(`verification.commandsRun #${index + 1} command is not suitable for review: ${unsafeReason}`);
    }
    return satisfied(`verification permission=${permission}, commands=${commandsRun.length}`);
  },
};

export const reviewReportStructuredCheckpoint: Checkpoint = {
  id: "review-report-structured",
  rule: "The review report must lead with high-value content: summary/top risks/project memory suggestions/findings/next steps; each finding must have severity, category, location, summary, evidence, impact, recommendation, confidence.",
  check(work) {
    const report = objectAt(work.completionEvidence?.report);
    if (!report) return notSatisfied("missing completionEvidence.report");
    if (!stringAt(report.summary)) return notSatisfied("report.summary must not be empty");
    if (!Array.isArray(report.findings)) return notSatisfied("report.findings must be an array");
    if (!Array.isArray(report.projectMemorySuggestions)) return notSatisfied("report.projectMemorySuggestions must be an array; fill [] when there are no suggestions — review does not modify PROJECT.md/docs directly");
    if (!Array.isArray(report.nextSteps)) return notSatisfied("report.nextSteps must be an array");

    const validOverall = new Set(["pass", "needs-work", "blocked"]);
    const overall = String(report.overall);
    if (!validOverall.has(overall)) return notSatisfied(`report.overall must be one of pass / needs-work / blocked (current: "${overall}")`);

    const validSeverity = new Set(["blocking", "important", "minor"]);
    const validCategory = new Set(["correctness", "security", "architecture", "maintainability", "performance", "testing", "style", "ux", "docs", "other"]);
    const validConfidence = new Set(["high", "medium", "low"]);
    let hasBlocking = false;
    let hasImportant = false;

    for (const [index, finding] of report.findings.entries()) {
      if (!finding || typeof finding !== "object") return notSatisfied(`finding #${index + 1} is not an object`);
      const item = finding as any;
      const severity = String(item.severity ?? "");
      if (!validSeverity.has(severity)) return notSatisfied(`finding #${index + 1} missing a valid severity (valid values: blocking|important|minor, current: "${severity}")`);
      if (severity === "blocking") hasBlocking = true;
      if (severity === "important") hasImportant = true;
      if (!validCategory.has(String(item.category ?? ""))) return notSatisfied(`finding #${index + 1} category invalid (valid values: correctness|security|architecture|maintainability|performance|testing|style|ux|docs|other, current: "${item.category ?? ""}")`);
      if (!String(item.location ?? "").trim()) return notSatisfied(`finding #${index + 1} missing location`);
      if (!String(item.summary ?? "").trim()) return notSatisfied(`finding #${index + 1} missing summary`);
      if (!String(item.evidence ?? "").trim()) return notSatisfied(`finding #${index + 1} missing evidence`);
      if (!String(item.impact ?? "").trim()) return notSatisfied(`finding #${index + 1} missing impact`);
      if (!String(item.recommendation ?? "").trim()) return notSatisfied(`finding #${index + 1} missing recommendation`);
      if (!validConfidence.has(String(item.confidence ?? ""))) return notSatisfied(`finding #${index + 1} missing a valid confidence (valid values: high|medium|low, current: "${item.confidence ?? ""}")`);
    }

    if (overall === "blocked" && !hasBlocking) return notSatisfied("when report.overall=blocked, at least 1 blocking finding is required");
    if (overall === "needs-work" && hasBlocking) return notSatisfied("when a blocking finding exists, overall must be blocked");
    if (overall === "needs-work" && !hasImportant) return notSatisfied("when report.overall=needs-work, at least 1 important finding is required");
    if (overall === "pass" && (hasBlocking || hasImportant)) return notSatisfied("when blocking/important findings exist, overall cannot be pass");

    return satisfied(`overall=${report.overall}, findings=${report.findings.length}, projectMemorySuggestions=${arrayAt(report.projectMemorySuggestions).length}`);
  },
};
