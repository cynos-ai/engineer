#!/usr/bin/env node
// ============================================================
// Atomic local release helper.
//
// One invocation verifies the tree, bumps version metadata, regenerates the
// changelog, creates one release commit, and creates the annotated tag. The tag
// must point at the commit containing the version and changelog.
//
// Usage:
//   npm run release -- patch | minor | major | <x.y.z>
//
// On an unprotected repository, push after review with:
//   git push origin main --follow-tags
//
// On the public protected repository, create a release branch/PR first, merge
// without squash so the tagged commit becomes part of main, then push the tag:
//   git switch -c release/vX.Y.Z
//   git push -u origin release/vX.Y.Z
//   # merge the PR without squash after verify passes
//   git push origin vX.Y.Z
// ============================================================
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kind = process.argv[2];

if (!kind) {
  console.error("Usage: npm run release -- patch | minor | major | <x.y.z>");
  process.exit(1);
}

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function gitInherit(args) {
  execFileSync("git", args, { cwd: root, stdio: "inherit" });
}

function run(args) {
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd: root, stdio: "inherit" });
}

// 1. The working tree must be clean so unrelated changes cannot enter the release commit.
const status = git(["status", "--porcelain"]);
if (status) {
  console.error("Working tree is not clean. Commit or stash first:\n" + status);
  process.exit(1);
}

// 2. Release only from main and refresh remote refs before creating a tag.
const branch = git(["branch", "--show-current"]);
if (branch !== "main") {
  console.error(`Release must start from main; current branch is ${branch || "detached HEAD"}.`);
  process.exit(1);
}
console.log("→ git fetch origin main --tags …");
gitInherit(["fetch", "origin", "main", "--tags"]);
if (!gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"])) {
  console.error("Local main does not contain origin/main. Rebase or merge the remote main before releasing.");
  process.exit(1);
}

// 3. Read the current version and calculate the next version.
const pkgPath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const next = resolveVersion(current, kind);
if (!next) {
  console.error(`Cannot resolve target version: ${kind} (current ${current}).`);
  process.exit(1);
}
if (next === current) {
  console.error(`Target version is unchanged: ${current}.`);
  process.exit(1);
}
const tag = `v${next}`;
if (gitOk(["rev-parse", "--verify", `refs/tags/${tag}`])) {
  console.error(`Tag already exists: ${tag}`);
  process.exit(1);
}

console.log(`Preparing release: ${current} → ${next}`);

// 4. Run the full verification before making any file changes.
console.log("→ npm run verify …");
run(["run", "verify"]);

// 5. bump package.json + package-lock.json。
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
bumpLockfile(lockPath, next);

// 6. Regenerate CHANGELOG before creating the tag so the new section is part
//    of the same commit.
console.log("→ npm run changelog …");
run(["run", "changelog"]);

// 7. Create one release commit and tag it.
git(["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
git(["commit", "-m", `release ${tag}`]);
git(["tag", "-a", tag, "-m", tag]);

const releaseHead = git(["rev-parse", "HEAD"]);
const taggedCommit = git(["rev-list", "-n", "1", `${tag}^{}`]);
if (releaseHead !== taggedCommit || pkg.version !== next) {
  console.error(`Release invariant failed: ${tag} does not point at the ${next} release commit.`);
  process.exit(1);
}

console.log(`\n✓ Released ${tag} (version, CHANGELOG, and tag share one commit).`);
console.log("\nUnprotected main:");
console.log("  git push origin main --follow-tags");
console.log("\nProtected main (public repository):");
console.log(`  git switch -c release/${tag}`);
console.log(`  git push -u origin release/${tag}`);
console.log("  # open and merge the PR without squash after verify passes");
console.log(`  git push origin ${tag}`);

function resolveVersion(currentSemver, input) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentSemver);
  if (!match) return null;
  const [, maj, min, pat] = match;
  let major = Number(maj), minor = Number(min), patch = Number(pat);
  if (/^major$/.test(input)) return `${major + 1}.0.0`;
  if (/^minor$/.test(input)) return `${major}.${minor + 1}.0`;
  if (/^patch$/.test(input)) return `${major}.${minor}.${patch + 1}`;
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(input)) return input;
  return null;
}

function bumpLockfile(path, version) {
  const lock = JSON.parse(readFileSync(path, "utf8"));
  lock.version = version;
  // Lockfile v3 also records the version in the root packages[""] entry.
  if (lock.packages && lock.packages[""]) lock.packages[""].version = version;
  writeFileSync(path, JSON.stringify(lock, null, 2) + "\n", "utf8");
}
