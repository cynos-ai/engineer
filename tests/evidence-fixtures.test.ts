import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { getPractice } from "../extensions/practices/registry";
import type { CheckpointResult, WorkState } from "../extensions/core/types";

interface EvidenceFixture {
  id: string;
  checkpoint: string;
  work: WorkState;
  expected: {
    satisfied: boolean;
    detailsIncludes?: string;
    reasonIncludes?: string;
  };
}

const fixtureDirectory = path.resolve(process.cwd(), "tests/fixtures/evidence");
const fixtureFiles = fs
  .readdirSync(fixtureDirectory)
  .filter((file) => file.endsWith(".json"))
  .sort();

function loadFixture(file: string): EvidenceFixture {
  return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, file), "utf8")) as EvidenceFixture;
}

describe("evidence golden fixtures", () => {
  it("has deterministic fixture coverage", () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of fixtureFiles) {
    const fixture = loadFixture(file);
    it(`${fixture.id} (${file})`, () => {
      const checkpoint = getPractice(fixture.work.practice).checkpoints.find((item) => item.id === fixture.checkpoint);
      expect(checkpoint, `checkpoint ${fixture.work.practice}.${fixture.checkpoint} must exist`).toBeDefined();

      const result = checkpoint!.check(fixture.work) as CheckpointResult;
      expect(result.satisfied).toBe(fixture.expected.satisfied);

      if (fixture.expected.satisfied) {
        if (!result.satisfied) throw new Error(`expected a satisfied result, got: ${result.reason}`);
        if (fixture.expected.detailsIncludes) {
          expect(result.details ?? "").toContain(fixture.expected.detailsIncludes);
        }
      } else {
        if (result.satisfied) throw new Error(`expected a rejected result, got: ${result.details ?? "no details"}`);
        if (fixture.expected.reasonIncludes) {
          expect(result.reason ?? "").toContain(fixture.expected.reasonIncludes);
        }
      }
    });
  }
});
