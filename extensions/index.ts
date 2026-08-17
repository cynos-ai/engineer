import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activateCynosTools, CYNOS_TOOLS_PACKAGE_VERSION, CYNOS_TOOLS_PROTOCOL_VERSION } from "@cynos-ai/tools";
import { registerCommands } from "./core/commands";
import { registerConfigCommand } from "./core/config-command";
import { registerSubagentTool } from "./subagent";
import { registerWorkTools } from "./core/tools";
import { registerPracticeSlashCommands } from "./practice-commands";
import { registerResourcesHook, registerSessionHook, registerPromptHook, registerProtocolGate, registerCompactionHook } from "./hooks";
import { registerToolResultCapture } from "./core/tool-result-capture";
import { validatePractices } from "./practices/registry";
import { DEFAULT_LANGUAGE, ensureUserConfig } from "./infra/config";
import { isGlobalToolsInstalled } from "./infra/global-tools-detect";
import type { CynosConfig } from "./infra/config";

// Tools protocol version this Engineer build is compatible with. Bump only when
// Tools ships an incompatible activateCynosTools contract.
const SUPPORTED_TOOLS_PROTOCOL = 1;

function isChildProcess(): boolean {
  return process.env.PE_CHILD === "1";
}

async function activateSharedTools(pi: ExtensionAPI): Promise<void> {
  if (CYNOS_TOOLS_PROTOCOL_VERSION !== SUPPORTED_TOOLS_PROTOCOL) {
    throw new Error(
      `@cynos-ai/tools protocol mismatch: bundled @cynos-ai/tools@${CYNOS_TOOLS_PACKAGE_VERSION} ` +
        `reports v${CYNOS_TOOLS_PROTOCOL_VERSION}; Engineer supports v${SUPPORTED_TOOLS_PROTOCOL}. ` +
        "Align the package versions and restart pi.",
    );
  }
  // Coexistence: if the user has @cynos-ai/tools installed as a GLOBAL pi
  // package, it loads as a separate extension and would register the same
  // cynos_* tool names → pi's detectExtensionConflicts hard-fails on boot.
  // pi's runtime does not aggregate tools across extensions during the load
  // phase, so the only reliable pre-load signal is pi's global settings / disk.
  // pi loads project packages before user packages, so Engineer activates first
  // and defers here; the global copy provides the tools. The per-pi-instance
  // WeakMap dedup inside activateCynosTools cannot catch this because pi hands
  // each extension its own ExtensionAPI (loader.js createExtensionAPI).
  if (isGlobalToolsInstalled()) {
    // Visible best-effort notice (never block startup). Users who want
    // Engineer's bundled copy instead can `pi remove npm:@cynos-ai/tools`.
    try {
      // eslint-disable-next-line no-console
      console.warn(
        "[@cynos-ai/engineer] Global @cynos-ai/tools detected — using it and deferring the bundled copy. " +
          "To use Engineer's bundled tools instead: `pi remove npm:@cynos-ai/tools`.",
      );
    } catch {
      /* ignore */
    }
    return;
  }
  // The cast bypasses a dev-only type duplication: under a file: dependency, tools
  // resolves @earendil-works/pi-coding-agent to its own nested dev copy, while
  // engineer resolves to its own. The two ExtensionAPI types are structurally
  // identical at the published, hoisted-module runtime; only tsc in dev sees two
  // copies. At publish time bundledDependencies + peerDependencies yield one copy.
  const activate = activateCynosTools as unknown as (pi: ExtensionAPI) => Promise<void> | void;
  try {
    await activate(pi);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to activate bundled @cynos-ai/tools@${CYNOS_TOOLS_PACKAGE_VERSION}: ${detail}`, { cause: error });
  }
}

function registerMainOnly(pi: ExtensionAPI): void {
  registerWorkTools(pi);
  registerSubagentTool(pi);
  registerCommands(pi);
  registerConfigCommand(pi);
  registerPracticeSlashCommands(pi);
  registerResourcesHook(pi);
  registerSessionHook(pi);
  registerPromptHook(pi);
  registerProtocolGate(pi);
  registerCompactionHook(pi);
  registerToolResultCapture(pi);
}

const USER_CONFIG_DEFAULTS: CynosConfig = {
  schemaVersion: 1,
  language: DEFAULT_LANGUAGE,
  onboardMode: "human-assisted",
  compactionEnabled: true,
  compactionMinContextPercent: 55,
};

export default async function (pi: ExtensionAPI): Promise<void> {
  const practiceErrors = validatePractices();
  if (practiceErrors.length > 0) {
    throw new Error(`Practice definition validation failed:\n- ${practiceErrors.join("\n- ")}`);
  }

  // Lazy-init user-level defaults on main process startup (child processes skip to avoid double-write).
  // visionModel auto-discovery is deferred to the session_start hook (where modelRegistry is available).
  if (!isChildProcess()) await ensureUserConfig(USER_CONFIG_DEFAULTS);

  // Activate shared Tools (search/fetch/vision/browser). Runs in both main and
  // child processes; Tools itself decides what to register per CYNOS_AGENT_ROLE.
  await activateSharedTools(pi);
  if (!isChildProcess()) registerMainOnly(pi);
}
