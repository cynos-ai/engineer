# Development

## Setup

```bash
npm ci
npm run verify
npm run pack:dry-run
```

The repository is TypeScript. The development entrypoint is
`extensions/index.ts`; the published CommonJS entrypoint is generated at
`index.js` and is intentionally ignored by Git.

## Useful commands

```bash
npm run typecheck
npm test
npm run build
npm run build:smoke
npm run verify
npm run pack:dry-run
```

`npm run verify` runs typechecking, unit tests, and the built-entry smoke check.
`npm run pack:dry-run` additionally checks the npm file allowlist and tarball
boundaries.

## Local pi testing

Load the source extension in a disposable target project:

```bash
cd /path/to/target-project
pi -e /path/to/cynos-engineer/index.ts
```

Keep the target project disposable when testing practices that write files. Do
not commit target-project state, credentials, screenshots, or user data to this
repository.

## Code changes

1. Read the relevant source, tests, and public documentation first.
2. Keep changes focused and preserve public behavior unless the change explicitly
   requires a behavior update.
3. Add or update tests for changed runtime behavior.
4. Run the smallest relevant check while iterating and the full verification
   commands before opening a pull request.
5. Update architecture or user documentation when a durable public behavior,
   configuration, or package boundary changes.

## Package boundary

The npm package intentionally contains the runtime entrypoint, skills,
subagents, README files, and license. Source, tests, CI, development scripts,
and repository documentation stay out of the published tarball.
