#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;
const today = new Date().toISOString().slice(0, 10);

function git(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function latestTagBeforeHead() {
  const exact = git(["tag", "--points-at", "HEAD"]);
  if (exact) return git(["describe", "--tags", "--abbrev=0", "HEAD^"], "");
  return git(["describe", "--tags", "--abbrev=0"], "");
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const raw = git(["log", "--reverse", "--pretty=format:%h%x1f%s%x1f%an", range], "");
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => {
      const [hash, subject, author] = line.split("\x1f");
      return { hash, subject, author };
    })
    .filter((item) => item.subject && !isReleaseMetadata(item.subject));
}

function groupFor(subject) {
  if (/^(feat|feature)(\(.+\))?:/i.test(subject)) return "新增";
  if (/^(fix|bugfix)(\(.+\))?:/i.test(subject)) return "修复";
  if (/^docs(\(.+\))?:/i.test(subject)) return "文档";
  if (/^test(s)?(\(.+\))?:/i.test(subject)) return "测试";
  if (/^(build|ci|chore|refactor)(\(.+\))?:/i.test(subject)) return "工程";
  return "其他";
}

function cleanSubject(subject) {
  return subject.replace(/^[a-z]+(\(.+\))?:\s*/i, "").trim();
}

// 发版元数据提交不算用户可见变更，不应进入 changelog：
// - "docs: update changelog [skip ci]"（旧 CI 自动提交）
// - "release vX.Y.Z"（新原子发版脚本）
// - 裸版本号 "0.1.1"（旧 `npm version` 风格）
function isReleaseMetadata(subject) {
  return /update changelog/i.test(subject)
    || /^release\s+v?\d/i.test(subject)
    || /^\d+\.\d+\.\d+$/.test(subject);
}

function renderReleaseNotes(tag, commits) {
  const lines = [`## v${version} - ${today}`, ""];
  if (tag) lines.push(`范围：${tag}..HEAD`, "");
  else lines.push("范围：项目首次发布以来的全部提交。", "");

  if (commits.length === 0) {
    lines.push("- 无新的提交。");
    return `${lines.join("\n")}\n`;
  }

  for (const group of ["新增", "修复", "文档", "测试", "工程", "其他"]) {
    const items = commits.filter((commit) => groupFor(commit.subject) === group);
    if (items.length === 0) continue;
    lines.push(`### ${group}`, "");
    for (const item of items) {
      lines.push(`- ${cleanSubject(item.subject)} (${item.hash}, ${item.author})`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function mergeChangelog(entry) {
  const path = resolve(root, "CHANGELOG.md");
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = "# Changelog\n\n";
  }
  const header = `## v${version} - `;
  const withoutCurrent = current.replace(new RegExp(`\\n?## v${version} - [\\s\\S]*?(?=\\n## v|$)`), "").trimEnd();
  return `${withoutCurrent}\n\n${entry}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

const previousTag = latestTagBeforeHead();
const commits = commitsSince(previousTag);
const entry = renderReleaseNotes(previousTag, commits);

if (args.has("--release-notes")) {
  process.stdout.write(entry);
} else if (args.has("--check")) {
  const expected = mergeChangelog(entry);
  const current = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
  if (current !== expected) {
    console.error("CHANGELOG.md 不是最新。请运行 npm run changelog。");
    process.exit(1);
  }
} else {
  writeFileSync(resolve(root, "CHANGELOG.md"), mergeChangelog(entry), "utf8");
  process.stdout.write("CHANGELOG.md 已更新。\n");
}
