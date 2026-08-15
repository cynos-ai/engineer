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
  if (/^(feat|feature)(\(.+\))?:/i.test(subject)) return "Added";
  if (/^(fix|bugfix)(\(.+\))?:/i.test(subject)) return "Fixed";
  if (/^docs(\(.+\))?:/i.test(subject)) return "Documentation";
  if (/^test(s)?(\(.+\))?:/i.test(subject)) return "Tests";
  if (/^(build|ci|chore|refactor)(\(.+\))?:/i.test(subject)) return "Engineering";
  return "Other";
}

function cleanSubject(subject) {
  return subject.replace(/^[a-z]+(\(.+\))?:\s*/i, "").trim();
}

// Release metadata commits are not user-visible changes and should not enter
// the changelog:
// - "docs: update changelog [skip ci]" (legacy CI commit)
// - "release vX.Y.Z" or "release: package X.Y.Z" (release scripts)
// - bare versions such as "0.1.1" (legacy `npm version` style)
function isReleaseMetadata(subject) {
  return /update changelog/i.test(subject)
    || /^release(?:\s+|:\s+)(?:[^\s]+\s+)?v?\d/i.test(subject)
    || /^\d+\.\d+\.\d+$/.test(subject);
}

function renderReleaseNotes(tag, commits) {
  const lines = [`## v${version} - ${today}`, ""];
  if (tag) lines.push(`Range: ${tag}..HEAD / 范围：${tag}..HEAD`, "");
  else lines.push("Range: all commits since the first public release / 范围：项目首次公开发布以来的全部提交。", "");

  if (commits.length === 0) {
    lines.push("- No new commits. / 无新的提交。");
    return `${lines.join("\n")}\n`;
  }

  const groups = [
    ["Added", "新增"],
    ["Fixed", "修复"],
    ["Documentation", "文档"],
    ["Tests", "测试"],
    ["Engineering", "工程"],
    ["Other", "其他"],
  ];
  for (const [english, chinese] of groups) {
    const items = commits.filter((commit) => groupFor(commit.subject) === english);
    if (items.length === 0) continue;
    lines.push(`### ${english} / ${chinese}`, "");
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
    console.error("CHANGELOG.md is out of date. Run npm run changelog.");
    process.exit(1);
  }
} else {
  writeFileSync(resolve(root, "CHANGELOG.md"), mergeChangelog(entry), "utf8");
  process.stdout.write("CHANGELOG.md updated.\n");
}
