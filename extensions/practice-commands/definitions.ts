import type { PracticeId } from "../core/types";
import { getPractice } from "../practices/registry";

export interface PracticeSlashCommandDefinition {
  /** Slash command name without leading slash. Keep it equal to practiceId unless an alias is intentional. */
  name: string;
  practice: PracticeId;
  description: string;
  supplementHint: string;
  emptySupplementInstruction: string;
  focus: string[];
}

export const PRACTICE_SLASH_COMMANDS: PracticeSlashCommandDefinition[] = [
  {
    name: "onboard",
    practice: "onboard",
    description: "Use Cynos onboard practice to build or refresh durable project memory.",
    supplementHint: "[scope/mode/extra requirements]",
    emptySupplementInstruction: "No supplement was provided. Confirm onboard scope and mode as required by the onboard skill before writing durable memory.",
    focus: [
      "Understand the existing project code-first and create/refresh durable project memory such as PROJECT.md and operating docs.",
      "Do not start onboard merely because PROJECT.md is missing or stale; this slash command is the user's explicit onboard request.",
    ],
  },
  {
    name: "init",
    practice: "init",
    description: "Use Cynos init practice for requirements, architecture, scaffold, and core docs.",
    supplementHint: "[project idea/constraints]",
    emptySupplementInstruction: "No supplement was provided. Start with a requirements interview before recommending architecture or generating files.",
    focus: [
      "Drive requirements clarification, architecture/technology recommendation, user decision, project scaffold, core docs, and verification.",
      "If the directory is non-empty, preserve existing files and incorporate them into the initialization plan instead of overwriting blindly.",
    ],
  },
  {
    name: "review",
    practice: "review",
    description: "Use Cynos review practice for independent read-only engineering review.",
    supplementHint: "[scope/verification policy]",
    emptySupplementInstruction: "No supplement was provided. Ask the user to clarify review scope and verification permission before reviewing; do not guess the scope.",
    focus: [
      "Perform an independent read-only review of existing code/design/PR/commit/docs and produce a high-value structured report.",
      "Do not modify code, docs, PROJECT.md, or config during review. Fixes and memory/doc updates are report suggestions only.",
      "Do not use review for open-ended chat-only advice; answer directly unless the user asks for a docs deliverable or implementation.",
    ],
  },
  {
    name: "docs",
    practice: "docs",
    description: "Use Cynos docs practice for project documentation work that does not change runtime behavior.",
    supplementHint: "[doc scope/audience/source]",
    emptySupplementInstruction: "No supplement was provided. Clarify the target document, audience, and source facts before writing.",
    focus: [
      "Write or update project documentation, guides, runbooks, config docs, token plans, ADRs, or RFCs.",
      "Do not change runtime behavior: code, tests, CI workflow, package scripts, build/test/lint config, real .env, Docker/K8s/Terraform/nginx files belong to develop.",
      "For token/secret/cloud/CI docs, use placeholders only and record secret handling, least privilege, environment separation, and rotation/rollback notes.",
    ],
  },
  {
    name: "debug",
    practice: "debug",
    description: "Use Cynos debug practice to reproduce, diagnose root cause, fix, and verify bugs.",
    supplementHint: "[bug/test failure/symptom]",
    emptySupplementInstruction: "No supplement was provided. Clarify the bug, failing command, symptom, or reproduction path before changing code.",
    focus: [
      "Reproduce or document why reproduction is blocked before changing code, then read diagnostics and trace the relevant code/data flow to root cause.",
      "Read PROJECT.md and docs/testing.md when present; docs/release.md is only relevant for release/deploy/publish/rollback or release artifact bugs.",
      "Record structured debug evidence: reproduction, diagnostics, investigation, root cause, fix, regression/final verification, project impact, and report.",
    ],
  },
  {
    name: "test",
    practice: "test",
    description: "Use Cynos test practice for testing/validating existing behavior by running it and reporting a verdict.",
    supplementHint: "[target/surface/test scope]",
    emptySupplementInstruction: "No supplement was provided. Clarify the target behavior and surface before testing if the user's request is ambiguous.",
    focus: [
      "Testing-as-purpose: run the relevant test suite, browser/API/CLI probe, or write a test asset only as a means to produce a verdict.",
      "PASS, FAIL, FLAKE, and BLOCKED are valid outcomes when backed by real captured run evidence.",
      "Do not modify product source, runtime config, package/CI config, or persisted docs/reports; if a bug is found, report it and use develop/debug for fixes.",
    ],
  },
  {
    name: "develop",
    practice: "develop",
    description: "Use Cynos develop practice for feature implementation, business logic, API/page/state flow, and runtime/build/CI/package config.",
    supplementHint: "[feature/scope/acceptance]",
    emptySupplementInstruction: "No supplement was provided. Clarify the feature scope and acceptance criteria before implementing.",
    focus: [
      "Read PROJECT.md and relevant modules first; judge simple vs complex and default to TDD for complex work.",
      "Do not switch to default to avoid context scan / TDD / challenger / reviewer overhead; develop is the correct practice for behavior-changing implementation.",
      "If writing/running tests and reporting a verdict is the user's primary purpose, use test instead; tests written as part of implementation stay in develop.",
      "Prefer ui-design for visual/design-heavy UI work, or refactor for behavior-preserving structural changes.",
    ],
  },
  {
    name: "refactor",
    practice: "refactor",
    description: "Use Cynos refactor practice for actual behavior-preserving code-structure changes, not plan-only advice.",
    supplementHint: "[code-change scope/behavior contract]",
    emptySupplementInstruction: "No supplement was provided. Clarify the refactor scope and behavior contract before editing; if the user only wants a plan with no code changes, use chat/docs instead of refactor.",
    focus: [
      "Preserve external behavior while improving code structure with real production writes.",
      "Do not use refactor for chat-only advice or persisted no-code plans; use no practice or docs respectively.",
      "Establish baseline/final verification and use browser/surface-verification evidence when UI or user flows are affected."
    ],
  },
  {
    name: "ui-design",
    practice: "ui-design",
    description: "Use Cynos ui-design practice for visual design tasks: brand-spec, design system, themes, component styling, and page visual design.",
    supplementHint: "[design scope/brand reference/acceptance]",
    emptySupplementInstruction: "No supplement was provided. Clarify the visual scope and brand requirements before starting; ui-design requires real browser evidence, so confirm the dev server is running.",
    focus: [
      "Follow web-design-engineer skill: start from brand-spec.md (read if exists, create/update for brand tasks, or use design-system-only for non-brand one-off), propose design direction for confirmation, then build and verify with browser screenshot/console.",
      "Browser evidence is mandatory — do not use build/typecheck/test as static substitutes; if the browser is blocked, ask the user or abandon rather than faking evidence.",
      "Declared UI artifacts must be real written files; never fake assets (CSS silhouettes, colored rectangles) even under user pressure to be fast.",
    ],
  },
  {
    name: "usability",
    practice: "usability",
    description: "Use Cynos usability practice for browser-first frontend UX observation and fixes: responsive, overflow, touch, focus, loading/empty/error states, console issues.",
    supplementHint: "[page/viewport/symptoms]",
    emptySupplementInstruction: "No supplement was provided. Clarify the target page, viewport sizes, and specific UX symptoms before observing.",
    focus: [
      "browser-first: set viewport → observe and capture per-item evidence → record observations with severity → fix (no functional changes) → re-verify the same scenario.",
      "Do not introduce functional or behavior changes; if the issue requires logic changes, switch to develop/debug.",
      "observe-only is allowed; if the browser is blocked, degrade to single-evidence mode and continue rather than getting stuck.",
    ],
  },
  {
    name: "release",
    practice: "release",
    description: "Use Cynos release practice for push/tag/publish/deploy/CI-CD and post-release validation.",
    supplementHint: "[release target/version/authorization]",
    emptySupplementInstruction: "No supplement was provided. Read release docs and clarify the release target before executing side-effectful commands.",
    focus: [
      "Read docs/release.md or record that it is missing; do not invent release steps.",
      "Only release practice may run git push, git tag, publish, deploy, CI/CD release, or post-release validation side effects.",
    ],
  },
  {
    name: "default",
    practice: "default",
    description: "Use Cynos default practice as lightweight fallback for project-internal maintenance that no specific practice clearly owns.",
    supplementHint: "[task/scope/verification]",
    emptySupplementInstruction: "No supplement was provided. Clarify the task scope and verification command before starting.",
    focus: [
      ".gitignore, .editorconfig, and root LICENSE* are strong default examples, but unknown/gray maintenance can also be default when no practice owns it.",
      "default is a routing sentinel and fallback, not a shortcut to bypass other practices' constraints or a pure verification-as-deliverable practice.",
      "If docs/source/test/UI/package/config/project-memory/release signals appear, abandon default and restart with the more specific practice before mutating files.",
    ],
  },
];

export function buildPracticeCommandPrompt(definition: PracticeSlashCommandDefinition, args: string): string {
  const practice = getPractice(definition.practice);
  const supplement = args.trim();
  const supplementBlock = supplement
    ? `User supplemental requirements after /${definition.name}:\n${supplement}`
    : definition.emptySupplementInstruction;

  return [
    `Cynos slash command /${definition.name} selected.`,
    "",
    `The user explicitly selected practice: ${definition.practice} (${practice.title}).`,
    "Do not route this request to another practice unless the user explicitly changes intent. In particular, do not switch to onboard because PROJECT.md is missing/stale when the selected command is not /onboard.",
    "If another Cynos work is currently active or waiting-for-user, follow the active-work protocol first instead of silently starting conflicting work.",
    "Otherwise call cynos_start_work with this exact practice before doing the practice work (including read-only review/exploration), and complete via cynos_check_completion.",
    "",
    `Practice mental model: ${practice.guidance.mentalModel}`,
    "Command focus:",
    ...definition.focus.map((line) => `- ${line}`),
    "",
    supplementBlock,
  ].join("\n");
}
