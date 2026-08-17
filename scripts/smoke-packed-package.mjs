#!/usr/bin/env node
// Install the freshly packed tarball into an isolated directory and run the
// published-artifact smoke against it. This catches files[] and bundledDependency
// mistakes that a source-tree build smoke cannot see.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const temp = mkdtempSync(path.join(os.tmpdir(), "cynos-packed-smoke-"));
const installDir = path.join(temp, "install");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

try {
  run(npm, ["pack", "--pack-destination", temp]);
  const tarball = readdirSync(temp).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack did not produce a tarball");

  run(npm, [
    "install",
    "--prefix",
    installDir,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--legacy-peer-deps",
    path.join(temp, tarball),
  ]);

  const packageRoot = path.join(installDir, "node_modules", "@cynos-ai", "engineer");
  const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const toolsPackageJson = JSON.parse(readFileSync(path.join(packageRoot, "node_modules", "@cynos-ai", "tools", "package.json"), "utf8"));
  const declaredTools = packageJson.dependencies?.["@cynos-ai/tools"];
  if (toolsPackageJson.version !== declaredTools) {
    throw new Error(`bundled Tools version mismatch: declared ${declaredTools}, installed ${toolsPackageJson.version}`);
  }
  const optionalBrowserPeer = toolsPackageJson.peerDependenciesMeta?.["playwright-core"]?.optional === true;
  const nestedPlaywright = path.join(packageRoot, "node_modules", "@cynos-ai", "tools", "node_modules", "playwright-core");
  if (optionalBrowserPeer && existsSync(nestedPlaywright)) {
    throw new Error("optional playwright-core was bundled inside Engineer; ordinary installs must not carry the browser runtime");
  }

  const smoke = path.join(root, "scripts", "smoke-built-index.mjs");
  const env = { ...process.env, CYNOS_PACKAGE_ROOT: packageRoot };
  run(process.execPath, [smoke], { env });
  run(process.execPath, [smoke, "--expect-tools-failure"], { env });
  console.log(`✓ packed npm artifact smoke OK (${packageJson.name}@${packageJson.version}, bundled Tools ${toolsPackageJson.version}${optionalBrowserPeer ? "; optional playwright peer not bundled" : ""})`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
