function schema(text: string): string {
  return text.trim();
}

const criteriaCoverageBlock = `  criteriaCoverage: array, each item { criterionId, summary }
    - criterionId must exactly match the id in work.acceptanceCriteria (criterion-1, criterion-2, ...)
    - summary is a non-empty string explaining how this criterion was met`;

const localFinalizationBlock = `  finalization: {
    verificationSummary: string,
    gitSummary: string,  // branch + working-tree status; non-git projects must explain
    commit: { status: 'committed'|'not-committed'|'failed', commitHash?: string, message?: string, reason?: string, userAuthorizedSkip?: boolean }
  }`;

export const reviewEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
${criteriaCoverageBlock}
  reviewScope: { targets: string[], basis or source, targetType?: 'current-diff'|'staged-diff'|'last-commit'|'commit'|'range'|'branch-diff'|'files'|'dirs'|'pr'|'inline'|'previous-work' },
  verification: { permission: 'read-only'|'local-safe'|'ask-before-running'|'full-project', commandsRun?: [{ command, purpose, result }], notRunReason?: string },
  context: { projectDocsRead?: string[], relatedFilesRead?: string[], normsApplied?: string[], notes?: string },
  report: {
    overall: 'pass'|'needs-work'|'blocked',
    summary: string,
    topRisks?: string[],
    projectMemorySuggestions: [{ file, reason, recommendation, priority?: 'high'|'medium'|'low' }],
    findings: [{ severity: 'blocking'|'important'|'minor', category: 'correctness'|'security'|'architecture'|'maintainability'|'performance'|'testing'|'style'|'ux'|'docs'|'other', location, summary, evidence, impact, recommendation, confidence: 'high'|'medium'|'low' }],
    nextSteps: string[]
  }
}
Key: review is strictly read-only and does not modify code/docs/PROJECT.md; scope and verification policy must be explicit; the final report leads with the highest-value content.
`);

export const testEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
${criteriaCoverageBlock}
  scope: { target: string, surface?: 'browser'|'api'|'cli'|'db'|'unit'|'other', plan: string },
  runs: [{ kind: 'test-runner'|'browser'|'api'|'cli'|'db'|'unit'|'other', summary: string, outcome: 'pass'|'fail'|'flake'|'blocked', evidence?: string, attemptedApproaches?: string[] }],
  verdict: {
    summary: string,
    outcome: 'pass'|'fail'|'flake'|'blocked',
    failures?: string[],
    blockedReason?: string,
    attemptedApproaches?: string[],
    alternativeVerification?: string,
    degradedEvidence?: string
  },
  assets?: { retained?: string[], throwaway?: string[] },
  report?: { summary: string, evidence: string[], nextSteps?: string[] },
  finalization?: {
    verificationSummary: string,
    gitSummary: string,
    commit: { status: 'committed'|'not-committed'|'failed', commitHash?: string, message?: string, reason?: string, userAuthorizedSkip?: boolean }
  }
}
Key: test is testing-as-purpose: the verdict is the deliverable, and FAIL/FLAKE/BLOCKED can all be completable results, but each must have real captured run/failed-attempt evidence that matches the verdict (FAIL needs failure evidence; FLAKE needs flaky/mixed evidence). test does not use verification-command-passed and has no verification.noTestSuite. Writing test assets and .cynos/ scratch is allowed; you must not modify product src/runtime config/package/CI/docs/report files, including test/browser runner config such as package.json, vitest.config.*, playwright.config.*, or workflows. If a test asset is written, run a real test execution after the write. finalization is required only when retained test assets are kept; retained assets follow the local commit policy (commit by default, skip only with explicit skip/not-commit authorization). A committed retained test asset must be staged narrowly and backed by git diff --cached --name-only showing only test assets before the normal local commit; pure runs or write-then-actually-delete temporary tests do not need commit ceremony.
`);

export const defaultEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
${criteriaCoverageBlock}
  default: {
    work: {
      summary: string,
      filesChanged?: string[],     // each path must have real write/edit evidence and be limited to .gitignore/.editorconfig/LICENSE
      noFileChangeReason?: string  // explain when there is no file change
    }
  },
  verification: { summary, noTestSuite?: boolean, noTestSuiteReason?: string },
${localFinalizationBlock}
}
Key: default is the lightweight fallback practice, not an exit hatch for "small tasks" or "escaping complex flows". Use it only after no-practice and the specific practices are ruled out. .gitignore/.editorconfig/root LICENSE* are strong default examples, but unknown gray project maintenance can also be default when no practice owns it. Clearly owned work must route elsewhere: prose docs/reports to docs; source/behavior/test-asset/runtime config to develop/debug/refactor/test; project memory to onboard; release-system files and push/tag/publish/deploy/CI side effects to release. filesChanged[] is a claim about delivered file changes and must have captured mutation evidence; noFileChangeReason is explanatory only and is not a routing gate. If no project files changed, do not invent target files just to satisfy default. Pure verification as a deliverable belongs to test; chat-only/read-only answers may need no practice. Real verification, git status, and git commit are inferred from capturedToolResults. PROJECT.md/docs/testing.md are project-knowledge sources: read them first when you need project boundaries, verification strategy, or diagnostic rules, but they are no longer a hard completion gate for default.
`);

export const docsEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
${criteriaCoverageBlock}
  docs: {
    scope: {
      audience: string,
      docType: 'readme'|'guide'|'runbook'|'adr'|'rfc'|'config-doc'|'review-report'|'audit-report'|'other',
      filesTargeted: string[],
      behaviorChangeIncluded: false
    },
    sources: {
      projectFilesRead?: string[],
      externalSources?: [{ title?: string, url?: string, summary: string }],
      userProvidedFacts?: string[],
      assumptions?: string[]
    },
    changes: {
      filesChanged: string[],
      summary: string,
      consistencyNotes?: string[]
    }
  },
  verification: { summary, noTestSuite?: boolean, noTestSuiteReason?: string },
${localFinalizationBlock}
}
Key: docs is for writing/organizing project documentation, review/audit/report files, and docs-only examples, with no runtime behavior change. PROJECT.md/docs/testing.md are project-knowledge sources: read them first when project boundaries, existing-doc consistency, verification strategy, or diagnostic rules are involved, and choose appropriate verification per docs/testing.md; but reading project docs is no longer a hard completion gate for docs. filesChanged must have real write/edit and may only be documentation/text/example-explanation files; LICENSE/.gitignore/.editorconfig go to default; code, tests, CI workflows, package/tsconfig, Docker/K8s/Terraform/nginx, real .env and other runtime-behavior configs must go to develop. Docs involving token/secret/cloud/CI use placeholders and must not contain real secrets (guided by the skill, not a hard completion gate).
`);

export const onboardEvidenceSchema = schema(`
completionEvidence must be a JSON object organized by dimension. The shared preamble (preflight / exploration / authorization) feeds all dimensions; the four dimensions are independent products, each its own top-level field:
{
  // ── shared preamble (feeds all dimensions) ──
  criteriaCoverage: [{ criterionId, summary }],
  onboardMode?: 'human-assisted'|'auto',
  preflight: { gitStatusChecked: true, scopeConfirmationSummary, mode?: 'human-assisted'|'auto' },
  exploration: {
    coreFilesRead: string[],
    readStrategy: { projectType, navigationFiles: string[], coreLogicFiles: string[], layerCoverage: [{ layer, files: string[], reason }], followedEdges: [{ from, to, reason }], coverageGaps?: [{ area, reason, impact }] },
    smallProjectReason?: string,
    coverageGaps?: [{ area, reason, impact }],
    flowsTraced: string[],
    docTrustAudit: [{ file, conclusion, basis? }] or [],
    docTrustAuditNotApplicableReason?: string
  },
  automationDecision?: { rationale or summary, unresolvedQuestions: string[] },

  // ── dimension 1: project understanding (PROJECT.md — business knowledge for the AI, especially non-obvious design decisions and their rationale) ──
  projectMemory: { path: 'PROJECT.md', lineCount?: number, criticalRisks?: [{ summary, evidence? }], noCriticalRisksReason?: string },

  // ── dimension 2: verification contract (how changes in this project are verified; consumed by develop/debug/test) ──
  testingContract: { summary, signalsChecked: string[], matrix: [{ changeScope, paths?: string[], pathlessReason?: string, currentCommands?: string[], plannedCommands?: string[], status?: string }] },

  // ── dimension 3: release contract (how this project is released; conditional — notApplicableReason when there is no release flow) ──
  releaseContract: { classification: 'none'|'ci-only'|'package-release'|'deploy'|'unknown', signalsChecked: string[], reason?: string, runbook?: 'docs/release.md', versionSources?: [{ source, version }], versionConsistency?: 'consistent'|'mismatch'|'unknown', versionMismatchSummary?: string, notApplicableReason?: string },

  // ── dimension 4: engineering contract ──
  // Establishes AGENTS.md at the project root (pi auto-loads it). Keep it SHORT: a tech-stack
  // summary, an on-demand routing table (task keywords -> rule files in docs/), and behavior basics.
  // Detailed conventions disperse into docs/*.md rule files, referenced from AGENTS.md's routing
  // table so later agents load them on demand. Read any existing AGENTS.md first, then REWRITE it
  // wholesale (do not patch) so stale content cannot linger.
  engineeringContract: {
    agentsMd: { reviewedExisting?: boolean, techStack?: string, behaviorBasics?: string },
    routingEntries?: [{ triggers: string[], ruleFiles: string[] }],
    git: { summary|reason },
    ui: { summary|reason }
  }
}
Key: PROJECT.md and docs/testing.md must be really written; docs/release.md must be really written when there are release/deploy/package signals. The four dimensions are independent — a project with no release flow uses releaseContract.notApplicableReason instead of fabricating one. In git repos, wrap up per the Cynos local commit policy; for non-git or when the user opts out, explain why.
`);

export const initEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
  criteriaCoverage: [{ criterionId, summary }],
  init: {
    requirementsSummary,
    requirementsInterview: { problemStatement, targetUsers?: string[], primaryUseCases?: string[], mvpScope: string[], nonGoals?: string[], constraints?: string[], assumptions?: string[], successCriteria: string[], openQuestions?: string[] },
    recommendation: { options: [{ name, summary? or stack?: string[], pros?: string[], cons?: string[], risks?: string[], verificationImplications?: string[], recommended?: boolean, reason? }], recommendedOption, selectedOption, rationale? or userChoiceSummary? },
    techStackDecision,
    decisionRounds?: [{ topic, summary or decision }],
    finalPlanConfirmation: { confirmed: true, summary },
    postScaffoldAudit: { auditedFiles: string[] /* generated manifest/config/source-of-truth files only; do not list README.md, PROJECT.md, docs/testing.md, docs/release.md, node_modules/**, vendored dependencies, or dependency-internal files */, docsUpdatedAfterAudit?: true, docsConsistencySummary?: string },
    userConfirmationSummary
  },
  scaffold: { files: string[] },
  verification: { summary, noTestSuite?: boolean, noTestSuiteReason?: string },
  projectMemory: { path: 'PROJECT.md', lineCount?: number },
  operatingDecisions: {
    testing: { selectedStrategy? or summary, rationale? or reason?, signalsChecked?: string[], matrix: [{ changeScope, paths?: string[], pathlessReason?: string, currentCommands?: string[], plannedCommands?: string[], status?: string }] },
    release: { classification: 'none'|'local-only'|'package-release'|'deploy'|'unknown', summary? or reason? or rationale?, selectedFlow?: string, target?: string, runbook: 'docs/release.md', rollbackStrategy: string, generatedDeployArtifacts?: string[], activeDeploy?: boolean },
    git: { summary|reason|rationale },
    ui: { summary|reason|rationale }
  },
${localFinalizationBlock}
}
Key: init's release contract is written to docs/release.md; finalization only records local verification/git/commit wrap-up. The archive must show target-directory preflight and captured final plan confirmation before the first scaffold write/generator/install/git action; post-hoc reads or approvals cannot repair this ordering. Normal standalone code projects should have a real minimal test/verification setup and a confirmed local git initialization + initial commit plan. The no-test/no-build path is only for genuinely doc-only/meta/config-only projects and still requires a lightweight substantive invariant check; do not fabricate package/test runners just to pass verification. For init.postScaffoldAudit, auditedFiles are generated manifest/config/source-of-truth files used to calibrate operational docs; README.md, PROJECT.md, docs/testing.md, docs/release.md, node_modules/**, vendored dependencies, and dependency-internal files are not auditedFiles. Summarize dependency-version checks in docsConsistencySummary unless the project source-of-truth file was actually read.
`);

export const debugEvidenceSchema = schema(`
completionEvidence must be a JSON object. debug models a SINGLE bug per work; a bug list must be split into separate debug works:
{
  criteriaCoverage: [{ criterionId, summary }],
  debugging: {
    reproduction: {  // OPTIONAL — root cause can be evidenced via logs/stack/tracing without reproducing
      kind?: 'command'|'test'|'browser'|'manual'|'unreproducible',
      summary?: string, steps?: string[], expected?: string, actual?: string, unreproducibleReason?: string
    },
    diagnostics: {
      // key error/log/stack/db-query excerpts (sanitized). one bucket, not split by kind.
      evidenceRead?: string[],
      browserEvidence?: string, browserBlockedReason?: string,
      networkEvidence?: string, networkNotApplicableReason?: string
    },
    investigation: {
      relatedFilesRead: string[],  // must have real read tool evidence
      flowsTraced?: string[],      // optional, skill-guided; the tracing chain also belongs in rootCause.evidence
      comparableWorkingPaths?: string[],
      hypothesesTested?: [{ hypothesis, result: 'confirmed'|'rejected', evidence }]
    },
    rootCause: { summary, evidence: string[] },  // CORE — the hard root-cause requirement; evidence[] = stack/log/tracing/repro excerpts
    fix: { summary, filesChanged?: string[], noFileChangeReason?: string },
    regression: { summary } or { unavailableReason, alternativeVerification }  // OPTIONAL when no reproduction (no red to turn green)
  },
  surfaceVerification?: { summary, blockedReason?: string, attemptedApproaches?: string[], alternativeVerification?: string, degradedEvidence?: string },
  projectImpact?: { durableMemoryUpdateNeeded?: boolean, reason?: string, updatedFiles?: string[] },
  verification: { summary },
  report?: { summary, symptom, reproduction?: string, diagnostics?: string, rootCause, fix, verification, evidence: string[], screenshotsOrArtifacts?: string[], projectMemoryDecision },
${localFinalizationBlock}
}
Key: debug is ROOT-CAUSE-CENTERED, not reproduction-centered. Reproduction is ONE path to root cause — logs, stack traces, and source tracing can evidence the cause without reproducing; reproduction and regression red/green are OPTIONAL when the cause is evidenced otherwise. When reproduction IS used, it is at the layer/surface where the bug was REPORTED (a web symptom at the web layer, not only a deeper API layer); final verification must re-run that same reported scenario. rootCause.evidence[] carries the hard root-cause-evidence requirement (stack/log/tracing/repro excerpts). For reproduction.kind='browser', completion requires captured Playwright CLI direct browser evidence (snapshot/screenshot/console/requests/eval) or strict blocked fallback; diagnostics.browserEvidence/networkEvidence are summaries of captured evidence, not evidence by themselves. Strict browser-blocked fallback is recorded in surfaceVerification with blockedReason, attemptedApproaches[] >= 2, alternativeVerification, degradedEvidence, and real failed browser attempts. diagnostics.evidenceRead[] consolidates key error/log/stack/db-query excerpts (sanitized) into one bucket; database query excerpts follow docs/testing.md read-only rules and must strip secrets/PII, but DB no longer needs a separate used/notUsedReason declaration — it is just another evidence source. investigation.relatedFilesRead[] must list files with real read evidence (pre-start reads are carried over). The report is produced by the skill and is not a hard checkpoint; when projectImpact does not declare an update it is not a hard gate, but once durableMemoryUpdateNeeded=true or updatedFiles is listed, updatedFiles must have real write/edit evidence.
`);

export const developEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
  criteriaCoverage: [{ criterionId, summary }],
  develop: {
    context: {
      complexity: 'simple'|'complex',
      reason: string,
      relatedFilesRead: string[],
      existingPatterns?: string[],
      tracedFlowOrEdges?: string[],
      impactedModules?: string[],
      reuseOrDuplicationCheck: string,
      confidenceBoundary?: string,
      loggingPatterns?: string[]
    },
    plan: {
      summary: string,
      testPlan: string[],
      tasks?: string[],
      touchedAreas?: string[],
      risksOrAssumptions?: string[]
    },
    challenge?: {
      summary: string,
      result?: 'accepted'|'revised'|'fallback'|'skipped-by-user',
      revisions?: string[],
      fallbackReason?: string,
      userAuthorizedSkip?: boolean
    },
    implementation: {
      summary: string,
      filesChanged?: string[],
      noFileChangeReason?: string
    }
  },
  tdd: {
    used: boolean,
    summary: string,
    red?: string,
    green?: string,
    notApplicableReason?: string,
    alternativeVerification?: string
  },
  review: {
    summary: string,
    result: 'pass'|'needs-work'|'blocked'|'fallback'|'skipped-by-user',
    fixesFromReview?: string[],
    fallbackReason?: string,
    selfReviewAcknowledged?: boolean,
    userAuthorizedSkip?: boolean
  },
  surfaceVerification?: { summary, blockedReason?: string, attemptedApproaches?: string[], alternativeVerification?: string, degradedEvidence?: string },
  projectImpact?: { durableMemoryUpdateNeeded?: boolean, reason?: string, updatedFiles?: string[] },
  verification: { summary, noTestSuite?: boolean, noTestSuiteReason?: string },
  report?: { summary: string, releaseDecision: string, deviationsFromPlan?: string, evidence: string[] },
${localFinalizationBlock}
}
Key: use develop for feature/behavior implementation; test assets may be written as an implementation verification means, but when "write/run tests and give a verdict" is the main purpose, use test. simple allows a light plan but still requires context/TDD/reviewer/verification; complex must have tasks/touchedAreas/risks and a challenger audit or auditable fallback; all develop completions require a reviewer or auditable fallback before completion. The report is produced by the skill and is no longer a hard checkpoint; when projectImpact does not declare an update it is not a hard gate, but once durableMemoryUpdateNeeded=true or updatedFiles is listed, updatedFiles must have real write/edit evidence. The TDD checkpoint only proves red/green evidence exists; it does not prove the semantic quality of red; red quality is constrained by the skill, reviewer, and smoke. Frontend/UI/cross-flow changes require direct browser evidence; project e2e/test runners may be extra verification but do not replace browser evidence. If the browser environment is blocked, record strict fallback fields: surfaceVerification.blockedReason, attemptedApproaches[] (>=2), alternativeVerification, and degradedEvidence; completion also requires real failed browser attempts. local commit requires real git commit evidence; commit.status=not-committed requires explicit user authorization (either a captured cynos_ask_user answer with userAuthorizedSkip=true, or an authorization phrase quoted in commit.reason such as 'review-only / don't commit / skip commit'). verification.noTestSuite=true is for projects without an automated test suite: fill noTestSuiteReason and run a real command that loads/compiles/inspects the changed object (e.g. python -c "import x", pip show x, node --check x.js, test -f .env); a bare no-op does not count.
`);

export const refactorEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
  criteriaCoverage: [{ criterionId, summary }],
  refactor: {
    context: { relatedFilesRead: string[] },
    scope: { summary?: string, inScope: string[], outOfScope: string[] },
    behaviorContract: { contracts: [{ id, kind: 'api'|'cli'|'ui'|'data'|'error'|'storage'|'performance'|'other', verification }] },
    plan: { summary: string, slices: [{ id, summary }], verificationPlan: string[] },
    characterization: {
      baseline: { summary: string, command?: string },
      final: { summary: string, command?: string },
      characterizationTestsAdded?: string[],
      contractCoverage: [{ contractId, baselineEvidence, finalEvidence, result: 'same' }]
    },
    challenge: {
      summary: string,
      result: 'accepted'|'revised'|'fallback'|'skipped-by-user',
      revisions?: string[],
      fallbackReason?: string,
      selfChallengeAcknowledged?: boolean,
      userAuthorizedSkip?: boolean
    },
    changes: { summary: string, filesChanged: string[] }
  },
  review: {
    summary: string,
    result: 'pass'|'needs-work'|'blocked'|'fallback'|'skipped-by-user',
    fixesFromReview?: string[],
    fallbackReason?: string,
    selfReviewAcknowledged?: boolean,
    userAuthorizedSkip?: boolean
  },
  surfaceVerification?: {
    summary?: string,
    blockedReason?: string,
    attemptedApproaches?: string[],
    alternativeVerification?: string,
    degradedEvidence?: string
  },
  projectImpact?: { durableMemoryUpdateNeeded?: boolean, reason?: string, updatedFiles?: string[] },
  verification: { summary, noTestSuite?: boolean, noTestSuiteReason?: string },
${localFinalizationBlock}
}
Key: refactor is for actual behavior-preserving code-structure changes, not plan-only advice. Chat-only refactor advice needs no practice; persisted refactor plans use docs. Refactor requires related code reads, bounded scope, id/kind/verification behavior contracts, a concise plan, real baseline evidence before production writes, challenger before production writes, production filesChanged with real write/edit/rm/mv evidence, comparable final evidence after production writes, contractCoverage result='same' for every contract, reviewer after final verification, and local finalization. UI contracts require direct browser evidence before and after production writes, or a strict blocked fallback with real failed browser attempts plus degraded evidence. ProjectImpact is conditional: if durableMemoryUpdateNeeded=true or updatedFiles is listed, updatedFiles must have real write/edit evidence. noTestSuite/substantive checks may serve as baseline/final only as real paired evidence; they are not a bypass around characterization.
`);

export const uiDesignEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
${criteriaCoverageBlock}
  uiDesign: {
    directionDecision: {
      source: 'user-confirmed'|'user-delegated'|'provided-spec'|'existing-brand-spec'|'small-tweak',
      summary: string,                       // how the design direction was chosen; user-confirmed requires a real captured user answer, but checkpoint does not parse answer text
      confirmationSummary?: string
    },
    foundation: {
      mode: 'brand-spec-existing'|'brand-spec-created'|'brand-spec-updated'|'design-system-only',
      summary: string,
      brandSpecPath?: 'brand-spec.md',        // brand-spec is only recognized at the project root; read for real if it exists, write for real if creating/updating
      brandSpecActionReason?: string,        // reason for creating/updating; for design-system-only, explain why brand-spec is not written
      visualDirection?: string,              // required for design-system-only
      tokensSummary?: string,
      assetPaths?: string[]                  // optional; when listed, must have real read/write evidence
    },
    implementation: {
      summary: string,
      artifacts?: string[],                  // final in-project UI deliverables only; each path must have real write/edit evidence; do not list tests, screenshots, scratch, browser evidence, or outside-project files
      noFileChangeReason?: string            // only for critique/design-review/no-change scenarios that still inspect a browser-rendered artifact
    },
    designFidelity?: {
      foundationUsed: string,
      alignmentSummary: string,
      deviations?: [{ item: string, reason: string }]
    }
  },
  browserVerification: { summary: string, targets?: string[], evidence?: [{ kind, summary, artifactPath? }], consoleSummary?: string, blockedReason?: string },
  critique?: { summary: string, overallScore?: number, dimensions?: object, fixesApplied?: string[], remainingIssues?: string[] },
  confirmation?: { summary: string },
  verification: { summary },
${localFinalizationBlock}
}
Key: ui-design works with the web-design-engineer skill; Cynos does not duplicate its intermediate process and only verifies completion facts. PROJECT.md/docs/testing.md are project-knowledge sources: read them first when design system, frontend architecture, verification strategy, or browser rules are involved, but they are no longer a hard completion gate for ui-design. directionDecision records how the design direction was chosen; user-confirmed requires a real captured user answer, but the checkpoint does not parse answer text. brand-spec.md is a durable design contract at the project root: read if present, create or update for new-brand/asset tasks, and for non-brand one-offs you may use design-system-only with a reason. Declared UI artifacts must be really written final in-project UI deliverables; do not list tests, screenshots, scratch, browser evidence, or outside-project files. There must be real browser/screenshot/console evidence after the last UI-like production write — browser-not-applicable or build/typecheck static substitutes are not accepted. Written test assets must really run test/browser via the shared test-assets checkpoint. A critique or evidenced user confirmation is required at the end, and implementation work must include designFidelity foundation/alignment reporting; local commit, no push/tag/publish/deploy.
`);

export const usabilityEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
${criteriaCoverageBlock}
  usability: {
    targets: string[],  // target viewport/scenario list, e.g. ['mobile 360px', 'desktop 1280px']
    observations: [
      {
        id: string,                          // e.g. 'obs-1', used for report references
        severity: 'blocking'|'important'|'minor',
        summary: string,                     // problem description
        area: string,                        // e.g. 'responsive / mobile menu', for locating
        before: {                            // pre-fix browser evidence
          screenshot?: string,               // path under .cynos/browser-evidence/
          snapshot?: string,                 // DOM snapshot path
          consoleErrors?: string[],
          networkErrors?: string[],
          viewport?: string                  // e.g. '360x640'
        },
        fix?: {                              // required when status='fixed'
          summary: string,
          filesChanged: string[]             // each file needs real write/edit evidence; evidence/cache/scratch artifacts do not count
        },
        after?: {                            // required when status='fixed', browser evidence of re-checking the same scenario
          screenshot?: string,
          snapshot?: string,
          consoleErrors?: string[],
          networkErrors?: string[],
          viewport?: string
        },
        deferredReason?: string,             // explain when status='deferred'|'wontfix' (required for blocking/important)
        status: 'fixed'|'deferred'|'wontfix'
      }
    ],
    browserBlocked?: {                       // recorded when the browser cannot launch/use from the start; degrade to a single-evidence type and continue
      reason: string,                        // specific failure cause
      attemptedApproaches: string[],         // at least 2 launch approaches tried
      degradedEvidence: string,              // what it degraded to (e.g. static DOM/code inspection plus screenshot unavailable note; not browser evidence)
      userAuthorized?: boolean
    },
    scope: {
      behaviorPreserved: boolean,            // whether business/product behavior was preserved
      behaviorPreservedSummary: string,      // how it was confirmed, e.g. 'page-level UX only; no API/data/auth/business logic changes'
      pageInteractionChanges?: string[],     // allowed page-level UX touches to existing behavior, e.g. focus trap, scroll lock, Escape close
      functionalChangesIntroduced?: string[] // likely out-of-scope behavior changes; declare and consider debug/develop instead
    }
  },
  report: {
    summary: string,
    observationsSummary: string,             // what was found
    fixesSummary: string,                    // what was fixed (for observe-only, explain 'not fixed')
    deferredItems?: string[],                // deferred/wontfix observations
    behaviorPreserved: string,               // confirm no business/product behavior changes
    pageInteractionChanges?: string[],       // required when usability.scope.pageInteractionChanges[] is non-empty
    functionalChangesIntroduced?: string[],  // required when usability.scope.functionalChangesIntroduced[] is non-empty
    screenshots?: string[],                  // screenshot paths under .cynos/browser-evidence/
    evidence: string[]
  },
  verification: { summary },
${localFinalizationBlock}
}
Key: usability is a browser-first page-level UX optimization specialist — an observe + fix + re-observe chain for existing pages/controls/interactions that work but are hard to use. Each fixed observation needs before Playwright CLI direct browser evidence before the first real fix write and after evidence after the last real fix write; screenshot paths are artifacts, not evidence by themselves. status='fixed' requires real product file writes in fix.filesChanged[]; noFileChangeReason is not a completion path for fixed usability work, and evidence/cache/scratch artifacts do not count as fix files. Blocking/important must be fixed or explain a deferred reason; minor may be postponed; observe-only is allowed. Page-level interaction touches to existing behavior are allowed when declared in scope.pageInteractionChanges[] and report.pageInteractionChanges[], but new visible controls/actions/capabilities, business/product behavior, data flow, API, auth, or core feature changes belong in debug/develop. If functionalChangesIntroduced[] is declared, the report must expose it and the checkpoint passes only with a soft warning in details. browserBlocked means the browser is globally unavailable from the start: attemptedApproaches>=2, degradedEvidence, real failed browser attempts before the first fix write, and no successful Playwright CLI browser evidence in the work. typecheck/build/e2e cannot stand in for direct browser evidence.
`);

export const releaseEvidenceSchema = schema(`
completionEvidence must be a JSON object with the following structure:
{
  criteriaCoverage: [{ criterionId, summary }],
  release: {
    mode: 'execute'|'maintain',
    guide: {
      missingReason?: string,  // required when docs/release.md does not exist; when it exists, real read evidence proves it was read
      filesRead?: string[]     // optional extra release signals/runbooks actually read
    },
    deliveryConfig?: {         // required for mode='maintain' or release-system file edits
      filesChanged: string[],  // release-owned files only: docs/release.md, docs/release, docs/release/**, release/publish/deploy workflows, release automation scripts, rollback docs. Do not list package.json, src/**, tests/**, node_modules/**, evidence/cache artifacts, or ordinary CI/build/runtime config.
      signalsRead: string[],   // files/signals actually read to ground the release-system change; package.json may be read as a signal but is not release-owned by default
      summary: string
    },
    authorization: {
      summary: string,
      branch: string,
      includeUncommitted: boolean,
      operations: Array<'verify-only'|'push'|'tag'|'npm-publish'|'deploy'|'github-release'|'ci-trigger'>,
      targets?: string[],
      version?: string,
      dryRun?: boolean,
      highRiskConfirmed?: string[]  // npm-publish/deploy/github-release/ci-trigger require cynos_ask_user/capturedUserAnswers confirmation
    },
    execution: {
      summary: string,
      stepsPerformed: [{ operation, result: 'succeeded'|'failed'|'skipped', evidence?: string, reason?: string }],
      releaseNotPerformedReason?: string,  // required when no real push/tag/publish/deploy/CI side effect was executed
      postValidation: [{ kind: 'ci'|'git-remote'|'tag'|'github-release'|'npm-package'|'deploy-url'|'manual', result: 'passed'|'failed'|'blocked'|'skipped', evidence?: string, reason?: string }],
      rollback: string,
      failuresOrSkipped?: string[]
    },
    finalState: {
      summary: string,
      gitStatusSummary?: string,
      localChanges: 'none'|'committed'|'not-committed'|'commit-failed',
      localChangeReason?: string,
      sideEffectState?: string
    }
  },
  verification: { summary: string, commandsRun?: [{ command, purpose, result }], notRunReason?: string }
}
Key: release has two modes. mode='execute' covers verify-only readiness, dry-runs, and real push/tag/publish/deploy/GitHub Release/release CI/post-release validation; it must read docs/release.md or real release signals, run substantive pre-release verification before side effects, obtain structured authorization, execute only authorized side effects, avoid opaque black-box release scripts unless dry-run/decomposed/classified, post-validate each non-verify-only operation, record rollback, and record final state. For tag/push-only execution, git release-state checks such as git status plus remote and tag/head/branch checks can satisfy preflight; a bare file-existence check such as test -f docs/release.md cannot. mode='maintain' edits release-system files only (release runbooks, release workflows, publish/deploy/release scripts, rollback docs); maintaining release files is not authorization to release, and if the user wants to change release machinery and then publish/deploy, split into a maintain work followed by a fresh execute work. package.json may be read as a release signal but is not release-owned by default in maintain mode; execute-mode release scripts may still mutate package/version/lockfile/changelog as part of authorized release execution.
`);
