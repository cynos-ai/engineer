#!/usr/bin/env node
// Verify the npm tarball contents without creating a package file.
// npm pack --dry-run exits 0 even when a files[] entry is missing, so assert
// the runtime entry and resource directories explicitly.
import { execFileSync } from "node:child_process";

const output = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

const pack = parsePackJson(output);
const files = new Set((pack.files ?? []).map((file) => file.path));
const MAX_COMPRESSED_BYTES = 5 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 16 * 1024 * 1024;

if (Number.isFinite(pack.size) && pack.size > MAX_COMPRESSED_BYTES) {
  console.error(`npm package is too large when compressed: ${formatBytes(pack.size)} > ${formatBytes(MAX_COMPRESSED_BYTES)}`);
  process.exit(1);
}
if (Number.isFinite(pack.unpackedSize) && pack.unpackedSize > MAX_UNPACKED_BYTES) {
  console.error(`npm package is too large when unpacked: ${formatBytes(pack.unpackedSize)} > ${formatBytes(MAX_UNPACKED_BYTES)}`);
  process.exit(1);
}

const required = [
  "index.js",
  "package.json",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "skills/cynos/SKILL.md",
  "skills/browser-automation/SKILL.md",
  "skills/browser-automation/references/playwright-cli.md",
  "subagents/reviewer.md",
];

const missing = required.filter((file) => !files.has(file));
if (missing.length > 0) {
  console.error(`npm package is missing required file(s): ${missing.join(", ")}`);
  process.exit(1);
}

const forbiddenPrefixes = ["extensions/", "scripts/", "docs/", ".pi/", ".github/", "smoke-testing/", "tests/"];
const forbidden = [...files].filter((file) => forbiddenPrefixes.some((prefix) => file.startsWith(prefix)));
if (forbidden.length > 0) {
  console.error(`npm package includes source/internal file(s): ${forbidden.slice(0, 20).join(", ")}`);
  if (forbidden.length > 20) console.error(`...and ${forbidden.length - 20} more`);
  process.exit(1);
}

// @cynos-ai/tools must be bundled in node_modules (bundledDependency).
const toolsEntry = [...files].find((file) => file.startsWith("node_modules/@cynos-ai/tools/"));
if (!toolsEntry) {
  console.error("npm package is missing bundled @cynos-ai/tools under node_modules/@cynos-ai/tools/");
  process.exit(1);
}
const requiredToolsFiles = [
  "node_modules/@cynos-ai/tools/package.json",
  "node_modules/@cynos-ai/tools/index.js",
  "node_modules/@cynos-ai/tools/index.d.ts",
];
const missingTools = requiredToolsFiles.filter((file) => !files.has(file));
if (missingTools.length > 0) {
  console.error(`Bundled @cynos-ai/tools is missing required file(s): ${missingTools.join(", ")}`);
  process.exit(1);
}

// No browser binaries may ship (neither Tools' nor ours).
const browserBinary = [...files].find((file) => /(^|\/)\.local-browsers\//.test(file) || /chromium-[0-9]/.test(file));
if (browserBinary) {
  console.error(`npm package includes a browser binary, which must not ship: ${browserBinary}`);
  process.exit(1);
}

console.log(`✓ npm package dry-run OK (${files.size} files, ${formatBytes(pack.size)} compressed, ${formatBytes(pack.unpackedSize)} unpacked, includes index.js + bundled @cynos-ai/tools)`);

function formatBytes(value) {
  if (!Number.isFinite(value)) return "unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function parsePackJson(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    // Some npm versions may print lifecycle noise around --json output.
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed[0] : parsed;
    }
    throw new Error(`Unable to parse npm pack --json output:\n${text}`);
  }
}
