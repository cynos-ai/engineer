import type { Checkpoint } from "../../core/types";
import { existingOnboardAuditDocs, findCompleteReadEvidenceForPath, findReadEvidenceForPath, isPartialReadResult, isWriteLike, findWriteEditForPath, objectAt, arrayAt, stringAt, stringList, validateRootRunnableCurrentCommand } from "../helpers";
import { satisfied, notSatisfied } from "./common";

export const onboardDecisionAuthorizedCheckpoint: Checkpoint = {
  id: "onboard-decision-authorized",
  rule: "human-assisted onboard requires user confirmation before writing long-term memory; auto onboard must record the basis for autonomous decisions and unresolved questions.",
  check(work) {
    const mode = stringAt(work.completionEvidence?.onboardMode ?? objectAt(work.completionEvidence?.preflight)?.mode);
    if (mode === "auto") {
      const decision = objectAt(work.completionEvidence?.automationDecision);
      const rationale = stringAt(decision?.rationale ?? decision?.summary);
      if (!rationale) return notSatisfied("auto onboard missing automationDecision.rationale/summary: record why this can be decided autonomously, which facts came from code, and which questions remain unresolved");
      if (!Array.isArray(decision?.unresolvedQuestions)) return notSatisfied("auto onboard requires an automationDecision.unresolvedQuestions array (may be empty)");
      return satisfied("auto onboard autonomous-decision basis recorded");
    }

    const answers = work.capturedUserAnswers ?? [];
    if (answers.length < 2) {
      return notSatisfied("human-assisted onboard must capture at least two user confirmations via real cynos_ask_user/cynos_resume_work: 1) scope confirmation before deep reading; 2) long-term-memory and operating-contract confirmation before writing PROJECT.md/docs/testing.md/docs/release.md. For auto mode, set onboardMode/preflight.mode='auto' and provide automationDecision");
    }
    return satisfied(`captured ${answers.length} user answers, covering scope and long-term-memory/operating-contract confirmation`);
  },
};


export const onboardScopeConfirmedCheckpoint: Checkpoint = {
  id: "onboard-scope-confirmed",
  rule: "onboard must complete a preflight/scope gate before deep reading, describing git status, freshness, and scope source (user confirmation for human-assisted, autonomous judgment for auto).",
  check(work) {
    const preflight = objectAt(work.completionEvidence?.preflight);
    if (!preflight) return notSatisfied("missing completionEvidence.preflight");
    if (preflight.gitStatusChecked !== true) return notSatisfied("preflight.gitStatusChecked must be true");
    if (!stringAt(preflight.scopeConfirmationSummary)) return notSatisfied("preflight.scopeConfirmationSummary must not be empty");
    const mode = stringAt(work.completionEvidence?.onboardMode ?? preflight.mode);
    if (mode !== "auto" && (work.capturedUserAnswers ?? []).length === 0) {
      return notSatisfied("human-assisted onboard must first capture scope confirmation via cynos_ask_user/cynos_resume_work before deep reading; it cannot just hand-write a confirmation summary in completionEvidence");
    }
    return satisfied("preflight scope gate recorded");
  },
};


export const onboardExplorationEvidencedCheckpoint: Checkpoint = {
  id: "onboard-exploration-evidenced",
  rule: "onboard must record sufficient code-first exploration and prove the core files were actually read with real read/bash tool results; the documentation-trust audit must have a conclusion or an explicit N/A reason.",
  check(work) {
    const exploration = objectAt(work.completionEvidence?.exploration);
    if (!exploration) return notSatisfied("missing completionEvidence.exploration");
    const coreFiles = stringList(exploration.coreFilesRead);
    const readStrategy = objectAt(exploration.readStrategy);
    if (!readStrategy) return notSatisfied("missing exploration.readStrategy: record the project type, navigation files, core logic files, and chained-read edges");
    if (!stringAt(readStrategy.projectType)) return notSatisfied("exploration.readStrategy.projectType must not be empty");

    const smallProjectReason = stringAt(exploration.smallProjectReason ?? readStrategy.smallProjectReason);
    const coreLogicFiles = stringList(readStrategy.coreLogicFiles);
    if (coreLogicFiles.length === 0) return notSatisfied("exploration.readStrategy.coreLogicFiles needs at least 1 core logic file, and it must be fully read");
    for (const file of coreLogicFiles) {
      if (!coreFiles.includes(file)) return notSatisfied(`exploration.coreFilesRead must include the core logic file: ${file}`);
    }
    const flowsTracedCount = arrayAt(exploration.flowsTraced).length;
    if (flowsTracedCount === 0) return notSatisfied("exploration.flowsTraced needs at least 1 core flow; even for a narrow scope, record the actual behavior chain traced");

    const followedEdges = arrayAt(readStrategy.followedEdges);
    if (followedEdges.length === 0) return notSatisfied("exploration.readStrategy.followedEdges must record at least 1 chained-read edge from a navigation/entry file to a core logic file");

    const depthBelowDefault = coreLogicFiles.length < 4 || flowsTracedCount < 2 || followedEdges.length < 2;
    if (depthBelowDefault && !smallProjectReason) {
      const gapCheck = validateCoverageGaps(exploration.coverageGaps ?? readStrategy.coverageGaps);
      if (!gapCheck.ok) {
        return notSatisfied(`when onboard deep reading is below the default target (coreLogicFiles 4+, flowsTraced 2+, followedEdges 2+), you must provide smallProjectReason or a valid coverageGaps[]; ${gapCheck.reason}`);
      }
    }

    const layerCoverage = arrayAt(readStrategy.layerCoverage);
    if (layerCoverage.length === 0) return notSatisfied("exploration.readStrategy.layerCoverage must record at least 1 behavior/core layer covered; multi-layer projects should cover each key layer (e.g. UI state, IPC/adapter, domain/service, persistence, external integration)");
    for (const [index, layer] of layerCoverage.entries()) {
      const item = objectAt(layer);
      if (!item) return notSatisfied(`layerCoverage #${index + 1} is not an object`);
      if (!stringAt(item.layer) || !stringAt(item.reason)) return notSatisfied(`layerCoverage #${index + 1} must contain layer/reason`);
      const files = stringList(item.files);
      if (files.length === 0) return notSatisfied(`layerCoverage #${index + 1} needs files[]`);
    }

    for (const [index, edge] of followedEdges.entries()) {
      const item = objectAt(edge);
      if (!item) return notSatisfied(`followedEdges #${index + 1} is not an object`);
      if (!stringAt(item.from) || !stringAt(item.to) || !stringAt(item.reason)) return notSatisfied(`followedEdges #${index + 1} must contain from/to/reason`);
    }

    const refs: Array<{ toolCallId?: string }> = [];
    for (const file of coreLogicFiles) {
      const completeRead = findCompleteReadEvidenceForPath(work, file);
      if (!completeRead) return notSatisfied(`core logic files must be fully read with the read tool (do not use limit/offset sharding or only grep/head): ${file}`);
      refs.push({ toolCallId: completeRead.toolCallId });
    }
    for (const file of coreFiles) {
      const read = findReadEvidenceForPath(work, file);
      if (!read) return notSatisfied(`coreFilesRead missing real read evidence: ${file}`);
    }

    if (!Array.isArray(exploration.docTrustAudit)) return notSatisfied("exploration.docTrustAudit must be an array");
    const docTrustAudit = arrayAt(exploration.docTrustAudit);
    const auditDocs = existingOnboardAuditDocs(work.cwd);
    if (auditDocs.length > 0 && docTrustAudit.length === 0) {
      return notSatisfied(`the project has auditable docs (${auditDocs.join(", ")}), so exploration.docTrustAudit must not be empty; pick the docs with the most business/operational value, read them, and verify against the code`);
    }
    for (const [index, entry] of docTrustAudit.entries()) {
      const item = objectAt(entry);
      if (!item) return notSatisfied(`docTrustAudit #${index + 1} is not an object`);
      const file = stringAt(item.file);
      if (!file) return notSatisfied(`docTrustAudit #${index + 1} missing file`);
      const read = findReadEvidenceForPath(work, file);
      if (!read) return notSatisfied(`docTrustAudit #${index + 1} missing real read evidence: ${file}`);
      if (!stringAt(item.conclusion)) return notSatisfied(`docTrustAudit #${index + 1} missing conclusion`);
      if (isPartialReadResult(read) && !stringAt(item.auditedScope ?? item.scope)) return notSatisfied(`docTrustAudit #${index + 1} used a partial read, so it must fill auditedScope/scope to bound the audit scope; it cannot endorse the whole file: ${file}`);
      if (!stringAt(item.basis) && stringList(item.verifiedAgainst).length === 0) return notSatisfied(`docTrustAudit #${index + 1} needs basis or verifiedAgainst[] explaining how the conclusion was reached against code/config`);
    }
    if (docTrustAudit.length === 0 && !stringAt(exploration.docTrustAuditNotApplicableReason)) {
      return notSatisfied("when docTrustAudit is empty, you must provide exploration.docTrustAuditNotApplicableReason explaining there are no auditable project docs or why it does not apply");
    }
    return satisfied(`${coreLogicFiles.length} core logic files, ${flowsTracedCount} flows`, refs.slice(0, 5));
  },
};


// ── dimension 1: project understanding ────────────────────────────────────
// criticalRisks used to live inside the operating-contract checkpoint; it belongs to
// project understanding (PROJECT.md's high-value maintenance knowledge), so it is its own
// checkpoint now. PROJECT.md being written is still checked by the shared projectMemoryWritten.
export const onboardProjectUnderstandingCheckpoint: Checkpoint = {
  id: "onboard-project-understanding",
  rule: "project understanding (PROJECT.md) must record criticalRisks[] (verified key risks/inconsistencies/broken features) or explain their absence; PROJECT.md may be trimmed but must not lose high-value maintenance risks.",
  check(work) {
    const projectMemory = objectAt(work.completionEvidence?.projectMemory);
    const criticalRisks = arrayAt(projectMemory?.criticalRisks);
    if (criticalRisks.length === 0 && !stringAt(projectMemory?.noCriticalRisksReason)) {
      return notSatisfied("projectMemory must record criticalRisks[] (verified key risks/inconsistencies/broken features) or provide noCriticalRisksReason; PROJECT.md may be trimmed but must not lose high-value maintenance risks");
    }
    for (const [index, risk] of criticalRisks.entries()) {
      const item = objectAt(risk);
      if (!item) return notSatisfied(`projectMemory.criticalRisks #${index + 1} is not an object`);
      if (!stringAt(item.summary)) return notSatisfied(`projectMemory.criticalRisks #${index + 1} missing summary`);
      if (!stringAt(item.evidence) && stringList(item.verifiedAgainst).length === 0) return notSatisfied(`projectMemory.criticalRisks #${index + 1} needs evidence or verifiedAgainst[]`);
    }
    const lineCount = Number(projectMemory?.lineCount ?? 0);
    return satisfied(lineCount > 0 ? `PROJECT.md lineCount=${lineCount}, ${criticalRisks.length} critical risk(s)` : `${criticalRisks.length} critical risk(s) recorded`);
  },
};


// ── dimension 2: verification contract ────────────────────────────────────
export const onboardTestingContractCheckpoint: Checkpoint = {
  id: "onboard-testing-contract",
  rule: "the verification contract (docs/testing.md) must record the testing matrix and actually-read test signals; docs/testing.md is a hard deliverable that must really be written, even if the project has no automated tests yet.",
  check(work) {
    const testing = objectAt(work.completionEvidence?.testingContract);
    if (!testing) return notSatisfied("missing completionEvidence.testingContract");
    const testingMatrix = arrayAt(testing.matrix);
    const hasMatrix = testingMatrix.length > 0;
    const testingSignals = stringList(testing.signalsChecked);
    if (testingSignals.length === 0) return notSatisfied("testingContract.signalsChecked must list and actually read test-signal files such as package/test/CI");
    for (const signal of testingSignals) {
      if (!findReadEvidenceForPath(work, signal)) return notSatisfied(`testingContract.signalsChecked missing real read evidence: ${signal}`);
    }
    if (!hasMatrix) return notSatisfied("testingContract.matrix needs at least 1 row; even if the project has no automated tests yet, record not-established/planned verification per change scope");
    for (const [index, row] of testingMatrix.entries()) {
      const item = objectAt(row);
      if (!item) return notSatisfied(`testingContract.matrix #${index + 1} is not an object`);
      if (!stringAt(item.changeScope)) return notSatisfied(`testingContract.matrix #${index + 1} missing changeScope`);
      const current = stringList(item.current ?? item.currentCommands ?? item.runnableNow);
      const planned = stringList(item.planned ?? item.plannedCommands ?? item.recommended);
      const required = stringList(item.required ?? item.requiredVerification);
      const status = stringAt(item.status);
      if (current.length === 0 && planned.length === 0 && required.length === 0 && !status) return notSatisfied(`testingContract.matrix #${index + 1} needs currentCommands[] (runnable now) or plannedCommands[] (recommended to establish) or status (e.g. not-established)`);
      for (const command of current) {
        const rootRunnable = validateRootRunnableCurrentCommand(command, testingSignals);
        if (!rootRunnable.ok) return notSatisfied(`testingContract.matrix #${index + 1} currentCommands must be complete commands runnable directly from the project root: ${rootRunnable.reason}`);
      }
      if (stringList(item.paths).length === 0 && !stringAt(item.pathlessReason)) return notSatisfied(`testingContract.matrix #${index + 1} needs paths[]; if there is truly no path scope, fill pathlessReason`);
    }
    const testingResult = findWriteEditForPath(work, "docs/testing.md");
    if (!testingResult || !isWriteLike(testingResult) || testingResult.isError) {
      return notSatisfied("missing real write/edit of docs/testing.md (onboard's core deliverable, used by subsequent practices' verification; even if the project has no tests, write the current state and plan)");
    }
    return satisfied(`testing matrix ${testingMatrix.length} rows`, [{ toolCallId: testingResult.toolCallId }]);
  },
};


// ── dimension 3: release contract (conditional) ───────────────────────────
export const onboardReleaseContractCheckpoint: Checkpoint = {
  id: "onboard-release-contract",
  rule: "the release contract records the release classification and signals actually read; docs/release.md must really be written when there is a package-release/deploy flow. Projects with no release flow declare notApplicableReason.",
  check(work) {
    const release = objectAt(work.completionEvidence?.releaseContract);
    if (!release) return notSatisfied("missing completionEvidence.releaseContract (if this project has no release flow, set classification='none' and notApplicableReason)");
    const releaseClassification = stringAt(release.classification);
    const validReleaseClassifications = new Set(["none", "ci-only", "package-release", "deploy", "unknown"]);
    if (!validReleaseClassifications.has(releaseClassification)) return notSatisfied("releaseContract.classification must be none / ci-only / package-release / deploy / unknown");
    const releaseSignals = stringList(release.signalsChecked);
    if (releaseSignals.length === 0) return notSatisfied("releaseContract.signalsChecked must list and actually read release-signal files such as package/CI/changelog/deploy; if there are none, explain what was checked");
    for (const signal of releaseSignals) {
      if (!findReadEvidenceForPath(work, signal)) return notSatisfied(`releaseContract.signalsChecked missing real read evidence: ${signal}`);
    }
    if (["package-release", "deploy"].includes(releaseClassification) || stringAt(release.runbook)) {
      const releaseResult = findWriteEditForPath(work, "docs/release.md");
      if (!releaseResult) {
        return notSatisfied("releaseContract.classification indicates a package-release/deploy flow, but no real write/edit of docs/release.md was found; if this is only CI testing, use classification='ci-only'");
      }
    }
    if (["package-release", "deploy"].includes(releaseClassification)) {
      const versionSources = arrayAt(release.versionSources);
      if (versionSources.length === 0) return notSatisfied("package-release/deploy projects must record at least one version source in releaseContract.versionSources[] (e.g. package.json); single-source projects are fine, but record the version per source to avoid writing expected agreement as fact");
      for (const [index, source] of versionSources.entries()) {
        const item = objectAt(source);
        if (!item) return notSatisfied(`releaseContract.versionSources #${index + 1} is not an object`);
        if (!stringAt(item.source) || !stringAt(item.version)) return notSatisfied(`releaseContract.versionSources #${index + 1} must contain source/version`);
      }
      const versionConsistency = stringAt(release.versionConsistency);
      if (!["consistent", "mismatch", "unknown"].includes(versionConsistency)) return notSatisfied("package-release/deploy projects must record releaseContract.versionConsistency: consistent / mismatch / unknown");
      if (versionConsistency === "mismatch" && !stringAt(release.versionMismatchSummary)) return notSatisfied("when releaseContract.versionConsistency=mismatch, versionMismatchSummary must be filled and that fact kept in docs/release.md / PROJECT.md");
    }
    return satisfied(`release=${releaseClassification}`);
  },
};


// ── dimension 4: engineering contract ─────────────────────────────────────
// Establishes AGENTS.md (pi auto-loads it) as the short entry — tech-stack + on-demand
// routing table (triggers -> docs/*.md rule files) + behavior basics — with detailed
// conventions dispersed into docs/ rule files. The agent reads any existing AGENTS.md first,
// then rewrites it wholesale (no patching) so stale content cannot linger.
export const onboardEngineeringContractCheckpoint: Checkpoint = {
  id: "onboard-engineering-contract",
  rule: "the engineering contract establishes AGENTS.md at the project root (pi auto-loads it; keep it short: tech-stack + routing table of triggers->docs/*.md rule files + behavior basics). Read any existing AGENTS.md first, then rewrite it wholesale. Routing-table rule files must really be written.",
  check(work) {
    const engineering = objectAt(work.completionEvidence?.engineeringContract);
    if (!engineering) return notSatisfied("missing completionEvidence.engineeringContract");

    const agentsMd = objectAt(engineering.agentsMd);
    if (!agentsMd) return notSatisfied("engineeringContract.agentsMd missing: onboard must establish AGENTS.md at the project root (pi auto-loads it). Keep it short — tech-stack + a routing table (triggers -> docs/*.md rule files) + behavior basics. Read any existing AGENTS.md first, then rewrite it wholesale; do not patch.");

    // AGENTS.md must really be written (rewritten wholesale, not patched).
    const agentsMdResult = findWriteEditForPath(work, "AGENTS.md");
    if (!agentsMdResult || !isWriteLike(agentsMdResult) || agentsMdResult.isError) {
      return notSatisfied("missing real write/edit of project-root AGENTS.md; read the existing one first (if any), then rewrite it wholesale from your fresh understanding — do not patch, so stale content cannot linger");
    }

    // Routing table is optional (small projects may put conventions directly in AGENTS.md).
    // When present, every referenced rule file must really be written — no dangling routes.
    const routingEntries = arrayAt(engineering.routingEntries);
    const referencedRuleFiles = new Set<string>();
    for (const [index, entry] of routingEntries.entries()) {
      const item = objectAt(entry);
      if (!item) return notSatisfied(`engineeringContract.routingEntries #${index + 1} is not an object`);
      const triggers = arrayAt(item.triggers);
      const ruleFiles = arrayAt(item.ruleFiles);
      if (triggers.length === 0) return notSatisfied(`engineeringContract.routingEntries #${index + 1} needs triggers[] (task keywords that load these rules, e.g. ['写代码','修Bug'])`);
      if (ruleFiles.length === 0) return notSatisfied(`engineeringContract.routingEntries #${index + 1} needs ruleFiles[] (the docs/*.md files to load for those triggers)`);
      for (const f of ruleFiles) {
        const p = stringAt(f);
        if (p) referencedRuleFiles.add(p);
      }
    }
    for (const ruleFile of referencedRuleFiles) {
      if (!findWriteEditForPath(work, ruleFile)) {
        return notSatisfied(`routing table references ${ruleFile} but no real write/edit of it was found; either really write that rule file or drop the route`);
      }
    }

    // git/ui conventions (migrated from the old operating-contract checkpoint).
    for (const key of ["git", "ui"]) {
      const section = objectAt(engineering[key]);
      if (!section) return notSatisfied(`engineeringContract.${key} missing`);
      if (!stringAt(section.summary) && !stringAt(section.reason)) return notSatisfied(`engineeringContract.${key}.summary or reason must not be empty`);
    }

    const refs: Array<{ toolCallId?: string }> = [{ toolCallId: agentsMdResult.toolCallId }];
    return satisfied(
      routingEntries.length > 0
        ? `AGENTS.md + ${referencedRuleFiles.size} rule file(s), ${routingEntries.length} routing entries`
        : "AGENTS.md written",
      refs,
    );
  },
};


function validateCoverageGaps(value: unknown): { ok: true } | { ok: false; reason: string } {
  const gaps = arrayAt(value);
  if (gaps.length === 0) return { ok: false, reason: "coverageGaps[] must not be empty" };
  for (const [index, gap] of gaps.entries()) {
    const item = objectAt(gap);
    if (!item) return { ok: false, reason: `coverageGaps #${index + 1} is not an object` };
    if (!stringAt(item.area ?? item.layer ?? item.flow ?? item.scope)) return { ok: false, reason: `coverageGaps #${index + 1} needs area/layer/flow/scope describing the uncovered layer or flow` };
    if (!stringAt(item.reason)) return { ok: false, reason: `coverageGaps #${index + 1} needs reason explaining why it is uncovered` };
    if (!stringAt(item.impact ?? item.risk ?? item.followUp ?? item.nextRead)) return { ok: false, reason: `coverageGaps #${index + 1} needs impact/risk/followUp/nextRead explaining the impact on PROJECT.md credibility or follow-up reading` };
  }
  return { ok: true };
}
