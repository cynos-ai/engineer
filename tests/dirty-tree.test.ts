import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DirtyTreeError, startWork } from "../extensions/core/state";

const execFileAsync = promisify(execFile);

let tmp = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pe-dirty-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function gitInit() {
  await execFileAsync("git", ["init", "-q"], { cwd: tmp });
  await execFileAsync("git", ["config", "user.email", "t@t.test"], { cwd: tmp });
  await execFileAsync("git", ["config", "user.name", "test"], { cwd: tmp });
}

async function writeAndCommit(file: string, content: string) {
  await fs.writeFile(path.join(tmp, file), content);
  await execFileAsync("git", ["add", file], { cwd: tmp });
  await execFileAsync("git", ["commit", "-q", "-m", `add ${file}`], { cwd: tmp });
}

describe("startWork dirty tree gate", () => {
  it("starts cleanly when work tree is clean", async () => {
    await gitInit();
    await writeAndCommit("README.md", "hello");
    const work = await startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] });
    expect(work.dirtyTreeAtStart).toBeUndefined();
  });

  it("blocks start when uncommitted modifications exist, with file list and guidance", async () => {
    await gitInit();
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await writeAndCommit("src/app.ts", "export const x = 1;");
    // Create dirty changes: modify committed file + add untracked file
    await fs.writeFile(path.join(tmp, "src/app.ts"), "export const x = 2;");
    await fs.writeFile(path.join(tmp, "src/new.ts"), "new");

    await expect(
      startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] }),
    ).rejects.toBeInstanceOf(DirtyTreeError);
    try {
      await startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] });
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toContain("src/app.ts");
      expect(msg).toContain("src/new.ts");
      expect(msg).toContain("cynos_ask_user");
    }
  });

  it("allows start with acknowledgeDirtyTree and records the snapshot for audit", async () => {
    await gitInit();
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await writeAndCommit("src/app.ts", "export const x = 1;");
    await fs.writeFile(path.join(tmp, "src/app.ts"), "export const x = 2;");

    const work = await startWork(tmp, {
      practice: "develop",
      objective: "o",
      acceptanceCriteria: ["c"],
      acknowledgeDirtyTree: true,
    });
    expect(work.dirtyTreeAtStart).toBeDefined();
    expect(work.dirtyTreeAtStart!.join("\n")).toContain("src/app.ts");
  });

  it("expands untracked directories into individual files in the dirty snapshot", async () => {
    await gitInit();
    await fs.mkdir(path.join(tmp, "src", "deep"), { recursive: true });
    await writeAndCommit("README.md", "hello");
    // Create untracked directory + internal files
    await fs.writeFile(path.join(tmp, "src", "deep", "a.ts"), "a");
    await fs.writeFile(path.join(tmp, "src", "deep", "b.ts"), "b");

    const work = await startWork(tmp, {
      practice: "develop",
      objective: "o",
      acceptanceCriteria: ["c"],
      acknowledgeDirtyTree: true,
    });
    const snapshot = work.dirtyTreeAtStart!.join("\n");
    // --untracked-files=all should expand directory, listing specific files instead of bare `?? src/`
    expect(snapshot).toContain("src/deep/a.ts");
    expect(snapshot).toContain("src/deep/b.ts");
  });

  it("does not gate non-git projects (no dirty tree snapshot)", async () => {
    // tmp is not a git repository
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "src/app.ts"), "x");
    const work = await startWork(tmp, { practice: "develop", objective: "o", acceptanceCriteria: ["c"] });
    expect(work.dirtyTreeAtStart).toBeUndefined();
  });
});
