# Internal maintenance scripts

These scripts are repository-maintenance implementation details. Prefer invoking them through `package.json` scripts so lifecycle hooks and expected arguments stay consistent.

| File | npm entrypoint | Keep? | Purpose |
|---|---|---:|---|
| `build.mjs` | `npm run build`, `prepack` | yes | Bundles `extensions/index.ts` to a readable root `index.js` and keeps pi host packages external. |
| `check-pack.mjs` | `npm run pack:dry-run` | yes | Runs `npm pack --dry-run --json`, enforces package-size budgets, and asserts required runtime files are included while source/internal directories are excluded. |
| `generate-changelog.mjs` | `npm run changelog`, `npm run changelog:check`, `npm run changelog:release-notes` | yes | Regenerates the current changelog section and release notes from Git commits since the previous tag.
| `smoke-built-index.mjs` | `npm run build:smoke` | yes | Loads the readable build with host-boundary stubs and verifies both successful and failed Tools activation paths.
| `smoke-packed-package.mjs` | `npm run package:smoke` | yes | Installs the freshly packed tarball in isolation and repeats the published-artifact activation smoke, including the bundled Tools version check. |
| `release.mjs` | `npm run release -- <patch|minor|major|x.y.z>` | yes | Performs the local atomic release commit and tag after verification. |

## Deletion policy

No script in this directory is currently stale. Delete a script only after removing or replacing every caller in `package.json`, GitHub Actions, release docs, and maintainer rules.

## Packaging boundary

`scripts/` must stay out of the npm package. `scripts/check-pack.mjs` enforces that boundary during `npm run pack:dry-run`.
