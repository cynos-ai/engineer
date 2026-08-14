# Cynos Architecture

Cynos is a pi extension built around one public trust model:

```text
practice = methodology skill + completion checkpoints
work     = objective + acceptance criteria + completion evidence + captured tool results
```

The agent remains free to explore, edit, run commands, call subagents, and use
capability tools. Before it claims completion, Cynos checks the claim against
captured runtime results instead of trusting a prose summary.

## Runtime flow

```text
user request
  -> practice routing
  -> cynos_start_work(practice, objective, acceptanceCriteria)
  -> normal agent work
  -> cynos_check_completion(completionEvidence)
       pass: archive work and write the last outcome
       fail: keep work active and report missing evidence
```

There is no per-step workflow state machine. A practice owns a methodology,
an evidence schema, and a set of checkpoints. Checkpoints validate the smallest
set of observable facts needed to establish completion.

## Main layers

### Core runtime

`extensions/core/` owns work state, captured tool results, completion checks,
configuration, reporting, and the pi-facing tool surface.

### Practices

`extensions/practices/` defines practice registries, evidence schemas, helpers,
and checkpoint implementations. The shipped skills under `skills/` explain how
an agent should work; checkpoints independently verify the resulting evidence.

### Capability integrations

Search, fetch, vision, browser automation, and subagent execution are capability
layers. They provide tool results that can be captured by the core runtime, but
they do not replace completion checks or invent completion evidence.

### Published entrypoint

`extensions/index.ts` is the development entrypoint. `scripts/build.mjs` uses
esbuild to produce a readable CommonJS `index.js` for pi and npm packaging.
Host packages supplied by pi remain external so the extension uses the host's
compatible copies at runtime.

## State and privacy

Work state is stored in the target project under `.cynos/`. User preferences are
stored in the user's pi configuration directory. Neither location should be
committed when it contains personal data, credentials, or project-specific
artifacts.

## Design constraints

- Captured tool results are the source of truth for actions that must be proven.
- Completion evidence explains the result but cannot substitute for captured facts.
- Practices should stay composable and should not become a workflow DSL.
- Capability tools should remain usable independently of any particular practice.
- Changes to a practice should update its skill, schema, checkpoints, tests, and
  user-facing documentation together.
