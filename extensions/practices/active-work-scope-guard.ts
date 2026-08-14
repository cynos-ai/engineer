import type { WorkState } from "../core/types";
import { classifyDefaultBoundary, pathAllowedForDocs, pathAllowedForTest } from "./helpers";
import { detectProjectMutationTargets, type ProjectMutationTarget } from "./mutation-targets";
import { isAllowedTestFinalizationGitCommand } from "./test-git-finalization";
import { routePracticeForPath } from "./routing-direction";

export function evaluateActiveWorkScope(
  cwd: string,
  work: WorkState,
  toolName: string,
  input: Record<string, unknown> = {},
): { block: false } | { block: true; reason: string; message: string } {
  if (toolName.startsWith("cynos_")) return { block: false };
  if (work.practice !== "default" && work.practice !== "docs" && work.practice !== "test" && work.practice !== "review") return { block: false };

  const targets = detectProjectMutationTargets(cwd, toolName, input);
  if (targets.length === 0) return { block: false };

  // review is strictly read-only: any project mutation blocks immediately at execution time
  // (the completion-time review-read-only gate is a defense-in-depth backstop, not the primary guard).
  if (work.practice === "review") return blockReadOnly(targets[0]);

  for (const target of targets) {
    if (work.practice === "default") {
      const boundary = classifyDefaultBoundary(target.path, cwd);
      if (!boundary.allowed) return blockDefaultBoundary(target, boundary);
      continue;
    }
    if (work.practice === "docs" && !pathAllowedForDocs(target.path, cwd)) return block(work.practice, target);
    if (work.practice === "test" && target.kind === "git-mutation" && isAllowedTestFinalizationGitCommand(String(input.command ?? ""), cwd, work)) continue;
    if (work.practice === "test" && !pathAllowedForTest(target.path, cwd)) return block(work.practice, target);
  }
  return { block: false };
}

function blockReadOnly(target: ProjectMutationTarget): { block: true; reason: string; message: string } {
  const text = [
    "Cynos active-work scope guard blocked this action.",
    `Blocked: ${target.path} (${target.kind}) — review is read-only.`,
    "Why: review evaluates existing code and must not modify it. If the user wants changes implemented, abandon this review and start a modifying practice.",
    'Next: cynos_abandon_work, then cynos_start_work with the appropriate modifying practice (develop/docs/test/refactor).',
  ].join("\n");
  return { block: true, reason: text, message: text };
}

function block(currentPractice: "docs" | "test", target: ProjectMutationTarget): { block: true; reason: string; message: string } {
  const targetPractice = routePracticeForPath(target.path);
  const practice = targetPractice === currentPractice ? "develop" : targetPractice;
  const text = [
    "Cynos active-work scope guard blocked this action.",
    `Blocked: ${target.path} (${target.kind}) is outside ${currentPractice}'s write scope.`,
    `Why: this looks like ${practice} work, not ${currentPractice} work.`,
    `Next: abandon the current work with cynos_abandon_work, then start cynos_start_work(practice=\"${practice}\") if that matches the user's request.`,
  ].join("\n");
  return { block: true, reason: text, message: text };
}

function blockDefaultBoundary(target: ProjectMutationTarget, boundary: Exclude<ReturnType<typeof classifyDefaultBoundary>, { allowed: true }>): { block: true; reason: string; message: string } {
  const targetPractice = boundary.targetPractice;
  const next = targetPractice === "none"
    ? "This looks like project-external/personal configuration. Do it without a project practice if the user asked for it."
    : `Abandon the current work with cynos_abandon_work, then start cynos_start_work(practice=\"${targetPractice}\") if that matches the user's request.`;
  const text = [
    "Cynos active-work scope guard blocked this action.",
    `Blocked: ${target.path} (${target.kind}) is outside default's fallback ownership boundary.`,
    `Why: ${boundary.reason}.`,
    `Next: ${next}`,
  ].join("\n");
  return { block: true, reason: text, message: text };
}

