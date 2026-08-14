import { describe, expect, it } from "vitest";
import { allPractices, getPractice, validatePractices } from "../extensions/practices/registry";

describe("practice registry", () => {
  it("validates registered practices", () => {
    expect(validatePractices()).toEqual([]);
  });

  it("registers current practices", () => {
    expect(allPractices().map((practice) => practice.id).sort()).toEqual(["debug", "default", "develop", "docs", "init", "onboard", "refactor", "release", "review", "test", "ui-design", "usability"]);
  });

  it("lists default last because it is the fallback practice", () => {
    expect(allPractices().map((practice) => practice.id)).toEqual(["review", "docs", "onboard", "init", "test", "debug", "develop", "refactor", "ui-design", "usability", "release", "default"]);
  });

  it("exposes evidence schema for check_completion", () => {
    expect(getPractice("default").evidenceSchema).toContain("criteriaCoverage");
    expect(getPractice("review").evidenceSchema).toContain("overall");
    expect(getPractice("debug").evidenceSchema).toContain("debugging");
    expect(getPractice("test").evidenceSchema).toContain("verdict");
    expect(getPractice("docs").evidenceSchema).toContain("behaviorChangeIncluded");
    expect(getPractice("onboard").evidenceSchema).toContain("preflight");
    expect(getPractice("ui-design").evidenceSchema).toContain("brand-spec.md");
    expect(getPractice("refactor").evidenceSchema).toContain("behaviorContract");
    expect(getPractice("release").evidenceSchema).toContain("authorization");
    expect(getPractice("release").evidenceSchema).toContain("postValidation");
    expect(getPractice("usability").evidenceSchema).toContain("observations");
  });

  it("does not prompt agents to fill runtime internal ids in evidence schemas", () => {
    for (const practice of allPractices()) {
      expect(practice.evidenceSchema, practice.id).not.toMatch(/toolCallId|writtenTool|artifactTool|evidenceTool|postFixEvidenceTool|failingTool|passingTool|testTool|capturedAnswerIndex/i);
    }
  });
});
