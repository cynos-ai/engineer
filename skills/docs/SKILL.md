---
name: docs
description: "Use for ordinary project documentation, review/audit/report files, guides, ADR/RFC, and configuration/secret documentation without changing runtime behavior. Do not use for release-system runbooks/files; use release maintain."
---

# Docs Practice

Docs is for **project documentation work** that does not change runtime behavior.

## Use when

- Updating ordinary README, docs, guides, runbooks, troubleshooting notes.
- Writing ADR/RFC/design notes as a project document.
- Writing review/audit/report files when the user asks for a persisted report.
- Writing config docs, token plans, secret handling notes, cloud setup guidance, or `.env.example` placeholder examples.
- Turning prior work results into project documentation.

## Do not use when

- Editing release-system files such as `docs/release.md`, `docs/release`, `docs/release/**`, release/publish/deploy workflows, release automation scripts, publish/deploy scripts, or rollback docs → `release` with `mode='maintain'`, even when the edit is docs-only.
- Changing code, tests, package scripts, build/test/lint config, CI workflow, Docker/K8s/Terraform/nginx, real `.env`, or runtime behavior → `develop`.
- Editing `.gitignore`, `.editorconfig`, or `LICENSE` → `default`.
- Editing `.prettierrc`, `.nvmrc`, `.npmignore`, or other build/toolchain/publish metadata → `develop`.
- Creating or refreshing `PROJECT.md` durable agent memory → `onboard`.
- Reviewing existing objects and producing findings only in chat/archive → `review`.
- Answering a general/pi provider question or chat-only project advice without writing project files → no project practice.

## Workflow

### Work start timing

Use `cynos_start_work(practice="docs")` to start the auditable work. Pre-start context reads (`read` / `cynos_search` / `cynos_fetch`) are carried over into the work record, so you do **not** need to re-read files you already read for routing. But start the work before any audited action beyond context reads (writes, verification commands, subagents) — those are not captured pre-start.

Note: reading `PROJECT.md`/`docs/testing.md` is **not** a completion hard gate (the schema declares them optional). If you list them in `docs.sources`, the read just needs a real `read` tool result (pre-start or post-start both count).

1. Consult existing `PROJECT.md` and `docs/testing.md` when they affect the doc's audience, project boundaries, consistency, verification strategy, or diagnostic/release guidance. They are important project knowledge, but this is a skill expectation rather than a completion hard gate; do not fabricate reads just to satisfy a checkpoint.
2. Define scope:
   - audience;
   - `docType` — must be one of (closest fit; `other` only when nothing applies):
     - `readme` — project entry/readme/root description
     - `guide` — usage/getting-started/tutorial
     - `runbook` — ops/troubleshooting/playbook
     - `adr` — architecture decision record
     - `rfc` — design/proposal/request-for-comments
     - `config-doc` — config/deploy/secret/cloud/CI **documentation**
     - `review-report` — a persisted review/assessment report file
     - `audit-report` — a persisted audit/compliance report file
     - `other` — none of the above
   - target files;
   - `behaviorChangeIncluded: false`.
3. Gather sources:
   - only list project files actually read in this work;
   - external sources need `cynos_search` / `cynos_fetch` evidence;
   - user-provided facts and assumptions should be explicit.
4. Write only documentation/text/example files. If the user asks to “also change CI/config/code,” stop that part and tell them it needs `develop`.
5. For token/secret/cloud/CI docs (skill expectation, not a completion gate):
   - never include real secrets — use placeholders (`<TOKEN>`, `changeme`, `${{ secrets.* }}`);
   - describe least privilege, environment separation, rotation, rollback, and production impact as docs-only;
   - this is quality guidance, not a hard `cynos_check_completion` gate — there is no `docs.safety` field to fill. Real secret-leak prevention belongs to cross-practice content scanning / external tools (git-secrets/trufflehog), not a docs-only field gate.
6. Verify appropriately. For docs-as-code or generated docs, run the real build/test command from `docs/testing.md`. For pure-text doc changes with no build/test implication (most README/guide/ADR edits), there is no meaningful test runner — set `verification.noTestSuite=true` with a `noTestSuiteReason` and run one light substantive check (e.g. `test -f README.md`, or a markdown lint if the project has one). Then check git status and follow the local commit policy.

## Completion evidence notes

Use the schema returned by `cynos_start_work`. Core intent:

- `docs.scope` records audience/docType/files/no behavior change;
- `docs.sources` lists only evidenced sources;
- `docs.changes.filesChanged` lists final delivered files with real write/edit evidence;
- for pure-text doc changes, use `verification.noTestSuite=true` + `noTestSuiteReason` + a light check (see step 6); only docs-as-code/generated docs need a real build/test command;
- finalization records verification, git status, and local commit decision.
