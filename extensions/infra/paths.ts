import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ============================================================
// Centralized path management
//
// Project-level .cynos/ state files + user-level ~/.pi/agent/cynos-config.json config
// are all exported from here. Other modules always go through these functions.
// ============================================================

// ============================================================
// Package root resolution
//
// Walks up from this module's __dirname until it finds a directory containing
// package.json. Depth-agnostic: works both for the unbundled .ts source (loaded
// by jiti, __dirname = extensions/infra) and for the bundled single-file
// ./index.js at the package root (CJS output, __dirname = package root). Never
// rely on a hardcoded `../..` count — that breaks the moment the file is
// bundled or moved.
// ============================================================
let cachedPackageRoot = "";

export function packageRoot(): string {
  if (cachedPackageRoot) return cachedPackageRoot;
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.existsSync(path.join(dir, "package.json"))) {
        cachedPackageRoot = dir;
        return dir;
      }
    } catch { /* ignore, try parent */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: two levels up from this file (the historical source layout).
  cachedPackageRoot = path.resolve(__dirname, "..", "..");
  return cachedPackageRoot;
}

export function stateDir(cwd: string): string {
  return path.join(cwd, ".cynos");
}

export function workPath(cwd: string): string {
  return path.join(stateDir(cwd), "work.json");
}

export function lastOutcomePath(cwd: string): string {
  return path.join(stateDir(cwd), "last-outcome.json");
}

// PROJECT.md lives at the project root (not under .cynos/).
export function projectMdPath(cwd: string): string {
  return path.join(cwd, "PROJECT.md");
}

// ---- user-level config (~/.pi/agent/cynos-engineer.json) ----
// Engineer-owned preferences. Search/vision/browser settings live in
// cynos-tools.json, owned by @cynos-ai/tools.
// Tests can override the home directory via the CYNOS_HOME env var.

function homeDir(): string {
  return process.env.CYNOS_HOME ?? os.homedir();
}

export function userConfigPath(): string {
  return path.join(homeDir(), ".pi", "agent", "cynos-engineer.json");
}

// Legacy single-config path (pre-split). Read-only migration source only.
export function legacyCynosConfigPath(): string {
  return path.join(homeDir(), ".pi", "agent", "cynos-config.json");
}

// @cynos-ai/tools config path. Read-only from Engineer's side (e.g. looker
// needs the visionModel the user configured via /cynos-tools-config).
export function cynosToolsConfigPath(): string {
  return path.join(homeDir(), ".pi", "agent", "cynos-tools.json");
}
