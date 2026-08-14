import type { PracticeDefinition, PracticeId } from "../core/types";
import { criteriaCoverageCompleteCheckpoint, projectMemoryWrittenCheckpoint, verificationCommandPassedCheckpoint } from "./checkpoints/common";
import { reviewReadOnlyCheckpoint, reviewReportStructuredCheckpoint, reviewScopeEvidencedCheckpoint, reviewVerificationRecordedCheckpoint } from "./checkpoints/review";
import { onboardDecisionAuthorizedCheckpoint, onboardEngineeringContractCheckpoint, onboardExplorationEvidencedCheckpoint, onboardProjectUnderstandingCheckpoint, onboardReleaseContractCheckpoint, onboardScopeConfirmedCheckpoint, onboardTestingContractCheckpoint } from "./checkpoints/onboard";
import { initCoreDocsWrittenCheckpoint, initOperatingContractDefinedCheckpoint, initPostScaffoldAuditCheckpoint, initReleaseContractDefinedCheckpoint, initScaffoldWrittenCheckpoint, initUserDecisionCapturedCheckpoint } from "./checkpoints/init";
import { debugDiagnosticsCheckpoint, debugFixCheckpoint, debugInvestigationCheckpoint, debugProjectImpactCheckpoint, debugRegressionCheckpoint, debugReproductionCheckpoint, debugRootCauseCheckpoint } from "./checkpoints/debug";
import { defaultWorkRecordedCheckpoint } from "./checkpoints/default";
import { docsFilesWrittenCheckpoint, docsScopeRecordedCheckpoint, docsSourcesEvidencedCheckpoint } from "./checkpoints/docs";
import { developChallengeCheckpoint, developContextCheckpoint, developImplementationCheckpoint, developPlanCheckpoint, developProjectImpactCheckpoint, developReviewCheckpoint, developTddCheckpoint } from "./checkpoints/develop";
import { changeFinalizationRecordedCheckpoint } from "./checkpoints/change";
import { surfaceVerificationEvidenceIfRequiredCheckpoint } from "./checkpoints/surface";
import { testAssetsPassedIfWrittenCheckpoint } from "./checkpoints/test-assets";
import { testAssetsExecutedIfWrittenCheckpoint, testFinalizationIfAssetsWrittenCheckpoint, testProductReadonlyCheckpoint, testVerdictRecordedCheckpoint } from "./checkpoints/test";
import { refactorBehaviorContractMappedCheckpoint, refactorChallengeCheckpoint, refactorChangesCheckpoint, refactorCharacterizationCheckpoint, refactorFilesReadCheckpoint, refactorPlanCheckpoint, refactorProjectImpactCheckpoint, refactorReviewCheckpoint, refactorScopeBoundedCheckpoint } from "./checkpoints/refactor";
import { releaseAuthorizationRecordedCheckpoint, releaseDeliveryConfigRecordedCheckpoint, releaseExecutionRecordedCheckpoint, releaseFinalStateRecordedCheckpoint, releaseGuideReadCheckpoint, releaseVerificationRecordedCheckpoint } from "./checkpoints/release";
import { browserEvidenceCheckpoint, critiqueOrConfirmationCheckpoint, rootBrandSpecCheckpoint, uiArtifactWrittenCheckpoint, uiDirectionDecisionCheckpoint } from "./checkpoints/ui";
import { usabilityFixesCheckpoint, usabilityObservationsCheckpoint, usabilityReportCheckpoint, usabilityScopeCheckpoint } from "./checkpoints/usability";
import { defaultEvidenceSchema, debugEvidenceSchema, developEvidenceSchema, docsEvidenceSchema, initEvidenceSchema, onboardEvidenceSchema, refactorEvidenceSchema, releaseEvidenceSchema, reviewEvidenceSchema, testEvidenceSchema, uiDesignEvidenceSchema, usabilityEvidenceSchema } from "./evidence-schemas";
import { onboardConcerns } from "./concerns/onboard";
import { developConcerns } from "./concerns/develop";

export const reviewPractice: PracticeDefinition = {
  id: "review",
  title: "Review",
  methodology: "skills/review/SKILL.md",
  guidance: {
    whenToUse: "Use for independent judgment of existing code, designs, PRs, diffs, commits, or docs. Chat-only future advice needs no practice; persisted reports use docs.",
    mentalModel: "Independent reviewer: produce a structured judgment without modifying the reviewed object.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, reviewReadOnlyCheckpoint, reviewScopeEvidencedCheckpoint, reviewVerificationRecordedCheckpoint, reviewReportStructuredCheckpoint],
  evidenceSchema: reviewEvidenceSchema,
};

export const docsPractice: PracticeDefinition = {
  id: "docs",
  title: "Documentation",
  methodology: "skills/docs/SKILL.md",
  guidance: {
    whenToUse: "Use for prose project docs, guides, runbooks, ADR/RFC, config docs, placeholder examples, and persisted review/audit/report files without runtime behavior changes.",
    mentalModel: "Docs engineer: define audience/type/sources, confirm no behavior change, write only docs-safe files, use placeholders for any secrets (skill expectation, not a completion gate), then verify and finalize locally.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, docsScopeRecordedCheckpoint, docsSourcesEvidencedCheckpoint, docsFilesWrittenCheckpoint, verificationCommandPassedCheckpoint, changeFinalizationRecordedCheckpoint],
  evidenceSchema: docsEvidenceSchema,
};

export const defaultPractice: PracticeDefinition = {
  id: "default",
  title: "Default fallback",
  methodology: "skills/default/SKILL.md",
  guidance: {
    whenToUse: "Lightweight fallback for project-internal maintenance when no specific practice clearly owns the work. .gitignore, .editorconfig, and root LICENSE* are strong examples, but default is not a small-task shortcut and not pure verification-as-deliverable.",
    mentalModel: "Negative-space fallback with an ownership denylist: unknown/gray maintenance can proceed, but source/tests/docs/runtime config/project memory/release-owned files and release side effects must route to the owning practice.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, defaultWorkRecordedCheckpoint, verificationCommandPassedCheckpoint, changeFinalizationRecordedCheckpoint],
  evidenceSchema: defaultEvidenceSchema,
};

export const onboardPractice: PracticeDefinition = {
  id: "onboard",
  title: "Onboarding and project memory",
  methodology: "skills/onboard/SKILL.md",
  guidance: {
    whenToUse: "Use to understand an existing project and create or refresh durable project memory such as PROJECT.md for future maintenance.",
    mentalModel: "Confirm scope, explore code-first, then write high-signal project memory according to the configured onboard mode.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, onboardScopeConfirmedCheckpoint, onboardExplorationEvidencedCheckpoint, onboardDecisionAuthorizedCheckpoint, projectMemoryWrittenCheckpoint, onboardProjectUnderstandingCheckpoint, onboardTestingContractCheckpoint, onboardReleaseContractCheckpoint, onboardEngineeringContractCheckpoint],
  concerns: onboardConcerns,
  evidenceSchema: onboardEvidenceSchema,
};

export const initPractice: PracticeDefinition = {
  id: "init",
  title: "Project initialization",
  methodology: "skills/init/SKILL.md",
  guidance: {
    whenToUse: "Use when the user wants to create/scaffold a new project from scratch, choose a stack, and generate a runnable skeleton.",
    mentalModel: "Clarify requirements, recommend architecture/stack/testing/release choices, get user confirmation, scaffold, verify, and write durable operating docs.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, initUserDecisionCapturedCheckpoint, initScaffoldWrittenCheckpoint, verificationCommandPassedCheckpoint, projectMemoryWrittenCheckpoint, initCoreDocsWrittenCheckpoint, initPostScaffoldAuditCheckpoint, initOperatingContractDefinedCheckpoint, initReleaseContractDefinedCheckpoint, changeFinalizationRecordedCheckpoint],
  evidenceSchema: initEvidenceSchema,
};

export const testPractice: PracticeDefinition = {
  id: "test",
  title: "Test",
  methodology: "skills/test/SKILL.md",
  guidance: {
    whenToUse: "Use when the user's purpose is testing or validating existing behavior by running it: smoke tests, test suites, browser/API/CLI probes, or writing test assets whose verdict is the deliverable.",
    mentalModel: "Testing-as-purpose: run through the matching surface, record PASS/FAIL/FLAKE/BLOCKED with real evidence, optionally write test assets, and never modify product code/config/docs.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, testVerdictRecordedCheckpoint, testProductReadonlyCheckpoint, testAssetsExecutedIfWrittenCheckpoint, testFinalizationIfAssetsWrittenCheckpoint],
  evidenceSchema: testEvidenceSchema,
};

export const debugPractice: PracticeDefinition = {
  id: "debug",
  title: "Systematic debug",
  methodology: "skills/debug/SKILL.md",
  guidance: {
    whenToUse: "Use for bugs, failing tests/builds, unexpected behavior, performance or integration failures that require root cause, fix, and verification (reproduction is one path to root cause, not a requirement).",
    mentalModel: "Evidence the root cause before fixing — via reproduction, logs, stack traces, or source tracing (reproduction optional); avoid guess-fixes. Small bug lists are allowed only with per-issue root cause and verification.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, debugReproductionCheckpoint, debugDiagnosticsCheckpoint, debugInvestigationCheckpoint, debugRootCauseCheckpoint, debugFixCheckpoint, debugRegressionCheckpoint, debugProjectImpactCheckpoint, surfaceVerificationEvidenceIfRequiredCheckpoint, testAssetsPassedIfWrittenCheckpoint, verificationCommandPassedCheckpoint, changeFinalizationRecordedCheckpoint],
  evidenceSchema: debugEvidenceSchema,
};

export const developPractice: PracticeDefinition = {
  id: "develop",
  title: "Development",
  methodology: "skills/develop/SKILL.md",
  guidance: {
    whenToUse: "Use for features, user-visible behavior, new visible page controls/actions/capabilities, business logic/data/API/CLI/page/state flow, runtime/build/CI/package config, and general implementation work. If writing/running tests is the primary deliverable, use test instead.",
    mentalModel: "Consult project memory when relevant, read relevant modules, classify simple/complex, prefer TDD, challenge complex plans, get reviewer feedback, verify, and finalize with local git state.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, developContextCheckpoint, developPlanCheckpoint, developChallengeCheckpoint, developTddCheckpoint, developImplementationCheckpoint, developReviewCheckpoint, developProjectImpactCheckpoint, surfaceVerificationEvidenceIfRequiredCheckpoint, testAssetsPassedIfWrittenCheckpoint, verificationCommandPassedCheckpoint, changeFinalizationRecordedCheckpoint],
  evidenceSchema: developEvidenceSchema,
  concerns: developConcerns,
};

export const refactorPractice: PracticeDefinition = {
  id: "refactor",
  title: "Behavior-preserving refactor",
  methodology: "skills/refactor/SKILL.md",
  guidance: {
    whenToUse: "Use for structural cleanup, module extraction/merge, boundary isolation, deduplication, or internal replacement where external behavior must stay equivalent.",
    mentalModel: "Behavior-contract refactor: read related code, bound scope, define contracts, plan, capture baseline, challenge before production writes, implement, prove comparable final equivalence, and review after final verification.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, refactorFilesReadCheckpoint, refactorScopeBoundedCheckpoint, refactorBehaviorContractMappedCheckpoint, refactorPlanCheckpoint, refactorCharacterizationCheckpoint, refactorChallengeCheckpoint, refactorChangesCheckpoint, refactorReviewCheckpoint, refactorProjectImpactCheckpoint, surfaceVerificationEvidenceIfRequiredCheckpoint, testAssetsPassedIfWrittenCheckpoint, verificationCommandPassedCheckpoint, changeFinalizationRecordedCheckpoint],
  evidenceSchema: refactorEvidenceSchema,
};

export const uiDesignPractice: PracticeDefinition = {
  id: "ui-design",
  title: "UI design engineering",
  methodology: "skills/ui-design/SKILL.md",
  guidance: {
    whenToUse: "Use for visual UI deliverables: brand specs, design systems, themes, layout/aesthetic implementation, component visual styling, page visual design, and browser-rendered presentation work. Existing UX friction belongs to usability; new capabilities/actions/data flow belong to develop; broken behavior belongs to debug.",
    mentalModel: "Follow web-design-engineer: establish direction/foundation, write final in-project UI artifacts, verify the final rendered UI in a browser after the last UI-like production write, critique/confirm alignment, and finalize locally.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, uiDirectionDecisionCheckpoint, rootBrandSpecCheckpoint, uiArtifactWrittenCheckpoint, browserEvidenceCheckpoint, critiqueOrConfirmationCheckpoint, testAssetsPassedIfWrittenCheckpoint, verificationCommandPassedCheckpoint, changeFinalizationRecordedCheckpoint],
  evidenceSchema: uiDesignEvidenceSchema,
};

export const usabilityPractice: PracticeDefinition = {
  id: "usability",
  title: "Frontend usability",
  methodology: "skills/usability/SKILL.md",
  guidance: {
    whenToUse: "Use for browser-first page-level UX work where an existing page/control/interaction works but is hard to use: responsive layout, overflow, touch targets, popover bounds, focus/keyboard health, loading/empty/error states, helper text, and existing local interaction friction. New visible controls/actions/capabilities belong to develop.",
    mentalModel: "Browser-first UX: observe with evidence before changing files, make page-level experience fixes to existing behavior (including small local interaction polish), avoid new controls/capabilities and business/product behavior changes, re-observe after the last fix write, and report any interaction/functional changes structurally.",
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, usabilityObservationsCheckpoint, usabilityFixesCheckpoint, usabilityScopeCheckpoint, usabilityReportCheckpoint, testAssetsPassedIfWrittenCheckpoint, verificationCommandPassedCheckpoint, changeFinalizationRecordedCheckpoint],
  evidenceSchema: usabilityEvidenceSchema,
};

export const releasePractice: PracticeDefinition = {
  id: "release",
  title: "Release delivery",
  methodology: "skills/release/SKILL.md",
  guidance: {
    whenToUse: "Use for release execution and release-system maintenance: push, tag, publish, deploy, GitHub Release, release CI trigger, post-release validation, verify-only release readiness checks, release runbooks, release workflows, publish/deploy scripts, release automation scripts, rollback docs, and release verification. Ordinary docs remain docs; ordinary build/test/runtime config and package.json changes remain develop unless a future field-level release ownership design says otherwise.",
    mentalModel: "Release operator/maintainer: either execute the release process with preflight, authorization, side-effect subset checks, post-validation, rollback, and final state; or maintain release-system files only, with release-relevant verification and no delivery side effects."
  },
  checkpoints: [criteriaCoverageCompleteCheckpoint, releaseGuideReadCheckpoint, releaseAuthorizationRecordedCheckpoint, releaseDeliveryConfigRecordedCheckpoint, releaseVerificationRecordedCheckpoint, releaseExecutionRecordedCheckpoint, releaseFinalStateRecordedCheckpoint],
  evidenceSchema: releaseEvidenceSchema,
};

const practices = new Map<PracticeId, PracticeDefinition>([
  [reviewPractice.id, reviewPractice],
  [docsPractice.id, docsPractice],
  [onboardPractice.id, onboardPractice],
  [initPractice.id, initPractice],
  [testPractice.id, testPractice],
  [debugPractice.id, debugPractice],
  [developPractice.id, developPractice],
  [refactorPractice.id, refactorPractice],
  [uiDesignPractice.id, uiDesignPractice],
  [usabilityPractice.id, usabilityPractice],
  [releasePractice.id, releasePractice],
  [defaultPractice.id, defaultPractice],
]);

export function getPractice(id: PracticeId): PracticeDefinition {
  const practice = practices.get(id);
  if (!practice) throw new Error(`unknown practice: ${id}`);
  return practice;
}

export function allPractices(): PracticeDefinition[] {
  return [...practices.values()];
}

export function isKnownPractice(id: string): id is PracticeId {
  return practices.has(id as PracticeId);
}

export function validatePractices(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const practice of practices.values()) {
    if (seen.has(practice.id)) errors.push(`duplicate Practice ID: ${practice.id}`);
    seen.add(practice.id);
    if (!practice.methodology.trim()) errors.push(`${practice.id}: methodology must not be empty`);
    if (!practice.evidenceSchema.trim()) errors.push(`${practice.id}: evidenceSchema must not be empty`);
    if (practice.checkpoints.length === 0) errors.push(`${practice.id}: at least one checkpoint is required`);
    const checkpointIds = new Set<string>();
    for (const checkpoint of practice.checkpoints) {
      if (checkpointIds.has(checkpoint.id)) errors.push(`${practice.id}: duplicate checkpoint ID: ${checkpoint.id}`);
      checkpointIds.add(checkpoint.id);
      if (!checkpoint.rule.trim()) errors.push(`${practice.id}.${checkpoint.id}: rule must not be empty`);
    }
  }
  return errors;
}

