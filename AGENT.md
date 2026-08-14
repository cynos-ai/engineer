# Cynos Engineer repository guide

This repository contains the public source for `@cynos-ai/engineer`.

## Before changing code

- Read the relevant source, tests, and public documentation.
- Inspect `git status --short` before editing.
- Keep personal configuration, generated artifacts, credentials, and target
  project data outside the repository.
- Read [`docs/rules/repository-maintenance.md`](docs/rules/repository-maintenance.md)
  for package, documentation, and release boundaries.

## Verification

Run the smallest relevant check while iterating. Before handoff, run:

```bash
npm run verify
npm run pack:dry-run
```

For security-sensitive changes also run `npm audit --omit=dev` and a repository
secret scan.

## Public documentation

`docs/` contains public documentation only. Internal design history, maintainer
experiments, private benchmarks, and smoke-test transcripts must not be added
here.
