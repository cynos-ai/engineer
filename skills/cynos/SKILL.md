---
name: cynos
description: "Use when doing engineering work in a repository: implementation, fixes, refactors, reviews, validation, or any task that may require edits or completion evidence."
---

# Cynos

Cynos makes engineering work auditable without forcing a step-by-step state machine.

## Core rule

**No mutating work without an active work record. No completion claim without passing `cynos_check_completion`.**

Evidence before claims. A completion claim without fresh captured verification is not a weaker claim; it is invalid. Do not say “should pass”, “probably fixed”, “seems done”, or imply completion before running the proving command and passing `cynos_check_completion`.

Why: `cynos_check_completion` validates the work against checkpoints using runtime-captured `tool_result`s. Agent-written summaries explain intent, but real tool results prove reads, writes, browser evidence, and verification commands.

## Flow

1. New engineering work → call `cynos_start_work` with the most specific practice.
2. Work freely: read, edit, test, use browser automation, or call subagents as needed.
3. If blocked by an auditable user decision → `cynos_ask_user`, then wait for `cynos_resume_work`.
4. When ready → call `cynos_check_completion({ completionEvidence })`.
5. If checkpoints fail, fix the missing evidence and check again. Passing check means done and archived.

### Pre-start context reads are tolerated, but start before audited work

A little read-only exploration before `cynos_start_work` is fine for rough routing / context ("which practice is this? what's in the repo?"). The runtime **does carry over limited pre-start context reads** (`read` / `cynos_search` / `cynos_fetch`) into the work record when you start, so they count as source evidence without a re-read.

BUT pre-start exploration is only for routing/context, **not a recommended workflow**. You **must call `cynos_start_work` before**: running verification/test/build commands, calling subagents (reviewer/challenger), browser checks, edits/writes, or producing any completion evidence beyond source/context reads. Those tool results are NOT captured pre-start (only context reads are), so work done before start won't count and you'll have to redo it. Start the appropriate work first, then do the audited work.

There is no separate finish tool.

## Practice selection

- No practice: generic Q&A, project-external personal/agent configuration, temporary read-only exploration, or chat-only project advice that does not request review, docs, implementation, verification, release, onboarding, or init.
- `review`: independent assessment of an existing code/design/docs/PR/diff object. Output is a structured judgment in chat/archive; do not modify the reviewed object.
- `docs`: write/update ordinary project documentation, guides, runbooks, ADR/RFC, config docs, review/audit/report files, or placeholder examples without changing runtime behavior. Excludes release-system files (`docs/release.md`, `docs/release`, `docs/release/**`, release workflows/scripts, rollback docs), which are `release` maintain.
- `test`: test/validate existing behavior by running it. The deliverable is a PASS/FAIL/FLAKE/BLOCKED verdict with real run evidence; optional test assets may be written, but product code/config/docs must not be modified.
- `onboard`: understand an existing project and create/refresh durable `PROJECT.md` memory for future maintenance; not a human-facing tutorial.
- `init`: create a new project from scratch after requirements and tech-stack confirmation. Explicit user wording like "init", "initialise", "create new project", "scaffold", or "project skeleton" means choose init, not onboard.
- `debug`: reproduce, root-cause, and fix bugs/test failures/system failures.
- `develop`: feature, code, real runtime configuration/CI/build config, or general implementation work whose shape is design/plan → implementation → review → verification. Strong signals: create/edit `.ts/.js/.py/.rs/.go` source, implement a function/CLI/API/page/state flow, or build/lint config. Tests written as part of implementation stay in develop; testing-as-purpose routes to `test`.
- `refactor`: actual behavior-preserving code-structure changes; establish scope, behavior contract, baseline/final verification, then modify code. Chat-only refactor advice is no practice; persisted refactor plans/reports with no code changes are docs.
- `ui-design`: visual UI/design-system/prototype/styling work — brand systems, themes, layout/aesthetic implementation, component visual polish, and browser-rendered presentation work; follow web-design-engineer and root `brand-spec.md`. Existing UX friction is usability; new capabilities/actions/data flow are develop; broken behavior is debug.
- `usability`: observe, fix, and re-observe practical frontend page-level usability issues where an existing page/control/interaction works but is hard to use (too narrow, too small, overflow, awkward focus/keyboard, popover bounds, unclear helper text). Small local interaction touches to existing behavior are allowed when reported; adding new visible controls/actions/capabilities, business/product behavior, data/API/auth, or broken behavior changes are develop/debug.
- `release`: release execution and release-system maintenance: push/tag/publish/deploy/GitHub Release/release CI trigger/post-release validation, verify-only release readiness checks, `docs/release.md`, `docs/release`, `docs/release/**`, release workflows, publish/deploy/release scripts, rollback docs, and release verification. Release-system files choose `release` with `mode='maintain'` even when the requested edit is docs-only. Ordinary non-release docs remain docs; ordinary build/test/runtime config and package.json changes remain develop unless a future field-level release ownership design says otherwise.
- `default`: lightweight fallback for project-internal maintenance when no specific practice clearly owns the work. `.gitignore`, `.editorconfig`, and root `LICENSE*` are strong default examples, not the full identity of default.

Select the most specific applicable practice. Do not use `default` just because the task is small. “Create hello.ts”, “add a Python script”, or “implement function X” are develop, not default/docs. “Test/validate/smoke X”, “run the suite and tell me the result”, or “write a test for X and report whether it passes” are test. README, docs, ADR/RFC, persisted review reports, and config documentation are docs, not default. `.prettierrc`, `.nvmrc`, `.npmignore`, package scripts, tsconfig, CI, Docker, and real runtime config are develop. If the user explicitly asks to initialize/create/scaffold a project, choose `init`; onboard is for understanding existing projects, not starting a new one. If the user asks to push, tag, publish, deploy, release a version, check CI/CD/post-release state, verify release readiness, or maintain release-system files (`docs/release.md`, `docs/release`, `docs/release/**`, release workflows, release/publish/deploy scripts, rollback docs), choose `release`. This release-system rule overrides the generic docs rule for release/deploy/publish/rollback runbooks; ordinary runbooks and release announcements/user-facing notes are docs. Ordinary build/test/runtime config, package.json dependencies/scripts, and generic CI fixes are develop. If the user asks for behavior-preserving structural cleanup with code changes, choose `refactor`. If the user only asks for a refactor plan/advice/analysis and says not to change code, do not choose refactor: answer in chat when no file is written, or choose docs for a persisted plan/report.

Review boundary examples: “review/find problems/assess correctness/security/maintainability of this existing code/design/PR/diff” means `review`, even when the report is only in chat. Test boundary examples: “run smoke and tell me the result” means `test`; “run smoke and write docs/smoke-report.md” means `docs`; “found a bug, fix it” means `debug`/`develop` after the test verdict. Refactor boundary examples: “give me a refactor plan, do not change code” means no practice for chat-only advice, or docs for a persisted plan. Frontend routing examples: “input is too short / long email is hard to see / button is too small / mobile layout overflows” means `usability`; “button click does nothing / valid email cannot save / page throws an error” means `debug`; “add a clear-email button / add a new visible control or action / support a new validation rule / change API or data flow” means `develop` even when framed as usability; “redesign the page style / brand colors / design system” means `ui-design`. “Explain what this code does”, “summarize this file”, “teach me this concept”, or future-oriented advice with no audited judgment means no practice.

**Project-external config ≠ practice.** Editing files outside the current project — `~/.pi/...`, `~/.config/...`, `~/.gitconfig`, `~/.npmrc`, switching the default model, deleting an old provider/extension, managing the agent’s own settings — do these directly without `cynos_start_work`. If you wrap such a tweak in a practice anyway it may still complete, but you are adding unnecessary ceremony — prefer doing it directly. To change Cynos preferences (including `onboardMode`), use the `/cynos-config` menu — practices never write `~/.pi/agent/cynos-engineer.json`.

If the user only asks a generic question, chat-only advice, or follows up on a completed work without new exploration, audited judgment, file output, or modification, answer normally without starting project practice.

## Completion evidence

The exact schema returned by `cynos_start_work` / failed `cynos_check_completion` is authoritative. Do not rely on memorized JSON examples.

Universal intent:

- cover every acceptance criterion in `criteriaCoverage`;
- summarize what was done and verified;
- let checkpoints verify hard facts from `capturedToolResults` rather than self-claims.

Do not invent `toolCallId`s. Optional ID fields are for explicit references only; most checkpoints can infer evidence from captured tool results.

## Verification command safety

Do not wrap verification commands in pipelines that hide the command's real exit code, such as `npm test 2>&1 | tail -30` or `cargo build 2>&1 | head`. If you need trimmed output, use `set -o pipefail` or redirect to a temporary log, preserve `$?`, then print the tail and exit with the original status.

## No active work: read-only + build/test allowed, project mutations blocked

When there is no active work, the guardrail uses a deny-list:

- **Allowed**: read-only exploration (read/grep/find/ls/git status/git diff/git log), non-mutating build/test/lint (npm test, go build, cargo check, pytest, etc.), and reading/writing **project-external** temporary or personal paths (`/tmp`, `~/.pi`, etc.).
- **Blocked**: all project-internal file mutations, including source, tests, docs, repo metadata, config, package manifests, CI, dependency mutations (npm install, pip install, go get, …), git commit, push/tag/publish/deploy, redirect/sed -i/tee and other file writes that bypass write/edit.

This means: to modify any project file, first `cynos_start_work` with the appropriate practice. The gate blocks and points to the likely practice; it does not auto-select or start work for you.

## Local commit policy

For modifying practices (`default`, `develop`, `debug`, `refactor`, `ui-design`, `usability`, `test` when durable test assets remain, and git-backed `init`/`onboard`), the default is: after implementation and successful verification, make a local commit before `cynos_check_completion`.

Rules:

- Do not ask whether to commit by default; commit is the normal local finalization step.
- Respect explicit user opt-out such as "don't commit / hold off on committing". The `not-committed` completion status requires explicit user authorization: either a captured `cynos_ask_user` answer (set `commit.userAuthorizedSkip=true`) or an opt-out phrase quoted in `commit.reason` / stated in the original task (e.g. "review-only / don't commit / 别提交"). A bare reason like "用户未要求提交" or "改动已验证" is NOT authorization — if you simply haven't committed yet, run `git commit` and set `commit.status='committed'`.
- Never commit before verification passes.
- `review` stays read-only and never commits. `release` has its own push/tag/publish/deploy flow and does not use this generic auto-commit rule.
- Stage only files that belong to this work. If pre-existing dirty changes make the stage scope ambiguous, use `cynos_ask_user` to confirm the stage range; this asks “which files belong to this work”, not “whether to commit”.
- Abandoned work is not committed; revert partial changes or ask the user how to handle them.
- Non-git init targets: do not run `git init` just to satisfy finalization; record `commit.status='not-committed'` with a non-git reason.
- If `git commit` itself fails (hook failure, missing user.email, disk full), do not retry blindly or bypass hooks. Record `commit.status='failed'` with the real failure reason and captured failed `git commit` result.

## Dirty tree at start (residual change handling)

Every `cynos_start_work` checks whether the working tree has uncommitted residual changes (changes that do not belong to this objective). This prevents leftovers from the previous session / manual edits / unfinished work from contaminating a new work.

- **Clean** → normal start; finalization commits only changes produced by this work.
- **Dirty** → start is blocked, error message lists residual files. First use `cynos_ask_user` to ask how to handle them:
  - User chooses commit / stash / revert → handle until the working tree is clean, then `cynos_start_work` again.
  - User explicitly says "include these residuals too / ignore them" → retry `cynos_start_work` with `acknowledgeDirtyTree=true`. The residual snapshot is recorded in `work.dirtyTreeAtStart` for audit.
- **Commit scope after acknowledge**: if the user chooses to keep residuals and include them in the commit, finalization should `git add -A` to include them (state the scope in `commit.message` or `finalization.gitSummary`). If the user only wants them left uncommitted, commit the normal work scope and record the residual status in `gitSummary`.
- This step asks "how to handle the residuals", not "whether to commit this work" (committing this work follows the local commit policy above).

## When to pause with `cynos_ask_user`

Use `cynos_ask_user` only when the answer blocks the next safe action, authorizes risky/destructive/external work, or records a durable/auditable decision.

Do not use it for every question. Ask normally for non-blocking clarification before work starts or after work is already done.

**One decision per `cynos_ask_user`.** Each authorization question should resolve ONE decision (e.g. "skip the commit?" or "skip the challenger?"). Do not bundle "skip challenger + skip commit + ..." into one question. The reason is mechanical: every `userAuthorizedSkip` gate only checks that *a* user answer was captured (`capturedUserAnswers.length > 0`) — it does not verify the answer addressed its decision. Bundling lets one answer unlock multiple skips it never consented to. If you need several authorizations, ask separately so each captured answer maps unambiguously to its decision.

Important practice-specific rules:

- `init`: after proposing the full requirements/stack/scaffold/testing/release plan, always use `cynos_ask_user` and wait for confirmation before writing files.
- `onboard` human-assisted mode: use `cynos_ask_user` for scope confirmation and before writing durable memory.

## Waiting-for-user reentry

When a work is `waiting-for-user`, classify the next user message first:

- answer to pending question → `cynos_resume_work` with a concise answer summary;
- explicit cancellation → `cynos_abandon_work`;
- switch/new unrelated request → ask whether to abandon the old work first;
- insufficient answer → clarify without mutating files.

Do not modify, verify, or call `cynos_check_completion` while the work is still waiting.

## Red flags

| Rationalization | Reality |
| --- | --- |
| "I'll just edit first and record later" | Mutating work must start with `cynos_start_work`. |
| "Tests should pass" | Run the command, read the output, and let runtime capture the result. |
| "I can claim done with caveats" | If `cynos_check_completion` fails, work is not done. |
| "This is just a quick review" | Reviews still need scoped, evidenced, structured reports. |
| "This is analysis, so review is fine" | Review evaluates existing objects. Chat-only advice needs no practice; persisted reports go to docs; implementation goes to develop/debug/refactor. |
| "It is just docs, so default is fine" | Project documentation deliverables belong to docs unless no specific practice fits. |
| "This config change is just documentation" | Real CI/build/runtime config changes belong to develop. |
| "I need to ask immediately" | Explore first when safe; pause only when the answer affects safe next action or must be audited. |

## Surface verification and browser automation

Verification-method is an internal method, not a standalone practice. For user-visible/cross-flow behavior, use `verification-method` inside the current practice. When testing/validating is the user's primary purpose, use the standalone `test` practice. For frontend/UI/usability changes, browser automation is the default browser evidence capability: open a real browser and capture screenshot/snapshot/console/network evidence.

For browser interaction, screenshots, console/network inspection, DOM/accessibility snapshots, or frontend runtime validation, use the `browser-automation` skill. Prefer Playwright CLI via bash so evidence is captured as tool results:

```bash
npx --yes @playwright/cli
```
