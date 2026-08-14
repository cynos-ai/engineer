---
name: release
description: "Use for release execution and release-system maintenance: push/tag/publish/deploy/GitHub Release/release CI/post-release validation, verify-only release readiness, release runbooks, release workflows, publish/deploy/release scripts, rollback docs, and release verification."
---

# Release Practice

Release is the only practice that may execute external delivery side effects such as `git push`, `git tag`, package publish, production deploy, GitHub Release creation, release CI/CD triggers, and post-release validation.

Release also owns **release-system maintenance**: the runbooks, workflows, scripts, and rollback docs that define how future releases happen.

Local `git commit` alone is not release. Ordinary docs remain `docs`; ordinary build/test/runtime config and `package.json` edits remain `develop` unless they are part of authorized release execution.

## Required start

Use `cynos_start_work(practice="release")` for:

- release execution: verify-only readiness checks, dry-runs, push, tag, publish, deploy, GitHub Release, release CI trigger, post-release validation;
- release-system maintenance: `docs/release.md`, `docs/release`, `docs/release/**`, release/publish/deploy workflows, release automation scripts, publish/deploy scripts, rollback docs, and release verification docs.

## Choose exactly one mode

Set `release.mode` to one of:

- `execute` — running the release process, including verify-only readiness or dry-run checks.
- `maintain` — editing release-system files only.

There is no separate verify mode. A release readiness check is:

```json
"mode": "execute",
"authorization": { "operations": ["verify-only"], "dryRun": true }
```

Hard rule:

> Maintaining release files is not authorization to execute a release.

Hard split rule:

> If the user asks to update release machinery and then release, split the work. Finish a `mode='maintain'` release work first. Then start a fresh `mode='execute'` release work that re-reads the final release runbook/signals and obtains execution authorization.

## Execute flow

Use `mode='execute'` for real release execution and verify-only readiness checks.

1. **Read the release runbook first.** Read `docs/release.md` when it exists. If missing, record `release.guide.missingReason` and inspect real project signals such as release workflows, package metadata, README release notes, deploy configs, or release scripts. Do not invent a release process.
2. **Inspect local state and run substantive preflight verification before side effects.** Run the runbook's pre-release command or the best real project verification. For tag/push-only releases, check release git state before side effects: `git status` plus remote and tag/head/branch state (`git remote -v`, `git tag -l <tag>`, `git log -1`/`git rev-parse HEAD`, or branch check). A bare file-existence check such as `test -f docs/release.md` is not enough execute preflight.
3. **Confirm structured authorization before side effects.** Record operations, branch, targets, version, `includeUncommitted`, `dryRun`, and constraints. Ask with `cynos_ask_user` if any part is unclear.
4. **Require explicit confirmation for high-risk operations.** `npm-publish`, `deploy`, `github-release`, and `ci-trigger` require real user confirmation and `authorization.highRiskConfirmed[]`.
5. **Execute only authorized side effects.** If the user says verify-only, dry-run, no publish, no deploy, or only push/tag, obey exactly. If preflight fails, stop before side effects.
6. **Avoid opaque release scripts for real release evidence.** Prefer explicit commands the checkpoint can classify (`git tag`, `git push`, `npm publish`, `gh release create`, deploy commands). A black-box command like `npm run release` or `node scripts/release.mjs` must be dry-run, decomposed into recognized commands, or backed by a conservative classifier/test before it can prove a real release operation.
7. **Post-validate by operation type.** Validate push/tag/publish/GitHub Release/deploy/CI trigger with matching evidence or a blocked/skipped reason.
8. **Record rollback and final state.** Record rollback/undo, final git status, local-change state, side-effect state, failures/skips, and final release summary.
9. **Complete with `cynos_check_completion`.**

## Maintain flow

Use `mode='maintain'` for release-system maintenance only.

1. **Read release context.** Read `docs/release.md` if it exists, plus the target release workflow/script/runbook before editing. If the runbook is missing, record `release.guide.missingReason` and read real release signals.
2. **Edit only release-owned files.** Valid examples: `docs/release.md`, `docs/release`, `docs/release/**`, `.github/workflows/release*.yml`, `.github/workflows/publish*.yml`, clearly delivery-focused `.github/workflows/deploy*.yml`, `scripts/release.*`, release/changelog/version automation scripts, publish/deploy/pack validation scripts, deploy/rollback runbooks.
3. **Do not edit non-release-owned files in maintain mode.** Do not list or edit `package.json`, `src/**`, `tests/**`, ordinary PR CI/lint/build workflows, ordinary runtime config, dependency files, `node_modules/**`, or evidence/cache/scratch files. `package.json` may be read as a signal but is not release-owned by default.
4. **Run release-relevant verification.** Examples: `git diff --check` plus referenced-file checks for runbooks; `actionlint`/YAML/invariant check for workflows; `node --check`/dry-run/project verification for release scripts; `npm pack --dry-run` for package artifact flow.
5. **Do not execute release delivery side effects.** No `git push`, `git tag`, publish, deploy, GitHub Release, or release CI trigger in maintain mode. If execution is needed, finish maintain first and start a fresh execute work.
6. **Record final local state.** Maintain-mode file edits should be committed by default in git repos. If the user explicitly says not to commit, quote that authorization in `release.finalState.localChangeReason`; if commit fails, record the failed commit evidence.
7. **Complete with `cynos_check_completion`.**

## User steering rules

- **verify-only / dry-run / do not release** → `mode='execute'`, `operations=['verify-only']` or `dryRun=true`, and no real release side effects.
- **maintain release files** → `mode='maintain'`, no release side effects.
- **only push/tag** → do not npm publish, deploy, create GitHub Release, or trigger release CI.
- **no high-risk confirmation** → do not publish/deploy/create release/trigger release CI.
- **preflight fails** → stop before side effects and record the blocker.
- **release command fails** → stop, record failure and rollback/next step; never summarize as successful.

## Captured evidence guidance

- Pre-start generic bash does not count for release evidence. Run preflight verification, release checks, side effects, and final status inside the active work.
- `release.deliveryConfig.filesChanged[]` lists only release-owned edited files. Include examples: `docs/release.md`, `docs/release`, `docs/release/rollback.md`; exclude `package.json`, `src/**`, `tests/**`, ordinary CI/build/runtime config, and evidence/cache/scratch files.
- `release.deliveryConfig.signalsRead[]` and `release.guide.filesRead[]` list files/signals actually read, not guessed from memory.
- Evidence/cache/scratch files must not be listed as release-system changes.
- Do not invent `toolCallId`s; checkpoints infer captured evidence automatically.

## Completion evidence

Use this shape:

- `criteriaCoverage[]` covers the user's release request.
- `release.mode` is `execute` or `maintain`.
- `release.guide.missingReason` only if `docs/release.md` is absent; `release.guide.filesRead[]` may list extra release signals actually read.
- `release.deliveryConfig` is required for `mode='maintain'` or release-system file edits: `filesChanged[]`, `signalsRead[]`, and `summary`.
- `release.authorization` records `summary`, `branch`, `includeUncommitted`, `operations[]`, optional `targets[]`, `version`, `dryRun`, and high-risk confirmations.
- `release.execution` records `summary`, `stepsPerformed[]`, optional `releaseNotPerformedReason`, `postValidation[]`, `rollback`, and failures/skips.
- `release.finalState` records final git status/local change state/side-effect state. Pure execute works with no local file changes may use `localChanges='none'`; maintain local edits should normally be committed.
- `verification.summary` records the real release preflight or release-maintenance verification.

Never use `verification.noTestSuite` for release. Release always needs a real release-relevant verification action.
