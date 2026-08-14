import type { Checkpoint, WorkState } from "../../core/types";
import { classifyDefaultBoundary, isReleaseSideEffectCommand, objectAt, stringAt, stringList, toProjectRelativePath } from "../helpers";
import { findMutationEvidenceForPath, listProjectContentMutations } from "../mutation-targets";
import { notSatisfied, satisfied } from "./common";

export const defaultWorkRecordedCheckpoint: Checkpoint = {
  id: "default-work-recorded",
  rule: "default is a lightweight fallback: it must honestly record delivered file changes, must not complete clearly owned practice work, and must never bypass release authorization.",
  check(work) {
    const defaultEvidence = objectAt(work.completionEvidence?.default);
    const workEvidence = objectAt(defaultEvidence?.work);
    if (!workEvidence) return notSatisfied("missing completionEvidence.default.work");
    if (!stringAt(workEvidence.summary)) return notSatisfied("default.work.summary must not be empty");

    const releaseCommands = releaseSideEffectCommands(work);
    if (releaseCommands.length > 0) {
      return notSatisfied([
        "Why: push/tag/publish/deploy/release CI have external side effects and require release authorization.",
        `Missing: this default work attempted release side-effect command(s): ${releaseCommands.join("; ")}`,
        "Next: abandon/restart with cynos_start_work(practice=\"release\") after confirming release scope.",
      ].join(" "));
    }

    const contentMutations = listProjectContentMutations(work);
    const filesChanged = stringList(workEvidence.filesChanged);
    const noFileChangeReason = stringAt(workEvidence.noFileChangeReason);
    if (filesChanged.length === 0 && contentMutations.length > 0 && !explainsNoDeliveredChange(noFileChangeReason)) {
      return notSatisfied([
        "Why: default completion must honestly record delivered project file changes.",
        `Missing: captured project content mutations exist (${contentMutations.map((mutation) => mutation.path).join(", ")}), but default.work.filesChanged[] is empty and noFileChangeReason does not explain temporary/reverted/non-delivered mutations.`,
        "Next: list delivered changed files in default.work.filesChanged[], or explain in noFileChangeReason that the captured mutations were temporary, reverted, or non-delivered.",
      ].join(" "));
    }

    for (const file of filesChanged) {
      const normalized = toProjectRelativePath(file, work.cwd);
      const evidence = findMutationEvidenceForPath(work, normalized, { allowBroadGitMutation: false });
      if (!evidence) {
        return notSatisfied([
          "Why: default completion must be backed by real captured work evidence.",
          `Missing: default.work.filesChanged[] lists ${file}, but no captured mutation for that path exists.`,
          "Next: either perform the file change, or remove it from filesChanged[] if it was not delivered.",
        ].join(" "));
      }
    }

    for (const mutation of contentMutations) {
      const boundary = classifyDefaultBoundary(mutation.path, work.cwd);
      if (!boundary.allowed) {
        const next = boundary.targetPractice === "none"
          ? "Do this outside a project practice if it matches the user's request."
          : `Abandon/restart with ${boundary.targetPractice} if this mutation matches the user's request.`;
        return notSatisfied([
          "Why: default is the fallback after specific practice ownership is ruled out.",
          `Missing: this work mutated ${mutation.path}, which is owned by ${boundary.targetPractice}.`,
          `Reason: ${boundary.reason}.`,
          `Next: ${next}`,
        ].join(" "));
      }
    }

    return satisfied(filesChanged.length > 0 ? `default work recorded with ${filesChanged.length} file changes` : "default work recorded without delivered file changes");
  },
};

function releaseSideEffectCommands(work: WorkState): string[] {
  return (work.capturedToolResults ?? [])
    .filter((result) => result.toolName === "bash" && isReleaseSideEffectCommand(String(result.input.command ?? "")))
    .map((result) => String(result.input.command ?? "").trim())
    .filter(Boolean);
}

function explainsNoDeliveredChange(reason: string): boolean {
  return /(temporary|temp|reverted|rolled\s*back|non[-\s]?delivered|not\s+delivered|scratch|evidence)/i.test(reason);
}
