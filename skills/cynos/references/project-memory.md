# Project Memory Reference

Use when deciding what belongs in `PROJECT.md`, `AGENTS.md`, `docs/testing.md`, `tests/e2e/`, `docs/release.md`, or `brand-spec.md`.

## Core principle

`PROJECT.md` is compact durable memory for future agents. It is not a project manual, onboarding transcript, route inventory, or implementation diary.

Prefer fewer reliable facts over many broad weak claims.

## `PROJECT.md` quality bar

A good PROJECT.md fact is:

- stable beyond the current task;
- valuable for future engineering work;
- backed by code, a trusted doc, or user confirmation;
- a synthesis across files or workflows, not obvious from one file;
- concise.

Length posture:

- 80–160 lines: ideal.
- 160–220 lines: acceptable for larger projects.
- >220 lines: audit and move detail to docs.

Do not include:

- directory trees or file inventories;
- route/API catalogs;
- config values visible in one file;
- raw exploration notes;
- temporary bug analysis;
- speculative claims.

## File boundaries

| File | Belongs here |
| --- | --- |
| `PROJECT.md` | Short durable project memory: shape, architecture boundaries, core workflows, risks, testing/release/UI strategy summaries and links. |
| `AGENTS.md` | Operational rules for future agents: validation commands, coding rules, branch/commit policy, release obligations. |
| `docs/testing.md` | Test strategy, commands, how to add/maintain tests. |
| `docs/testing.md` surface-verification section / `tests/e2e/` | Surface-verification rules and executable end-to-end coverage for repeated user/runtime flows. |
| `docs/release.md` | Release/deploy/rollback runbook. |
| `brand-spec.md` | Root design context: visual direction, tokens, assets, typography, motion, references. |
| reference docs | Deep module maps, long diagrams, API inventories, historical notes. |

## Confirmation rule

Creating or materially updating `PROJECT.md`, `AGENTS.md`, `docs/release.md`, or root `brand-spec.md` should be based on code evidence or explicit user confirmation. For onboarding/init, ask before writing durable memory.
