---
name: default
description: "Lightweight fallback practice for project-internal engineering maintenance when no specific practice clearly owns the work. Not a small-task shortcut."
---

# Default Practice

Default is a **negative-space fallback**. Use it only after you have ruled out no-practice/chat-only work and the specific practices.

Default is not the small-task bucket and not an escape hatch from heavier practices. If the task clearly touches code behavior, tests, docs, review judgment, release side effects, project memory, initialization, UI design, or usability, choose that specific practice instead.

`.gitignore`, `.editorconfig`, and root `LICENSE*` are strong default examples, but they are not the full identity of default. Unknown/gray project maintenance can use default only when no specific practice clearly owns it.

## Fast routing check

Before `cynos_start_work(practice="default")`, check these escalation triggers:

| Trigger | Use instead |
| --- | --- |
| generic Q&A, read-only explanation, chat-only project advice | no practice |
| independent judgment of existing code/PR/diff/design/docs | `review` |
| README, docs, ADR/RFC, ordinary guide/runbook, persisted review/audit/report file, config docs | `docs` |
| release/deploy/publish/rollback runbook, `docs/release.md`, `docs/release/**`, release workflow/script | `release` maintain |
| create/refresh `PROJECT.md` or durable project memory | `onboard` |
| create a new project/skeleton | `init` |
| bug, failing test/build, regression, exception, broken behavior, root cause needed | `debug` |
| feature, behavior/API/CLI/state/data-flow change, new/edit source file, real runtime config/CI/build config, or implementation-owned test asset | `develop` |
| code restructuring while preserving behavior | `refactor` |
| writing/running tests and reporting PASS/FAIL/FLAKE/BLOCKED as the deliverable | `test` |
| visual design, design system, brand/style work | `ui-design` |
| responsive/overflow/focus/loading/error usability observation/fix | `usability` |
| push, tag, publish, deploy, GitHub release, CI/CD release trigger, release verification | `release` execute |
| editing `~/.pi/...`, `~/.config/...`, `~/.gitconfig`, switching default model/provider, or other project-external config | no project practice |

Do not use default because another practice feels heavy.

## Boundary examples

Default can handle fallback-safe maintenance such as:

- ✅ `.gitignore`, `.editorconfig`, root `LICENSE*`
- ✅ `.gitattributes`, `.mailmap`, and similar non-runtime repository housekeeping metadata
- ✅ unknown/gray project maintenance files that are not docs/source/test/release/runtime config/project memory

Default must not complete clearly owned work:

- ❌ `README.md`, `docs/*.md`, ADR/RFC/report files → `docs`
- ❌ ordinary runbooks → `docs`
- ❌ release/deploy/publish/rollback runbooks or release workflows/scripts → `release`
- ❌ `PROJECT.md` → `onboard`
- ❌ source, tests, UI, test assets → a specific modifying/testing practice
- ❌ `.npmignore`, `package.json`, lockfiles, `tsconfig`, CI, Docker/K8s/Terraform, real `.env`, runtime/build/test/lint config → usually `develop` unless release-owned
- ❌ push/tag/publish/deploy/GitHub release/release CI → `release`

## Required workflow

1. Confirm no escalation trigger applies.
2. Call `cynos_start_work(practice="default")` before audited actions beyond small read-only routing/context reads.
3. Consult existing `PROJECT.md` and `docs/testing.md` when they affect project boundaries or the verification command. They are project knowledge, not a completion hard gate; do not read them mechanically when the default task is already unambiguous.
4. Do the fallback maintenance work.
5. Record final delivered file changes in `default.work.filesChanged`.
   - Only list files actually changed as part of the delivered result.
   - Do not list evidence/cache/scratch artifacts such as `.cynos/**` or `.playwright-cli/**`.
   - If no project files changed, use `default.work.noFileChangeReason`, e.g. `no project changes to commit`.
   - If captured mutations were temporary/reverted/non-delivered, explain that in `noFileChangeReason` instead of adding a new field.
6. Run a real verification command chosen from project docs, package scripts, or the repository's obvious verification path.
7. Run `git status` and follow the local commit policy.
   - Commit completed default work by default.
   - Stage only files that belong to this work. Avoid broad staging and special commit modes unless there is a clear reason.
   - If no project files changed, record `commit.status='not-committed'` with reason `no project changes to commit`.
8. Submit `cynos_check_completion` with work, verification, and finalization evidence.

## Completion evidence notes

The schema returned by `cynos_start_work` / failed `cynos_check_completion` is authoritative. Minimum intent:

- cover every acceptance criterion with `criteriaCoverage`;
- fill `default.work.summary`;
- fill `default.work.filesChanged[]` for delivered project file changes, or explain no delivered file change in `noFileChangeReason`;
- summarize verification;
- include local finalization evidence.

Do not invent tool IDs. Checkpoints infer captured mutation and verification evidence from tool results.
