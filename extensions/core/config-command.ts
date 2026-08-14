import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  LANGUAGE_OPTIONS,
  languageLabel,
  readUserConfig,
  writeUserConfig,
  type CynosConfig,
} from "../infra/config";

// ============================================================
// /cynos-config interactive configuration command
//
// Edits Engineer-owned user-level config via pi's select/input/confirm dialogs.
// Writes to ~/.pi/agent/cynos-engineer.json.
//
// Search API keys, vision model, and browser launch options are owned by
// @cynos-ai/tools and live in ~/.pi/agent/cynos-tools.json — point users to
// /cynos-tools-config instead of duplicating them here.
// ============================================================

export function registerConfigCommand(pi: ExtensionAPI): void {
  pi.registerCommand("cynos-config", {
    description: "Configure Cynos Engineer preferences (language, onboard mode, compaction, etc.).",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("cynos-config requires an interactive TUI. Please run it in the terminal.", "warning");
        return;
      }
      await configLoop(ctx);
    },
  });
}

type ConfigEditCtx = Pick<ExtensionCommandContext, "ui" | "modelRegistry">;

async function configLoop(ctx: ConfigEditCtx): Promise<void> {
  let config = await readUserConfigSafe();

  for (;;) {
    const choice = await ctx.ui.select("Cynos Engineer Config", buildMenu(config));
    if (!choice) return; // user cancelled

    if (choice.startsWith(TOOLS_SETTINGS_LABEL)) {
      ctx.ui.notify("Run /cynos-tools-config to edit search API keys, vision model, and browser options.", "info");
      continue;
    }

    const item = MENU_ITEMS.find((m) => choice.startsWith(m.label));
    const key = item?.key;

    if (key === MENU_KEYS.LANGUAGE) {
      config = await editLanguage(ctx, config);
    } else if (key === MENU_KEYS.ONBOARD_MODE) {
      config = await editOnboardMode(ctx, config);
    } else if (key === MENU_KEYS.SUBAGENT_TIMEOUT) {
      config = await editSubagentTimeout(ctx, config);
    } else if (key === MENU_KEYS.PROJECT_MD_MAX_LINES) {
      config = await editProjectMdMaxLines(ctx, config);
    } else if (key === MENU_KEYS.COMPACTION) {
      config = await editCompaction(ctx, config);
    }
  }
}

const MENU_KEYS = {
  LANGUAGE: "language",
  ONBOARD_MODE: "onboard",
  SUBAGENT_TIMEOUT: "timeout",
  PROJECT_MD_MAX_LINES: "maxlines",
  COMPACTION: "compaction",
} as const;

const TOOLS_SETTINGS_LABEL = "Tools settings (search/vision/browser)";

const MENU_ITEMS: { key: string; label: string }[] = [
  { key: MENU_KEYS.LANGUAGE, label: "Language" },
  { key: MENU_KEYS.ONBOARD_MODE, label: "Onboard mode" },
  { key: MENU_KEYS.SUBAGENT_TIMEOUT, label: "Subagent timeout" },
  { key: MENU_KEYS.PROJECT_MD_MAX_LINES, label: "PROJECT.md max lines" },
  { key: MENU_KEYS.COMPACTION, label: "Work-aware compaction" },
];

const ENGINEER_LABELS = MENU_ITEMS.map((m) => m.label);
const ALL_LABELS = [...ENGINEER_LABELS, TOOLS_SETTINGS_LABEL];
const MENU_LABEL_WIDTH = Math.max(...ALL_LABELS.map((label) => label.length));

export function buildMenu(config: CynosConfig): string[] {
  const values = new Map<string, string>([
    [MENU_KEYS.LANGUAGE, config.language ? languageLabel(config.language) : "English (default)"],
    [MENU_KEYS.ONBOARD_MODE, config.onboardMode ?? "human-assisted (default)"],
    [MENU_KEYS.SUBAGENT_TIMEOUT, config.subagentTimeoutMinutes ? `${config.subagentTimeoutMinutes} min` : "15 min (default)"],
    [MENU_KEYS.PROJECT_MD_MAX_LINES, config.projectMdMaxLines ? `${config.projectMdMaxLines} lines` : "600 lines (default)"],
    [MENU_KEYS.COMPACTION, config.compactionEnabled === false ? "Disabled" : "Enabled (default)"],
  ]);

  const rows = MENU_ITEMS.map(
    (item) => `${item.label.padEnd(MENU_LABEL_WIDTH + 2)} -> ${values.get(item.key)}`,
  );
  rows.push(`${TOOLS_SETTINGS_LABEL.padEnd(MENU_LABEL_WIDTH + 2)} -> /cynos-tools-config`);
  return rows;
}

async function editLanguage(ctx: ConfigEditCtx, config: CynosConfig): Promise<CynosConfig> {
  const options = LANGUAGE_OPTIONS.map((o) => `${o.value}  ${o.label}`);
  const choice = await ctx.ui.select("Choose language", options);
  if (!choice) return config;
  const value = choice.split(/\s+/)[0];
  const updated = { ...config, language: value };
  await save(ctx, updated);
  ctx.ui.notify(`Language preference set to: ${languageLabel(value)}`, "info");
  return updated;
}

async function editOnboardMode(ctx: ConfigEditCtx, config: CynosConfig): Promise<CynosConfig> {
  const options = [
    "human-assisted  Human-assisted: confirm before writing memory (default)",
    "auto            Auto: decide independently",
  ];
  const choice = await ctx.ui.select("Choose onboard mode", options);
  if (!choice) return config;
  const value = choice.trim().split(/\s+/)[0] as CynosConfig["onboardMode"];
  const updated = { ...config, onboardMode: value };
  await save(ctx, updated);
  ctx.ui.notify(`Onboard mode set to: ${value}`, "info");
  return updated;
}

async function editSubagentTimeout(ctx: ConfigEditCtx, config: CynosConfig): Promise<CynosConfig> {
  const input = await ctx.ui.input("Subagent timeout in minutes (leave blank to restore default 15):");
  if (input === undefined) return config;
  const minutes = parsePositiveNumber(input);
  if (minutes === null) {
    ctx.ui.notify("Invalid number. No changes made.", "warning");
    return config;
  }
  const updated = minutes !== undefined
    ? { ...config, subagentTimeoutMinutes: minutes }
    : (() => { const { subagentTimeoutMinutes: _, ...rest } = config; return rest; })();
  await save(ctx, updated);
  ctx.ui.notify(minutes ? `Subagent timeout set to ${minutes} min` : "Restored default 15 min", "info");
  return updated;
}

async function editProjectMdMaxLines(ctx: ConfigEditCtx, config: CynosConfig): Promise<CynosConfig> {
  const input = await ctx.ui.input("PROJECT.md max lines (leave blank to restore default 600):");
  if (input === undefined) return config;
  const lines = parsePositiveInteger(input);
  if (lines === null) {
    ctx.ui.notify("A positive integer is required. No changes made.", "warning");
    return config;
  }
  const updated = lines !== undefined
    ? { ...config, projectMdMaxLines: lines }
    : (() => { const { projectMdMaxLines: _, ...rest } = config; return rest; })();
  await save(ctx, updated);
  ctx.ui.notify(lines ? `PROJECT.md max lines set to ${lines}` : "Restored default 600 lines", "info");
  return updated;
}

async function editCompaction(ctx: ConfigEditCtx, config: CynosConfig): Promise<CynosConfig> {
  const choice = await ctx.ui.select("Work-aware compaction", ["Enabled (default)", "Disabled"]);
  if (!choice) return config;
  const enabled = choice.startsWith("Enabled");
  const updated = {
    ...config,
    compactionEnabled: enabled,
  };
  await save(ctx, updated);
  ctx.ui.notify(`Work-aware compaction ${enabled ? "enabled" : "disabled"}`, "info");
  return updated;
}

async function save(ctx: ConfigEditCtx, config: CynosConfig): Promise<void> {
  await writeUserConfig(config);
}

export function parsePositiveNumber(input: string): number | undefined | null {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parsePositiveInteger(input: string): number | undefined | null {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function readUserConfigSafe(): Promise<CynosConfig> {
  try {
    return await readUserConfig();
  } catch {
    return { schemaVersion: 1 };
  }
}
