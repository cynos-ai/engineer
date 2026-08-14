import { describe, expect, it } from "vitest";
import { buildPracticeCommandPrompt, PRACTICE_SLASH_COMMANDS } from "../extensions/practice-commands/definitions";

describe("practice slash commands", () => {
  it("defines slash commands for every practice", () => {
    expect(PRACTICE_SLASH_COMMANDS.map((command) => command.name)).toEqual([
      "onboard", "init", "review", "docs", "debug", "test", "develop", "refactor", "ui-design", "usability", "release", "default",
    ]);
  });

  it("builds a practice-locked prompt with supplemental requirements", () => {
    const review = PRACTICE_SLASH_COMMANDS.find((command) => command.name === "review")!;
    const prompt = buildPracticeCommandPrompt(review, "review staged diff, read-only");

    expect(prompt).toContain("Cynos slash command /review selected.");
    expect(prompt).toContain("practice: review");
    expect(prompt).toContain("Do not route this request to another practice");
    expect(prompt).toContain("User supplemental requirements after /review:");
    expect(prompt).toContain("review staged diff, read-only");
  });

  it("uses command-specific empty argument guidance", () => {
    const init = PRACTICE_SLASH_COMMANDS.find((command) => command.name === "init")!;
    const prompt = buildPracticeCommandPrompt(init, "   ");

    expect(prompt).toContain("No supplement was provided");
    expect(prompt).toContain("requirements interview");
    expect(prompt).not.toContain("User supplemental requirements after /init");
  });

  it("builds a docs prompt that forbids runtime behavior changes", () => {
    const docs = PRACTICE_SLASH_COMMANDS.find((command) => command.name === "docs")!;
    const prompt = buildPracticeCommandPrompt(docs, "write token rotation guide");

    expect(prompt).toContain("Cynos slash command /docs selected.");
    expect(prompt).toContain("practice: docs");
    expect(prompt).toContain("Do not change runtime behavior");
    expect(prompt).toContain("User supplemental requirements after /docs:");
  });

  it("builds a debug prompt that emphasizes root-cause debugging", () => {
    const debug = PRACTICE_SLASH_COMMANDS.find((command) => command.name === "debug")!;
    const prompt = buildPracticeCommandPrompt(debug, "npm test fails in pricing flow");

    expect(prompt).toContain("Cynos slash command /debug selected.");
    expect(prompt).toContain("practice: debug");
    expect(prompt).toContain("Reproduce or document why reproduction is blocked before changing code");
    expect(prompt).toContain("root cause");
    expect(prompt).toContain("User supplemental requirements after /debug:");
    expect(prompt).toContain("npm test fails in pricing flow");
  });

  it("builds a test prompt that keeps verdict and product-readonly boundaries", () => {
    const test = PRACTICE_SLASH_COMMANDS.find((command) => command.name === "test")!;
    const prompt = buildPracticeCommandPrompt(test, "run smoke");
    expect(prompt).toContain("Cynos slash command /test selected.");
    expect(prompt).toContain("practice: test");
    expect(prompt).toContain("PASS, FAIL, FLAKE, and BLOCKED");
    expect(prompt).toContain("Do not modify product source");
  });

  it("builds a develop prompt that warns against switching to default", () => {
    const develop = PRACTICE_SLASH_COMMANDS.find((command) => command.name === "develop")!;
    const prompt = buildPracticeCommandPrompt(develop, "add pricing API endpoint");

    expect(prompt).toContain("Cynos slash command /develop selected.");
    expect(prompt).toContain("practice: develop");
    expect(prompt).toContain("Do not switch to default");
    expect(prompt).toContain("User supplemental requirements after /develop:");
    expect(prompt).toContain("add pricing API endpoint");
  });

  it("builds a ui-design prompt that mandates browser evidence", () => {
    const uiDesign = PRACTICE_SLASH_COMMANDS.find((command) => command.name === "ui-design")!;
    const prompt = buildPracticeCommandPrompt(uiDesign, "polish settings page visuals");

    expect(prompt).toContain("Cynos slash command /ui-design selected.");
    expect(prompt).toContain("practice: ui-design");
    expect(prompt).toContain("Browser evidence is mandatory");
    expect(prompt).toContain("brand-spec.md");
    expect(prompt).toContain("User supplemental requirements after /ui-design:");
    expect(prompt).toContain("polish settings page visuals");
  });

  it("builds a usability prompt that is browser-first and observe-only friendly", () => {
    const usability = PRACTICE_SLASH_COMMANDS.find((command) => command.name === "usability")!;
    const prompt = buildPracticeCommandPrompt(usability, "check mobile responsive at 375px");

    expect(prompt).toContain("Cynos slash command /usability selected.");
    expect(prompt).toContain("practice: usability");
    expect(prompt).toContain("browser-first");
    expect(prompt).toContain("observe-only is allowed");
    expect(prompt).toContain("User supplemental requirements after /usability:");
    expect(prompt).toContain("check mobile responsive at 375px");
  });

  it("builds a default prompt that warns against bypassing specific practices", () => {
    const def = PRACTICE_SLASH_COMMANDS.find((command) => command.name === "default")!;
    const prompt = buildPracticeCommandPrompt(def, "update README badge URLs");

    expect(prompt).toContain("Cynos slash command /default selected.");
    expect(prompt).toContain("practice: default");
    expect(prompt).toContain("not a shortcut to bypass");
    expect(prompt).toContain("User supplemental requirements after /default:");
    expect(prompt).toContain("update README badge URLs");
  });
});
