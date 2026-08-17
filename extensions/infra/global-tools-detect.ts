// Detect whether the user has @cynos-ai/tools installed as a GLOBAL pi package
// (user-scope), which would load as a SEPARATE extension alongside Engineer.
//
// Why this exists: Engineer bundles its own @cynos-ai/tools copy
// (bundledDependency) and calls activateCynosTools internally. If a user also
// has a global `npm:@cynos-ai/tools` install, pi loads TWO extensions that both
// register the cynos_* tool names. pi creates a per-extension ExtensionAPI
// bound to each extension's own tools map, so the WeakMap-keyed dedup in
// activateCynosTools (keyed on the pi object) cannot detect the duplicate —
// both copies register, and pi's detectExtensionConflicts hard-fails on boot.
//
// pi loads project-scope packages BEFORE user-scope packages, so Engineer
// activates first. Engineer is therefore the only party that can cleanly avoid
// the conflict: if a global tools install is detected, Engineer defers (does
// not activate its bundled tools) and lets the global copy provide them.
//
// The runtime-aggregation signal (pi.getAllTools) is NOT usable here because pi
// leaves action methods as `notInitialized` during the extension load phase
// (loader.js createExtensionRuntime). The only reliable pre-load signal is
// pi's own global settings / package install state, which this helper reads.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Resolve pi's agent directory. PI_CODING_AGENT_DIR is pi's own override;
 * otherwise fall back to ~/.pi/agent under the real (or CYNOS_HOME-test) home.
 */
function piAgentDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
  const home = process.env.CYNOS_HOME ?? os.homedir();
  return path.join(home, ".pi", "agent");
}

export type GlobalToolsDetectionSource = "settings" | "disk";

export interface GlobalToolsInstallation {
  source: GlobalToolsDetectionSource;
  version?: string;
}

/**
 * Detect a user-scope (global) `npm:@cynos-ai/tools` install. Engineer uses
 * this result to make its bundled/global ownership decision visible in the
 * startup warning instead of silently treating every signal as equivalent.
 */
export function detectGlobalToolsInstallation(): GlobalToolsInstallation | undefined {
  const agentDir = piAgentDir();

  // Signal 1: pi's user-level settings.json lists npm:@cynos-ai/tools.
  try {
    const settingsPath = path.join(agentDir, "settings.json");
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as { packages?: unknown };
    const packages = Array.isArray(settings.packages) ? settings.packages : [];
    if (packages.some((p) => p === "npm:@cynos-ai/tools")) return { source: "settings" };
  } catch {
    /* settings missing/unreadable — fall through to disk check */
  }

  // Signal 2: the global package is physically present in pi's npm dir.
  // (Belts-and-suspenders: catches installs where settings.json lags.)
  try {
    const packagePath = path.join(agentDir, "npm", "node_modules", "@cynos-ai", "tools", "package.json");
    if (!fs.existsSync(packagePath)) return undefined;
    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as { version?: unknown };
      return {
        source: "disk",
        version: typeof packageJson.version === "string" ? packageJson.version : undefined,
      };
    } catch {
      return { source: "disk" };
    }
  } catch {
    /* ignore */
  }

  return undefined;
}

export function isGlobalToolsInstalled(): boolean {
  return detectGlobalToolsInstallation() !== undefined;
}
