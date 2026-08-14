#!/usr/bin/env node
// ============================================================
// 原子发版脚本
//
// 一次调用完成：校验 → 版本 bump → 重生成 CHANGELOG → 单次提交 → 打 tag。
// 关键不变量：CHANGELOG 与版本号、tag 必须落在同一个 commit 里，
// tag 指向的提交必须已经包含正确的 CHANGELOG。
//
// 这取代了旧的 `npm version` + CI 自动补 changelog 提交的两步流程——
// 旧流程会让 tag 指向「只有版本号、没有 CHANGELOG」的提交，
// 且 CI 的自动提交会与本地分叉。
//
// 用法：
//   npm run release -- patch     # 0.1.1 → 0.1.2
//   npm run release -- minor     # 0.1.1 → 0.2.0
//   npm run release -- major     # 0.1.1 → 1.0.0
//   npm run release -- 1.2.3     # 显式版本号
//
// 完成后手动推送：
//   git push origin main --follow-tags
// ============================================================
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kind = process.argv[2];

if (!kind) {
  console.error("用法: npm run release -- patch | minor | major | <x.y.z>");
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

// 1. 工作树必须干净，避免把无关改动混进 release commit。
const status = git(["status", "--porcelain"]);
if (status) {
  console.error("工作树不干净，请先提交或 stash：\n" + status);
  process.exit(1);
}

// 2. 发布只从 main 分支发起；先同步远端引用，避免本地基于过期 main 打 tag。
const branch = git(["branch", "--show-current"]);
if (branch !== "main") {
  console.error(`当前分支是 ${branch || "detached HEAD"}，请切到 main 后再发版。`);
  process.exit(1);
}
console.log("→ git fetch origin main --tags …");
gitInherit(["fetch", "origin", "main", "--tags"]);
if (!gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"])) {
  console.error("本地 main 不包含 origin/main 的最新提交。请先 rebase/merge 远端 main，再发版。");
  process.exit(1);
}

// 3. 读当前版本，计算下一版本。
const pkgPath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const next = resolveVersion(current, kind);
if (!next) {
  console.error(`无法解析目标版本，输入为: ${kind}（当前 ${current}）`);
  process.exit(1);
}
if (next === current) {
  console.error(`目标版本与当前相同: ${current}`);
  process.exit(1);
}
const tag = `v${next}`;
if (gitOk(["rev-parse", "--verify", `refs/tags/${tag}`])) {
  console.error(`tag 已存在: ${tag}`);
  process.exit(1);
}

console.log(`准备发版: ${current} → ${next}`);

// 4. 先跑完整校验，失败则中止（不产生任何改动）。
console.log("→ npm run verify …");
run(["run", "verify"]);

// 5. bump package.json + package-lock.json。
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
bumpLockfile(lockPath, next);

// 6. 重生成 CHANGELOG（此时新 tag 尚未创建，脚本以上一个可达 tag 为分界，
//    生成新版本段）。必须在提交前完成，让 CHANGELOG 进入同一个 commit。
console.log("→ npm run changelog …");
run(["run", "changelog"]);

// 7. 单次提交 + 打 tag。
git(["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
git(["commit", "-m", `release ${tag}`]);
git(["tag", "-a", tag, "-m", tag]);

console.log(`\n✓ 已发版 ${tag}（commit 含版本号 + CHANGELOG + tag）`);
console.log("推送：");
console.log("  git push origin main --follow-tags");

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
  // lockfile v3：根 packages[""] 也记录版本。
  if (lock.packages && lock.packages[""]) lock.packages[""].version = version;
  writeFileSync(path, JSON.stringify(lock, null, 2) + "\n", "utf8");
}
