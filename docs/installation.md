# Installation

Cynos Engineer is distributed as an npm package for the [pi coding agent](https://github.com/earendil-works/pi-coding-agent).

## Requirements

- Node.js 22 or newer
- pi installed and available as `pi`
- npm access to the public npm registry

## Install

Install for the current pi user:

```bash
pi install npm:@cynos-ai/engineer
```

Install only for the current project:

```bash
pi install npm:@cynos-ai/engineer -l
```

Pin a version when reproducibility matters:

```bash
pi install npm:@cynos-ai/engineer@x.y.z
```

## Verify

Start pi in a test project:

```bash
pi
```

Then ask for a small, safe change and verify that Cynos starts a work item and
checks the completion evidence. Do not test against a project containing
uncommitted work unless you intend to modify it.

## Upgrade and remove

```bash
pi update --extensions
pi remove npm:@cynos-ai/engineer
```

## Local development install

From a checkout, load the TypeScript entrypoint directly:

```bash
pi -e /path/to/engineer/index.ts
```

When testing subagent child processes, set `PE_DEV_EXTENSION_PATH` to the same
checkout so they load the development entrypoint rather than an installed copy.

## Troubleshooting

| Symptom | Suggested check |
|---|---|
| npm returns 404 | Check the package name and registry with `npm view @cynos-ai/engineer --registry=https://registry.npmjs.org/`. |
| npm returns 401 | Inspect user/project `.npmrc`; do not paste credentials into an issue. |
| pi does not show Cynos | Remove and reinstall the package, then inspect pi's extension settings. |
| pi cannot find the command | Confirm pi itself is installed and that the package was installed into the intended user/project scope. |

When reporting a problem, include the package version, Node version, pi version,
and a redacted error message. Never include tokens, cookies, private `.npmrc`
contents, or personal project data.
