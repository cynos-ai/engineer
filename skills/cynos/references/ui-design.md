# ui-design bridge protocol

`ui-design` uses the bundled third-party web-design-engineer methodology for creative visual design work. Cynos adds only the auditable practice contract around that workflow.

Routing boundary:

- Use `ui-design` for visual design, brand systems, themes, layout/aesthetic implementation, component visual styling, prototypes, dashboards, slides, animations, and browser-rendered presentation work.
- Use `usability` for existing page/control UX friction where the page works but is hard to use.
- Use `develop` for new visible capabilities/actions, data/API/state flow, or product behavior.
- Use `debug` for broken behavior, errors, invalid results, or click-does-nothing failures.

Evidence bridge:

- Direction provenance is recorded in `uiDesign.directionDecision`.
- Durable design foundation is root `brand-spec.md` when applicable.
- Final UI deliverables are in-project product files listed in `uiDesign.implementation.artifacts[]`.
- Browser evidence must be captured after the last UI-like production write.
- Critique/confirmation records design-foundation alignment through `uiDesign.designFidelity`.

Do not replace web-design-engineer with a second Cynos design checklist, and do not add checkpoint logic that tries to judge visual quality semantically.
