import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { CapturedToolResult, PracticeId, WorkState } from "../core/types";

// Pure-function helpers: JSON access, path/command classification, capturedToolResults lookup.
// Kept separate from the checkpoint DSL (satisfied/notSatisfied/require*) so they can be unit-tested and reused independently.

export function existingOnboardAuditDocs(cwd?: string): string[] {
  if (!cwd) return [];
  return [
    "PROJECT.md",
    "AGENT.md",
    "AGENTS.md",
    "README.md",
    "docs/testing.md",
    "docs/release.md",
    "docs/architecture.md",
    "docs/api.md",
    "docs/design.md",
  ].filter((file) => existsSync(resolve(cwd, file)));
}

export function findReadEvidenceForPath(work: WorkState, expectedPath: string): CapturedToolResult | undefined {
  const expected = normalizePath(expectedPath);
  // A directory target (ending in /) allows ls/find as read evidence; a file target does not (listing a file is not reading its content).
  const dirTarget = expectedPath.endsWith("/");
  const bashReadPattern = dirTarget
    ? /\b(cat|sed|head|tail|rg|grep|awk|less|more|bat|ls|find)\b/
    : /\b(cat|sed|head|tail|rg|grep|awk|less|more|bat)\b/;
  return (work.capturedToolResults ?? []).find((result) => {
    if (result.isError) return false;
    if (result.toolName === "read") {
      const actual = normalizePath(extractToolPath(result));
      if (work.cwd && actual) return sameProjectPath(actual, expectedPath, work.cwd);
      return actual === expected || actual.endsWith(`/${expected}`);
    }
    if (result.toolName === "bash") {
      const command = String(result.input.command ?? "");
      const mentionsPath = commandMentionsPath(command, expectedPath, work.cwd);
      const readsFile = bashReadPattern.test(command);
      return mentionsPath && readsFile;
    }
    return false;
  });
}

export function findCompleteReadEvidenceForPath(work: WorkState, expectedPath: string): CapturedToolResult | undefined {
  const expected = normalizePath(expectedPath);
  return (work.capturedToolResults ?? []).find((result) => {
    if (result.isError || result.toolName !== "read") return false;
    if (isPartialReadResult(result)) return false;
    const actual = normalizePath(extractToolPath(result));
    if (work.cwd && actual) return sameProjectPath(actual, expectedPath, work.cwd);
    return actual === expected || actual.endsWith(`/${expected}`);
  });
}

export function isPartialReadResult(result: CapturedToolResult): boolean {
  return result.toolName !== "read" || isPartialReadInput(result.input) || Boolean(result.fullOutputRef);
}

function isPartialReadInput(input: Record<string, unknown>): boolean {
  const offset = input.offset;
  const limit = input.limit;
  if (typeof offset === "number" && offset > 1) return true;
  if (typeof limit === "number" && limit > 0) return true;
  return false;
}

export function findAnyReadEvidence(work: WorkState): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find((result) => {
    if (result.isError) return false;
    if (result.toolName === "read") return true;
    if (result.toolName === "bash") {
      const command = String(result.input.command ?? "");
      return /\b(cat|sed|head|tail|rg|grep|awk|less|more|bat|git\s+(show|diff))\b/.test(command);
    }
    return false;
  });
}

// ─── Test / verification command recognition family ─────────────────────────────
// Three judgments, each with a defined consumer class (see unify-test-command-recognition-plan.md):
//   isTestOrVerificationCommand(c) — Class A canonical entry point: "find a test/verification command"
//                                    detectors (develop red/green, common final-verify, refactor,
//                                    review read-only guard). Composes the two halves below.
//   isTestExecutionCommand(c)      — Class C: "did a TEST run" detectors (test-only, MUST exclude
//                                    lint/build/tsc). test.ts, surface.ts, test-assets keep this.
//   isVerificationCommand(c)       — decomposition half (runners+checkers). Kept for structure;
//                                    no narrow-only call site remains after Problem 3.
// Pattern lists — NOT a clean superset/subset; each has exclusive members:
//   VERIFICATION_COMMAND_PATTERNS  = package-manager scripts + per-stack runners + type/lint checkers
//                                    (tsc/ruff/mypy/shellcheck/py_compile) + build + project verify-scripts.
//                                    (NO bare <lang> <testfile>.)
//   TEST_EXECUTION_COMMAND_PATTERNS = per-stack runners + bare <lang> <testfile>
//                                    (node/python/ruby/php/lua). (NO lint/type-check/build.)
//   The runner sets mostly overlap but are NOT identical. The unified function is A || B.
// Detectors (find*) sit right after the judgments — they are the family's direct consumers.
// ─── end family header ───────────────────────────────────────────────────────────


const VERIFICATION_SCRIPT_NAME = "(?:test(?::\\S+)?|e2e(?::\\S+)?|verify(?::\\S+)?|build(?::\\S+)?|lint(?::\\S+)?|smoke(?::\\S+)?|check(?::\\S+)?|validate(?::\\S+)?|spec(?::\\S+)?|ci(?::\\S+)?|unit(?::\\S+)?|integration(?::\\S+)?)";

const PACKAGE_MANAGER_FLAGS = "(?:\\s+(?:--prefix|--cwd|-C|--filter|--workspace)\\s+\\S+|\\s+--(?:prefix|cwd|filter|workspace)=\\S+)*";

const packageManagerVerificationPattern = new RegExp(`^(npm|pnpm|yarn|bun)${PACKAGE_MANAGER_FLAGS}\\s+(run\\s+)?${VERIFICATION_SCRIPT_NAME}(?=$|\\s|:)`);


const VERIFICATION_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  // JS/TS package-manager scripts: npm/pnpm/yarn/bun run test|e2e|verify|build|lint|smoke|check|validate|...
  packageManagerVerificationPattern,
  // TS type checking
  /^(npx\s+(--yes\s+)?|pnpm\s+|yarn\s+|bunx\s+)?tsc\b/,
  // frontend e2e/unit runners
  /^(npx\s+(--yes\s+)?|pnpm\s+exec\s+|yarn\s+|bunx\s+)?playwright\s+test\b/,
  /^(npx\s+(--yes\s+)?|pnpm\s+(exec\s+)?|yarn\s+|bunx\s+)?(vitest|jest)\b/,
  // Python
  /^pytest\b/,
  /^python3?\s+(-m\s+)?(py_compile|compileall)\b/,
  /^python3?\s+-m\s+pytest\b/,
  /^(ruff|mypy|flake8|pylint)\b/,
  // Go: test/vet/build are all standard verifications
  /^go\s+(test|vet|build)\b/,
  // Rust：cargo test/check/build/clippy
  /^cargo\s+(test|check|build|clippy)\b/,
  // .NET
  /^dotnet\s+(build|test)\b/,
  // Java/JVM
  /^(mvn|gradle)\s+test\b/,
  // Shell static analysis
  /^shellcheck\b/,
  // Make standard targets (only recognize semantically clear test/check/verify/build)
  /^make\s+(test|check|verify|build)\b/,
  // Bun native
  /^bun\s+test\b/,
  // node syntax check (real compiler check, not ad-hoc eval)
  /^node\s+--check\b/,
  // Project-defined verification scripts: ./verify.sh / ./scripts/check.sh / bash ./test.sh / node scripts/verify.mjs
  // Anchored at the start of the segment with a real runner, so that `cat ./verify.sh` / `echo ./verify.sh` are not misjudged.
  /^(\.\/|bash\s+\.\/)(scripts\/)?(verify|check|test|smoke|validate)[\w.-]*\.sh\b/,
  /^node\s+(scripts\/)?(verify|check|test|smoke|validate)[\w.-]*\.[cm]?js\b/,
  /^python3?\s+(scripts\/)?(verify|check|test|smoke|validate)[\w.-]*\.py\b/,
];


const TEST_EXECUTION_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test(?::\S+)?|e2e)\b/,
  /^(npx\s+(--yes\s+)?|pnpm\s+(exec\s+)?|yarn\s+|bunx\s+)?(vitest|jest)\b/,
  /^(npx\s+(--yes\s+)?|pnpm\s+exec\s+|yarn\s+|bunx\s+)?playwright\s+test\b/,
  /^(npx\s+(--yes\s+)?|pnpm\s+exec\s+|yarn\s+|bunx\s+)?cypress\b/,
  /^pytest\b/,
  /^python3?\s+-m\s+pytest\b/,
  /^go\s+test\b/,
  /^cargo\s+test\b/,
  /^dotnet\s+test\b/,
  /^mvn\s+test\b/,
  /^gradle\s+test\b/,
  /^make\s+test\b/,
  /^bun\s+test\b/,
  /^(\.\/|bash\s+\.\/)(scripts\/)?test[\w.-]*\.sh\b/,
  // Bare "<lang> <testfile>": a legitimate way to run standalone test files in tiny/no-runner
  // repos (e.g. python3 test_add.py, node tests/x.test.js). Guarded by test-file-path heuristics
  // (test_*, *_test.*, *.test.*) to avoid over-matching arbitrary scripts (node random.js).
  /^python3?\s+\S*(test_[\w.-]*\.py|test\w*\.py|[\w.-]*_test\.py)\b/,
  /^node\s+\S*([\w.-]*\.test\.[mc]?js|[\w.-]*\.spec\.[mc]?js|test[\w.-]*\.js)\b/,
  // Bare <lang> <testfile> for other script stacks (same guard shape: require a test-file path,
  // so ruby app.rb / php index.php / lua script.lua are NOT matched). Compiled languages
  // (go/rust/java/c#) have no bare-run convention and are intentionally omitted.
  /^ruby\s+\S*([\w./-]*_(test|spec)\.rb|test[\w.-]*\.rb)\b/,
  /^php\s+\S*([\w./-]*Test\.php)\b/,
  /^lua\s+\S*([\w./-]*_(test|spec)\.lua|test[\w.-]*\.lua)\b/,
];


export function isVerificationCommand(command: string): boolean {
  // Only match real executed command segments, to avoid text searches like `cat package.json | grep "tsc"` being misjudged as verification.
  // commandSegments splits by && / || / ; / () / newlines, so read-only segments starting with cat/echo/grep
  // do not match any of the `^...`-anchored patterns below.
  // Supported (excerpt): `npm run build`, `npm test -- file.test.ts`, `cd app && npx tsc --noEmit`,
  // `npx playwright test`、`npx vitest run`、`(cd src-tauri && cargo check)`、
  // `go vet ./...`、`go test ./...`、`ruff check .`、`mypy app`、`make verify`、
  // `./scripts/verify.sh`、`python3 -m py_compile`、`dotnet build`、`shellcheck *.sh`。
  return commandSegments(command).some((segment) => {
    if (segmentIsHelpOrVersion(segment)) return false;
    if (isBrowserBashCommand(segment)) return true;
    return VERIFICATION_COMMAND_PATTERNS.some((pattern) => pattern.test(segment));
  });
}


export function isTestExecutionCommand(command: string): boolean {
  return commandSegments(command).some((segment) => {
    if (segmentIsHelpOrVersion(segment)) return false;
    if (/\s--list(\s|$)/.test(segment)) return false;
    return TEST_EXECUTION_COMMAND_PATTERNS.some((pattern) => pattern.test(segment));
  });
}


// The canonical "is this a test/verification command?" entry point. Use this in any detector that
// wants to recognize ANY legitimate test/verification run (Class A callers — see
// unify-test-command-recognition-plan.md: develop red/green, common final-verify, refactor,
// review guard). Composes the two decomposition halves: runners+checkers (isVerificationCommand)
// OR bare <lang> <testfile> (isTestExecutionCommand).
// (Class C test-only callers — test.ts, surface.ts, test-assets — keep isTestExecutionCommand
// directly, because they must EXCLUDE lint/build/tsc. The suspected-diagnostic uses THIS unified
// function via Problem 3.)
export function isTestOrVerificationCommand(command: string): boolean {
  return isVerificationCommand(command) || isTestExecutionCommand(command);
}


// Generic shell classifier: is the first real (non-cd) segment a read-only or write-only
// operation (cat/grep/echo>/file/...)? Used by the suspected-command diagnostic to exclude
// shell ops that merely reference verification keywords in text (e.g. `cat package.json | grep test`).
// Moved from common.ts so the suspected-diagnostic helper can reach it without a circular import.
export function isLikelyReadOnlyOrWriteOnlyShell(command: string): boolean {
  const first = commandSegments(command).find((segment) => !/^cd\b/.test(segment)) ?? "";
  if (/^(cat|grep|rg|sed|awk|head|tail|less|more|bat|ls|find)\b/.test(first)) return true;
  if (/^(echo|printf)\b/.test(first) && />/.test(command)) return true;
  return false;
}

// A command that ENDS in `echo "...$?"` swallows the real exit code (shell: the last command in
// a ;-chain determines exit). Only a TRAILING echo masks the exit; an echo earlier in the chain
// (e.g. `echo "start"; npm test`) leaves the real command's exit intact, so it is NOT matched.
// Used by the red detectors to see through this masking, rather than reject the command (which
// would force a costly re-run). See smoke-fix-plan-2026-06-30-followups.md Problem 2.
export function commandMasksExitCodeWithEcho(command: string): boolean {
  const trimmed = command.trim();
  return /(?:;|&&|\|\|)\s*echo\s+["'][^"']*\$\?[^"']*["']\s*$/.test(trimmed)
    || /^echo\s+["'][^"']*\$\?[^"']*["']\s*$/.test(trimmed);
}


// Recovers a real failure from a bash whose exit code was masked by a trailing echo. PRIMARY
// signal = test-framework / crash signature (robust; the echoed exit code format varies wildly
// and may be truncated out of outputSummary, so do NOT rely on it alone). SECONDARY = an echoed
// non-zero exit code (EXIT:1 / RED_EXIT:1 / exit code: 1). The Error: signal is anchored to
// start-of-line (^Error:\s/m) to stay symmetric with the Bug 2 fix in cleanVerificationResult
// (a bare /Error:\s/ false-positives on ValueError:/TypeError: in passing error-path tests).
// Shared by findFailedVerificationBash (develop) and findFailedBash (debug) so the red/green
// failure-signature logic is defined once.
export function bashLooksFailedDespiteSuccess(result: CapturedToolResult): boolean {
  if (!commandMasksExitCodeWithEcho(String(result.input.command ?? ""))) return false;
  const output = String(result.outputSummary ?? "");
  const primaryFailure = /\b(FAIL|FAILED|AssertionError)\b/i.test(output)
    || /Traceback \(most recent call last\)/m.test(output)
    || /^Error:\s/m.test(output);
  const echoedExit = /\b[A-Z_]*EXIT[:_\s]+[1-9]\d*|exit\s+code[:\s]+[1-9]\d*/i.test(output);
  return primaryFailure || echoedExit;
}


// Debug red/reproduction: normal path accepts any genuinely failed bash (broader than develop's
// TDD red). See-through path accepts only test/verification-shaped echo-masked failures, to avoid
// treating an arbitrary successful command whose output contains "FAIL" as reproduction evidence.
export function isFailedBashResult(result: CapturedToolResult): boolean {
  if (result.toolName !== "bash") return false;
  if (result.isError) return true;
  return isTestOrVerificationCommand(String(result.input.command ?? "")) && bashLooksFailedDespiteSuccess(result);
}

export function findFailedBash(work: WorkState): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find(isFailedBashResult);
}


// Develop TDD red: must be a failed test/verification command, not any failed bash (git rebase
// conflict, npm install network error, a typo, etc.). Echo-masked failures are accepted by the same
// see-through rule as debug, but only after the command-shape guard.
export function isFailedVerificationBashResult(result: CapturedToolResult): boolean {
  if (result.toolName !== "bash" || !isTestOrVerificationCommand(String(result.input.command ?? ""))) return false;
  return result.isError || bashLooksFailedDespiteSuccess(result);
}

export function findFailedVerificationBash(work: WorkState): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find(isFailedVerificationBashResult);
}


// Green/final verification: require a successful, recognized test/verification command with clean
// output. This rejects echo-masked pseudo-greens: a failing `npm test; echo "exit:1"` has
// isError=false, but cleanVerificationResult catches the failure signals in output.
export function isSuccessfulCleanVerificationBashResult(result: CapturedToolResult): boolean {
  return result.toolName === "bash"
    && !result.isError
    && isTestOrVerificationCommand(String(result.input.command ?? ""))
    && cleanVerificationResult(result).ok;
}

export function findSuccessfulVerificationBash(work: WorkState): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find(isSuccessfulCleanVerificationBashResult);
}


export function findAnyTestExecution(work: WorkState): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find((result) => {
    if (result.toolName !== "bash") return false;
    return isTestExecutionCommand(String(result.input.command ?? ""));
  }) ?? findBrowserEvidence(work)[0];
}


export function findSuccessfulCleanTestExecution(work: WorkState): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find((result) => {
    if (result.toolName !== "bash" || result.isError) return false;
    const command = String(result.input.command ?? "");
    return isTestExecutionCommand(command) && cleanVerificationResult(result).ok;
  }) ?? findBrowserEvidence(work)[0];
}

// Cross-family: also uses isAdHocCheckCommand (noTestSuite ad-hoc arm); see the ad-hoc-check section.

// Shared no-runner-project recognition: a successful, clean, substantive check command that need
// NOT be a recognized test runner. Used by BOTH requireSuccessfulVerification's noTestSuite branch
// (common.ts) and test-assets-passed-if-written's noTestSuite accommodation (test-assets.ts), so the
// two checkpoints agree on what counts as verification in a project with no automated runner.
// Keeping this logic in one shared helper prevents the asymmetry that previously deadlocked F6
// (verification-command-passed accepted python3 -c, but test-assets demanded pytest).
export function findSuccessfulSubstantiveCheck(work: WorkState): CapturedToolResult | undefined {
  return [...(work.capturedToolResults ?? [])].reverse().find((result) => {
    if (result.toolName !== "bash" || result.isError) return false;
    const command = String(result.input.command ?? "");
    return (isVerificationCommand(command) || isAdHocCheckCommand(command)) && cleanVerificationResult(result).ok;
  });
}


// Diagnostic helper: commands that LOOK like test/verification intent (command or output contains
// test/verify/check/PASS/FAIL) but were NOT recognized by the canonical function. Used by rejection
// messages to NAME the almost-recognized command ("saw X but didn't recognize it") — materially
// better than a generic "no verification found" hint. isSuccess filters success vs failure side
// (green detectors want success; red detectors want failure-ish signals).
// NOTE: the isSuccess:false branch is scaffolding for the Follow-up (develop-red / debug-repro);
// only { isSuccess: true } is wired at common.ts in THIS commit. The filter uses the UNIFIED
// isTestOrVerificationCommand (not narrow) so it shrinks as recognition widens (Problem 3 consistency).
export function findSuspectedUnrecognizedCommands(work: WorkState, options: { isSuccess: boolean }): CapturedToolResult[] {
  return (work.capturedToolResults ?? [])
    .filter((result) => result.toolName === "bash" && (options.isSuccess ? !result.isError : (result.isError || bashLooksFailedDespiteSuccess(result))))
    .filter((result) => {
      const command = String(result.input.command ?? "");
      // looksLikeVerify: command/output mentions test/verify/check/etc. PASS/FAIL capture success/failure
      // signals for both sides (FAIL is for the Follow-up's isSuccess:false red branch).
      const looksLikeVerify = /\b(test|verify|check|lint|build|vet|smoke|validate|spec|ci|unit|integration)\b|\bPASS(ed)?\b|\bFAIL\b/i.test(`${command} ${result.outputSummary ?? ""}`);
      return looksLikeVerify && !isLikelyReadOnlyOrWriteOnlyShell(command) && !isTestOrVerificationCommand(command);
    });
}

// dead code — zero call sites repo-wide; kept for potential future family-based hints;
// do not consume without a separate revive-vs-delete decision (see unify plan What NOT to change).

// Used by checkpoint failure feedback: lists the command families currently recognized, so the agent can see the boundary
// and is not misled by narrow hints like "please run npm test" in non-JS projects into fabricating a package.json.
export const TEST_EXECUTION_COMMAND_FAMILIES = [
  "npm/pnpm/yarn/bun test, run test* scripts, or e2e scripts",
  "vitest / jest",
  "playwright test / cypress",
  "pytest / python -m pytest",
  "go test / cargo test / dotnet test",
  "mvn test / gradle test / make test / bun test",
  "./test*.sh or ./scripts/test*.sh (including bash ./...)",
] as const;


export const VERIFICATION_COMMAND_FAMILIES = [
  "npm/pnpm/yarn/bun run test|e2e|verify|build|lint|smoke|check|validate|spec|ci|unit|integration",
  "npx/pnpm/yarn/bunx tsc / vitest / jest",
  "npx/pnpm/yarn playwright test",
  "pytest / python -m pytest",
  "python -m py_compile | compileall",
  "ruff / mypy / flake8 / pylint",
  "go test | go vet | go build",
  "cargo test | check | build | clippy",
  "dotnet build | test",
  "mvn test / gradle test",
  "make test | check | verify | build",
  "bun test",
  "shellcheck",
  "./<verify|check|test|smoke|validate>.sh、node/python scripts/<verify|check|test|smoke|validate>.*",
] as const;

export function cleanVerificationResult(result: { outputSummary?: string; input?: Record<string, unknown> }): { ok: true } | { ok: false; reason: string } {
  const command = String(result.input?.command ?? "");
  if (commandUsesUnsafeFailureSwallowingPipeline(command)) {
    return { ok: false, reason: "the command uses a pipe that may swallow the failure exit code (tail/head/grep without set -o pipefail), so it cannot serve as a clean final verification" };
  }
  const output = String(result.outputSummary ?? "");
  // Anchor error signals to runner/stack-trace shapes. Do NOT substring-match a bare "Error:\s",
  // because code under test legitimately prints "*Error:" messages on passing error-path
  // assertions (e.g. "ValueError: ..." in a successful `python3 -c` that asserts a function raises).
  // A bare /Error:\s/ would false-positive on those and cause a gate-level downgrade: the selector
  // skips the full error-path run and lands on a weaker import-only check (observed in smoke).
  if (/^Error:\s/m.test(output) || /Traceback \(most recent call last\)/m.test(output) || /\n\s*at\s+[\w.<>/$]+\s+\(/m.test(output) || /TEST FAILED|FAIL:\s|Command failed|npm ERR!|Unhandled 'error'|EADDRINUSE|command not found|EXIT:\s*[1-9]\d*/i.test(output)) {
    return { ok: false, reason: "the output contains obvious failure/stack-trace signals, so it cannot serve as a clean final verification" };
  }
  return { ok: true };
}

export function validateRootRunnableCurrentCommand(command: string, testingSignals: string[]): { ok: true } | { ok: false; reason: string } {
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, reason: "empty command" };
  if (/\|\|\s*true\b|;\s*true\b|\bset\s+\+e\b/.test(trimmed) || commandUsesUnsafeFailureSwallowingPipeline(trimmed)) return { ok: false, reason: `the command will swallow the failure exit code: '${trimmed}'` };
  if (/^(above|same|manual\b|manual:|review\s+only\b|review-only\b|n\/a|none)\b/i.test(trimmed) || /\babove\b|\bsame\b/i.test(trimmed)) {
    return { ok: false, reason: `the command is not a copy-runnable complete command: '${trimmed}'` };
  }
  const hasRootCargo = testingSignals.includes("Cargo.toml");
  const nestedCargo = testingSignals.find((signal) => /(^|\/)Cargo\.toml$/.test(signal) && signal !== "Cargo.toml");
  if (!hasRootCargo && nestedCargo && /(^|[;&|()])\s*cargo\s+(build|test|check|clippy)\b/.test(trimmed)) {
    const manifestDir = nestedCargo.replace(/\/Cargo\.toml$/, "");
    const usesManifestPath = trimmed.includes(`--manifest-path ${nestedCargo}`) || trimmed.includes(`--manifest-path=${nestedCargo}`);
    const changesDir = new RegExp(`(^|[;&|()])\\s*(cd|pushd)\\s+${escapeRegExp(manifestDir)}\\b`).test(trimmed);
    if (!usesManifestPath && !changesDir) {
      return { ok: false, reason: `detected ${nestedCargo} but there is no root Cargo.toml, so a bare command '${trimmed}' cannot be used; write 'cd ${manifestDir} && cargo ...' or 'cargo ... --manifest-path ${nestedCargo}'` };
    }
  }
  return { ok: true };
}

export function stringList(value: unknown): string[] {
  return arrayAt(value).map((item) => {
    if (typeof item === "string") return item.trim();
    const object = objectAt(item);
    return stringAt(object?.path ?? object?.file ?? object?.to ?? object?.command ?? object?.name);
  }).filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type ReleaseOperation = "push" | "tag" | "npm-publish" | "deploy" | "github-release" | "ci-trigger";

export function isReleaseSideEffectCommand(command: string): boolean {
  // Precisely match real external side-effect commands. Do not match read-only text like `cat docs/deploy.md` / `grep deploy README.md`.
  return classifyReleaseSideEffectCommand(command).length > 0;
}

export function classifyReleaseSideEffectCommand(command: string): ReleaseOperation[] {
  const operations = new Set<ReleaseOperation>();
  for (const segment of commandSegments(command)) {
    if (/^git\s+push\b/.test(segment)) operations.add("push");
    if (/^git\s+tag\s+(?!(?:-l|--list)\b)\S+/.test(segment)) operations.add("tag");
    if (!/\s--dry-run\b/.test(segment) && (/^(npm|pnpm)\s+publish\b/.test(segment) || /^yarn\s+npm\s+publish\b/.test(segment) || /^cargo\s+publish\b/.test(segment))) operations.add("npm-publish");
    if (/^gh\s+release\s+create\b/.test(segment)) operations.add("github-release");
    if (/^gh\s+workflow\s+run\b/.test(segment) && /(^|\s)(release|deploy|publish)[\w.-]*\.ya?ml\b|(^|\s)(release|deploy|publish)\b/i.test(segment)) operations.add("ci-trigger");
    if (/^docker\s+push\b/.test(segment)
      || (/^vercel\b/.test(segment) && /(^|\s)(--prod|deploy\s+--prod)\b/.test(segment))
      || /^fly\s+deploy\b/.test(segment)
      || /^railway\s+up\b/.test(segment)
      || /^wrangler\s+deploy\b/.test(segment)
      || /^netlify\s+deploy\s+--prod\b/.test(segment)) {
      operations.add("deploy");
    }
  }
  return [...operations];
}

export function isGitCommitCommand(command: string): boolean {
  return commandSegments(command).some((segment) => /^git\s+commit\b/.test(segment));
}

export function isGitStatusCommand(command: string): boolean {
  return commandSegments(command).some((segment) => /^git\s+status\b/.test(segment));
}

export function findCaptured(work: WorkState, toolCallId: string): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find((result) => result.toolCallId === toolCallId);
}

export function isWriteLike(result: CapturedToolResult): boolean {
  return result.toolName === "write" || result.toolName === "edit";
}

export function findWriteEditsForPath(work: WorkState, expectedPath: string): CapturedToolResult[] {
  const expected = stripChangeAnnotation(expectedPath);
  return (work.capturedToolResults ?? []).filter((result) => {
    if (!isWriteLike(result) || result.isError) return false;
    const actualPath = extractToolPath(result);
    if (!actualPath) return expected === "PROJECT.md" && result.outputSummary.includes("PROJECT.md");
    if (work.cwd) return sameProjectPath(actualPath, expected, work.cwd);
    return normalizePath(actualPath).endsWith(normalizePath(expected));
  });
}

export function findWriteEditForPath(work: WorkState, expectedPath: string): CapturedToolResult | undefined {
  return findWriteEditsForPath(work, expectedPath)[0];
}

export function findDeleteMoveEvidenceForPath(work: WorkState, expectedPath: string): CapturedToolResult | undefined {
  const expected = stripChangeAnnotation(expectedPath);
  return (work.capturedToolResults ?? []).find((result) => {
    if (result.toolName !== "bash" || result.isError) return false;
    return commandDeletesOrMovesPath(String(result.input.command ?? ""), expected, work.cwd);
  });
}

export function extractToolPath(result: CapturedToolResult): string {
  const metadataPath = result.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath.trim()) return metadataPath.trim();
  for (const key of ["path", "filePath", "filename", "target"]) {
    const value = result.input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function stripChangeAnnotation(value: string): string {
  // Tolerate annotations agents add after delete/move declarations, e.g. `path (删除)` / `path (bash rm -rf 删除)`.
  // No longer used as a gate; it just lets annotated paths still match real write/edit/rm/mv evidence.
  // Note: you cannot wrap CJK keywords with \b (\b only recognizes ASCII word characters), so \b is only used on rm.
  return normalizePath(value).replace(/\s*\([^)]*(?:删除|已删除|deleted|removed|delete|remove|\brm\b)[^)]*\)\s*$/i, "").trim();
}

export function isRootFile(value: string, fileName: string, cwd?: string): boolean {
  // Determine whether path points to fileName under the project root.
  // With cwd, strictly compare against the real project root to avoid misjudging /other/project/docs/PROJECT.md as a root file.
  if (cwd) return sameProjectPath(value, fileName, cwd);
  const normalized = normalizePath(value);
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (base !== fileName) return false;
  // Legacy/test compat without cwd: a bare filename or ./file counts as root; subdirectory relative paths are rejected.
  if (!normalized.includes("/")) return true;
  if (normalized.startsWith("./")) return !normalized.slice(2).includes("/");
  return normalized.startsWith("/");
}

export function sameProjectPath(actualPath: string, expectedPath: string, cwd: string): boolean {
  const actual = absoluteComparablePath(actualPath, cwd);
  const expected = absoluteComparablePath(expectedPath, cwd);
  return actual === expected;
}

export function pathLooksLikeProjectMemory(value: string): boolean {
  return /(^|\/)PROJECT(\.changes)?\.md$/.test(normalizePath(value));
}

export function pathLooksLikeUiArtifact(value: string): boolean {
  const normalized = normalizePath(value);
  return /\.(tsx?|jsx?|css|scss|html|vue|svelte)$/.test(normalized)
    || normalized.startsWith("src/")
    || normalized.startsWith("app/")
    || normalized.startsWith("components/")
    || normalized.startsWith("pages/")
    || normalized.startsWith("assets/")
    || normalized.includes("prototype")
    || normalized.includes("design");
}

export function pathLooksLikeStrongUiArtifact(value: string): boolean {
  const normalized = normalizePath(value);
  return /\.(tsx|jsx|css|scss|html|vue|svelte)$/.test(normalized)
    || normalized.startsWith("app/")
    || normalized.startsWith("pages/")
    || normalized.startsWith("components/")
    || /(^|\/)(ui|design|prototype)(\/|$)/i.test(normalized);
}

export function pathLooksLikeUiProductionArtifact(value: string, cwd?: string): boolean {
  const normalized = toProjectRelativePath(value, cwd);
  if (!normalized || isOutsideProjectPath(normalized, cwd)) return false;
  if (pathLooksLikeEvidenceOrScratchArtifact(normalized, cwd)) return false;
  if (pathLooksLikeTestAsset(normalized)) return false;
  return pathLooksLikeStrictUiArtifact(normalized);
}

export function pathLooksLikeEvidenceOrScratchArtifact(value: string, cwd?: string): boolean {
  const normalized = toProjectRelativePath(value, cwd).replace(/^\.\//, "");
  if (!normalized) return false;
  if (/^\.cynos(\/|$)/.test(normalized)) return true;
  if (/^\.playwright-cli(\/|$)/.test(normalized)) return true;
  if (/^node_modules(\/|$)/.test(normalized)) return true;
  if (/(^|\/)(\.cache|cache|tmp|temp|scratch)(\/|$)/i.test(normalized)) return true;
  if (/(^|\/)browser-evidence(\/|$)/i.test(normalized)) return true;
  if (/\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(normalized) && /(^|\/)(screenshots?|browser-evidence|evidence)(\/|$)/i.test(normalized)) return true;
  return false;
}

function pathLooksLikeStrictUiArtifact(value: string): boolean {
  const normalized = normalizePath(value).replace(/^\.\//, "");
  return /\.(tsx|jsx|css|scss|html|vue|svelte)$/.test(normalized)
    || /^(src|app|components|pages)\//.test(normalized)
    || /^(prototype|design)\//i.test(normalized);
}

export function pathLooksLikeUnsafeUiDeliverableArtifact(value: string, cwd?: string): boolean {
  const normalized = normalizePath(stripChangeAnnotation(value));
  if (!normalized) return false;
  if (!pathLooksLikeStrictUiArtifact(normalized)) return false;
  return isOutsideProjectPath(normalized, cwd) || pathLooksLikeEvidenceOrScratchArtifact(normalized, cwd);
}

export function findUiLikeProductionWrites(work: WorkState): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => {
    if (result.isError) return false;
    if (isWriteLike(result)) {
      const path = extractToolPath(result);
      return Boolean(path) && pathLooksLikeUiProductionArtifact(path, work.cwd);
    }
    if (result.toolName !== "bash") return false;
    return commandLooksLikeUiProductionMutation(String(result.input.command ?? ""), work.cwd);
  });
}

export function findUnsafeUiDeliverableWrites(work: WorkState): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => {
    if (result.isError) return false;
    if (isWriteLike(result)) {
      const path = extractToolPath(result);
      return Boolean(path) && pathLooksLikeUnsafeUiDeliverableArtifact(path, work.cwd);
    }
    if (result.toolName !== "bash") return false;
    return commandLooksLikeUnsafeUiDeliverableWrite(String(result.input.command ?? ""), work.cwd);
  });
}

function commandLooksLikeUiProductionMutation(command: string, cwd?: string): boolean {
  return commandSegments(command).some((segment) => uiProductionMutationTargets(segment, cwd).length > 0);
}

function commandLooksLikeUnsafeUiDeliverableWrite(command: string, cwd?: string): boolean {
  return commandSegments(command).some((segment) => unsafeUiDeliverableWriteTargets(segment, cwd).length > 0);
}

function uiProductionMutationTargets(segment: string, cwd?: string): string[] {
  return shellMutationTargets(segment, { includeRemove: true }).filter((target) => pathLooksLikeUiProductionArtifact(target, cwd));
}

function unsafeUiDeliverableWriteTargets(segment: string, cwd?: string): string[] {
  return shellMutationTargets(segment, { includeRemove: false }).filter((target) => pathLooksLikeUnsafeUiDeliverableArtifact(target, cwd));
}

function shellMutationTargets(segment: string, options: { includeRemove: boolean }): string[] {
  const targets: string[] = [];
  for (const match of segment.matchAll(/(?:^|\s)(?:\d?>{1,2})\s*([^\s;&|]+)/g)) {
    targets.push(cleanShellPathToken(match[1]));
  }

  const tee = segment.match(/(?:^|\|\s*)tee\s+([^|;&]+)/);
  if (tee) targets.push(...shellishPathArgs(tee[1]).filter((token) => !token.startsWith("-")));

  const copyMove = segment.match(/^(?:mv|cp)\s+(.+)$/);
  if (copyMove) targets.push(...shellishPathArgs(copyMove[1]).filter((token) => !token.startsWith("-")));

  if (options.includeRemove) {
    const remove = segment.match(/^(?:rm|git\s+rm)\s+(.+)$/);
    if (remove) targets.push(...shellishPathArgs(remove[1]).filter((token) => !token.startsWith("-")));
  }

  return targets;
}

function shellishPathArgs(value: string): string[] {
  return value.split(/\s+/).map(cleanShellPathToken).filter(Boolean);
}

function cleanShellPathToken(value: string): string {
  return value.trim().replace(/^['"`]+|['"`;:,)]+$/g, "");
}

export function pathLooksLikeTestAsset(value: string): boolean {
  const normalized = normalizePath(value).replace(/^\.\//, "");
  if (!normalized) return false;
  if (/^(tests?|__tests__|spec)\//i.test(normalized)) return true;
  if (/^packages\/[^/]+\/(tests?|__tests__|spec)\//i.test(normalized)) return true;
  if (/\.(test|spec|e2e)\.[cm]?[jt]sx?$/i.test(normalized)) return true;
  if (/_(test|spec)\.py$/i.test(normalized) || /(^|\/)test_[^/]+\.py$/i.test(normalized)) return true;
  if (/(_test\.go|Test\.java|Test\.kt|Spec\.scala)$/i.test(normalized)) return true;
  if (normalized.startsWith("e2e/")) return true;
  if (/(^|\/)(playwright|cypress)\.(config|e2e)\./i.test(normalized)) return true;
  return false;
}


export function pathLooksLikePackageOrBehavioralConfig(path: string): boolean {
  return /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|requirements\.txt|pyproject\.toml|poetry\.lock|tsconfig[^/]*\.json|jsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|jest\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s|cypress\.config\.[cm]?[jt]s|eslint\.config\.[cm]?[jt]s|prettier\.config\.[cm]?js|\.prettierrc[^/]*|\.eslintrc[^/]*|Dockerfile|docker-compose\.ya?ml|Makefile)$/i.test(path);
}

export function pathLooksLikeReleaseOwned(value: string, cwd?: string): boolean {
  const normalized = toProjectRelativePath(value, cwd).replace(/^\.\//, "");
  if (!normalized) return false;
  if (normalized === "docs/release.md") return true;
  if (normalized === "docs/release") return true;
  if (/^docs\/release\//.test(normalized)) return true;
  if (/^\.github\/workflows\/(release|publish)[\w.-]*\.ya?ml$/i.test(normalized)) return true;
  if (/^\.github\/workflows\/deploy[\w.-]*\.ya?ml$/i.test(normalized)) return true;
  if (/^scripts\/release\.[\w.-]+$/i.test(normalized)) return true;
  if (/^scripts\/.*(release|changelog|version|publish|deploy|pack)[\w.-]*\.(mjs|cjs|js|ts|sh|py)$/i.test(normalized)) return true;
  if (/^(docs\/)?(deploy|rollback)[\w.-]*\.md$/i.test(normalized)) return true;
  return false;
}

export function pathLooksLikeSourceOrTest(path: string): boolean {
  if (/^(src|lib|server|client|app|pages|components|tests?|__tests__|spec|packages\/[^/]+\/(src|test|tests))\//.test(path)) return true;
  if (/(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return true;
  return /\.(tsx?|jsx?|mjs|cjs|py|pyx|go|rs|java|kt|rb|php|cs|fs|fsx|cpp|cc|cxx|c|hpp|hxx|h|hh|swift|scala|vue|svelte|dart|lua|pl|pm|r|jl|ex|exs|erl|hs|ml|mli|clj|cljs|cljc|lisp|el|elm|nim|v|d|zig)$/i.test(path);
}

export function pathLooksLikeRuntimeConfig(value: string): boolean {
  const normalized = normalizePath(value).replace(/^\.\//, "");
  if (!normalized) return false;
  if (/^\.env(?:\..+)?$/i.test(normalized) && !/^\.env\.example$/i.test(normalized)) return true;
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(normalized)) return true;
  if (pathLooksLikePackageOrBehavioralConfig(normalized)) return true;
  if (/(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml)$/i.test(normalized)) return true;
  if (/(^|\/)(nginx\.conf|nginx\/|conf\.d\/.*\.conf$)/i.test(normalized)) return true;
  if (/(^|\/)(k8s|kubernetes|helm|terraform)\//i.test(normalized)) return true;
  if (/\.(tf|tfvars|hcl)$/i.test(normalized)) return true;
  return false;
}

export function toProjectRelativePath(value: string, cwd?: string): string {
  const normalized = normalizePath(stripChangeAnnotation(value)).replace(/^\.\//, "");
  if (!cwd || !normalized || !isAbsolute(normalized)) return normalized;
  const relativePath = relative(resolve(cwd), resolve(normalized));
  if (relativePath === "") return ".";
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return normalized;
  return normalizePath(relativePath);
}

export function pathLooksLikeDocumentationAsset(value: string, cwd?: string): boolean {
  const normalized = toProjectRelativePath(value, cwd);
  if (!normalized) return false;
  if (/^README(?:\.[^/]*)?$/i.test(normalized)) return true;
  if (/^AGENTS?\.md$/i.test(normalized)) return true;
  if (normalized === ".env.example") return true;
  return /\.(md|mdx|txt|rst|adoc)$/i.test(normalized);
}

export function pathLooksLikeDefaultMetadata(path: string, cwd?: string): boolean {
  const normalized = toProjectRelativePath(path, cwd);
  if (!normalized || isOutsideProjectPath(path, cwd)) return false;
  if (/^LICENSE(?:\.[^/]*)?$/i.test(normalized)) return true;
  return normalized === ".gitignore" || normalized === ".editorconfig";
}

export type DefaultBoundaryDecision =
  | { allowed: true; kind: "default-hint" | "unknown-fallback"; reason: string }
  | { allowed: false; targetPractice: PracticeId | "none"; reason: string };

export function classifyDefaultBoundary(path: string, cwd?: string): DefaultBoundaryDecision {
  const normalized = toProjectRelativePath(path, cwd).replace(/^\.\//, "");
  if (!normalized) return { allowed: false, targetPractice: "none", reason: "empty path" };
  if (isOutsideProjectPath(path, cwd)) return { allowed: false, targetPractice: "none", reason: "project-external path; no project practice should own this mutation" };

  if (pathLooksLikeReleaseOwned(normalized)) {
    return { allowed: false, targetPractice: "release", reason: "release-system file; use release maintain mode" };
  }
  if (pathLooksLikeProjectMemory(normalized)) {
    return { allowed: false, targetPractice: "onboard", reason: "project memory belongs to onboard" };
  }
  if (pathLooksLikeTestAsset(normalized)) {
    return { allowed: false, targetPractice: "test", reason: "test asset belongs to test when testing is the deliverable, or develop when part of implementation" };
  }
  if (pathLooksLikeRuntimeConfig(normalized) || pathLooksLikePackageOrBehavioralConfig(normalized) || pathLooksLikeDefaultDeniedRepoConfig(normalized)) {
    return { allowed: false, targetPractice: "develop", reason: "runtime/package/build/test/CI config belongs to develop unless release-owned" };
  }
  if (pathLooksLikeSourceOrTest(normalized)) {
    return { allowed: false, targetPractice: "develop", reason: "source/runtime code belongs to develop, debug, or refactor depending on intent" };
  }
  if (pathAllowedForDocs(normalized, cwd)) {
    return { allowed: false, targetPractice: "docs", reason: "documentation/report file belongs to docs" };
  }
  if (pathLooksLikeDefaultMetadata(normalized, cwd)) {
    return { allowed: true, kind: "default-hint", reason: "repo metadata strongly suggests default" };
  }
  return { allowed: true, kind: "unknown-fallback", reason: "unknown/gray project maintenance path not clearly owned by another practice" };
}

function pathLooksLikeDefaultDeniedRepoConfig(path: string): boolean {
  return /(^|\/)(\.npmignore|\.nvmrc|\.node-version|\.tool-versions|\.python-version)$/i.test(path);
}

export function pathAllowedForDocs(path: string, cwd?: string): boolean {
  const normalized = toProjectRelativePath(path, cwd);
  if (!normalized) return false;
  if (/^LICENSE(?:\.[^/]*)?$/i.test(normalized)) return false;
  if (normalized === ".gitignore" || normalized === ".editorconfig") return false;
  if (pathLooksLikeReleaseOwned(normalized)) return false;
  if (/^\.npmignore$/i.test(normalized) || /^\.nvmrc$/i.test(normalized) || /^\.prettierrc[^/]*$/i.test(normalized)) return false;
  if (pathLooksLikeRuntimeConfig(normalized)) return false;
  if (pathLooksLikeTestAsset(normalized)) return false;
  if (pathLooksLikeSourceOrTest(normalized)) return false;
  if (pathLooksLikeStrongUiArtifact(normalized)) return false;
  return pathLooksLikeDocumentationAsset(normalized);
}

export function pathAllowedForTest(path: string, cwd?: string): boolean {
  const normalized = toProjectRelativePath(path, cwd);
  if (!normalized) return false;
  if (normalized === ".cynos" || normalized.startsWith(".cynos/")) return true;
  if (pathLooksLikeRuntimeConfig(normalized) || pathLooksLikePackageOrBehavioralConfig(normalized)) return false;
  return pathLooksLikeTestAsset(normalized);
}

export function isBrowserBashCommand(command: string): boolean {
  // Direct Playwright CLI browser evidence via bash: recognize actions that capture page/browser state.
  // Management commands like help/version/install/list/open/goto/close do not count as successful evidence.
  // Project test runners (npx playwright test, npm run e2e) are intentionally NOT browser evidence.
  return commandSegments(command).some((segment) => {
    if (segmentIsHelpOrVersion(segment)) return false;
    if (!/^(npx\s+(--yes\s+)?@playwright\/cli|playwright-cli)\b/.test(segment)) return false;
    if (/\b(install|install-browser|install-deps|list|open|goto|close|close-all|kill-all|run-code)\b/.test(segment)) return false;
    return /\b(snapshot|screenshot|console|eval|requests?)\b/.test(segment);
  });
}

export function isBrowserAttemptBashCommand(command: string): boolean {
  // Failed open/goto can prove browser launch/connect is blocked, even though successful open/goto is not evidence.
  // Failed install-browser is also a browser-environment attempt. Help/version/list/close are management only.
  return commandSegments(command).some((segment) => {
    if (segmentIsHelpOrVersion(segment)) return false;
    if (!/^(npx\s+(--yes\s+)?@playwright\/cli|playwright-cli)\b/.test(segment)) return false;
    if (/\b(list|close|close-all|kill-all|run-code)\b/.test(segment)) return false;
    return /\b(open|goto|snapshot|screenshot|console|eval|requests?|install-browser)\b/.test(segment);
  });
}

// Whether a single result constitutes direct browser evidence.
// Two routes:
//   1. @cynos-ai/tools cynos_browser_inspect with action snapshot/screenshot/console/requests/eval (preferred)
//   2. legacy Playwright CLI bash evidence (fallback, still supported)
// cynos_browser_navigate / cynos_browser_interact / cynos_browser_close are intentionally
// NOT evidence on their own — they are setup steps. Shared by findBrowserEvidence and tools.ts.
const BROWSER_EVIDENCE_ACTIONS = new Set(["snapshot", "screenshot", "console", "requests", "request", "eval"]);

function cynosBrowserInspectAction(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const action = (input as { action?: unknown }).action;
  return typeof action === "string" ? action : undefined;
}

export function isBrowserEvidenceResult(result: CapturedToolResult): boolean {
  if (result.isError) return false;
  // Route 1: @cynos-ai/tools cynos_browser_inspect with an evidence-grade action.
  if (result.toolName === "cynos_browser_inspect") {
    const action = cynosBrowserInspectAction(result.input);
    return !!action && BROWSER_EVIDENCE_ACTIONS.has(action);
  }
  // Route 2: legacy Playwright CLI bash evidence.
  if (result.toolName !== "bash") return false;
  return isBrowserBashCommand(String(result.input.command ?? ""));
}

export function isFailedBrowserAttemptResult(result: CapturedToolResult): boolean {
  if (!result.isError) return false;
  // Route 1: a failed cynos_browser_navigate or cynos_browser_inspect proves the browser environment is blocked.
  if (result.toolName === "cynos_browser_navigate" || result.toolName === "cynos_browser_inspect") {
    return true;
  }
  // Route 2: legacy failed Playwright CLI open/goto/evidence/install-browser attempts.
  if (result.toolName !== "bash") return false;
  return isBrowserAttemptBashCommand(String(result.input.command ?? ""));
}

export function commandSegments(command: string, options: { splitPipe?: boolean } = {}): string[] {
  const separator = options.splitPipe ? /&&|\|\||[;|()\n]/ : /&&|\|\||[;()\n]/;
  return command.split(separator).map((segment) => segment.trim()).filter(Boolean);
}

function commandDeletesOrMovesPath(command: string, expectedPath: string, cwd?: string): boolean {
  const expected = stripChangeAnnotation(expectedPath);
  if (!expected) return false;
  return commandSegments(command).some((segment) => {
    if (!/^(rm\s|git\s+rm\b|mv\s)/.test(segment)) return false;
    return commandMentionsPath(segment, expected, cwd);
  });
}

// Strictly normalize against cwd, without expanding `~`: paths outside the project (~/.pi, ~/.config, etc.) should not be matched by the generic path gate.
// By design, outside-project = user environment, free to read/write, not going through a practice (see no-work-gate). Persisting Cynos
// preferences (such as onboardMode) always goes through the /cynos-config config layer; a practice never writes outside-project config files directly.
function absoluteComparablePath(path: string, cwd: string): string {
  const normalized = normalizePath(stripChangeAnnotation(path));
  return isAbsolute(normalized) ? resolve(normalized) : resolve(cwd, normalized);
}

// Ad-hoc check recognition for the no-test bypass. Unlike isVerificationCommand, this only accepts commands that "really load/compile/check
// a file or package", to block unrelated no-ops like `node -e "1"` / `python -c "print(1)"` / `pip list`.
// Used together with verification.noTestSuite=true + a reason, only via the no-test bypass, not the normal verification path.
export function isAdHocCheckCommand(command: string): boolean {
  const segments = commandSegments(command);
  if (segments.some((segment) => segmentIsHelpOrVersion(segment))) return false;
  // Substance of node -e / python -c: directly extract the code inside the quotes from the whole command to test (do not go through commandSegments,
  // because splitting on () would break require(). The code must contain require/import, to block no-ops like `node -e "1"`,
  // and to block `echo "require" && node -e "1"` (the node -e code itself has no require).
  const nodeECode = command.match(/node\s+-e\s+(["'])([\s\S]*?)\1/)?.[2];
  if (nodeECode !== undefined && /\b(require\(|import\s|import\()/.test(nodeECode)) return true;
  // node --check / python -m py_compile / compileall: real syntax check, must take a file argument
  if (segments.some((segment) => /^node\s+--check\s+\S/.test(segment))) return true;
  if (segments.some((segment) => /^python3?\s+-m\s+(py_compile|compileall)\s+\S/.test(segment))) return true;
  const pyCCode = command.match(/python3?\s+-c\s+(["'])([\s\S]*?)\1/)?.[2];
  if (pyCCode !== undefined && /\bimport\s/.test(pyCCode)) return true;
  // pip show <pkg>: an existence check for a specific package (pip list does not count, no specific target)
  if (segments.some((segment) => /^(python3?\s+-m\s+)?pip\s+show\s+\S/.test(segment))) return true;
  // test -f/-s/-d <file>: file existence/non-empty check
  if (segments.some((segment) => /^(test|\[)\s+-[fsd]\s+\S/.test(segment))) return true;
  return false;
}

// Determine whether a path falls outside the project (cwd). Used to bounce back in failure messages: outside-project config changes should not be routed through a practice.
// A path starting with `~` is the user's home directory and counts as outside the project (not expanded; only classified).
export function isOutsideProjectPath(path: string, cwd?: string): boolean {
  if (!cwd) return false;
  if (path === "~" || path.startsWith("~/") || path.startsWith("~\\")) return true;
  const target = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(resolve(cwd), target);
  return rel === "" ? false : (rel.startsWith("..") || isAbsolute(rel));
}

// commandMentionsPath only covers the in-project case, with path-boundary matching (`src/foo` does not hit `src/foobar`).
// It does not handle the `~` form — outside-project paths are already rejected by policy at the find* entry points.
function commandMentionsPath(command: string, expectedPath: string, cwd?: string): boolean {
  const normalizedCommand = normalizePath(command);
  const expected = stripTrailingPathSep(stripChangeAnnotation(expectedPath));
  if (pathTokenInCommand(normalizedCommand, expected)) return true;
  if (!cwd) return false;
  const expectedAbs = normalizePath(stripTrailingPathSep(absoluteComparablePath(expected, cwd)));
  return pathTokenInCommand(normalizedCommand, expectedAbs);
}

function stripTrailingPathSep(value: string): string {
  return value.replace(/\/+$/, "") || value;
}

function pathTokenInCommand(command: string, token: string): boolean {
  if (!token) return false;
  // The token before must be at a start or a "non-word and non-/" character (to avoid bar/src/foo being treated as a declared src/foo);
  // the token after must be at an end or a non-word character (/ counts as non-word, so src/foo/ still hits src/foo).
  const re = new RegExp(`(^|[^\\w/]|(?<=\\.)/)${escapeRegExp(token)}(?=[^\\w]|$)`, "i");
  return re.test(command);
}

function segmentIsHelpOrVersion(segment: string): boolean {
  return /(^|\s)(--help|-h|--version|-V)(\s|$)/.test(segment);
}

export function commandUsesUnsafeFailureSwallowingPipeline(command: string): boolean {
  if (/\bset\s+-o\s+pipefail\b/.test(command)) return false;
  return /\|\s*(tail|head|grep)\b/.test(command);
}

export function findBrowserEvidence(work: WorkState): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => isBrowserEvidenceResult(result));
}

export function findFailedBrowserAttempts(work: WorkState): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => isFailedBrowserAttemptResult(result));
}

export function browserBlockedFallback(work: WorkState): string {
  const surfaceVerification = objectAt(work.completionEvidence?.surfaceVerification);
  if (!surfaceVerification) return "";
  const reason = stringAt(surfaceVerification.blockedReason);
  const alternative = stringAt(surfaceVerification.alternativeVerification);
  const degraded = stringAt(surfaceVerification.degradedEvidence);
  const attempts = stringList(surfaceVerification.attemptedApproaches);
  if (!reason || !alternative || !degraded || attempts.length < 2) return "";
  if (findFailedBrowserAttempts(work).length < 2) return "";
  return reason;
}

export function capturedResultIndex(work: WorkState, result: CapturedToolResult): number {
  return (work.capturedToolResults ?? []).indexOf(result);
}

export function hasBrowserEvidenceBefore(work: WorkState, boundaryIndex: number): boolean {
  return findBrowserEvidence(work).some((result) => capturedResultIndex(work, result) >= 0 && capturedResultIndex(work, result) < boundaryIndex);
}

export function hasBrowserEvidenceAfter(work: WorkState, boundaryIndex: number): boolean {
  return findBrowserEvidence(work).some((result) => capturedResultIndex(work, result) > boundaryIndex);
}

// Debug models a single bug per work. Multi-bug lists must be split into separate debug works.
export function debugBlock(work: WorkState): Record<string, any> | undefined {
  return objectAt(work.completionEvidence?.debugging);
}

export function objectAt(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

export function arrayAt(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function stringAt(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Original-prompt authorization recognition. Shared by the ui confirmation gate (ui.ts) and
// the commit not-committed gate (change.ts). Detects phrases where the user pre-stated
// authorization/delegation in the original task prompt, so the agent need not ask again.
// Covers both general delegation (you decide / 自主设计) and commit-specific authorization
// (don't commit / review-only / show me the diff) — the latter is the commit-gate escape path
// for the common "帮我改一下别提交" class of requests.
export function mentionsOriginalPromptAuthorization(summary: string): boolean {
  return /original\s*prompt|原始\s*prompt|explicitly\s+(delegated|authorized|approved)|用户.*(授权|确认|委托|不用.*问|无需.*确认|你决定|自主设计)|(do\s+not|don'?t|不用|别|无需)\s*(commit|提交|git\s+commit)|(review[-\s]?only|只\s*看|仅\s*看|不\s*动\s*git|show\s+(me\s+)?the\s+diff|给我看\s*diff)/i.test(summary);
}

// Subagent identity is determined ONLY by the agent field (input.agent for single mode,
// tasks[].agent for parallel mode), never by scanning outputSummary text.
// Runtime invariant: runSingleAgent uses agents.find(c => c.name === agentName) exact match,
// unknown agent -> exitCode:1 + isError. So a successful subagent call's input.agent is
// guaranteed to be exactly one of the 5 fixed names. No outputSummary fallback is needed or
// wanted (scanning it caused false positives, e.g. an explorer mentioning 'review' counted as
// reviewer). See principles §3.8 criterion C (gate trigger on deterministic field, not text scan).
export function isSubagentResult(result: CapturedToolResult, expectedAgent: "reviewer" | "challenger"): boolean {
  if (result.toolName !== "cynos_subagent" || result.isError) return false;
  const agent = stringAt(result.input.agent);
  if (agent.toLowerCase() === expectedAgent) return true;
  const tasks = Array.isArray(result.input.tasks) ? result.input.tasks : [];
  if (tasks.some((task) => stringAt(objectAt(task)?.agent).toLowerCase() === expectedAgent)) return true;
  return false;
}

export function failedSubagentResults(work: WorkState, expectedAgent: "reviewer" | "challenger"): CapturedToolResult[] {
  return (work.capturedToolResults ?? []).filter((result) => {
    if (result.toolName !== "cynos_subagent" || !result.isError) return false;
    const agent = stringAt(result.input.agent);
    if (agent.toLowerCase() === expectedAgent) return true;
    const tasks = Array.isArray(result.input.tasks) ? result.input.tasks : [];
    if (tasks.some((task) => stringAt(objectAt(task)?.agent).toLowerCase() === expectedAgent)) return true;
    return false;
  });
}

// ─── Timing/order helpers (capturedToolResults index by toolCallId) ──────────────
// Support "sequence gates": proving a subagent (e.g. challenger) ran BEFORE the first production
// write, not after. capturedToolResults is append-ordered and each entry carries a toolCallId, so
// index-by-toolCallId is robust to object-reference differences (works across filter boundaries).
export function capturedIndex(work: WorkState, result: CapturedToolResult): number {
  const id = result?.toolCallId;
  if (!id) return -1;
  return (work.capturedToolResults ?? []).findIndex((item) => item.toolCallId === id);
}

export function minIndex(work: WorkState, results: CapturedToolResult[]): number {
  return Math.min(...results.map((item) => capturedIndex(work, item)).filter((index) => index >= 0));
}

export function maxIndex(work: WorkState, results: CapturedToolResult[]): number {
  return Math.max(...results.map((item) => capturedIndex(work, item)).filter((index) => index >= 0));
}

export function subagentForEvidence(work: WorkState, expectedAgent: "reviewer" | "challenger", predicate: (item: CapturedToolResult) => boolean = () => true): CapturedToolResult | undefined {
  return (work.capturedToolResults ?? []).find((item) => isSubagentResult(item, expectedAgent) && predicate(item));
}

// Index of the first PRODUCTION write (code/config/docs), excluding evidence/scratch artifacts
// (.cynos, screenshots, browser-evidence, cache, tmp). Used by sequence gates to answer "did the
// challenger run before implementation started?". Returns +Infinity when there is no production
// write (pure-investigation work) — gates treat that as "implementation never started".
// options.excludeTests: also exclude test files. Used by the TDD-red sequence gate, where the
// first write must be the first IMPLEMENTATION write (TDD legitimately writes the test file,
// runs red, then implements — so the test-file write must not count as "implementation started").
export function firstProductionWriteIndex(work: WorkState, options: { excludeTests?: boolean } = {}): number {
  const writes = (work.capturedToolResults ?? []).filter((result) => {
    if (result.isError || !isWriteLike(result)) return false;
    const path = extractToolPath(result);
    if (!path || pathLooksLikeEvidenceOrScratchArtifact(path, work.cwd)) return false;
    if (options.excludeTests && pathLooksLikeTestAsset(path)) return false;
    return true;
  });
  return writes.length > 0 ? minIndex(work, writes) : Number.POSITIVE_INFINITY;
}
