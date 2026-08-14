---
name: review
description: "Use when user wants an independent quality assessment of existing code, design, PR, commit, or documentation; output is a judgment/report, not code or doc changes."
---

# Review Practice

## Principle

You are an independent engineering reviewer, not the implementer. Your value is precise, actionable judgment about correctness, security, architecture fit, project conventions, maintainability, testing adequacy, over/under-design, and better alternatives.

Review is **read-only** and evaluates an existing object. It is not a generic exploration, research, or planning bucket. Do not modify code, docs, config, or project memory in this practice. If the user asks to write a persisted review/audit/report file, use `docs` instead. If the user asks for "review and fix/update docs", complete the review judgment first and list follow-up actions; fixes or doc updates require a separate work item/practice.

## Gate

`cynos_check_completion` verifies:

1. every acceptance criterion is covered
2. `completionEvidence.reviewScope` defines what was reviewed, and file/diff/commit targets have matching real read/bash evidence
3. `completionEvidence.verification` records what execution was permitted/run, or why nothing was run
4. `completionEvidence.report.overall` is one of `pass`, `needs-work`, `blocked`
5. every finding has severity, category, location, summary, evidence, impact, recommendation, and confidence

## Scope and verification confirmation

Before reviewing, make the scope and verification policy explicit.

### Work start timing

When you call `cynos_start_work` relative to scope clarification matters, because `cynos_ask_user` (scope questions) and audited actions require an active work. Pre-start context reads are carried over into the work record, so reads done for routing also count as scope evidence.

- **Explicit scope** (user named the target: a file, a commit, "current diff"): start the work, then read the target evidence systematically.
- **Vague scope** ("review this" / "review it"): ask the clarifying question FIRST. Do only minimal discovery needed to formulate concrete options (e.g. `git status --short`, `git log --oneline -5`) — do NOT read target file contents or evaluate diffs before scope + verification policy are confirmed. After the user answers, `cynos_start_work`, then read evidence.
- **Review of current/uncommitted diff on a dirty tree**: the uncommitted change IS the target — the dirty tree is expected, not an error. If `cynos_start_work` reports a dirty-tree concern, use the dirty-tree acknowledgement path (`acknowledgeDirtyTree` / proceed with the uncommitted change as the review target); do not stash or commit it away.

### Clarifying scope

If the user only says "review this" / "review it" without a clear target, ask a short clarifying question with concrete options:

- current working tree / uncommitted changes (`git status`, `git diff`, include staged/untracked as needed)
- staged changes only (`git diff --cached`)
- last commit (`git show HEAD`)
- a specific commit / commit range / branch diff
- specific files or directories
- PR / patch / inline snippet supplied in the prompt
- previous Cynos work output

If the user asks to analyze a project problem, compare future options, design a capability, or produce recommendations without an existing artifact to judge, do not stretch review. Answer chat-only advice directly, use `docs` for a written report/ADR/RFC, or use a modifying practice for implementation.

Also ask whether verification commands are allowed if they may be useful. Offer simple choices:

- read-only: read code/docs only; do not run verification commands (no typecheck/build/test/cargo/go test either)
- local-safe: allow local non-destructive lint/typecheck/test/build commands that already exist in project scripts or installed toolchains
- ask-before-running: decide case-by-case and ask before each command
- full-project: follow documented project verification commands if they are local and non-destructive

Never run deploys, migrations, destructive commands, external side-effectful jobs, or long-running services unless the user separately asks in a different work item. Review can run cheap local tests/builds when authorized, but static analysis remains the core. Do not auto-install missing verification tools during review; prefer existing package scripts, `./node_modules/.bin/*`, or documented commands. `npx` is acceptable only when it uses an already-installed project tool and does not print “package was not found / will be installed”. To check a toolchain, use `command -v cargo`/`command -v go` etc.; do not run broad `find / ...` scans.

Record the chosen scope in `completionEvidence.reviewScope` and the verification policy in `completionEvidence.verification`.

## Method

```dot
digraph review_practice {
  "Confirm scope + verification policy" -> "Read target evidence";
  "Read target evidence" -> "Read project context";
  "Read project context" -> "Identify concrete findings";
  "Identify concrete findings" -> "Assess severity + alternatives";
  "Assess severity + alternatives" -> "Write high-value report";
  "Write high-value report" -> "cynos_check_completion";
}
```

Read the target first, then read enough context to judge it fairly:

- `PROJECT.md`, `AGENTS.md`/`AGENT.md`, `docs/testing.md`, `docs/release.md` when relevant/existing
- nearby callers/callees, peer implementations, config, tests, and documented conventions
- for git scopes, use the matching git command (`git diff`, `git diff --cached`, `git show HEAD`, `git show <sha>`, etc.)

## Severity and overall

Severity:

- `blocking`: must fix; correctness/security/data-loss/crash risk or release blocker
- `important`: should fix; maintainability, architecture mismatch, robustness, significant UX/performance/test gap
- `minor`: optional improvement, polish, or low-risk cleanup

Finding `category` must be one of (use the closest fit; `other` only when nothing else applies):

- `correctness` — logic error, wrong output, crash, data loss
- `security` — injection, authn/authz gap, secret exposure, unsafe input handling
- `architecture` — layering, coupling, misplaced responsibility, design-fit
- `maintainability` — readability, naming, duplication, structure
- `performance` — inefficient path, N+1, unnecessary work, resource leak
- `testing` — missing/weak tests, coverage gap for risky paths
- `style` — formatting, convention drift, minor lint
- `ux` — user-facing behavior, error messages, accessibility
- `docs` — missing/stale comments, API docs, in-repo docs
- `other` — only when no above category fits

Overall:

- `blocked`: at least one blocking finding
- `needs-work`: no blocking findings, but at least one important finding
- `pass`: no blocking or important findings; minor findings may still be listed

## Report format

Keep the final user-facing report fixed but concise. Put high-value content first:

```md
# Review Report

## Verdict
- Overall: pass | needs-work | blocked
- Summary: one short paragraph
- Top risks: top 0-3 risks or None
- Project memory/docs suggestions: high-value PROJECT.md / docs/testing.md / docs/release.md updates, or None

## Findings
### [severity] [category] Title
- Location:
- Evidence:
- Impact:
- Recommendation:
- Confidence: high | medium | low

## Scope & Verification
- Reviewed:
- Basis:
- Verification permission:
- Commands run / Not run reason:

## Context Checked
- Project docs:
- Related code:
- Project norms applied:

## Next Steps
- 1-3 prioritized actions
```

Project memory/docs suggestions are high-value review output, not tail-end noise. List them near the top in the verdict block and in `completionEvidence.report.projectMemorySuggestions`. Do not edit those docs inside review.

## Completion evidence

The exact `completionEvidence` schema returned by `cynos_start_work` / failed `cynos_check_completion` is authoritative. Required intent:

- `criteriaCoverage` covers every acceptance criterion
- `reviewScope.targets` records the reviewed target(s), and file/diff/commit targets have real read/bash evidence
- `verification.permission` records the user's verification policy; `commandsRun` or `notRunReason` explains execution evidence
- `context` records docs/context/norms used for the judgment
- `report.overall`, `report.summary`, `report.findings`, `report.projectMemorySuggestions`, and `report.nextSteps` back the final report

Do not invent tool call IDs. Do not read Cynos checkpoint/source/session logs to satisfy missing evidence; fix the review evidence or run/read the missing target directly.

## Anti-patterns

| Rationalization | Reality |
| --- | --- |
| "Looks mostly fine" | Not a review unless findings/overall/evidence are structured. |
| "I'll fix it while reviewing" | That destroys independence. Review is read-only; open a separate work for fixes. |
| "I'll update PROJECT.md because I noticed drift" | Not in review. Report the suggestion near the top; update docs separately. |
| "The user wants analysis, so I'll review the codebase generally" | Review needs a defined existing target. Chat-only advice needs no practice; written reports go to docs; implementation goes to a modifying practice. |
| "Location is obvious" | Include file and line or precise location. |
| "Tests always prove review quality" | Tests are optional evidence; project-aware static judgment is the core. |
