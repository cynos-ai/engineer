---
name: test
description: "Cynos practice for testing/validating existing behavior by running it and reporting a verdict."
---

# Test Practice

Use `test` when the user's purpose is to validate existing behavior by running it: "test this", "run smoke", "check whether X works", "write a test for X and tell me whether it passes".

Mental model: **testing-as-purpose; verdict is the deliverable**. A FAIL/FLAKE/BLOCKED verdict can be a successful completion if it is backed by real captured evidence.

## Boundaries

- ✅ `test`: run a suite/smoke/browser/API/CLI probe and report PASS/FAIL/FLAKE/BLOCKED.
- ✅ `test`: write a test asset as a means to validate behavior, then run it and report the verdict.
- ❌ `develop`: implementing or changing product behavior. Tests written as part of implementation stay in develop.
- ❌ `debug`: fixing a known bug after reproduction/root cause.
- ❌ `review`: judging by reading rather than running.
- ❌ `docs`: persisted test reports such as `docs/smoke-report.md`.

If testing reveals a bug, report it. Do not fix product code/config inside `test`; start a separate `debug` or `develop` work if the user wants a fix.

## Allowed writes

Allowed:

- test assets: `tests/`, `test/`, `__tests__/`, `spec/`, `e2e/`, `*.test.*`, `*.spec.*`, `*.e2e.*`; browser/e2e test files are allowed, but runner/config changes are not;
- `.cynos/` scratch/evidence files.

Forbidden inside `test`:

- product source/runtime behavior files;
- package/lock/build/test/lint/CI/browser-runner config (`package.json`, lockfiles, `vitest.config.*`, `playwright.config.*`, `cypress.config.*`, workflows, etc.);
- docs/reports/README/PROJECT.md.

## Flow

1. Clarify the target/surface only if ambiguous.
2. Read relevant project docs (`PROJECT.md`, `docs/testing.md`) when present if they affect how to run tests.
3. Choose the matching surface using `skills/verification-method/SKILL.md`.
4. Run the test/probe. If writing a test asset (including via shell redirection/heredoc), run a real test execution command afterwards; a run that happened before the asset was written does not count.
5. Record a verdict:
   - PASS: successful captured run;
   - FAIL: failing captured run or browser/API/CLI failure evidence;
   - FLAKE: evidence of unstable/inconsistent results;
   - BLOCKED: blockedReason + attemptedApproaches + at least one real failed captured attempt + alternativeVerification or degradedEvidence.
6. If a durable test asset remains, run `git status` and follow the local commit policy: commit the retained test asset by default after verification. For safe test finalization, stage only the retained test asset paths, run `git diff --cached --name-only` and confirm it lists only test assets, then run a normal `git commit -m ...`. Do not use broad staging (`git add .`, `git add -A`) or special commit modes (`--amend`, `--allow-empty`, `--no-verify`, `-a`). Only use `commit.status='not-committed'` when the user explicitly asked to skip/not commit. Pure-run testing and throwaway tests written then actually deleted do not need commit ceremony; declaring an asset `throwaway` is not enough if it remains in the worktree.

## Completion evidence

Submit `completionEvidence` with:

- `criteriaCoverage[]` covering every acceptance criterion.
- `scope`: `{ target, surface, plan }`.
- `runs[]`: each run has `{ kind, summary, outcome, evidence?, attemptedApproaches? }`.
- `verdict`: `{ summary, outcome: 'pass'|'fail'|'flake'|'blocked', failures?, blockedReason?, attemptedApproaches?, alternativeVerification?, degradedEvidence? }`.
- `assets.retained[]` only for durable test assets left in the worktree; `assets.throwaway[]` for temporary assets written and actually deleted before completion.
- `finalization` only when durable test assets remain.

Do not add `verification.noTestSuite`; this practice does not use `verification-command-passed`.
