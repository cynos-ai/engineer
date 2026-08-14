import { describe, expect, it } from "vitest";
import { formatCheckAttempts } from "../extensions/core/report";

describe("formatCheckAttempts", () => {
  it("returns nothing when there are no attempts", () => {
    expect(formatCheckAttempts({})).toEqual([]);
    expect(formatCheckAttempts({ checkAttempts: [] })).toEqual([]);
  });

  it("renders recent failed completion attempts for status/report output", () => {
    const lines = formatCheckAttempts({
      checkAttempts: [{
        checkedAt: "2026-01-01T00:00:00.000Z",
        allSatisfied: false,
        missing: ["review-report-structured: missing report"],
        evidenceKeys: ["criteriaCoverage", "reviewScope"],
        capturedToolResultCount: 7,
      }],
    });

    expect(lines.join("\n")).toContain("Recent failed check attempts");
    expect(lines.join("\n")).toContain("missing report");
    expect(lines.join("\n")).toContain("capturedToolResults=7");
  });
});
