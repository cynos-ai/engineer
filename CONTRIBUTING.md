# Contributing

Thank you for contributing to Cynos Engineer. This repository is the public
source for `@cynos-ai/engineer`; keep contributions focused, reproducible, and
free of private project data.

## Development setup

```bash
npm ci
npm run verify
npm run pack:dry-run
```

Node.js 22 or newer is required.

## Local pi testing

Load the source entrypoint in a disposable target project:

```bash
cd /path/to/target-project
pi -e /path/to/cynos-engineer/index.ts
```

Do not commit target-project state, credentials, screenshots, or generated
artifacts to this repository.

## Pull requests

- Explain the user-visible behavior or maintenance problem.
- Include focused tests for runtime changes.
- Update public documentation when behavior or configuration changes.
- Run `npm run verify` and, for package changes, `npm run pack:dry-run`.
- Keep generated `index.js`, `node_modules/`, `.cynos/`, tarballs, and secrets
  out of commits.
- Preserve third-party notices and license files when moving bundled content.

## Build and release

`npm run build` bundles the TypeScript entrypoint into a readable, unminified
CommonJS `index.js`. Releases are made by the
maintainer through the atomic `npm run release -- <patch|minor|major>` flow;
see [`docs/release.md`](./docs/release.md).
