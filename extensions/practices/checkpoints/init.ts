import type { Checkpoint, WorkState } from "../../core/types";
import { capturedResultIndex, commandSegments, findCaptured, isWriteLike, findWriteEditForPath, findWriteEditsForPath, findReadEvidenceForPath, extractToolPath, isOutsideProjectPath, pathLooksLikeProjectMemory, objectAt, arrayAt, stringAt, stringList, toProjectRelativePath, validateRootRunnableCurrentCommand } from "../helpers";
import { satisfied, notSatisfied } from "./common";

export const initScaffoldWrittenCheckpoint: Checkpoint = {
  id: "init-scaffold-written",
  rule: "init must really write project scaffold files, not just provide explanations.",
  check(work) {
    const explicitIds = arrayAt(objectAt(work.completionEvidence?.scaffold)?.writtenToolCallIds)
      .map((item) => String(item).trim())
      .filter(Boolean);
    if (explicitIds.length > 0) {
      const bad = explicitIds
        .map((id) => findCaptured(work, id))
        .find((result) => !result || !isWriteLike(result) || result.isError);
      if (bad === undefined && explicitIds.every((id) => findCaptured(work, id))) {
        return satisfied(`referenced ${explicitIds.length} real scaffold writes`, explicitIds.map((toolCallId) => ({ toolCallId })));
      }
      return notSatisfied("scaffold.writtenToolCallIds contains missing, failed, or non-write/edit tool results");
    }

    const writes = (work.capturedToolResults ?? []).filter((result) => isWriteLike(result) && !result.isError && !pathLooksLikeProjectMemory(extractToolPath(result)));
    if (writes.length === 0) return notSatisfied("no real write/edit tool results for project scaffold files found");
    return satisfied(`found ${writes.length} scaffold writes`, writes.slice(0, 5).map((result) => ({ toolCallId: result.toolCallId })));
  },
};


export const initUserDecisionCapturedCheckpoint: Checkpoint = {
  id: "init-user-decision-captured",
  rule: "init must inspect the target directory, record Socratic requirements analysis, AI recommendation/alternatives/tradeoffs, decision rounds, and capture user confirmation of the complete initialization plan via cynos_ask_user/cynos_resume_work before scaffold writes.",
  why: "Init can overwrite or mis-document a new project if the target directory and final plan are only checked after scaffold writes.",
  recoveryHint: "Normal path: start init work, capture directory preflight, ask for final plan confirmation, then write. If writes already happened before preflight/confirmation, abandon/restart in a fresh or user-approved cleaned target; later evidence cannot repair the ordering.",
  check(work) {
    const init = objectAt(work.completionEvidence?.init);
    if (!init) return notSatisfied("missing completionEvidence.init");
    if (!stringAt(init.requirementsSummary)) return notSatisfied("init.requirementsSummary must not be empty");
    if (!stringAt(init.techStackDecision)) return notSatisfied("init.techStackDecision must not be empty");

    const interview = objectAt(init.requirementsInterview ?? work.completionEvidence?.requirementsInterview);
    if (!interview) return notSatisfied("missing init.requirementsInterview: init must do requirements analysis first, not jump straight to scaffolding");
    if (!stringAt(interview.problemStatement)) return notSatisfied("init.requirementsInterview.problemStatement must not be empty");
    if (stringList(interview.mvpScope).length === 0) return notSatisfied("init.requirementsInterview.mvpScope[] must not be empty");
    if (stringList(interview.successCriteria).length === 0) return notSatisfied("init.requirementsInterview.successCriteria[] must not be empty");
    if (stringList(interview.constraints).length === 0 && stringList(interview.assumptions).length === 0) return notSatisfied("init.requirementsInterview needs constraints[] or assumptions[] to distinguish user facts from AI assumptions");

    const recommendation = objectAt(init.recommendation ?? work.completionEvidence?.recommendation);
    if (!recommendation) return notSatisfied("missing init.recommendation: the AI must give a recommended plan, alternatives, and reasons");
    const options = arrayAt(recommendation.options ?? recommendation.techStackOptions ?? recommendation.architectureOptions).map(objectAt).filter(Boolean);
    if (options.length < 2) return notSatisfied("init.recommendation.options needs at least 2 plans (1 recommended + at least 1 alternative) with tradeoffs explained");
    const recommendedOption = stringAt(recommendation.recommendedOption) || stringAt(options.find((option) => option?.recommended)?.name);
    const selectedOption = stringAt(recommendation.selectedOption);
    if (!recommendedOption) return notSatisfied("init.recommendation.recommendedOption must not be empty (the AI must clearly recommend one)");
    if (!selectedOption) return notSatisfied("init.recommendation.selectedOption must not be empty (record the user's final choice)");
    for (const [index, option] of options.entries()) {
      if (!stringAt(option?.name)) return notSatisfied(`init.recommendation.options #${index + 1} missing name`);
      if (!stringAt(option?.summary) && stringList(option?.stack).length === 0) return notSatisfied(`init.recommendation.options #${index + 1} needs summary or stack[]`);
      if (stringAt(option?.name) === recommendedOption && !stringAt(option?.reason ?? option?.fitReason ?? option?.rationale)) return notSatisfied(`the recommended option ${recommendedOption} needs reason/fitReason/rationale`);
    }
    if (!stringAt(recommendation.rationale) && !stringAt(recommendation.userChoiceSummary)) return notSatisfied("init.recommendation needs rationale or userChoiceSummary explaining the basis for the recommendation and the user's choice");

    const decisionRounds = arrayAt(init.decisionRounds ?? work.completionEvidence?.decisionRounds).map(objectAt).filter(Boolean);
    for (const [index, round] of decisionRounds.entries()) {
      if (!stringAt(round?.topic)) return notSatisfied(`init.decisionRounds #${index + 1} missing topic`);
      if (!stringAt(round?.summary ?? round?.decision ?? round?.questionSummary ?? round?.answerSummary)) return notSatisfied(`init.decisionRounds #${index + 1} needs one of summary/decision/questionSummary/answerSummary briefly recording the decision`);
    }

    if ((work.capturedUserAnswers ?? []).length === 0) return notSatisfied("missing user confirmation captured via cynos_ask_user/cynos_resume_work: init's requirements, recommended plan, testing/deployment, and scaffold plan must be verified by the user before writing");
    if (!stringAt(init.userConfirmationSummary)) return notSatisfied("init.userConfirmationSummary must not be empty (summarize which requirements, tech stack, testing/deployment, and scaffold shape the user confirmed)");
    const finalPlan = objectAt(init.finalPlanConfirmation ?? work.completionEvidence?.finalPlanConfirmation);
    if (!finalPlan || finalPlan.confirmed !== true || !stringAt(finalPlan.summary)) return notSatisfied("missing init.finalPlanConfirmation.confirmed=true and summary: the complete initialization plan must be confirmed before writing");

    const firstScaffoldWrite = findFirstInitScaffoldWrite(work);
    if (firstScaffoldWrite) {
      const preflight = findDirectoryPreflightBefore(work, firstScaffoldWrite);
      if (!preflight) return notSatisfied("init must inspect the target directory contents/status before the first scaffold write/edit; run ls/find/git status/test -e or read an existing root file before writing (pwd alone is not enough). If scaffold writes already happened in this work, this ordering failure cannot be repaired by later reads; abandon/restart in a fresh or user-approved cleaned target, or ask the user how to handle already-written files before starting a new init work");
      const planAnswers = (work.capturedUserAnswers ?? []).filter(isFinalPlanConfirmationAnswer);
      const planConfirmAnswer = planAnswers[planAnswers.length - 1];
      if (!planConfirmAnswer) return notSatisfied("init did not capture a complete-initialization-plan confirmation answer; you must use cynos_ask_user/cynos_resume_work to confirm a plan covering requirements, tech stack, testing/release, git decision, and files to write");
      if (!isBefore(planConfirmAnswer.at, firstScaffoldWrite.at)) return notSatisfied("init's complete-initialization-plan confirmation must happen before the first scaffold write/edit; currently the final plan confirmation is later than the first write. This ordering failure cannot be repaired inside the same work; abandon/restart in a fresh or user-approved cleaned target, or ask the user how to handle already-written files before starting a new init work");
      const answerText = `${planConfirmAnswer.question}\n${planConfirmAnswer.answerSummary}`;
      // Functional regex: keeps localized keywords agents may use for post-hoc confirmation patterns.
      if (/事后确认|搭建完成后|脚手架完成后/i.test(answerText)) return notSatisfied("init user confirmation looks post-hoc; the complete plan must be confirmed before writing the scaffold. If scaffold writes already happened, abandon/restart rather than trying to confirm retroactively");
    }

    return satisfied(`requirements analysis, recommendation, and user confirmation recorded, ${decisionRounds.length} decision summaries, ${work.capturedUserAnswers?.length ?? 0} user confirmations captured`);
  },
};

export const initCoreDocsWrittenCheckpoint: Checkpoint = {
  id: "init-core-docs-written",
  rule: "init must really write README.md, AGENTS.md/AGENT.md, PROJECT.md, docs/testing.md, and docs/release.md, serving the human entry point, agent rules, long-term memory, testing contract, and release/rollback contract respectively.",
  check(work) {
    const missing: string[] = [];
    const refs: Array<{ toolCallId?: string }> = [];
    for (const path of ["README.md", "PROJECT.md", "docs/testing.md", "docs/release.md"]) {
      const result = findWriteEditForPath(work, path);
      if (!result || !isWriteLike(result) || result.isError) missing.push(path);
      else refs.push({ toolCallId: result.toolCallId });
    }
    const agents = findWriteEditForPath(work, "AGENTS.md") ?? findWriteEditForPath(work, "AGENT.md");
    if (!agents || !isWriteLike(agents) || agents.isError) missing.push("AGENTS.md/AGENT.md");
    else refs.push({ toolCallId: agents.toolCallId });
    if (missing.length > 0) return notSatisfied(`missing real writes of init core docs: ${missing.join(", ")}`);
    return satisfied("init core docs written", refs);
  },
};


export const initPostScaffoldAuditCheckpoint: Checkpoint = {
  id: "init-post-scaffold-audit",
  rule: "init must re-read key manifest/config files after installing/generating the scaffold, then finalize README, PROJECT.md, docs/testing.md, and docs/release.md after that audit to avoid writing planned versions as facts.",
  check(work) {
    const audit = objectAt(objectAt(work.completionEvidence?.init)?.postScaffoldAudit ?? work.completionEvidence?.postScaffoldAudit);
    if (!audit) return notSatisfied("missing init.postScaffoldAudit: after generation/install you must re-read the actual manifest/config and calibrate documented facts");
    const auditedFiles = stringList(audit.auditedFiles ?? audit.manifestFilesRead);
    if (auditedFiles.length === 0) return notSatisfied("init.postScaffoldAudit.auditedFiles[] must not be empty (e.g. package.json, pyproject.toml, Cargo.toml, go.mod, vite.config.ts)");
    const firstScaffoldWrite = findFirstInitScaffoldWrite(work);
    const latestAuditReads = [];
    for (const file of auditedFiles) {
      const latestRead = findLatestReadEvidenceForPath(work, file);
      if (!latestRead) return notSatisfied(`init.postScaffoldAudit claims to audit ${file}, but there is no real read/bash read evidence`);
      if (firstScaffoldWrite && capturedResultIndex(work, latestRead) <= capturedResultIndex(work, firstScaffoldWrite)) {
        return notSatisfied(`init.postScaffoldAudit must read ${file} after scaffold generation/writes, not only before writing the project`);
      }
      latestAuditReads.push(latestRead);
    }
    const latestAuditReadIndex = Math.max(...latestAuditReads.map((result) => capturedResultIndex(work, result)));
    const scaffoldFiles = stringList(objectAt(work.completionEvidence?.scaffold)?.files);
    const expectedManifest = scaffoldFiles.find((file) => isManifestOrKeyConfig(file));
    if (expectedManifest && !auditedFiles.some((file) => samePathish(file, expectedManifest))) {
      return notSatisfied(`scaffold.files includes the key manifest/config ${expectedManifest}, but postScaffoldAudit.auditedFiles[] does not cover it`);
    }
    const staleDocs = ["README.md", "PROJECT.md", "docs/testing.md", "docs/release.md"].filter((path) => {
      const latestWrite = findLatestWriteEditForPath(work, path);
      return !latestWrite || capturedResultIndex(work, latestWrite) <= latestAuditReadIndex;
    });
    if (staleDocs.length > 0) {
      return notSatisfied(`init operational docs must be finalized after the post-scaffold audit read; edit/rewrite after reading actual manifest/config: ${staleDocs.join(", ")}`);
    }
    if (audit.docsUpdatedAfterAudit !== true && !stringAt(audit.docsConsistencySummary)) {
      return notSatisfied("init.postScaffoldAudit needs docsUpdatedAfterAudit=true or docsConsistencySummary explaining that the final docs were calibrated against the actual manifest/config");
    }
    return satisfied(`post-scaffold audit covered ${auditedFiles.length} files and operational docs were finalized after audit`);
  },
};

function findLatestReadEvidenceForPath(work: WorkState, expectedPath: string) {
  return [...(work.capturedToolResults ?? [])]
    .reverse()
    .find((result) => findReadEvidenceForPath({ ...work, capturedToolResults: [result] }, expectedPath));
}

function findLatestWriteEditForPath(work: WorkState, expectedPath: string) {
  return [...findWriteEditsForPath(work, expectedPath)].reverse()[0];
}

export const initOperatingContractDefinedCheckpoint: Checkpoint = {
  id: "init-operating-contract-defined",
  rule: "init must define testing, release, git, and UI/design operating contracts for the new project; docs/testing.md is a hard constraint (must be really written).",
  check(work) {
    const decisions = objectAt(work.completionEvidence?.operatingDecisions);
    if (!decisions) return notSatisfied("missing completionEvidence.operatingDecisions");
    for (const key of ["testing", "release", "git", "ui"]) {
      const section = objectAt(decisions[key]);
      if (!section) return notSatisfied(`operatingDecisions.${key} missing`);
      if (!stringAt(section.summary) && !stringAt(section.reason) && !stringAt(section.rationale)) return notSatisfied(`operatingDecisions.${key}.summary / reason / rationale must not be empty`);
    }

    const testing = objectAt(decisions.testing);
    const testingMatrix = arrayAt(testing?.matrix).map(objectAt).filter(Boolean);
    if (testingMatrix.length === 0) return notSatisfied("operatingDecisions.testing.matrix[] must not be empty: init must clearly define the verification strategy for different change scopes going forward");
    if (!stringAt(testing?.selectedStrategy) && !stringAt(testing?.summary)) return notSatisfied("operatingDecisions.testing.selectedStrategy or summary must not be empty");
    const testingSignals = stringList(testing?.signalsChecked);
    for (const [index, item] of testingMatrix.entries()) {
      if (!stringAt(item?.changeScope)) return notSatisfied(`testing.matrix #${index + 1} missing changeScope`);
      if (stringList(item?.paths).length === 0 && !stringAt(item?.pathlessReason)) return notSatisfied(`testing.matrix #${index + 1} needs paths[]; if there is truly no path scope, fill pathlessReason`);
      const current = stringList(item?.currentCommands);
      const planned = stringList(item?.plannedCommands);
      const status = stringAt(item?.status);
      if (current.length === 0 && planned.length === 0 && !status) return notSatisfied(`testing.matrix #${index + 1} needs currentCommands[], plannedCommands[], or status`);
      for (const command of current) {
        const rootRunnable = validateRootRunnableCurrentCommand(command, testingSignals);
        if (!rootRunnable.ok) return notSatisfied(`testing.matrix #${index + 1} currentCommands must be complete commands runnable directly from the project root: ${rootRunnable.reason}`);
      }
    }

    const testingResult = findWriteEditForPath(work, "docs/testing.md");
    if (!testingResult || !isWriteLike(testingResult) || testingResult.isError) {
      return notSatisfied("init must really write/edit docs/testing.md, defining the testing/verification contract going forward (even if there are no tests now, write the strategy)");
    }
    return satisfied(`init operating contract defined, testing matrix ${testingMatrix.length} rows, docs/testing.md written`, [{ toolCallId: testingResult.toolCallId }]);
  },
};


export const initReleaseContractDefinedCheckpoint: Checkpoint = {
  id: "init-release-contract-defined",
  rule: "init must clearly define the new project's release/deployment and rollback conventions going forward; docs/release.md must always be really written, even if there is no external release flow yet.",
  check(work) {
    const release = objectAt(objectAt(work.completionEvidence?.operatingDecisions)?.release);
    if (!release) return notSatisfied("missing operatingDecisions.release");
    const classification = stringAt(release.classification);
    const validClassifications = new Set(["none", "local-only", "package-release", "deploy", "unknown"]);
    if (!validClassifications.has(classification)) return notSatisfied("operatingDecisions.release.classification must be none / local-only / package-release / deploy / unknown");
    if (!stringAt(release.summary) && !stringAt(release.reason) && !stringAt(release.rationale)) return notSatisfied("operatingDecisions.release.summary / reason / rationale must not be empty (clarify whether there will be releases/deployments going forward)");
    if (!stringAt(release.rollbackStrategy) && !stringAt(release.rollbackSummary)) return notSatisfied("operatingDecisions.release.rollbackStrategy must not be empty (even with no external release, explain how to roll back the init artifacts/initial version)");
    if (["package-release", "deploy"].includes(classification) && !stringAt(release.target) && !stringAt(release.selectedFlow)) return notSatisfied("package-release/deploy needs release.target or selectedFlow to clarify the release/deployment target");
    const generatedDeployArtifacts = writtenDeployArtifacts(work);
    if (generatedDeployArtifacts.length > 0 && ["none", "local-only"].includes(classification)) {
      const recordedArtifacts = stringList(release.generatedDeployArtifacts);
      const missing = generatedDeployArtifacts.filter((artifact) => !recordedArtifacts.some((recorded) => samePathish(recorded, artifact)));
      if (missing.length > 0) return notSatisfied(`release.classification=${classification} but deployment-related files were generated; they must be marked in release.generatedDeployArtifacts[] as unused/planned: ${missing.join(", ")}`);
      if (release.activeDeploy !== false && !stringAt(release.activeDeployReason)) return notSatisfied("when local-only/none and deployment files are generated, release.activeDeploy must be false (or fill activeDeployReason) to distinguish the current flow from future plans");
    }

    const releaseResult = findWriteEditForPath(work, "docs/release.md");
    if (!releaseResult || !isWriteLike(releaseResult) || releaseResult.isError) return notSatisfied("init must really write/edit docs/release.md, recording the release/deployment/rollback contract (even with no release, write local-only/none)");
    return satisfied("init release contract defined, docs/release.md written", [{ toolCallId: releaseResult.toolCallId }]);
  },
};

function findFirstInitScaffoldWrite(work: WorkState) {
  // Only counts in-project write/edit as "first scaffold write" candidates. Files outside the project
  // (~/.pi, ~/.config, etc.) are not the practice's concern; they are not named, not special-cased,
  // and are all excluded from candidates.
  return (work.capturedToolResults ?? []).find((result) => {
    if (!isWriteLike(result) || result.isError) return false;
    const path = extractToolPath(result);
    if (!path || isOutsideProjectPath(path, work.cwd)) return false;
    return true;
  });
}

function findDirectoryPreflightBefore(work: WorkState, boundary: ReturnType<typeof findFirstInitScaffoldWrite>) {
  if (!boundary) return undefined;
  const boundaryIndex = capturedResultIndex(work, boundary);
  return (work.capturedToolResults ?? []).find((result) => {
    if (capturedResultIndex(work, result) >= boundaryIndex) return false;
    if (result.toolName === "read") return !result.isError && readLooksLikeRootPreflight(result, work.cwd);
    if (result.toolName !== "bash") return false;
    return commandLooksLikeDirectoryPreflight(String(result.input.command ?? ""), Boolean(result.isError));
  });
}

function readLooksLikeRootPreflight(result: Parameters<typeof extractToolPath>[0], cwd?: string): boolean {
  const path = extractToolPath(result);
  if (!path) return false;
  const relative = toProjectRelativePath(path, cwd).replace(/^\.\//, "");
  return /^(README(?:\.[^/]*)?|AGENTS?\.md|package\.json|pyproject\.toml|Cargo\.toml|go\.mod|deno\.json|tsconfig\.json)$/.test(relative);
}

function commandLooksLikeDirectoryPreflight(command: string, failed: boolean): boolean {
  return commandSegments(command).some((segment) => {
    const normalized = segment.trim();
    if (!normalized || /^pwd\b/.test(normalized)) return false;
    if (/^git\s+status\b/.test(normalized)) return true;
    if (/^test\s+-(?:e|f|d)\s+\S+/.test(normalized)) return true;
    if (/^\[\s+-(?:e|f|d)\s+\S+\s+\]$/.test(normalized)) return true;
    if (/^stat\s+\S+/.test(normalized)) return true;
    if (failed) return false;
    if (/^(ls|find)\b/.test(normalized)) return true;
    if (/^file\s+\S+/.test(normalized)) return true;
    return false;
  });
}

function isFinalPlanConfirmationAnswer(answer: { question?: string; answerSummary?: string }): boolean {
  const text = `${answer.question ?? ""}\n${answer.answerSummary ?? ""}`;
  // Functional regexes: keep localized confirmation and plan-scope keywords because agents
  // may use non-English summaries, and these patterns gate the post-hoc-confirmation check.
  const hasConfirmation = /confirm|confirmed|confirmation|approve|approved|确认|同意|批准|可以|按这个|继续/i.test(text);
  const hasPlanScope = /plan|方案|初始化|scaffold|脚手架|架构|architecture|tech|技术栈|stack|mvp|测试|testing|发布|release|部署|deploy|文件|写入/i.test(text);
  return hasConfirmation && hasPlanScope;
}

function isBefore(left: string, right: string): boolean {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs < rightMs;
}

function isManifestOrKeyConfig(path: string): boolean {
  return /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|deno\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|vite\.config\.[cm]?[tj]s|next\.config\.[cm]?[tj]s|tsconfig\.json)$/.test(path);
}

function writtenDeployArtifacts(work: WorkState): string[] {
  return (work.capturedToolResults ?? [])
    .filter((result) => isWriteLike(result) && !result.isError)
    .map((result) => extractToolPath(result))
    .filter((path): path is string => Boolean(path))
    .filter((path) => /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|railway\.json|wrangler\.toml|render\.ya?ml|Procfile)$/.test(path));
}

function samePathish(a: string, b: string): boolean {
  const left = a.replace(/\\/g, "/");
  const right = b.replace(/\\/g, "/");
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}
