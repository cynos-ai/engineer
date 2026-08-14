export const PRACTICE_IDS = [
  "default",
  "review",
  "docs",
  "onboard",
  "init",
  "debug",
  "test",
  "develop",
  "refactor",
  "ui-design",
  "usability",
  "release",
] as const;

export type PracticeId = typeof PRACTICE_IDS[number];
