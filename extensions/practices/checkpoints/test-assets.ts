import type { Checkpoint } from "../../core/types";
import { findSuccessfulCleanTestExecution, findSuccessfulSubstantiveCheck, objectAt } from "../helpers";
import { findTestAssetWrites } from "../test-asset-mutations";
import { notSatisfied, satisfied } from "./common";

// "test-assets" means durable/throwaway testing artifacts, not the `test` practice.
// Modifying practices require success when they write tests to prove their change.
export const testAssetsPassedIfWrittenCheckpoint: Checkpoint = {
  id: "test-assets-passed-if-written",
  rule: "If any test assets are written, the test command or browser verification must actually be run, and the result must be successful and clean.",
  check(work) {
    const writes = findTestAssetWrites(work);
    if (writes.length === 0) return satisfied("no test assets written");
    const verification = objectAt(work.completionEvidence?.verification);
    // noTestSuite accommodation: when the project declared no automated runner, do NOT demand a
    // recognized test runner (pytest/npm test) — that would deadlock (F6 smoke). Use the same
    // substantive-check standard as verification-command-passed, via the shared helper, so the
    // two checkpoints agree.
    const evidence = verification?.noTestSuite === true
      ? findSuccessfulSubstantiveCheck(work)
      : findSuccessfulCleanTestExecution(work);
    if (!evidence) return notSatisfied(`test assets were written but no test command/browser verification ran successfully and clean: ${writes.map((item) => item.path).filter(Boolean).join(", ")}`);
    return satisfied("verified successfully after test assets were written", [{ toolCallId: evidence.toolCallId }]);
  },
};
