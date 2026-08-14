---
name: verification-method
description: "Reusable method for deciding and running surface verification inside another Cynos practice. Not a standalone practice."
---

# Verification Method

Verification-method is not a standalone practice. Use it inside `develop`, `debug`, `refactor`, `ui-design`, `usability`, `test`, `init`, or `release` when behavior must be verified through the matching external surface.

`test` is the standalone landing point when testing/validating is the user's primary purpose and the verdict is the deliverable.

## Meaning

Surface verification means validating through the surface that proves the behavior:

- browser for UI/frontend flows;
- API request or integration test for API behavior;
- CLI command for CLI behavior;
- migration dry-run/read-only DB check for database behavior;
- project test runner for unit/integration/e2e assets.

For UI/browser gates in modifying practices, direct browser evidence is required: browser-automation snapshot/screenshot/console/requests/eval. Project e2e/browser test runners may be useful extra verification, but they do not replace direct browser evidence.

## Default asset locations

- Rules and matrix: `docs/testing.md`
- Durable automated assets when repeatedly useful: follow project convention, commonly `tests/`, `test/`, `__tests__/`, `spec/`, or existing e2e/browser locations.

Do not create extra docs/fixtures unless the project genuinely needs durable structure.

## Flow inside the active practice

1. Read `docs/testing.md` if present.
2. Decide the surface that matches the changed or tested behavior.
3. Prefer existing project commands (`npm test`, `pytest`, `go test`, API smoke scripts, CLI smoke commands, etc.) for non-browser behavior and final project verification.
4. For frontend/UI/usability/browser gates, use browser automation (`npx --yes @playwright/cli`) for direct snapshot/screenshot/console/requests/eval evidence. Do not use `npx playwright test`, `npm run e2e`, or similar project runners as a substitute for direct browser evidence; they may be extra verification only.
5. If the flow will be repeatedly validated and the user/project needs a durable asset, consider adding/updating a test asset in the current practice, then run it.
6. If browser verification is blocked, record strict fallback fields in modifying practices (`blockedReason`, `attemptedApproaches[]`, `alternativeVerification`, `degradedEvidence`, plus real failed browser attempts), or a BLOCKED verdict with attempted evidence in `test`.

## Command hygiene

The completion gate rejects verification commands that can swallow a failing exit code:

- **Do not** pipe verification output through `head` / `tail` / `grep` (e.g. `npm test && cat docs/x.md | head -5`) unless you prefix the command with `set -o pipefail`. A bare `| head` masks a non-zero exit from the preceding step, so it cannot count as a clean final verification.
- If the project has **no real test suite**, do not chain `npm test` (which may print "no tests") with `cat | head`. Instead set `verification.noTestSuite: true` + a `noTestSuiteReason`, and run one clean substantive check (e.g. `test -f <file>`, a markdown lint if present, or a build for docs-as-code).
- Keep the verification command a clean, single-purpose invocation; run separate inspection reads (`read`, separate `bash`) outside the verification step.

## Evidence

Do not invent runtime IDs. Captured evidence comes from real bash/browser/API/CLI tool results. Summarize what surface was verified, which command/tool ran, and what it proved.
