import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const changelogScript = path.resolve(process.cwd(), "scripts/generate-changelog.mjs");
const tempRepos: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd: string, message: string): void {
  git(cwd, ["add", "."]);
  git(cwd, [
    "-c",
    "user.name=Changelog Test",
    "-c",
    "user.email=changelog-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
}

function createRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cynos-changelog-"));
  tempRepos.push(repo);
  fs.mkdirSync(path.join(repo, "scripts"));
  fs.copyFileSync(changelogScript, path.join(repo, "scripts", "generate-changelog.mjs"));
  git(repo, ["init", "--quiet", "-b", "main"]);
  git(repo, ["config", "user.name", "Changelog Test"]);
  git(repo, ["config", "user.email", "changelog-test@example.invalid"]);
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "changelog-fixture", version: "0.28.2" }) + "\n");
  fs.writeFileSync(path.join(repo, "CHANGELOG.md"), "# Changelog\n");
  commit(repo, "chore: initial public release");
  git(repo, ["tag", "v0.28.2"]);
  return repo;
}

function releaseNotes(repo: string): string {
  return execFileSync(process.execPath, [path.join(repo, "scripts", "generate-changelog.mjs"), "--release-notes"], {
    cwd: repo,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const repo of tempRepos.splice(0)) fs.rmSync(repo, { recursive: true, force: true });
});

describe("generate-changelog release metadata filtering", () => {
  it("keeps a squash release commit when it also contains product changes", () => {
    const repo = createRepo();
    fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "changelog-fixture", version: "0.28.3" }) + "\n");
    fs.writeFileSync(path.join(repo, "README.md"), "Public maintenance change\n");
    commit(repo, "release: engineer 0.28.3 and public maintenance cleanup");

    const notes = releaseNotes(repo);
    expect(notes).toContain("engineer 0.28.3 and public maintenance cleanup");
    expect(notes).not.toContain("No new commits");
  });

  it("filters a release commit that changes only release metadata", () => {
    const repo = createRepo();
    fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "changelog-fixture", version: "0.28.3" }) + "\n");
    fs.writeFileSync(path.join(repo, "CHANGELOG.md"), "# Changelog\n\n## v0.28.3\n");
    commit(repo, "release v0.28.3");

    const notes = releaseNotes(repo);
    expect(notes).toContain("No new commits");
    expect(notes).not.toContain("release v0.28.3");
  });
});
