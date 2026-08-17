# Testing

This document is the public verification entrypoint for Cynos Engineer.

## Standard verification

```bash
npm run verify
```

The command runs:

1. TypeScript typechecking;
2. the Vitest unit-test suite;
3. a smoke check of the generated CommonJS entrypoint using host-package stubs;
4. an isolated install smoke of the freshly packed npm tarball, including the bundled Tools version.

For package or release changes also run:

```bash
npm run pack:dry-run
npm run package:smoke
npm audit --omit=dev --audit-level=high
```

## Targeted checks

```bash
npm run typecheck
npx vitest run tests/practice-checkpoints.test.ts
npm run build
npm run build:smoke
npm run package:smoke
```

Use a targeted test while iterating, then run the complete suite before handoff.

## What the tests cover

The suite covers work state transitions, captured tool results, practice
registry and routing helpers, completion checkpoints, configuration, subagent
boundaries, and the public capability integration boundaries. The build smoke
checks the default export, host-package externalization, and child-safe tool
registration without requiring a live pi process or browser.

## Package validation

`npm run pack:dry-run` verifies that the package contains its runtime entrypoint,
skills, subagents, README, and license while excluding source, tests, CI files,
and repository-only material. It also verifies that browser binaries are not
included.

## Diagnostics

- Type/API failures: run `npm run typecheck` and inspect the first diagnostic.
- Unit failures: run the affected Vitest file and inspect the assertion diff.
- Build failures: run `npm run build` directly, then rerun `npm run build:smoke`.
- Package failures: inspect the allowlist and run `npm pack --dry-run --json` for
  the raw file list.
- pi integration failures: reproduce in a disposable target project with a
  pinned package or local `pi -e` entrypoint.

Tests must use fake credentials and disposable paths. Redact tokens, cookies,
private URLs, and personal data from failure reports.
