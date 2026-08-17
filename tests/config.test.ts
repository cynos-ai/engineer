import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureUserConfig, getLanguagePreference, getOnboardMode, getSubagentTimeoutMs, languageInstruction, migrateLegacyEngineerConfig, readConfig, SUBAGENT_TIMEOUT_MINUTES, writeUserConfig } from "../extensions/infra/config";
import { legacyCynosConfigPath, userConfigPath } from "../extensions/infra/paths";

// getSubagentTimeoutMs is the newly added subagent execution timeout reading logic.
// It reads subagentTimeoutMinutes from user-level config, falling back to SUBAGENT_TIMEOUT_MINUTES on default/invalid values.
// Parallel-mode serial Event writing depends on child process spawn, hard to unit-test in isolation;
// its core recordSubagentCall is already covered in the state layer, so this file only tests timeout config parsing.

let tmp = "";
let homeTmp = "";
let prevHome = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pe-cfg-"));
  homeTmp = await fs.mkdtemp(path.join(os.tmpdir(), "pe-home-"));
  prevHome = process.env.CYNOS_HOME ?? "";
  process.env.CYNOS_HOME = homeTmp;
});

afterEach(async () => {
  if (prevHome) process.env.CYNOS_HOME = prevHome;
  else delete process.env.CYNOS_HOME;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.rm(homeTmp, { recursive: true, force: true }).catch(() => {});
});

describe("getSubagentTimeoutMs", () => {
  it("returns default timeout when no config.json exists", async () => {
    expect(await getSubagentTimeoutMs(tmp)).toBe(SUBAGENT_TIMEOUT_MINUTES * 60_000);
  });

  it("uses configured value when subagentTimeoutMinutes is valid (minutes to ms)", async () => {
    await writeUserConfig({ schemaVersion: 1, subagentTimeoutMinutes: 5 });
    expect(await getSubagentTimeoutMs(tmp)).toBe(5 * 60_000);
  });

  it("falls back to default when config is 0", async () => {
    await writeUserConfig({ schemaVersion: 1, subagentTimeoutMinutes: 0 });
    expect(await getSubagentTimeoutMs(tmp)).toBe(SUBAGENT_TIMEOUT_MINUTES * 60_000);
  });

  it("falls back to default when config is negative", async () => {
    await writeUserConfig({ schemaVersion: 1, subagentTimeoutMinutes: -3 });
    expect(await getSubagentTimeoutMs(tmp)).toBe(SUBAGENT_TIMEOUT_MINUTES * 60_000);
  });

  it("falls back to default when config is non-numeric (string on disk)", async () => {
    // writeUserConfig has type constraints; write invalid JSON directly to simulate manual editing.
    
    await fs.mkdir(path.dirname(userConfigPath()), { recursive: true });
    await fs.writeFile(userConfigPath(), JSON.stringify({ schemaVersion: 1, subagentTimeoutMinutes: "abc" }));
    expect(await getSubagentTimeoutMs(tmp)).toBe(SUBAGENT_TIMEOUT_MINUTES * 60_000);
  });

  it("other config fields do not affect timeout", async () => {
    await writeUserConfig({ schemaVersion: 1, language: "zh", onboardMode: "auto" });
    expect(await getSubagentTimeoutMs(tmp)).toBe(SUBAGENT_TIMEOUT_MINUTES * 60_000);
  });
});

describe("onboard config", () => {
  it("onboardMode defaults to human-assisted, valid config takes effect, invalid config falls back", async () => {
    expect(await getOnboardMode(tmp)).toBe("human-assisted");
    await writeUserConfig({ schemaVersion: 1, onboardMode: "auto" });
    expect(await getOnboardMode(tmp)).toBe("auto");
    // Write invalid JSON directly to user-level config path

    await fs.mkdir(path.dirname(userConfigPath()), { recursive: true });
    await fs.writeFile(userConfigPath(), JSON.stringify({ schemaVersion: 1, onboardMode: "invalid" }));
    expect(await getOnboardMode(tmp)).toBe("human-assisted");
  });

});

describe("language preference", () => {
  it("defaults to en when no config.json exists", async () => {
    expect(await getLanguagePreference(tmp)).toBe("en");
  });

  it("uses configured value when language is valid", async () => {
    await writeUserConfig({ schemaVersion: 1, language: "en" });
    expect(await getLanguagePreference(tmp)).toBe("en");
  });

  it("falls back to default when config is empty string", async () => {
    await writeUserConfig({ schemaVersion: 1, language: "" });
    expect(await getLanguagePreference(tmp)).toBe("en");
  });

  it("falls back to default when config is non-string", async () => {
    const configDir = path.dirname(userConfigPath());
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(userConfigPath(), JSON.stringify({ schemaVersion: 1, language: 123 }));
    expect(await getLanguagePreference(tmp)).toBe("en");
  });

  it("accepts any language name string", async () => {
    await writeUserConfig({ schemaVersion: 1, language: "Español" });
    expect(await getLanguagePreference(tmp)).toBe("Español");
  });

  it("second write overwrites previous value", async () => {
    const homeTmp = await fs.mkdtemp(path.join(os.tmpdir(), "pe-home-"));
    const prevHome = process.env.CYNOS_HOME ?? "";
    process.env.CYNOS_HOME = homeTmp;
    try {
      await writeUserConfig({ schemaVersion: 1, language: "en" });
      expect(await getLanguagePreference(tmp)).toBe("en");
      // second write overwrites
      await writeUserConfig({ schemaVersion: 1, language: "zh" });
      expect(await getLanguagePreference(tmp)).toBe("zh");
    } finally {
      if (prevHome) process.env.CYNOS_HOME = prevHome;
      else delete process.env.CYNOS_HOME;
      await fs.rm(homeTmp, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("languageInstruction", () => {
  it("known codes map to friendly labels", () => {
    expect(languageInstruction("zh")).toContain("中文");
    expect(languageInstruction("en")).toContain("English");
    expect(languageInstruction("ja")).toContain("日本語");
  });

  it("unknown code used as-is", () => {
    expect(languageInstruction("Esperanto")).toContain("Esperanto");
  });

  it("instruction specifies communication language but does not restrict thinking", () => {
    const instruction = languageInstruction("zh");
    expect(instruction).toContain("Communicate with the user in");
    expect(instruction).toContain("Internal reasoning");
  });
});

describe("legacy config migration", () => {
  let homeTmp = "";
  let prevHome = "";

  beforeEach(async () => {
    homeTmp = await fs.mkdtemp(path.join(os.tmpdir(), "pe-home-"));
    prevHome = process.env.CYNOS_HOME ?? "";
    process.env.CYNOS_HOME = homeTmp;
  });

  afterEach(async () => {
    if (prevHome) process.env.CYNOS_HOME = prevHome;
    else delete process.env.CYNOS_HOME;
    await fs.rm(homeTmp, { recursive: true, force: true }).catch(() => {});
  });

  it("copies only Engineer-owned fields and leaves the legacy file intact", async () => {
    await fs.mkdir(path.dirname(legacyCynosConfigPath()), { recursive: true });
    const legacy = { language: "zh", onboardMode: "auto", visionModel: "secret-model", exaApiKey: "do-not-copy" };
    await fs.writeFile(legacyCynosConfigPath(), JSON.stringify(legacy), "utf8");

    const result = await migrateLegacyEngineerConfig();

    expect(result).toEqual({ migrated: true, fieldsCopied: ["language", "onboardMode"] });
    expect(JSON.parse(await fs.readFile(userConfigPath(), "utf8"))).toEqual({ schemaVersion: 1, language: "zh", onboardMode: "auto" });
    expect(JSON.parse(await fs.readFile(legacyCynosConfigPath(), "utf8"))).toEqual(legacy);
  });

  it("reports an invalid target instead of overwriting it during migration", async () => {
    await fs.mkdir(path.dirname(userConfigPath()), { recursive: true });
    await fs.writeFile(userConfigPath(), "{not json", "utf8");
    await fs.writeFile(legacyCynosConfigPath(), JSON.stringify({ language: "zh" }), "utf8");

    const result = await migrateLegacyEngineerConfig();

    expect(result).toEqual({ migrated: false, fieldsCopied: [], blockedByExistingConfig: true });
    expect(await fs.readFile(userConfigPath(), "utf8")).toBe("{not json");
  });
});

describe("user-level single-file config", () => {
  let homeTmp = "";
  let prevHome = "";

  beforeEach(async () => {
    homeTmp = await fs.mkdtemp(path.join(os.tmpdir(), "pe-home-"));
    prevHome = process.env.CYNOS_HOME ?? "";
    process.env.CYNOS_HOME = homeTmp;
  });

  afterEach(async () => {
    if (prevHome) {
      process.env.CYNOS_HOME = prevHome;
    } else {
      delete process.env.CYNOS_HOME;
    }
    await fs.rm(homeTmp, { recursive: true, force: true }).catch(() => {});
  });

  it("returns default schemaVersion when no config file exists", async () => {
    const cfg = await readConfig(tmp);
    expect(cfg.schemaVersion).toBe(1);
    expect(cfg.subagentTimeoutMinutes).toBeUndefined();
  });

  it("written user config can be read back", async () => {
    await writeUserConfig({ schemaVersion: 1, subagentTimeoutMinutes: 20, language: "zh" });
    const cfg = await readConfig(tmp);
    expect(cfg.subagentTimeoutMinutes).toBe(20);
    expect(cfg.language).toBe("zh");
  });

  it("ensureUserConfig creates default config only when missing", async () => {
    await ensureUserConfig({ schemaVersion: 1, language: "zh", onboardMode: "human-assisted", compactionEnabled: true, compactionMinContextPercent: 55 });
    const cfg = await readConfig(tmp);
    expect(cfg).toMatchObject({
      schemaVersion: 1,
      language: "zh",
      onboardMode: "human-assisted",
      compactionEnabled: true,
      compactionMinContextPercent: 55,
    });
  });

  it("ensureUserConfig does not overwrite existing user config", async () => {
    await writeUserConfig({ schemaVersion: 1, language: "en", compactionEnabled: false });
    await ensureUserConfig({ schemaVersion: 1, language: "zh", onboardMode: "human-assisted", compactionEnabled: true, compactionMinContextPercent: 55 });
    const cfg = await readConfig(tmp);
    expect(cfg).toEqual({ schemaVersion: 1, language: "en", compactionEnabled: false });
  });

  it("ensureUserConfig does not overwrite existing invalid JSON with defaults", async () => {
    await fs.mkdir(path.dirname(userConfigPath()), { recursive: true });
    await fs.writeFile(userConfigPath(), "{not json", "utf8");
    await expect(ensureUserConfig({ schemaVersion: 1, language: "zh" })).resolves.toBeUndefined();
    expect(await fs.readFile(userConfigPath(), "utf8")).toBe("{not json");
  });

  it("concurrent ensureUserConfig calls create one valid config without temp leftovers", async () => {
    const defaults = Array.from({ length: 8 }, (_, i) => ({
      schemaVersion: 1 as const,
      language: `lang-${i}`,
      subagentTimeoutMinutes: i + 1,
    }));

    await Promise.all(defaults.map((cfg) => ensureUserConfig(cfg)));

    const cfg = await readConfig(tmp);
    expect(defaults).toContainEqual(cfg);
    const configDir = path.dirname(userConfigPath());
    const entries = await fs.readdir(configDir);
    expect(entries).toEqual(["cynos-engineer.json"]);
  });

  it("overwrite write loses old values", async () => {
    await writeUserConfig({ schemaVersion: 1, subagentTimeoutMinutes: 20, language: "zh" });
    await writeUserConfig({ schemaVersion: 1, subagentTimeoutMinutes: 5 });
    const cfg = await readConfig(tmp);
    expect(cfg.subagentTimeoutMinutes).toBe(5);
    expect(cfg.language).toBeUndefined();
  });

  it("config path is ~/.pi/agent/cynos-engineer.json", async () => {
    expect(userConfigPath()).toBe(path.join(homeTmp, ".pi", "agent", "cynos-engineer.json"));
  });

  it("getters read from user-level config", async () => {
    await writeUserConfig({ schemaVersion: 1, subagentTimeoutMinutes: 30 });
    expect(await getSubagentTimeoutMs(tmp)).toBe(30 * 60_000);
  });

  it("written file permission is 0o600 (owner-only)", async () => {
    await writeUserConfig({ schemaVersion: 1, language: "zh" });
    const stat = await fs.stat(userConfigPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
