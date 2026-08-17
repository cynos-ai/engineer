import { ensureDir, pathExists, readJsonFile, readJsonFileOptional, writeJsonAtomic, writeJsonAtomicIfAbsent } from "./fs-utils";
import { legacyCynosConfigPath, userConfigPath } from "./paths";
import * as path from "node:path";
import type { OnboardMode } from "../core/types";

// ============================================================
// Runtime config (user-level, single file)
//
// One config file only: ~/.pi/agent/cynos-engineer.json
// Holds Engineer-owned preferences only (language, onboard mode, compaction,
// subagent timeout). Search/vision/browser settings live in
// ~/.pi/agent/cynos-tools.json, owned by @cynos-ai/tools.
// Edit interactively via /cynos-config or manually edit the JSON.
// ============================================================

export interface CynosConfig {
  schemaVersion: 1;
  // User communication language preference. Used by the agent when communicating with the user (explanations, summaries, reports, questions, status updates, etc.).
  // Internal reasoning/thinking is unrestricted. Supports language codes (zh/en/ja/...) or names (Chinese/English/...).
  // Default "en" (English).
  language?: string;
  // onboard interaction mode:
  // - human-assisted (default): allow/encourage asking the user questions; require user confirmation before writing long-term memory.
  // - auto: agent decides autonomously; completion checkpoints require recording automationDecision instead of user confirmation.
  onboardMode?: OnboardMode;
  // Work-aware compaction: when there is no active work and the last work is archived, trigger compaction based on archive advantages.
  // Old works retain only outcome and archive path; read the archive if evidence is needed for follow-ups.
  // compactionEnabled defaults to true. compactionMinContextPercent defaults to 55 (trigger when context usage exceeds this percentage).
  compactionEnabled?: boolean;
  compactionMinContextPercent?: number;
  // Single subagent execution timeout (minutes). Force-abort runaway subagents to avoid long-lived stalls.
  // Falls back to SUBAGENT_TIMEOUT_MINUTES default when not configured. Value must be positive; otherwise fallback to default.
  subagentTimeoutMinutes?: number;
  // Max lines when injecting PROJECT.md. Truncate and hint if exceeded.
  // Counted by lines, not bytes (language-agnostic). Markdown's semantic unit is the line; line-based truncation avoids cutting mid-sentence.
  // Falls back to PROJECT_MD_MAX_LINES default when not configured. Value must be a positive integer; otherwise fallback to default.
  projectMdMaxLines?: number;
}

/** Read user-level config. Returns a default object with only schemaVersion when the file does not exist. */
export async function readConfig(_cwd: string): Promise<CynosConfig> {
  return readJsonFile<CynosConfig>(userConfigPath(), { schemaVersion: 1 });
}

/** Read raw user-level config content. Used by /cynos-config for editing. */
export async function readUserConfig(): Promise<CynosConfig> {
  return readJsonFile<CynosConfig>(userConfigPath(), { schemaVersion: 1 });
}

export async function writeUserConfig(config: CynosConfig): Promise<void> {
  const dir = path.dirname(userConfigPath());
  await ensureDir(dir);
  await writeJsonAtomic(userConfigPath(), config, { mode: 0o600 });
}

/** Merge a partial patch into the stored user config (read-modify-write). Used by one-shot prompts. */
export async function mergeUserConfig(patch: Partial<CynosConfig>): Promise<void> {
  const current = await readUserConfig();
  await writeUserConfig({ ...current, ...patch, schemaVersion: 1 });
}

// Lazy-init user-level defaults. Only creates when the file does not exist; never overwrites existing config.
// Uses create-if-absent semantics instead of read-then-write so project-level installs/startup races
// cannot replace a user's already configured ~/.pi/agent/cynos-engineer.json with defaults.
// Should be called once in the extension main process's activate() (not in child processes).
export async function ensureUserConfig(defaults: CynosConfig): Promise<void> {
  const migration = await migrateLegacyEngineerConfig();
  if (migration.blockedByExistingConfig) {
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[cynos-engineer] Could not migrate legacy settings because ${userConfigPath()} already exists but is not valid JSON. ` +
          "Back up and repair that file before restarting pi; the legacy file was left untouched.",
      );
    } catch {
      /* logging must never block startup */
    }
  }
  await writeJsonAtomicIfAbsent(userConfigPath(), defaults, { mode: 0o600 });
}

// Idempotent one-way migration from the legacy ~/.pi/agent/cynos-config.json
// (pre-split single config) into ~/.pi/agent/cynos-engineer.json. Copies only
// Engineer-owned fields. The legacy file is never modified or deleted; @cynos-ai/tools
// performs its own migration for visionModel/exaApiKey/tavilyApiKey.
const LEGACY_ENGINEER_FIELDS = [
  "language",
  "onboardMode",
  "compactionEnabled",
  "compactionMinContextPercent",
  "subagentTimeoutMinutes",
  "projectMdMaxLines",
] as const;

export async function migrateLegacyEngineerConfig(): Promise<{ migrated: boolean; fieldsCopied: string[]; blockedByExistingConfig?: boolean }> {
  // Best-effort reads: invalid JSON in either file is treated as missing, so a
  // corrupted target never blocks startup and never gets overwritten implicitly.
  const targetPath = userConfigPath();
  const existing = await readJsonOptionalSafe<CynosConfig>(targetPath);
  if (existing) return { migrated: false, fieldsCopied: [] };

  const legacy = await readJsonOptionalSafe<Record<string, unknown>>(legacyCynosConfigPath());
  if (!legacy) return { migrated: false, fieldsCopied: [] };

  const copied: string[] = [];
  const migrated: CynosConfig = { schemaVersion: 1 };
  const record = migrated as unknown as Record<string, unknown>;
  for (const field of LEGACY_ENGINEER_FIELDS) {
    const value = legacy[field];
    if (value !== undefined && value !== null) {
      record[field] = value;
      copied.push(field);
    }
  }
  if (copied.length === 0) return { migrated: false, fieldsCopied: [] };

  const written = await writeJsonAtomicIfAbsent(targetPath, migrated, { mode: 0o600 });
  if (!written) {
    const targetAfterRace = await readJsonOptionalSafe<CynosConfig>(targetPath);
    return {
      migrated: false,
      fieldsCopied: [],
      blockedByExistingConfig: !targetAfterRace && await pathExists(targetPath),
    };
  }
  return { migrated: true, fieldsCopied: copied };
}

// Default single subagent timeout (minutes). Overridable via config.subagentTimeoutMinutes.
export const SUBAGENT_TIMEOUT_MINUTES = 15;

// Default PROJECT.md max lines. Overridable via config.projectMdMaxLines.
export const PROJECT_MD_MAX_LINES = 600;
export const DEFAULT_ONBOARD_MODE: OnboardMode = "human-assisted";
export const DEFAULT_LANGUAGE = "en";
export const WORK_AWARE_COMPACTION_MIN_PERCENT = 55;

// Read subagent timeout (milliseconds). Falls back to default on illegal or missing config.
export async function getSubagentTimeoutMs(cwd: string): Promise<number> {
  const config = await readConfig(cwd);
  const minutes = config.subagentTimeoutMinutes;
  return Number.isFinite(minutes) && (minutes as number) > 0
    ? Math.floor((minutes as number) * 60_000)
    : SUBAGENT_TIMEOUT_MINUTES * 60_000;
}

// Read PROJECT.md max line count. Falls back to default on illegal or missing config.
export async function getProjectMdMaxLines(cwd: string): Promise<number> {
  const config = await readConfig(cwd);
  const lines = config.projectMdMaxLines;
  return Number.isInteger(lines) && (lines as number) > 0 ? (lines as number) : PROJECT_MD_MAX_LINES;
}

export async function getOnboardMode(cwd: string): Promise<OnboardMode> {
  const config = await readConfig(cwd);
  return isOnboardMode(config.onboardMode) ? config.onboardMode : DEFAULT_ONBOARD_MODE;
}

// Read user language preference. Falls back to default "en" (English) when config is empty or non-string.
export async function getLanguagePreference(cwd: string): Promise<string> {
  const config = await readConfig(cwd);
  const lang = config.language;
  return typeof lang === "string" && lang.trim() ? lang.trim() : DEFAULT_LANGUAGE;
}

export const LANGUAGE_LABELS: Record<string, string> = {
  zh: "中文",
  "zh-CN": "中文(简体)",
  "zh-Hans": "中文(简体)",
  "zh-TW": "中文(繁體)",
  "zh-Hant": "中文(繁體)",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
};

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language;
}

// Convert language preference into an agent-facing directive text.
// Restricts communication language; does not restrict internal reasoning/thinking.
export function languageInstruction(language: string): string {
  const label = languageLabel(language);
  return `Communicate with the user in ${label} (this covers all user-facing output: explanations, summaries, reports, questions, status updates, error messages, etc.). Internal reasoning / thinking is not restricted by this and may use any language.`;
}

// Common language options for the /cynos-config menu.
export const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
  { value: "ar", label: "العربية" },
];

export async function getWorkAwareCompactionSettings(cwd: string): Promise<{ enabled: boolean; minContextPercent: number }> {
  const config = await readConfig(cwd);
  const min = config.compactionMinContextPercent;
  return {
    enabled: config.compactionEnabled !== false,
    minContextPercent: Number.isFinite(min) && (min as number) > 0 ? (min as number) : WORK_AWARE_COMPACTION_MIN_PERCENT,
  };
}

function isOnboardMode(value: unknown): value is OnboardMode {
  return value === "human-assisted" || value === "auto";
}

async function readJsonOptionalSafe<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJsonFileOptional<T>(filePath);
  } catch {
    // Treat parse errors as "no usable config"; never let corruption block defaults.
    return undefined;
  }
}
