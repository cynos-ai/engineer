# Project Memory Maintenance

Use this when closing any modifying work (develop/debug/refactor/ui-design/usability/init/default) to decide whether durable project memory should be updated.

## Mental model

`PROJECT.md` and companion docs are for future agents maintaining the project, not for logging every task. Update durable memory only when the change alters how future work should be understood, verified, released, or constrained.

## Update `PROJECT.md` when

- architecture boundaries, ownership, module responsibilities, or core workflows changed;
- a project-specific risk, invariant, state machine, integration contract, or convention changed;
- you discovered `PROJECT.md` conflicts with current code/CI/tests and can correct it with evidence;
- a new long-lived subsystem or maintenance rule was introduced;
- testing/release/UI strategy changed and `PROJECT.md` needs a short index to the detailed doc.

## Prefer companion docs when

- verification commands, coverage matrix, diagnostic/log map, DB read-only diagnostic rules, or flaky-test notes changed → update `docs/testing.md`;
- deploy/release/rollback/changelog procedure changed → update `docs/release.md`;
- long-lived browser/surface-verification diagnostic rules changed → update `docs/testing.md`; executable repeated e2e coverage changed → update `tests/e2e/`;
- visual language/design tokens/brand direction changed → update root `brand-spec.md` via `ui-design`.

## Do not update durable memory for

- one-off bug symptoms or task diaries;
- implementation details obvious from a single file;
- temporary debugging notes, one-off log excerpts, or machine/session-specific diagnostic paths;
- speculative conclusions not supported by code evidence or user confirmation.

## Completion guidance

If durable memory needs an update, edit the relevant file in the same work and mention it in `finalization.gitSummary` / `verificationSummary` or the practice-specific evidence. If the update is uncertain, ask the user in human-assisted work; in autonomous work, record the uncertainty as an open question rather than inventing facts.
