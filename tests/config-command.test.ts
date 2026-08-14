import { describe, expect, it } from "vitest";
import { buildMenu, parsePositiveNumber, parsePositiveInteger } from "../extensions/core/config-command";

describe("buildMenu", () => {
  it("uses ASCII-only aligned rows so terminal columns are stable", () => {
    const rows = buildMenu({ schemaVersion: 1 });
    // 5 engineer-owned rows + 1 tools-settings pointer row.
    expect(rows).toHaveLength(6);
    // Rows show `label -> value` only (no internal key column). Default values are ASCII.
    const asciiRows = rows.filter((r) => !r.startsWith("Tools settings"));
    expect(asciiRows.every((row) => /^[\x20-\x7E]+$/.test(row))).toBe(true);

    const arrowColumns = asciiRows.map((row) => row.indexOf("->"));
    expect(new Set(arrowColumns).size).toBe(1);
    expect(rows[0]).toContain("Language");
    expect(rows[0]).toContain("-> English (default)");
    expect(rows.find((row) => row.startsWith("Tools settings"))).toContain("/cynos-tools-config");
  });

  it("uses friendly labels for extended language codes", () => {
    const rows = buildMenu({ schemaVersion: 1, language: "zh-CN" });
    expect(rows.find((row) => row.startsWith("Language"))).toContain("-> 中文(简体)");
  });

  it("keeps custom config values in the aligned menu", () => {
    const rows = buildMenu({
      schemaVersion: 1,
      language: "en",
      onboardMode: "auto",
      subagentTimeoutMinutes: 2.5,
      projectMdMaxLines: 1200,
      compactionEnabled: false,
    });

    expect(rows.find((row) => row.startsWith("Language"))).toContain("-> English");
    expect(rows.find((row) => row.startsWith("Onboard mode"))).toContain("-> auto");
    expect(rows.find((row) => row.startsWith("Subagent timeout"))).toContain("-> 2.5 min");
    expect(rows.find((row) => row.startsWith("PROJECT.md max lines"))).toContain("-> 1200 lines");
    expect(rows.find((row) => row.startsWith("Work-aware compaction"))).toContain("-> Disabled");
  });
});

describe("parsePositiveNumber", () => {
  it("accepts valid positive integer", () => {
    expect(parsePositiveNumber("15")).toBe(15);
    expect(parsePositiveNumber("30")).toBe(30);
  });

  it("accepts valid decimal", () => {
    expect(parsePositiveNumber("1.5")).toBe(1.5);
    expect(parsePositiveNumber("0.5")).toBe(0.5);
  });

  it("empty string returns undefined (restore default)", () => {
    expect(parsePositiveNumber("")).toBe(undefined);
    expect(parsePositiveNumber("   ")).toBe(undefined);
  });

  it("zero returns null (invalid)", () => {
    expect(parsePositiveNumber("0")).toBe(null);
  });

  it("negative number returns null", () => {
    expect(parsePositiveNumber("-5")).toBe(null);
  });

  it("non-numeric returns null", () => {
    expect(parsePositiveNumber("abc")).toBe(null);
    expect(parsePositiveNumber("10abc")).toBe(null);  // parseInt accepts as 10, Number rejects
  });

  it("NaN returns null", () => {
    expect(parsePositiveNumber("NaN")).toBe(null);
  });
});

describe("parsePositiveInteger", () => {
  it("accepts valid positive integer", () => {
    expect(parsePositiveInteger("10")).toBe(10);
    expect(parsePositiveInteger("600")).toBe(600);
  });

  it("decimal returns null (integer required)", () => {
    expect(parsePositiveInteger("3.5")).toBe(null);  // parseInt accepts as 3, correctly rejected here
    expect(parsePositiveInteger("0.5")).toBe(null);
  });

  it("empty string returns undefined", () => {
    expect(parsePositiveInteger("")).toBe(undefined);
  });

  it("zero and negative return null", () => {
    expect(parsePositiveInteger("0")).toBe(null);
    expect(parsePositiveInteger("-3")).toBe(null);
  });

  it("non-numeric returns null", () => {
    expect(parsePositiveInteger("abc")).toBe(null);
    expect(parsePositiveInteger("10abc")).toBe(null);
  });
});
