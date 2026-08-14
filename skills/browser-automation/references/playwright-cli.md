# Browser Automation via Playwright CLI

This project recommends **Playwright CLI + skill** as the default lightweight browser-automation path. It does not depend on MCP, works well for coding agents in headless environments through `bash`, and lets `capturedToolResults` record evidence automatically.

## Contents

- [Why CLI first](#why-cli-first)
- [Capabilities verified](#capabilities-verified)
- [Installation / invocation](#installation--invocation)
- [Basic workflow](#basic-workflow)
- [Local files](#local-files)
- [Use in practices](#use-in-practices)
- [Evidence guidance](#evidence-guidance)
- [Evidence inference](#evidence-inference)
- [Known tradeoffs](#known-tradeoffs)

## Why CLI first

Use **Playwright CLI + skill** as the supported path for Cynos browser evidence. It is lightweight, headless, bash-capturable, and suitable for browser/surface-verification in develop/debug/refactor/usability/ui-design/release.

Cynos/pi does not recognize MCP-style browser tools as browser evidence. If a future native browser extension is added, update the checkpoints and this reference together.

## Capabilities verified

Local smoke tests have verified that `npx --yes @playwright/cli` can perform the following in non-graphical/headless environments:

- open pages / manage sessions
- accessibility snapshots with element refs
- click, fill, press keys, select, hover, and other interactions
- screenshots to files
- console messages
- network requests
- `eval` for DOM / HTML / runtime state
- `run-code` for Playwright snippets (diagnostic/interaction helper; not currently a completion-gate evidence command)

## Installation / invocation

Prefer not requiring a global install at first; use:

```bash
npx --yes @playwright/cli --version
```

If the command is used frequently later, a global install is acceptable:

```bash
npm install -g @playwright/cli@latest
playwright-cli --version
```

The examples below use `npx --yes @playwright/cli` by default to avoid depending on global `PATH` state.

## Basic workflow

Use a unique session name for each verification to avoid session cross-talk:

```bash
SESSION="cynos-browser-$(date +%s)"
URL="http://127.0.0.1:5173"
```

Open a page (headless by default):

```bash
npx --yes @playwright/cli -s=$SESSION open "$URL" --browser=chromium
```

Get an interactive snapshot:

```bash
npx --yes @playwright/cli -s=$SESSION snapshot
```

The snapshot returns an accessibility tree with refs, for example:

```yaml
- generic [ref=e1]:
  - heading "PW CLI Smoke" [level=1] [ref=e2]
  - textbox "Name" [ref=e4]
  - button "Say hello" [ref=e5]
  - status [ref=e6]: waiting
```

Interact by refs:

```bash
npx --yes @playwright/cli -s=$SESSION fill e4 "Ada"
npx --yes @playwright/cli -s=$SESSION click e5
```

Selectors / role locators also work:

```bash
npx --yes @playwright/cli -s=$SESSION click "#submit"
npx --yes @playwright/cli -s=$SESSION click "getByRole('button', { name: 'Submit' })"
```

Verify runtime state:

```bash
mkdir -p .cynos/browser-evidence
npx --yes @playwright/cli -s=$SESSION --raw eval "document.querySelector('#status').textContent"
npx --yes @playwright/cli -s=$SESSION --raw eval "document.body.outerHTML" > .cynos/browser-evidence/body.html
```

Capture a screenshot:

```bash
mkdir -p .cynos/browser-evidence
npx --yes @playwright/cli -s=$SESSION screenshot --filename=.cynos/browser-evidence/after.png
```

Screenshots must be saved under `.cynos/browser-evidence/` (not the project root) so evidence stays organized and ignored by `.gitignore`.

Inspect console output:

```bash
npx --yes @playwright/cli -s=$SESSION console
npx --yes @playwright/cli -s=$SESSION console warning
```

Inspect network requests:

```bash
npx --yes @playwright/cli -s=$SESSION requests
npx --yes @playwright/cli -s=$SESSION request 1
```

Save a raw snapshot for diffing:

```bash
npx --yes @playwright/cli -s=$SESSION --raw snapshot > .cynos/browser-evidence/snapshot.yml
```

Close the browser:

```bash
npx --yes @playwright/cli -s=$SESSION close
```

Clean up stale sessions:

```bash
npx --yes @playwright/cli list
npx --yes @playwright/cli close-all
npx --yes @playwright/cli kill-all
```

## Local files

Playwright CLI blocks `file://` page access by default. When testing local HTML, serve it through a local HTTP server:

```bash
cd /path/to/static-dir
python3 -m http.server 8765
npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:8765/index.html
```

Real frontend projects usually use their own dev server:

```bash
npm run dev -- --host 127.0.0.1
npx --yes @playwright/cli -s=$SESSION open http://127.0.0.1:5173 --browser=chromium
```

## Use in practices

- `develop`: user-visible frontend behavior, cross-stack UI flows, or browser runtime behavior that needs direct browser evidence.
- `debug`: frontend bugs, console errors, network/runtime issues, or problems reproducible only in a browser.
- `usability`: browser evidence (snapshot/screenshot/console/requests) is required for observation and re-checks.
- `ui-design`: use a browser to inspect the visual result, screenshots, and console.
- `release`: post-release frontend/browser validation when a live browser check is required.

## Evidence guidance

Playwright CLI runs through `bash`, so it is captured in `capturedToolResults`. In completion evidence, summarize:

- URL / viewport opened
- key refs or selectors operated on
- snapshot/screenshot file paths
- whether console had errors/warnings
- whether network had failed requests
- final direct browser evidence command, such as a CLI snapshot, screenshot, console, requests, or eval command

Project test runners are out of scope for browser-automation. Do not use this reference to choose `npx playwright test`, `npm run e2e`, or `npm run test:e2e`. Another practice may run those separately as project verification, but they do not replace direct browser evidence here.

Do not create Node/Playwright capture scripts for normal evidence collection. Use the standalone Playwright CLI directly so Cynos can capture and recognize the evidence command. Persistent scripts/tests are only for user-requested deliverables or existing project test assets, and they still do not replace the direct browser evidence gate unless a checkpoint explicitly supports them.

Do not treat `cat package.json | grep "playwright"` as browser evidence. Real browser evidence must operate on a browser session and capture snapshot/screenshot/console/requests/eval output.

## Evidence inference

Browser-evidence checkpoints (`ui-design`'s `browserVerification`, `usability` observations/post-fix evidence) and UI surface checkpoints (`develop`/`debug`/`refactor`/`release` evidence) infer direct browser evidence automatically from `capturedToolResults`. The agent does not need to fill or chase internal runtime IDs; summarize the URL, steps, screenshot/console/network results in `completionEvidence`.

## Known tradeoffs

- CLI snapshots are the first choice; screenshots are for visual verification, archiving, and user review.
- The agent must use bash commands correctly; checkpoint recognition depends on captured Playwright CLI commands.
- If CLI usage becomes frequent and bash output is hard to parse, consider a native pi browser extension and update the evidence helpers/checkpoints at the same time.
