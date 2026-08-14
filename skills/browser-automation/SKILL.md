---
name: browser-automation
description: "Use when you need to operate a browser, inspect DOM/accessibility snapshots, capture screenshots, read console/network output, or validate frontend behavior. Uses @cynos-ai/tools browser tools (cynos_browser_*) by default; Playwright CLI via bash as a fallback."
---

# Browser Automation

Use this skill when a task needs browser evidence or browser interaction. The default route is the **`cynos_browser_*` tools** from `@cynos-ai/tools` — they drive an isolated browser session and capture evidence as tool results. The standalone **Playwright CLI via bash** (`npx --yes @playwright/cli`) remains supported as a fallback when Tools is not installed.

Cynos/pi browser evidence is recognized from either route:

- `cynos_browser_inspect(action="snapshot" | "screenshot" | "console" | "requests" | "eval")` — direct evidence
- `npx --yes @playwright/cli ... snapshot|screenshot|console|requests|eval` — legacy fallback evidence

Do not use MCP-style browser tools or project e2e runners as browser evidence.

## Scope / use cases

Use this for:

- frontend feature verification in `develop`
- frontend/runtime bug reproduction in `debug`
- usability observations and re-checks
- UI/design browser screenshots and console checks
- browser/surface-verification flows

Do not use browser automation when a normal unit/build/typecheck command is sufficient and the task has no browser behavior.

## Default route: cynos_browser_*

Open a page and start an isolated session:

```
cynos_browser_navigate(url="http://127.0.0.1:5173", viewport={width:1280, height:720})
```

Capture a snapshot to get element refs you can target:

```
cynos_browser_inspect(action="snapshot")
```

Interact using the refs from the latest snapshot (refs are invalidated by navigation, so re-snapshot after navigating):

```
cynos_browser_interact(action="click", target={ref:"e5"})
cynos_browser_interact(action="fill", target={ref:"e4"}, value="Ada")
cynos_browser_interact(action="press", key="Enter")
```

Capture evidence into `.cynos/browser-evidence/`:

```
cynos_browser_inspect(action="screenshot", path=".cynos/browser-evidence/after.png")
cynos_browser_inspect(action="console")
cynos_browser_inspect(action="requests")
cynos_browser_inspect(action="eval", expression="document.title")
```

Close the browser when done:

```
cynos_browser_close()
```

If no browser is configured, `cynos_browser_navigate` returns a setup pointer. Run `/cynos-tools-browser-setup` to probe system browsers or install Chromium (explicit confirmation required).

## Fallback route: Playwright CLI via bash

When `@cynos-ai/tools` is not installed, use the standalone Playwright CLI package directly:

```bash
npx --yes @playwright/cli --version
```

Named session workflow:

```bash
SESSION="pe-browser-$(date +%s)"
URL="http://127.0.0.1:5173"
npx --yes @playwright/cli -s=$SESSION open "$URL" --browser=chromium
npx --yes @playwright/cli -s=$SESSION snapshot
npx --yes @playwright/cli -s=$SESSION screenshot --filename=.cynos/browser-evidence/after.png
npx --yes @playwright/cli -s=$SESSION console
npx --yes @playwright/cli -s=$SESSION requests
npx --yes @playwright/cli -s=$SESSION close
```

Do not switch to project-local Playwright (`npx playwright ...`), `@playwright/test` scripts, or project e2e runners while collecting browser evidence. Those are project verification/test commands, not browser-automation commands.

## Browser environment preflight and blocked policy

When browser evidence is required, diagnose once and avoid repeated downloads. If the standalone CLI reports a missing browser, install Chromium at most once through the same CLI route:

```bash
npx --yes @playwright/cli install-browser chromium
```

Then retry one real browser launch/evidence command. If launch still fails, check system dependencies rather than trying every browser family:

```bash
CHROME="$(find ~/.cache/ms-playwright \
  \( -path '*/chrome-linux*/chrome' \
     -o -path '*/chrome-headless-shell*/chrome-headless-shell' \) \
  -type f 2>/dev/null | tail -1)"
ldd "$CHROME" | grep 'not found' || true
```

If this reports a missing library such as `libasound.so.2`, conclude: a browser binary may exist, but the runtime dependencies are missing. Do not keep downloading Firefox/WebKit/Chrome-for-testing to gamble.

If sudo/system dependency installation is needed, ask the user before running any privileged command. Dependency repair commands are diagnostics/repair, not browser evidence.

If sudo is not available or the user explicitly says the browser environment is unavailable:

- do not use `vite build`, `tsc`, `npm test`, project e2e, or CLI `--help` output as browser evidence;
- do not use `LD_PRELOAD`, self-compiled library stubs, or similar environment hacks unless the user explicitly authorizes that approach;
- use `cynos_ask_user` to choose: switch environment, authorize dependency repair, skip browser and use agreed degraded verification, or abandon/report blocked;
- if the user chooses to skip browser verification, stop trying to repair the browser environment and record the current practice's strict blocked fallback fields: reason, attempted approaches, degraded evidence, and alternative verification where the practice schema has it;
- after two real browser launch/evidence failures of the same class, stop and report blocked rather than looping.

## Local dev servers

Prefer project dev servers:

```bash
npm run dev -- --host 127.0.0.1
```

Then `cynos_browser_navigate(url="http://127.0.0.1:5173")`. Both routes allow localhost/127.0.0.1 for dev verification. Do not open local files with `file://`; serve static files instead.

## Completion evidence

In `completionEvidence`, summarize what you verified:

- URL and viewport
- user flow steps
- snapshot/screenshot paths
- console and network findings
- final result

Do not invent or chase runtime internal IDs. The runtime captures `cynos_browser_inspect` and Playwright CLI bash results into `capturedToolResults`. Browser-evidence checkpoints (`ui-design`/`usability`) and UI surface checkpoints (`develop`/`debug`/`refactor`/`release`) infer direct browser evidence from captured results automatically; summarize the evidence instead of filling internal IDs.

## Browser evidence actions

These count as direct browser evidence when they succeed:

- `cynos_browser_inspect(action="snapshot")`
- `cynos_browser_inspect(action="screenshot")`
- `cynos_browser_inspect(action="console")`
- `cynos_browser_inspect(action="requests")`
- `cynos_browser_inspect(action="eval")`
- `npx --yes @playwright/cli -s=$SESSION snapshot`
- `npx --yes @playwright/cli -s=$SESSION screenshot --filename=...`
- `npx --yes @playwright/cli -s=$SESSION console`
- `npx --yes @playwright/cli -s=$SESSION requests`
- `npx --yes @playwright/cli -s=$SESSION --raw eval "..."`

These are NOT direct evidence on their own (they are setup/interaction steps):

- `cynos_browser_navigate`
- `cynos_browser_interact`
- `cynos_browser_close`
- Playwright CLI `open`/`goto`/`list`/`close`, install commands, and `--help`/`--version`

Project test runners are out of scope for this skill. Do not list or choose `npx playwright test`, `npm run e2e`, or `npm run test:e2e` as browser-automation commands. If another practice independently runs them, that is extra project verification, but it does not replace direct browser evidence for browser-automation.

A failed `cynos_browser_navigate` or `cynos_browser_inspect` (or failed Playwright CLI open/goto/evidence/install-browser) can still be useful as blocked-environment evidence.

## See also

Full Playwright CLI reference: `references/playwright-cli.md`.


