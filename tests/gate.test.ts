import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askUser, startWork } from "../extensions/core/state";
import { evaluateProtocolGate } from "../extensions/hooks";
import { evaluateNoWorkMutation } from "../extensions/practices/no-work-gate";

let tmp = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cynos-gate-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("protocol gate tool naming", () => {
  it("current cynos_* work tools use the cynos_ prefix", () => {
    const cynosTools = [
      "cynos_start_work",
      "cynos_work_status",
      "cynos_check_completion",
      "cynos_ask_user",
      "cynos_resume_work",
      "cynos_abandon_work",
      "cynos_search",
      "cynos_fetch",
      "cynos_subagent",
    ];
    for (const name of cynosTools) expect(name.startsWith("cynos_")).toBe(true);
  });

  it("cynos_* work-lifecycle tools pass the no-work gate (regression for the pe_→cynos_ rename)", () => {
    // Every registered cynos_* tool must be callable without an active work.
    // none of them is a raw write/edit/bash; project mutations are caught separately
    // by detectProjectMutationTargets. If a rename forgets this prefix bypass again,
    // this test fails. Keep this list in sync with the registered cynos_* tools.
    const cynosLifecycleTools = [
      "cynos_start_work",
      "cynos_work_status",
      "cynos_check_completion",
      "cynos_ask_user",
      "cynos_resume_work",
      "cynos_abandon_work",
      "cynos_search",
      "cynos_fetch",
      "cynos_subagent",
    ];
    for (const name of cynosLifecycleTools) {
      const decision = evaluateNoWorkMutation(tmp, name, {});
      expect(decision.block, name).toBe(false);
    }
  });

  it("read-only tools are represented as plain tool names", () => {
    expect(["read", "grep", "find", "ls", "bash"]).toContain("read");
  });

  it("blocks write to project content when no active work exists", async () => {
    const decision = await evaluateProtocolGate(tmp, "write", { path: "src/index.ts" });
    expect(decision.block).toBe(true);
    if (!decision.block) throw new Error("expected block");
    expect(decision.reason).toContain("src/index.ts");
    expect(decision.message).toContain("project file mutation");
    expect(decision.message).toContain("cynos_start_work");
  });

  it("allows read-only exploration when no active work exists", async () => {
    for (const command of ["git status", "git check-ignore -v build/", "git ls-files", "git show HEAD", "git remote -v", "git branch --list", "git tag --list"]) {
      const decision = await evaluateProtocolGate(tmp, "bash", { command });
      expect(decision.block, command).toBe(false);
    }
  });

  it("allows build/test/lint and exploration commands when no active work exists (blacklist posture)", async () => {
    // Without an active work, no narrow allowlist is used; pipes, echo, and background & are not blocked, as long as it is not "mutating project content / commit / release".
    for (const command of [
      "find . -type f | head",
      "echo hello",
      "cat README.md & echo pwned",
      "npm test",
      "go build ./...",
      "cargo check",
      "pytest",
      "ls -la",
    ]) {
      const decision = await evaluateProtocolGate(tmp, "bash", { command });
      expect(decision.block, command).toBe(false);
    }
  });

  it("blocks project-internal write/edit but allows project-external paths", async () => {
    const pkg = await evaluateProtocolGate(tmp, "edit", { path: "package.json" });
    expect(pkg.block).toBe(true);
    if (pkg.block) expect(pkg.message).toContain("develop");
    const src = await evaluateProtocolGate(tmp, "write", { path: "src/app.ts" });
    expect(src.block).toBe(true);
    if (src.block) expect(src.message).toContain("develop");
    expect((await evaluateProtocolGate(tmp, "edit", { path: ".github/workflows/ci.yml" })).block).toBe(true);
    expect((await evaluateProtocolGate(tmp, "write", { path: "pyproject.toml" })).block).toBe(true);
    const testAsset = await evaluateProtocolGate(tmp, "write", { path: "tests/add.test.ts" });
    expect(testAsset.block).toBe(true);
    if (testAsset.block) expect(testAsset.message).toContain("test");
    const notes = await evaluateProtocolGate(tmp, "write", { path: "NOTES.md" });
    expect(notes.block).toBe(true);
    if (notes.block) expect(notes.message).toContain("docs");
    const gitignore = await evaluateProtocolGate(tmp, "write", { path: ".gitignore" });
    expect(gitignore.block).toBe(true);
    if (gitignore.block) expect(gitignore.message).toContain("default");
    expect((await evaluateProtocolGate(tmp, "write", { path: "/tmp/scratch.txt" })).block).toBe(false);
    expect((await evaluateProtocolGate(tmp, "write", { path: path.join(os.homedir(), ".pi", "note.txt") })).block).toBe(false);
  });

  it("blocks redirect/tee/cp/sed writes to project content but allows fd-merge, /dev/null, project-external, build logs", async () => {
    // P0 regression: redirects writing project content are blocked
    for (const command of [
      'echo "x" > src/test.ts',
      'echo "x" >> src/app.ts',
      'go build ./... > src/gen.ts',
      'cargo build > src/out',
      'echo x | tee src/f',
      'sed -i s/a/b/ config.yml',
      'cp /tmp/a src/b.ts',
    ]) {
      expect((await evaluateProtocolGate(tmp, "bash", { command })).block, command).toBe(true);
    }
    // P1 regression + proposition: fd merging / /dev/null / project-external / non-project-content files are allowed
    for (const command of [
      "npx tsc --noEmit 2>&1",
      "npm test 2>&1 | head",
      "ruff check . 2>&1",
      "cmd 2> /dev/null",
      "go build ./... > /tmp/build.log",
      "echo x > /tmp/scratch.ts",
      "echo x | tee /tmp/x.log",
      "pytest 2>&1 | tee /tmp/pytest.log",
      "node script.js > /tmp/out.log",
      "cp /tmp/a /tmp/b",
    ]) {
      expect((await evaluateProtocolGate(tmp, "bash", { command })).block, command).toBe(false);
    }
  });

  it("blocks commit and project-mutating bash (deps / git write / rm / redirect) when no active work exists", async () => {
    for (const command of [
      "git commit -m x",
      "git push origin main",
      "git add .",
      "npm install",
      "pip install requests",
      "go get example.com/pkg",
      "rm src/old.ts",
      "echo x > src/app.ts",
      "sed -i s/a/b/ config.yml",
    ]) {
      const decision = await evaluateProtocolGate(tmp, "bash", { command });
      expect(decision.block, command).toBe(true);
      if (!decision.block) throw new Error(`expected block for ${command}`);
      expect(decision.message, command).toContain("Cynos no-work gate");
    }
  });

  it("blocks release side-effect commands outside release practice but allows read-only deploy mentions", async () => {
    await startWork(tmp, { practice: "develop", objective: "change", acceptanceCriteria: ["safe"] });
    expect((await evaluateProtocolGate(tmp, "bash", { command: "git push origin main" })).block).toBe(true);
    expect((await evaluateProtocolGate(tmp, "bash", { command: "cat docs/deploy.md" })).block).toBe(false);
  });

  it("allows release side-effect commands in release practice", async () => {
    await startWork(tmp, { practice: "release", objective: "ship", acceptanceCriteria: ["pushed"] });
    expect((await evaluateProtocolGate(tmp, "bash", { command: "git push origin main" })).block).toBe(false);
  });

  it("blocks mutating and finishing tools while waiting-for-user", async () => {
    await startWork(tmp, { practice: "develop", objective: "wait", acceptanceCriteria: ["answer"] });
    await askUser(tmp, "Confirm the plan?");

    expect((await evaluateProtocolGate(tmp, "edit", { path: "src/a.ts" })).block).toBe(true);
    expect((await evaluateProtocolGate(tmp, "cynos_check_completion", {})).block).toBe(true);
    expect((await evaluateProtocolGate(tmp, "cynos_resume_work", { answerSummary: "ok" })).block).toBe(false);
    expect((await evaluateProtocolGate(tmp, "read", { path: "PROJECT.md" })).block).toBe(false);
  });

  it("guards active default scope before project mutations", async () => {
    await startWork(tmp, { practice: "default", objective: "metadata", acceptanceCriteria: ["safe"] });
    expect((await evaluateProtocolGate(tmp, "write", { path: ".gitignore" })).block).toBe(false);
    expect((await evaluateProtocolGate(tmp, "write", { path: `${tmp}/.gitignore` })).block).toBe(false);
    expect((await evaluateProtocolGate(tmp, "bash", { command: "git check-ignore -v build/" })).block).toBe(false);
    const code = await evaluateProtocolGate(tmp, "write", { path: "src/hello.ts" });
    expect(code.block).toBe(true);
    if (code.block) {
      expect(code.message).toContain("develop");
      expect(code.message).toContain("cynos_abandon_work");
    }
    expect((await evaluateProtocolGate(tmp, "write", { path: "README.md" })).block).toBe(true);
    expect((await evaluateProtocolGate(tmp, "bash", { command: "echo x > src/hello.ts" })).block).toBe(true);
    expect((await evaluateProtocolGate(tmp, "bash", { command: "rm src/old.ts" })).block).toBe(true);
    expect((await evaluateProtocolGate(tmp, "write", { path: "/tmp/x.ts" })).block).toBe(false);
  });

  it("guards active docs scope before project mutations", async () => {
    await startWork(tmp, { practice: "docs", objective: "docs", acceptanceCriteria: ["safe"] });
    expect((await evaluateProtocolGate(tmp, "write", { path: "README.md" })).block).toBe(false);
    expect((await evaluateProtocolGate(tmp, "write", { path: `${tmp}/README.md` })).block).toBe(false);
    expect((await evaluateProtocolGate(tmp, "write", { path: "src/hello.ts" })).block).toBe(true);
    expect((await evaluateProtocolGate(tmp, "bash", { command: "echo x > package.json" })).block).toBe(true);
    const license = await evaluateProtocolGate(tmp, "write", { path: "LICENSE" });
    expect(license.block).toBe(true);
    if (license.block) expect(license.message).toContain("default");
  });

  it("guards active test scope before project mutations", async () => {
    await startWork(tmp, { practice: "test", objective: "test add", acceptanceCriteria: ["verdict"] });
    expect((await evaluateProtocolGate(tmp, "write", { path: "tests/add.test.ts" })).block).toBe(false);
    expect((await evaluateProtocolGate(tmp, "write", { path: ".cynos/tmp/result.json" })).block).toBe(false);
    const src = await evaluateProtocolGate(tmp, "write", { path: "src/add.ts" });
    expect(src.block).toBe(true);
    if (src.block) expect(src.message).toContain("develop");
    const doc = await evaluateProtocolGate(tmp, "write", { path: "docs/smoke-report.md" });
    expect(doc.block).toBe(true);
    if (doc.block) expect(doc.message).toContain("docs");
  });
});
