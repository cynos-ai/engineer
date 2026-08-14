# Cynos

> **Languages:** English · [简体中文](./README-zh-CN.md)

Cynos is an autonomous AI engineering runtime for the [pi](https://github.com/earendil-works/pi-coding-agent) coding agent. It lets an agent work freely, then verifies completion with **evidence-based checkpoints** instead of trusting a plain "done" message.

The name **Cynos** comes from **cynosure** — the North Star: a guiding point for agents to navigate complex engineering work without losing the evidence trail.

[![npm version](https://img.shields.io/npm/v/@cynos-ai/engineer.svg)](https://www.npmjs.com/package/@cynos-ai/engineer)
[![GitHub release](https://img.shields.io/github/v/release/cynos-ai/engineer.svg)](https://github.com/cynos-ai/engineer/releases)

---

## Why Cynos

AI agents are great at producing convincing completion summaries. The hard part is trusting them.

- "I fixed the bug" — did it actually reproduce first?
- "Tests pass" — did it run the real test suite, or summarize from memory?
- "I updated the docs" — did it really write the file?

Cynos changes the trust model. The agent works however it wants; before it claims done, Cynos checks the claim against **captured tool results** — the actual reads, writes, bash commands, search/fetch results, and subagent calls that happened in the session. No captured evidence, no completion.

```text
completionEvidence  →  explains what the agent says happened
capturedToolResults →  proves what actually happened
checkpoints         →  decide whether the work is really complete
```

## Quick start

Install Cynos into pi (global, for the current user):

```bash
pi install npm:@cynos-ai/engineer
```

Or install it project-locally (writes to `.pi/settings.json`, shareable with your team):

```bash
pi install npm:@cynos-ai/engineer -l
```

Open pi in any project and just describe the work in natural language:

```text
> Add a multiply function to src/app.ts and verify it works.
```

Cynos routes the request to the right practice (here: `develop`), lets the agent implement, then runs `cynos_check_completion`. If a checkpoint finds missing real evidence, the work stays active with an actionable reason — not a false "done". When all checkpoints pass, the work is archived under `.cynos/archive/`.

Upgrade or remove:

```bash
pi update --extensions       # upgrade all installed packages
pi remove npm:@cynos-ai/engineer
```

## Core model

```text
practice = methodology skill + completion checkpoints
work     = objective + acceptanceCriteria + status + completionEvidence + capturedToolResults
```

There is no activity state machine and no per-step ceremony. The agent starts a work item, explores/edits/tests normally, then calls `cynos_check_completion`. If checkpoints fail, the work stays active with actionable missing evidence. If they pass, the work is archived under `.cynos/archive/`.

## Practices

Cynos currently includes 12 practices:

- **review** — read-only assessment of existing code, design, PRs, commits, or docs
- **docs** — documentation/report-only changes with no runtime behavior change
- **onboard** — understand an existing project and create/refresh durable project memory
- **init** — create a new project from scratch
- **debug** — reproduce, diagnose, fix, and verify bugs or failures
- **test** — test/validate existing behavior by running it and reporting a PASS/FAIL/FLAKE/BLOCKED verdict
- **develop** — implement features, runtime config, and general changes
- **refactor** — behavior-preserving structural changes with baseline/final verification
- **ui-design** — visual UI/design-system/styling work with browser evidence
- **usability** — frontend usability observation, fix, and re-verification
- **release** — push/tag/publish/deploy/CI-CD/post-release validation
- **default** — narrow fallback when no specific practice fits

Users can describe work naturally or use slash commands such as `/review`, `/test`, `/develop`, `/debug`, `/release`, and `/onboard`.

## Tools

Work lifecycle:

- `cynos_start_work` · `cynos_work_status` · `cynos_check_completion`
- `cynos_ask_user` · `cynos_resume_work` · `cynos_abandon_work`

Capabilities:

- `cynos_subagent` · `cynos_search` · `cynos_fetch`

## State and configuration

Project state lives in the target project:

```text
.cynos/
  work.json
  last-outcome.json
  archive/
```

User configuration lives in:

```text
~/.pi/agent/cynos-config.json
```

The `/cynos-config` command edits common settings: language, onboard mode, subagent timeout, and work-aware compaction. Search API keys, vision model, and browser options live in `@cynos-ai/tools` — edit them via `/cynos-tools-config`.

## License

Cynos Engineer is licensed under the [MIT License](./LICENSE).

The bundled `skills/ui-design/` material retains its upstream MIT attribution;
see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and
[`skills/ui-design/SOURCE.md`](./skills/ui-design/SOURCE.md).
