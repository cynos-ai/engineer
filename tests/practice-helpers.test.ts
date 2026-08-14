import { describe, expect, it } from "vitest";
import type { CapturedToolResult, WorkState } from "../extensions/core/types";
import { evaluateActiveWorkScope } from "../extensions/practices/active-work-scope-guard";
import {
  isBrowserBashCommand,
  isBrowserEvidenceResult,
  isFailedBrowserAttemptResult,
  isVerificationCommand,
  isRootFile,
  findBrowserEvidence,
  findFailedBrowserAttempts,
  pathLooksLikeProjectMemory,
  pathLooksLikeUiArtifact,
  pathLooksLikeStrongUiArtifact,
  pathLooksLikeTestAsset,
  isTestExecutionCommand,
  isReleaseSideEffectCommand,
  classifyReleaseSideEffectCommand,
  isGitCommitCommand,
  isGitStatusCommand,
  validateRootRunnableCurrentCommand,
  classifyDefaultBoundary,
  pathLooksLikeDefaultMetadata,
  pathAllowedForDocs,
  pathAllowedForTest,
  pathLooksLikeDocumentationAsset,
  pathLooksLikeRuntimeConfig,
  pathLooksLikeSourceOrTest,
  findReadEvidenceForPath,
  findWriteEditForPath,
  findDeleteMoveEvidenceForPath,
  isOutsideProjectPath,
  isAdHocCheckCommand,
  toProjectRelativePath,
  cleanVerificationResult,
  commandMasksExitCodeWithEcho,
  bashLooksFailedDespiteSuccess,
  findFailedBash,
  findFailedVerificationBash,
  findSuccessfulVerificationBash,
  isTestOrVerificationCommand,
  findSuspectedUnrecognizedCommands,
} from "../extensions/practices/helpers";
import { detectProjectMutationTargets } from "../extensions/practices/mutation-targets";

function bash(command: string, isError = false, outputSummary?: string): CapturedToolResult {
  return {
    toolCallId: `call-${command.slice(0, 12)}`,
    toolName: "bash",
    input: { command },
    outputSummary: outputSummary ?? (isError ? "failed" : "ok"),
    isError,
    at: "2026-01-01T00:00:00.000Z",
  };
}

function work(captured: CapturedToolResult[]): WorkState {
  return {
    schemaVersion: 1,
    id: "w",
    practice: "default",
    objective: "o",
    acceptanceCriteria: [{ id: "criterion-1", description: "c" }],
    status: "active",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completionEvidence: {},
    capturedToolResults: captured,
  };
}

describe("isVerificationCommand", () => {
  it("accepts real test/build/lint/typecheck commands", () => {
    for (const cmd of [
      "npm run build",
      "npm run smoke:matrix",
      "npm --prefix app run smoke:matrix",
      "pnpm -C app run validate",
      "yarn run check",
      "bun run ci",
      "pnpm test",
      "yarn run verify",
      "cd app && npx tsc --noEmit",
      "(cd src-tauri && cargo check)",
      "vitest run",
      "npx vitest run src/lib/versionCompare.test.ts",
      "npx --yes jest src/foo.test.ts",
      "pnpm vitest run",
      "npm test -- src/lib/versionCompare.test.ts",
      "node --version && npm test",
      "npx playwright test",
      "node --check src/hello.js",
      "node scripts/verify-fixture.mjs",
      "python scripts/verify_fixture.py",
    ]) {
      expect(isVerificationCommand(cmd), cmd).toBe(true);
    }
  });

  it("rejects unsafe package scripts and ad-hoc checks as verification", () => {
    // deploy/start/dev/publish scripts have side effects or just start services, not completion verification.
    // node -e / python -c / pip show / test -f && echo PASS are ad-hoc runtime probes,
    // not clean verification, cannot pass verification-command-passed. Real syntax check goes through node --check.
    for (const cmd of [
      "npm run deploy",
      "npm run start",
      "npm run dev",
      "npm run publish",
      "npm run checkout",
      "npm run special",
      "npm run united",
      "node scripts/deploy.mjs",
      "python scripts/publish.py",
      "node -e \"require('./src/hello.js')\"",
      "node -e \"1\"",
      "python -c \"import requests; print(requests.__version__)\"",
      "pip show requests",
      "test -f hello.txt && test -s hello.txt && echo PASS && cat hello.txt",
    ]) {
      expect(isVerificationCommand(cmd), cmd).toBe(false);
    }
  });

  it("accepts playwright-cli only with evidence actions", () => {
    expect(isVerificationCommand("npx --yes @playwright/cli -s=pe snapshot")).toBe(true);
    expect(isVerificationCommand("npx --yes @playwright/cli -s=pe screenshot --filename=a.png")).toBe(true);
    expect(isVerificationCommand("npx --yes @playwright/cli -s=pe console")).toBe(true);
  });

  it("rejects playwright-cli management/help commands (open/goto/list/close/help)", () => {
    for (const cmd of [
      "npx --yes @playwright/cli -s=pe open http://127.0.0.1:5173",
      "npx --yes @playwright/cli -s=pe goto http://x",
      "npx --yes @playwright/cli list",
      "npx --yes @playwright/cli -s=pe close",
      "npx --yes @playwright/cli console --help",
      "npx playwright test --help",
      "npx vitest --help",
    ]) {
      expect(isVerificationCommand(cmd), cmd).toBe(false);
    }
  });

  it("rejects grep/cat text that merely mentions test tools", () => {
    for (const cmd of [
      'cat package.json | grep "tsc"',
      "grep -r playwright package.json",
      "echo npm run build",
    ]) {
      expect(isVerificationCommand(cmd), cmd).toBe(false);
    }
  });

  it("accepts non-JS verification commands across stacks", () => {
    for (const cmd of [
      "go vet ./...",
      "go test ./...",
      "go build ./...",
      "cargo clippy",
      "cargo check",
      "cargo build",
      "pytest",
      "python3 -m py_compile app/main.py",
      "python3 -m compileall src",
      "python -m pytest tests/",
      "ruff check .",
      "mypy app",
      "flake8 src",
      "pylint app",
      "dotnet build",
      "dotnet test",
      "mvn test",
      "gradle test",
      "make verify",
      "make check",
      "make build",
      "bun test",
      "shellcheck scripts/*.sh",
      "./verify.sh",
      "./scripts/check.sh",
      "bash ./test.sh",
      "bash ./scripts/verify.sh",
      "cd server && go vet ./...",
      "cd server && python3 -m py_compile app/main.py",
    ]) {
      expect(isVerificationCommand(cmd), cmd).toBe(true);
    }
  });

  it("still rejects read-only commands even when they mention verify/test paths", () => {
    for (const cmd of [
      "cat ./verify.sh",
      "echo ./scripts/check.sh",
      "grep verify README.md",
      "ls ./test.sh",
      "go vet --help",
      "cargo check --help",
      "make test --help",
      "python3 -m py_compile --help",
      "echo \"test\" > src/test.ts",
      "grep -n 'version' src-tauri/",
      "node -e \"require('./x')\"",
    ]) {
      expect(isVerificationCommand(cmd), cmd).toBe(false);
    }
  });
});

describe("isAdHocCheckCommand", () => {
  // Materiality gate: only commands that actually load/compile/inspect concrete files or packages, used only in no-test bypass.
  it("accepts substantive ad-hoc checks that load/compile/check a real target", () => {
    for (const cmd of [
      "node -e \"require('./src/hello')\"",
      "python -c \"import requests\"",
      "python3 -c \"import sys; print(sys.version)\"",
      "pip show requests",
      "test -f .env",
      "[ -f .env ]",
      "node --check src/hello.js",
      "python -m py_compile src/hello.py",
    ]) {
      expect(isAdHocCheckCommand(cmd), cmd).toBe(true);
    }
  });

  it("rejects no-op commands that exercise nothing", () => {
    for (const cmd of [
      "node -e \"1\"",
      "node -e \"console.log('hi')\"",
      "python -c \"print(1)\"",
      "pip list",
      "echo hi",
      "ls",
      "node --check",
      "python -m py_compile",
      "echo \"require\" && node -e \"1\"",
    ]) {
      expect(isAdHocCheckCommand(cmd), cmd).toBe(false);
    }
  });
});

describe("validateRootRunnableCurrentCommand", () => {
  it("rejects placeholders and commands that swallow failures", () => {
    for (const cmd of ["manual: npm run tauri dev", "review only", "above", "same", "n/a", "npm test || true", "set +e && npm test", "npm test 2>&1 | tail -30"]) {
      const result = validateRootRunnableCurrentCommand(cmd, ["package.json"]);
      expect(result.ok, cmd).toBe(false);
    }
  });

  it("allows pipefail-protected output trimming", () => {
    expect(validateRootRunnableCurrentCommand("set -o pipefail; npm test 2>&1 | tail -30", ["package.json"]).ok).toBe(true);
  });

  it("requires nested cargo commands to be root-runnable", () => {
    expect(validateRootRunnableCurrentCommand("cargo build", ["src-tauri/Cargo.toml"]).ok).toBe(false);
    expect(validateRootRunnableCurrentCommand("cd src-tauri && cargo build", ["src-tauri/Cargo.toml"]).ok).toBe(true);
    expect(validateRootRunnableCurrentCommand("cargo build --manifest-path src-tauri/Cargo.toml", ["src-tauri/Cargo.toml"]).ok).toBe(true);
  });
});

describe("isBrowserBashCommand", () => {
  it("matches playwright-cli snapshot/screenshot/console/eval/requests", () => {
    expect(isBrowserBashCommand("npx --yes @playwright/cli -s=pe snapshot")).toBe(true);
    expect(isBrowserBashCommand("npx --yes @playwright/cli -s=pe eval \"document.title\"")).toBe(true);
    expect(isBrowserBashCommand("npx --yes @playwright/cli -s=pe requests")).toBe(true);
    expect(isBrowserBashCommand("npx --yes @playwright/cli -s=pe open http://x && npx --yes @playwright/cli -s=pe screenshot --filename=a.png")).toBe(true);
  });

  it("does not match management commands or grep mentions", () => {
    expect(isBrowserBashCommand("npx --yes @playwright/cli open http://x")).toBe(false);
    expect(isBrowserBashCommand("npx --yes @playwright/cli console --help")).toBe(false);
    expect(isBrowserBashCommand("npx playwright install chromium")).toBe(false);
    expect(isBrowserBashCommand("grep @playwright/cli README.md")).toBe(false);
  });
});

describe("isBrowserEvidenceResult", () => {
  it("rejects MCP-style browser tool names", () => {
    for (const toolName of ["playwright_browser_take_screenshot", "browser_snapshot", "playwright_browser_console_messages", "mcp__playwright__browser_snapshot", "mcp__browser_snapshot", "mcp__playwright__browser_requests"]) {
      expect(isBrowserEvidenceResult({ toolCallId: toolName, toolName, input: {}, outputSummary: "ok", isError: false, at: "x" }), toolName).toBe(false);
    }
  });

  it("accepts only successful Playwright CLI evidence bash results", () => {
    expect(isBrowserEvidenceResult(bash("npx --yes @playwright/cli -s=pe snapshot"))).toBe(true);
    expect(isBrowserEvidenceResult(bash("npx --yes @playwright/cli -s=pe screenshot --filename=.cynos/browser-evidence/a.png"))).toBe(true);
    expect(isBrowserEvidenceResult(bash("npx --yes @playwright/cli -s=pe open http://x"))).toBe(false);
    expect(isBrowserEvidenceResult(bash("npx --yes @playwright/cli -s=pe console", true))).toBe(false);
  });
});

describe("isFailedBrowserAttemptResult", () => {
  it("accepts failed Playwright CLI browser attempts and rejects management/help commands", () => {
    expect(isFailedBrowserAttemptResult(bash("npx --yes @playwright/cli -s=pe open http://x", true))).toBe(true);
    expect(isFailedBrowserAttemptResult(bash("npx --yes @playwright/cli -s=pe goto http://x", true))).toBe(true);
    expect(isFailedBrowserAttemptResult(bash("npx --yes @playwright/cli -s=pe snapshot", true))).toBe(true);
    expect(isFailedBrowserAttemptResult(bash("npx --yes @playwright/cli install-browser chromium", true))).toBe(true);
    expect(isFailedBrowserAttemptResult(bash("npx --yes @playwright/cli --version", true))).toBe(false);
    expect(isFailedBrowserAttemptResult(bash("npx --yes @playwright/cli close-all", true))).toBe(false);
    expect(isFailedBrowserAttemptResult(bash("npx --yes @playwright/cli -s=pe open http://x"))).toBe(false);
    expect(isFailedBrowserAttemptResult({ toolCallId: "mcp", toolName: "mcp__playwright__browser_snapshot", input: {}, outputSummary: "failed", isError: true, at: "x" })).toBe(false);
  });

  it("findFailedBrowserAttempts collects only failed Playwright CLI attempts", () => {
    const results = findFailedBrowserAttempts(work([
      bash("npx --yes @playwright/cli -s=pe open http://x", true),
      bash("npx --yes @playwright/cli -s=pe snapshot", true),
      bash("npx --yes @playwright/cli --version", true),
      bash("npx --yes @playwright/cli -s=pe snapshot"),
    ]));
    expect(results).toHaveLength(2);
  });
});

describe("findBrowserEvidence", () => {
  it("collects Playwright CLI bash evidence, skips MCP tools/errors/management commands", () => {
    const results = findBrowserEvidence(work([
      { toolCallId: "mcp", toolName: "playwright_browser_take_screenshot", input: {}, outputSummary: "ok", isError: false, at: "x" },
      bash("npx --yes @playwright/cli -s=pe snapshot"),
      bash("npx --yes @playwright/cli -s=pe open http://x"),
      bash("npx --yes @playwright/cli -s=pe console", true),
    ]));
    const ids = results.map((r) => r.toolCallId);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toContain("npx --yes @");
  });

  it("returns empty when no browser evidence captured", () => {
    expect(findBrowserEvidence(work([bash("npm run build")]))).toHaveLength(0);
  });
});

describe("path classifiers", () => {
  it("isRootFile distinguishes root files from subdirectory files", () => {
    expect(isRootFile("PROJECT.md", "PROJECT.md")).toBe(true);
    expect(isRootFile("/home/x/proj/PROJECT.md", "PROJECT.md")).toBe(true);
    expect(isRootFile("./PROJECT.md", "PROJECT.md")).toBe(true);
    expect(isRootFile("docs/PROJECT.md", "PROJECT.md")).toBe(false);
    expect(isRootFile("src/PROJECT.md", "PROJECT.md")).toBe(false);
    expect(isRootFile("/home/x/proj/PROJECT.md", "PROJECT.md", "/home/x/proj")).toBe(true);
    expect(isRootFile("/home/x/proj/docs/PROJECT.md", "PROJECT.md", "/home/x/proj")).toBe(false);
    expect(isRootFile("/other/proj/PROJECT.md", "PROJECT.md", "/home/x/proj")).toBe(false);
  });

  it("pathLooksLikeProjectMemory matches PROJECT.md and PROJECT.changes.md", () => {
    expect(pathLooksLikeProjectMemory("PROJECT.md")).toBe(true);
    expect(pathLooksLikeProjectMemory("PROJECT.changes.md")).toBe(true);
    expect(pathLooksLikeProjectMemory("a/b/PROJECT.md")).toBe(true);
    expect(pathLooksLikeProjectMemory("README.md")).toBe(false);
  });

  it("pathLooksLikeUiArtifact matches frontend assets", () => {
    expect(pathLooksLikeUiArtifact("src/App.tsx")).toBe(true);
    expect(pathLooksLikeUiArtifact("components/Button.jsx")).toBe(true);
    expect(pathLooksLikeUiArtifact("styles/main.css")).toBe(true);
    expect(pathLooksLikeUiArtifact("README.md")).toBe(false);
  });

  it("pathLooksLikeStrongUiArtifact narrowly matches UI assets", () => {
    expect(pathLooksLikeStrongUiArtifact("components/Button.tsx")).toBe(true);
    expect(pathLooksLikeStrongUiArtifact("src/lib/math.ts")).toBe(false);
    expect(pathLooksLikeStrongUiArtifact("styles/main.css")).toBe(true);
  });

  it("pathLooksLikeTestAsset matches peer test assets", () => {
    expect(pathLooksLikeTestAsset("tests/e2e/login.spec.ts")).toBe(true);
    expect(pathLooksLikeTestAsset("e2e/smoke.ts")).toBe(true);
    expect(pathLooksLikeTestAsset("tests/unit/add.test.ts")).toBe(true);
    expect(pathLooksLikeTestAsset("src/add.test.ts")).toBe(true);
    expect(pathLooksLikeTestAsset("__tests__/add.ts")).toBe(true);
    expect(pathLooksLikeTestAsset("src/App.tsx")).toBe(false);
  });

  it("isTestExecutionCommand only accepts test runners", () => {
    for (const cmd of ["npm test", "npm run test:smoke", "npm run e2e", "vitest run", "npx playwright test", "pytest", "python -m pytest", "go test ./...", "cargo test", "dotnet test", "mvn test", "gradle test", "make test", "bun test", "./test.sh"]) {
      expect(isTestExecutionCommand(cmd), cmd).toBe(true);
    }
    for (const cmd of ["npm run build", "npx tsc --noEmit", "eslint .", "cargo check", "go vet ./...", "npx playwright test --list", "cat package.json | grep test"]) {
      expect(isTestExecutionCommand(cmd), cmd).toBe(false);
    }
    // Bug 3 Part B: bare <lang> <testfile> is a legitimate way to run standalone test files.
    for (const cmd of ["python3 test_add.py", "python tests/test_calc.py", "python3 test_calc.py", "node tests/x.test.js", "node tests/x.spec.js", "node test_something.js"]) {
      expect(isTestExecutionCommand(cmd), cmd).toBe(true);
    }
    // Hard negative: bare <lang> <non-test-script> must NOT match (over-match guard).
    for (const cmd of ["node random.js", "python3 script.py", "python3 -c \"print(1)\"", "node src/index.js"]) {
      expect(isTestExecutionCommand(cmd), cmd).toBe(false);
    }
  });

  it("shares default/documentation/runtime path classifiers", () => {
    expect(pathLooksLikeDefaultMetadata("README.md")).toBe(false);
    expect(pathLooksLikeDefaultMetadata("docs/notes.rst")).toBe(false);
    expect(pathLooksLikeDefaultMetadata(".gitignore")).toBe(true);
    expect(pathLooksLikeDefaultMetadata("LICENSE")).toBe(true);
    expect(pathLooksLikeDefaultMetadata("package.json")).toBe(false);

    expect(classifyDefaultBoundary(".gitignore")).toMatchObject({ allowed: true, kind: "default-hint" });
    expect(classifyDefaultBoundary(".gitattributes")).toMatchObject({ allowed: true, kind: "unknown-fallback" });
    expect(classifyDefaultBoundary("src/file.ts")).toMatchObject({ allowed: false, targetPractice: "develop" });
    expect(classifyDefaultBoundary("README.md")).toMatchObject({ allowed: false, targetPractice: "docs" });
    expect(classifyDefaultBoundary("docs/release.md")).toMatchObject({ allowed: false, targetPractice: "release" });
    expect(classifyDefaultBoundary(".github/workflows/release.yml")).toMatchObject({ allowed: false, targetPractice: "release" });
    expect(classifyDefaultBoundary("PROJECT.md")).toMatchObject({ allowed: false, targetPractice: "onboard" });
    expect(classifyDefaultBoundary(".npmignore")).toMatchObject({ allowed: false, targetPractice: "develop" });
    expect(classifyDefaultBoundary("src/README.md")).toMatchObject({ allowed: false, targetPractice: "develop" });

    expect(pathAllowedForDocs("README.md")).toBe(true);
    expect(pathAllowedForDocs("docs/notes.rst")).toBe(true);
    expect(pathAllowedForDocs("docs/release.md")).toBe(false);
    expect(pathAllowedForDocs("LICENSE")).toBe(false);
    expect(pathAllowedForDocs(".env.example")).toBe(true);

    const cwd = "/tmp/project";
    expect(toProjectRelativePath("/tmp/project/.gitignore", cwd)).toBe(".gitignore");
    expect(pathLooksLikeDefaultMetadata("/tmp/project/.gitignore", cwd)).toBe(true);
    expect(pathLooksLikeDefaultMetadata("/tmp/project/.editorconfig", cwd)).toBe(true);
    expect(pathLooksLikeDefaultMetadata("/tmp/project/LICENSE", cwd)).toBe(true);
    expect(pathLooksLikeDefaultMetadata("/tmp/project/docs/LICENSE", cwd)).toBe(false);
    expect(pathAllowedForDocs("/tmp/project/README.md", cwd)).toBe(true);
    expect(pathAllowedForDocs("/tmp/project/docs/notes.rst", cwd)).toBe(true);
    expect(pathAllowedForDocs("/tmp/project/.env.example", cwd)).toBe(true);
    expect(pathAllowedForDocs("/tmp/project/LICENSE", cwd)).toBe(false);
    expect(pathAllowedForDocs("/tmp/project/package.json", cwd)).toBe(false);

    expect(pathAllowedForTest("tests/add.test.ts")).toBe(true);
    expect(pathAllowedForTest(".cynos/tmp/result.json")).toBe(true);
    expect(pathAllowedForTest("/tmp/project/src/add.test.ts", cwd)).toBe(true);
    expect(pathAllowedForTest("src/add.ts")).toBe(false);
    expect(pathAllowedForTest("docs/smoke-report.md")).toBe(false);
    expect(pathAllowedForTest("playwright.config.ts")).toBe(false);
    expect(pathAllowedForTest("vitest.config.ts")).toBe(false);

    expect(pathLooksLikeDocumentationAsset("docs/guide.md")).toBe(true);
    expect(pathLooksLikeDocumentationAsset("AGENT.md")).toBe(true);
    expect(pathLooksLikeDocumentationAsset(".env.example")).toBe(true);
    expect(pathLooksLikeDocumentationAsset("src/file.ts")).toBe(false);

    expect(pathLooksLikeRuntimeConfig(".github/workflows/ci.yml")).toBe(true);
    expect(pathLooksLikeRuntimeConfig("Dockerfile")).toBe(true);
    expect(pathLooksLikeRuntimeConfig("deploy/k8s/app.yaml")).toBe(true);
    expect(pathLooksLikeRuntimeConfig("terraform/main.tf")).toBe(true);
    expect(pathLooksLikeRuntimeConfig("nginx.conf")).toBe(true);
    expect(pathLooksLikeRuntimeConfig(".env")).toBe(true);
    expect(pathLooksLikeRuntimeConfig(".env.local")).toBe(true);
    expect(pathLooksLikeRuntimeConfig(".env.example")).toBe(false);

    expect(pathLooksLikeSourceOrTest("src/file.ts")).toBe(true);
    expect(pathLooksLikeSourceOrTest("tests/file.test.ts")).toBe(true);
    expect(pathLooksLikeSourceOrTest("docs/guide.md")).toBe(false);
  });
  it("detects project mutation targets from tools and bash", () => {
    const cwd = "/tmp/project";
    expect(detectProjectMutationTargets(cwd, "write", { path: "src/hello.ts" })).toMatchObject([{ path: "src/hello.ts", kind: "tool-write" }]);
    expect(detectProjectMutationTargets(cwd, "edit", { path: "README.md" })).toMatchObject([{ path: "README.md", kind: "tool-edit" }]);
    expect(detectProjectMutationTargets(cwd, "bash", { command: "echo x > src/hello.ts" })[0]).toMatchObject({ path: "src/hello.ts", kind: "redirect-write" });
    expect(detectProjectMutationTargets(cwd, "bash", { command: "cat > docs/x.md" })[0]).toMatchObject({ path: "docs/x.md", kind: "redirect-write" });
    expect(detectProjectMutationTargets(cwd, "bash", { command: "echo x | tee README.md" })[0]).toMatchObject({ path: "README.md", kind: "tee-write" });
    expect(detectProjectMutationTargets(cwd, "bash", { command: "cp /tmp/a package.json" })[0]).toMatchObject({ path: "package.json", kind: "copy-write" });
    expect(detectProjectMutationTargets(cwd, "bash", { command: "mv README.md docs/README.md" }).map((target) => target.kind)).toContain("move");
    expect(detectProjectMutationTargets(cwd, "bash", { command: "rm src/old.ts" })[0]).toMatchObject({ path: "src/old.ts", kind: "delete" });
    expect(detectProjectMutationTargets(cwd, "bash", { command: "git rm src/old.ts" })[0]).toMatchObject({ path: "src/old.ts", kind: "delete" });
    for (const command of [
      "git check-ignore -v build/",
      "git ls-files",
      "git show HEAD:README.md",
      "git blame README.md",
      "git remote -v",
      "git remote show origin",
      "git rev-parse HEAD",
      "git describe --tags",
      "git branch --list feature/*",
      "git tag --list",
      "git tag -l 'v*'",
      "git tag --list 'v*'",
      "git tag -l 'v*' 'w*'",
      "git tag",
      "git tag -l --sort=v:refname",
    ]) {
      expect(detectProjectMutationTargets(cwd, "bash", { command }), command).toEqual([]);
    }
    for (const command of [
      "git add .",
      "git checkout -- src/app.ts",
      "git reset --hard HEAD",
      "git branch new-feature",
      "git branch -D old-feature",
      "git tag v1.2.3",
      "git tag -d v1",
      "git tag -a v1 -m msg",
      "git remote add origin git@example.com:x/y.git",
      "git stash push",
    ]) {
      expect(detectProjectMutationTargets(cwd, "bash", { command })[0], command).toMatchObject({ path: ".", kind: "git-mutation" });
    }
    expect(detectProjectMutationTargets(cwd, "bash", { command: "touch src/new.ts" })[0]).toMatchObject({ path: "src/new.ts", kind: "touch" });
    expect(detectProjectMutationTargets(cwd, "bash", { command: "mkdir docs/new" })[0]).toMatchObject({ path: "docs/new", kind: "mkdir" });
    expect(detectProjectMutationTargets(cwd, "write", { path: "/tmp/x.ts" })).toEqual([]);
  });
});

describe("path evidence helpers", () => {
  it("isOutsideProjectPath classifies ~ and absolute-external as outside", () => {
    // isOutsideProjectPath is retained for init's findFirstInitScaffoldWrite to determine 'whether project files were touched'.
    const home = process.env.HOME ?? "";
    const absolute = `${home}/.pi/agent/settings.json`;
    expect(isOutsideProjectPath("~/.pi/agent/settings.json", "/tmp/project")).toBe(true);
    expect(isOutsideProjectPath(absolute, "/tmp/project")).toBe(true);
    expect(isOutsideProjectPath("src/hello.ts", "/tmp/project")).toBe(false);
  });

  it("in-project absolute and relative paths match", () => {
    const w = { ...work([
      { toolCallId: "edit", toolName: "edit", input: { path: "/tmp/project/src/hello.ts" }, outputSummary: "edited", isError: false, at: "x" },
    ]), cwd: "/tmp/project" };
    expect(findWriteEditForPath(w, "src/hello.ts")?.toolCallId).toBe("edit");
  });

  it("rm/mv evidence uses path boundaries, not substring", () => {
    // src/foo should NOT be hit by `rm -rf src/foobar`; but `rm -rf src/foo` and `rm -rf src/foo/` should hit.
    const cwd = "/tmp/project";
    const wBar = { ...work([
      { toolCallId: "rm", toolName: "bash", input: { command: "rm -rf src/foobar" }, outputSummary: "ok", isError: false, at: "x" },
    ]), cwd };
    expect(findDeleteMoveEvidenceForPath(wBar, "src/foo")).toBeUndefined();
    const wFoo = { ...work([
      { toolCallId: "rm", toolName: "bash", input: { command: "rm -rf src/foo" }, outputSummary: "ok", isError: false, at: "x" },
    ]), cwd };
    expect(findDeleteMoveEvidenceForPath(wFoo, "src/foo")?.toolCallId).toBe("rm");
    const wDir = { ...work([
      { toolCallId: "rm", toolName: "bash", input: { command: "rm -rf src/foo/" }, outputSummary: "ok", isError: false, at: "x" },
    ]), cwd };
    expect(findDeleteMoveEvidenceForPath(wDir, "src/foo")?.toolCallId).toBe("rm");
  });

  it("bash read/delete evidence matches ./-prefixed paths", () => {
    // `cat ./docs/testing.md` / `rm -rf ./src/foo` should match declarations without ./.
    const cwd = "/tmp/project";
    const wCat = { ...work([
      { toolCallId: "c", toolName: "bash", input: { command: "cat ./docs/testing.md" }, outputSummary: "ok", isError: false, at: "x" },
    ]), cwd };
    expect(findReadEvidenceForPath(wCat, "docs/testing.md")?.toolCallId).toBe("c");
    const wRm = { ...work([
      { toolCallId: "r", toolName: "bash", input: { command: "rm -rf ./src/foo" }, outputSummary: "ok", isError: false, at: "x" },
    ]), cwd };
    expect(findDeleteMoveEvidenceForPath(wRm, "src/foo")?.toolCallId).toBe("r");
  });
});

describe("command classifiers", () => {
  it("matches release side-effect commands without matching read-only deploy mentions", () => {
    expect(isReleaseSideEffectCommand("git push origin main")).toBe(true);
    expect(isReleaseSideEffectCommand("git tag v1.0.0")).toBe(true);
    expect(isReleaseSideEffectCommand("git tag -l")).toBe(false);
    expect(isReleaseSideEffectCommand("git tag --list")).toBe(false);
    expect(isReleaseSideEffectCommand("npm publish")).toBe(true);
    expect(isReleaseSideEffectCommand("npm publish --dry-run")).toBe(false);
    expect(isReleaseSideEffectCommand("fly deploy")).toBe(true);
    expect(isReleaseSideEffectCommand("cat docs/deploy.md")).toBe(false);
    expect(isReleaseSideEffectCommand("grep deploy README.md")).toBe(false);
    expect(isReleaseSideEffectCommand("git log --grep=deploy")).toBe(false);
  });

  it("classifies release side-effect operations from compound commands", () => {
    expect(classifyReleaseSideEffectCommand("git tag v1.2.3 && git push origin main --tags")).toEqual(["tag", "push"]);
    expect(classifyReleaseSideEffectCommand("npm publish && gh release create v1.2.3")).toEqual(["npm-publish", "github-release"]);
    expect(classifyReleaseSideEffectCommand("gh workflow run release.yml")).toEqual(["ci-trigger"]);
    expect(classifyReleaseSideEffectCommand("npm publish --dry-run")).toEqual([]);
  });

  it("matches git status and commit commands", () => {
    expect(isGitStatusCommand("git status --short")).toBe(true);
    expect(isGitCommitCommand("git commit -m 'x'")).toBe(true);
    expect(isGitCommitCommand("git add tests/x.test.ts && git commit -m 'x'")).toBe(true);
    expect(isGitCommitCommand("git log --oneline")).toBe(false);
  });
});

describe("evaluateActiveWorkScope — default ownership boundary", () => {
  const cwd = "/proj";
  const defaultWork = { practice: "default", status: "active", cwd } as unknown as WorkState;

  it("allows default metadata and unknown fallback mutations", () => {
    expect(evaluateActiveWorkScope(cwd, defaultWork, "write", { path: ".gitignore", content: "dist/" }).block).toBe(false);
    expect(evaluateActiveWorkScope(cwd, defaultWork, "write", { path: ".gitattributes", content: "* text=auto" }).block).toBe(false);
    expect(evaluateActiveWorkScope(cwd, defaultWork, "bash", { command: "echo 'Jane <jane@example.com>' > .mailmap" }).block).toBe(false);
  });

  it("blocks clearly owned paths during default", () => {
    for (const [toolName, input] of [
      ["write", { path: "src/app.ts", content: "x" }],
      ["write", { path: "README.md", content: "x" }],
      ["write", { path: "tests/app.test.ts", content: "x" }],
      ["write", { path: "package.json", content: "{}" }],
      ["write", { path: "docs/release.md", content: "x" }],
      ["write", { path: "PROJECT.md", content: "x" }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(evaluateActiveWorkScope(cwd, defaultWork, toolName, input).block, JSON.stringify(input)).toBe(true);
    }
  });
});

describe("evaluateActiveWorkScope — test finalization", () => {
  const cwd = "/proj";
  const testWork = { practice: "test", status: "active", cwd } as unknown as WorkState;

  it("allows scoped local git add and commit after staged test-asset proof", () => {
    for (const command of [
      "git add tests/add.test.js",
      "git add -- tests/add.test.js tests/sub.spec.js",
    ]) {
      expect(evaluateActiveWorkScope(cwd, testWork, "bash", { command }).block, command).toBe(false);
    }

    const workWithStagedProof = { ...testWork, capturedToolResults: [bash("git diff --cached --name-only", false, "tests/add.test.js")] } as unknown as WorkState;
    for (const command of [
      "git commit -m 'test: add unit tests'",
      "git commit -m 'test(add): add unit tests'",
    ]) {
      expect(evaluateActiveWorkScope(cwd, workWithStagedProof, "bash", { command }).block, command).toBe(false);
    }
  });

  it("blocks broad, out-of-scope, or unsafe git mutations during test", () => {
    const workWithSourceStaged = { ...testWork, capturedToolResults: [bash("git diff --cached --name-only", false, "tests/add.test.js\nsrc/add.js")] } as unknown as WorkState;
    for (const [command, scopedWork] of [
      ["git add .", testWork],
      ["git add -A", testWork],
      ["git add -p tests/add.test.js", testWork],
      ["git add src/add.js", testWork],
      ["git commit -m 'commit unknown staged changes'", testWork],
      ["git add tests/add.test.js && git commit -m 'commit without staged proof'", testWork],
      ["git commit -am 'commit tracked changes'", testWork],
      ["git commit --amend -m 'rewrite history'", workWithSourceStaged],
      ["git commit --allow-empty -m 'empty'", workWithSourceStaged],
      ["git commit --no-verify -m 'bypass hooks'", workWithSourceStaged],
      ["git commit -m 'commit source too'", workWithSourceStaged],
      ["git push origin main", testWork],
      ["git tag v1.2.3", testWork],
      ["git checkout src/add.js", testWork],
    ] as Array<[string, WorkState]>) {
      expect(evaluateActiveWorkScope(cwd, scopedWork, "bash", { command }).block, command).toBe(true);
    }
  });
});

describe("evaluateActiveWorkScope — review branch", () => {
  const cwd = "/proj";
  const reviewWork = { practice: "review", status: "active", cwd } as unknown as WorkState;

  it("blocks write/edit during review", () => {
    expect(evaluateActiveWorkScope(cwd, reviewWork, "write", { path: "src/app.ts", content: "x" }).block).toBe(true);
    expect(evaluateActiveWorkScope(cwd, reviewWork, "edit", { path: "src/app.ts" }).block).toBe(true);
  });

  it("blocks bash mutations during review (sed -i / echo > / rm / npm install / git checkout)", () => {
    for (const command of ["sed -i 's/a/b/' src/app.ts", "echo x > src/app.ts", "rm src/old.ts", "npm install lodash", "git checkout src/app.ts"]) {
      const r = evaluateActiveWorkScope(cwd, reviewWork, "bash", { command });
      expect(r.block, command).toBe(true);
    }
  });

  it("allows read-only git and read tools during review (no false positive)", () => {
    for (const command of ["git status", "git diff", "git show HEAD", "git log -1"]) {
      expect(evaluateActiveWorkScope(cwd, reviewWork, "bash", { command }).block, command).toBe(false);
    }
    expect(evaluateActiveWorkScope(cwd, reviewWork, "read", { path: "src/app.ts" }).block).toBe(false);
  });
});

describe("cleanVerificationResult", () => {
  // Bug 2: a bare /Error:\s/ substring match false-positived on code-under-test printing "*Error:"
  // messages (ValueError:/TypeError:/CustomError:) on passing error-path assertions, causing a
  // gate-level downgrade (selector skipped the full error-path run for a weaker import-only check).
  const ok = (output: string) => cleanVerificationResult({ outputSummary: output, input: { command: "x" } }).ok;

  it("accepts error-path assertion output containing *Error: as a substring (exit-0 command)", () => {
    // These are SUCCESSFUL verifications that assert a function raises; the printed error is the
    // expected behavior, not a command failure. Must be ok: true.
    expect(ok("✓ add(1,2)=3\n✓ ValueError: a must be a number, got str\n✓ ValueError: b must be a number")).toBe(true);
    expect(ok("TypeError: cannot read property of undefined (asserted)")).toBe(true);
    expect(ok("caught CustomError: bad input — as expected")).toBe(true);
  });

  it("rejects real crash signatures: start-of-line Error:, Traceback, JS stack frame", () => {
    expect(ok("Error: Cannot find module 'foo'\n    at Object.<anonymous>")).toBe(false);
    expect(ok("Traceback (most recent call last):\n  File \"x.py\", line 1")).toBe(false);
    expect(ok("\n    at Object.<anonymous> (x.js:3:5)\n    at main")).toBe(false);
  });

  it("rejects the other specific failure signatures", () => {
    expect(ok("TEST FAILED in add")).toBe(false);
    expect(ok("FAIL: expected 2 got 3")).toBe(false);
    expect(ok("npm ERR! Test failed")).toBe(false);
    expect(ok("EADDRINUSE: address already in use")).toBe(false);
    expect(ok("command not found: pytest")).toBe(false);
    expect(ok("EXIT: 1")).toBe(false);
  });

  it("accepts clean success output", () => {
    expect(ok("import OK\nadd(1,2)= 3")).toBe(true);
    expect(ok("ok\n3 tests passed")).toBe(true);
    expect(ok("")).toBe(true);
  });
});

describe("commandMasksExitCodeWithEcho", () => {
  const m = commandMasksExitCodeWithEcho;
  it("matches a trailing echo that contains $?", () => {
    expect(m('npm test; echo "exit:$?"')).toBe(true);
    expect(m('npm test; echo "---EXIT:$?---"')).toBe(true);
    expect(m('npm test; echo "RED_EXIT:$?"')).toBe(true);
    expect(m('echo "code:$?"')).toBe(true);  // whole-command echo
  });
  it("does NOT match a non-trailing echo (only a trailing echo swallows the exit)", () => {
    expect(m('echo "start"; npm test')).toBe(false);   // npm test is last; its exit applies
    expect(m('npm test')).toBe(false);
    expect(m('npm test && npm run build')).toBe(false);
    expect(m('echo "hello world"')).toBe(false);        // no $?
  });
});

describe("bashLooksFailedDespiteSuccess + echo-masked red detection (Bug 2-followup, real B1 fixture)", () => {
  // Fixtures taken verbatim from b1-archive.json (develop-fixes-retest run) — the real failure
  // mode where the agent appended `; echo "...:$?"`, making isError=false and hiding the red.
  const maskedRedCmd = 'cd /tmp/x && npm test; echo "RED_EXIT:$?"';
  const maskedRedOut = '> test\n> node tests/x.test.js\n\n  FAIL: greet() returns "hello, guest" \u2014 got "hello, undefined"\n  3 test(s) failed\nRED_EXIT:1';
  const maskedGreenCmd = 'cd /tmp/x && npm test; echo "---EXIT:$?---"';
  const maskedGreenOut = '> test\n> node tests/x.test.js\n\n  all tests passed\n---EXIT:0---';

  const bash = (command: string, outputSummary: string, isError = false): CapturedToolResult =>
    ({ toolCallId: "t", toolName: "bash", input: { command }, outputSummary, isError, at: "2026-01-01T00:00:00.000Z" });

  it("recognizes a masked red (isError=false) via FAIL signature AND echoed exit code", () => {
    expect(bashLooksFailedDespiteSuccess(bash(maskedRedCmd, maskedRedOut))).toBe(true);
  });
  it("does NOT recognize a masked green (exit 0, no FAIL)", () => {
    expect(bashLooksFailedDespiteSuccess(bash(maskedGreenCmd, maskedGreenOut))).toBe(false);
  });
  it("recognizes a masked red even with NO echoed exit code (FAIL is the primary signal)", () => {
    // Proves the detector doesn't depend on the exit-code marker (which can be truncated).
    expect(bashLooksFailedDespiteSuccess(bash('npm test; echo "x:$?"', "FAIL: expected 2 got 3"))).toBe(true);
  });
  it("does NOT treat a non-masked command as failed-despite-success", () => {
    // commandMasksExitCodeWithEcho is the gate; bare npm test (no echo) is not seen-through here.
    expect(bashLooksFailedDespiteSuccess(bash('npm test', "FAIL: x"))).toBe(false);
  });
  it("does NOT false-positive on ValueError: in a passing error-path assertion (Error: anchored)", () => {
    // Bug 2 symmetry: bare /Error:/ would match "ValueError:"; the anchored ^Error:\s/m does not.
    expect(bashLooksFailedDespiteSuccess(bash('python3 -c x; echo "e:$?"', "caught ValueError: bad input (ok)"))).toBe(false);
  });

  it("findFailedVerificationBash sees through the masked red (develop TDD path)", () => {
    const work = { capturedToolResults: [bash(maskedGreenCmd, maskedGreenOut), bash(maskedRedCmd, maskedRedOut)] } as any;
    const found = findFailedVerificationBash(work);
    expect(found?.input.command).toBe(maskedRedCmd);
  });
  it("findFailedBash sees through the masked red for verification/test commands (debug path)", () => {
    const work = { capturedToolResults: [bash(maskedRedCmd, maskedRedOut)] } as any;
    expect(findFailedBash(work)?.input.command).toBe(maskedRedCmd);
  });
  it("findFailedBash does NOT see through masked non-test commands (debug false-positive guard)", () => {
    // A stray "FAIL" substring in an unrelated command's output must not count as a reproduction red.
    const work = { capturedToolResults: [bash('ls FAILED.log; echo "c:$?"', "FAILED.log\nc:0")] } as any;
    expect(findFailedBash(work)).toBeUndefined();
  });
});

describe("findSuccessfulVerificationBash — rejects echo-masked pseudo-greens (cleanVerificationResult gate)", () => {
  it("finds a clean green (normal path unaffected)", () => {
    const work = { capturedToolResults: [bash("npm test", false, "PASS: 5 tests")] } as any;
    expect(findSuccessfulVerificationBash(work)?.input.command).toBe("npm test");
  });
  it("rejects echo-masked FAILURE when output has FAIL signals (pseudo-green)", () => {
    // npm test; echo "exit:1" → isError=false (echo masks the exit), but output includes FAIL
    const work = { capturedToolResults: [
      bash('npm test; echo "exit: $?"', false, "FAIL: expected 2 got 3\nexit:1"),
    ] } as any;
    expect(findSuccessfulVerificationBash(work)).toBeUndefined();
  });
  it("rejects echo-masked FAILURE with stack trace signals (pseudo-green)", () => {
    const work = { capturedToolResults: [
      bash('node tests/x.test.js; echo "EXIT:$?"', false, "Error: x is not defined\n    at Object.<anonymous> (/app/test.js:3:1)"),
    ] } as any;
    expect(findSuccessfulVerificationBash(work)).toBeUndefined();
  });
  it("rejects echo-masked FAILURE with npm ERR! (pseudo-green)", () => {
    const work = { capturedToolResults: [
      bash('npm test; echo "exit:$?"', false, "npm ERR! Test failed"),
    ] } as any;
    expect(findSuccessfulVerificationBash(work)).toBeUndefined();
  });
  it("selects a clean green over an earlier pseudo-green in the array", () => {
    // First result is echo-masked pseudo-green, second is a clean re-run
    const work = { capturedToolResults: [
      bash('npm test; echo "exit: $?"', false, "FAIL: bug\nexit:1"),
      bash("npm test", false, "ok"),
    ] } as any;
    const found = findSuccessfulVerificationBash(work);
    expect(found?.input.command).toBe("npm test");
  });
  it("finds a masked green when the underlying test genuinely passes", () => {
    // Test passed, echo "exit:0" — output is clean, isError=false — legit green
    const work = { capturedToolResults: [
      bash('npm test; echo "exit: $?"', false, "ok\nexit:0"),
    ] } as any;
    expect(findSuccessfulVerificationBash(work)?.input.command).toContain("npm test");
  });
});

describe("isTestOrVerificationCommand (unified, Problem 1+2)", () => {
  it("recognizes runners (both halves)", () => {
    for (const cmd of ["npm test", "pytest", "cargo test", "go test", "vitest", "mvn test"]) {
      expect(isTestOrVerificationCommand(cmd), cmd).toBe(true);
    }
  });
  it("recognizes bare <lang> <testfile> (the friction fix)", () => {
    for (const cmd of ["node tests/x.test.js", "node tests/x.spec.js", "node test_something.js", "python3 test_add.py", "python3 tests/test_calc.py", "python3 x_test.py"]) {
      expect(isTestOrVerificationCommand(cmd), cmd).toBe(true);
    }
  });
  it("recognizes the new script-language stacks (ruby/php/lua)", () => {
    for (const cmd of ["ruby test/foo_test.rb", "ruby test_test.rb", "ruby spec/foo_spec.rb", "php tests/FooTest.php", "lua test/foo_spec.lua", "lua test_test.lua"]) {
      expect(isTestOrVerificationCommand(cmd), cmd).toBe(true);
    }
  });
  it("hard negatives — non-test scripts must NOT match (over-match guard)", () => {
    for (const cmd of ["node random.js", "node src/index.js", "python3 script.py", "ruby app.rb", "php index.php", "lua script.lua", "python3 -c \"print(1)\""]) {
      expect(isTestOrVerificationCommand(cmd), cmd).toBe(false);
    }
  });
  it("still recognizes verification-only commands (lint/type-check/build) — the unified function is wider than test-only", () => {
    // Class C (isTestExecutionCommand) does NOT match these; the unified function DOES.
    // This is why Class C callers must keep isTestExecutionCommand, not the unified one.
    for (const cmd of ["npm run lint", "npx tsc --noEmit", "cargo check", "npm run build"]) {
      expect(isTestOrVerificationCommand(cmd), cmd).toBe(true);
    }
  });
});

describe("findSuspectedUnrecognizedCommands (Problem 3 diagnostic)", () => {
  const bash = (command: string, outputSummary = "", isError = false): CapturedToolResult =>
    ({ toolCallId: command, toolName: "bash", input: { command }, outputSummary, isError, at: "2026-01-01T00:00:00.000Z" });

  it("an UNRECOGNIZED verification-looking command appears as suspected", () => {
    // npm run my-custom-check is not in any pattern list, but looksLikeVerify matches 'check'.
    const work = { capturedToolResults: [bash("npm run my-custom-check", "all checks passed")] } as unknown as WorkState;
    const suspected = findSuspectedUnrecognizedCommands(work, { isSuccess: true });
    expect(suspected).toHaveLength(1);
    expect(suspected[0].input.command).toBe("npm run my-custom-check");
  });

  it("a RECOGNIZED command does NOT appear as suspected (consistency with Problem 1)", () => {
    // node tests/x.test.js is now recognized by the unified function (Problem 1) — must NOT be flagged.
    const work = { capturedToolResults: [bash("node tests/x.test.js", "all tests passed")] } as unknown as WorkState;
    expect(findSuspectedUnrecognizedCommands(work, { isSuccess: true })).toHaveLength(0);
    // npm test is recognized too.
    const work2 = { capturedToolResults: [bash("npm test", "ok")] } as unknown as WorkState;
    expect(findSuspectedUnrecognizedCommands(work2, { isSuccess: true })).toHaveLength(0);
  });

  it("read-only shells referencing verification keywords are excluded", () => {
    // cat package.json | grep test — looksLikeVerify hits 'test', but isLikelyReadOnlyOrWriteOnlyShell excludes it.
    const work = { capturedToolResults: [bash("cat package.json | grep test", "\"test\""    )] } as unknown as WorkState;
    expect(findSuspectedUnrecognizedCommands(work, { isSuccess: true })).toHaveLength(0);
  });

  it("isSuccess:true only includes non-errored bash; isSuccess:false is scaffolding (not wired here)", () => {
    // The isSuccess:false branch exists for the Follow-up; verify isSuccess:true excludes errored bash.
    const work = { capturedToolResults: [bash("npm run my-check", "", true)] } as unknown as WorkState;
    expect(findSuspectedUnrecognizedCommands(work, { isSuccess: true })).toHaveLength(0);
  });
});

describe("Problem 1 friction fix — findFailedVerificationBash sees bare-testfile masked red (real Run 3 fixture)", () => {
  // Real fixture from smoke run 20260701011637-develop-echo-followup-retest run3-archive.json idx=4:
  // the exact command that took 4 rejections pre-fix because isVerificationCommand missed it.
  const maskedRedCmd = 'node tests/greet.test.js; echo "EXIT: $?"';
  const maskedRedOut = 'FAIL: greet with empty string\n3 test(s) failed\nEXIT: 1';
  const bash = (command: string, outputSummary: string, isError = false): CapturedToolResult =>
    ({ toolCallId: command, toolName: "bash", input: { command }, outputSummary, isError, at: "2026-01-01T00:00:00.000Z" });

  it("findFailedVerificationBash now finds the bare-testfile masked red (was NONE pre-fix)", () => {
    const work = { capturedToolResults: [bash(maskedRedCmd, maskedRedOut)] } as unknown as WorkState;
    expect(findFailedVerificationBash(work)?.input.command).toBe(maskedRedCmd);
  });
});
