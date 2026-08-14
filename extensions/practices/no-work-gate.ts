import { isGitCommitCommand, isReleaseSideEffectCommand } from "./helpers";
import { detectProjectMutationTargets, type ProjectMutationTarget } from "./mutation-targets";
import { routeDirectionForPath } from "./routing-direction";

export interface NoWorkGateDecision {
  block: boolean;
  reason?: string;
  message?: string;
}

export function evaluateNoWorkMutation(cwd: string, toolName: string, input: Record<string, unknown> = {}): NoWorkGateDecision {
  if (toolName.startsWith("cynos_")) return { block: false };
  if (isReadOnlyTool(toolName)) return { block: false };

  if (toolName === "bash") {
    const command = String(input.command ?? "").trim();
    if (!command) return { block: false };
    if (isReleaseSideEffectCommand(command)) return blockRelease(command);
    if (isGitCommitCommand(command)) return block("git commit", "git commit belongs to an active work finalization flow.", "Start the relevant practice first, then commit during finalization.");
  }

  const targets = detectProjectMutationTargets(cwd, toolName, input);
  if (targets.length > 0) return blockProjectMutation(targets);

  if (toolName === "bash" || toolName === "write" || toolName === "edit") return { block: false };
  return block(
    `non-read-only tool ${toolName}`,
    "This tool may mutate project state and there is no active Cynos work.",
    "If this is project work, start the appropriate practice first. If it is purely read-only, use read/grep/find/ls or another read-only tool.",
  );
}

function blockProjectMutation(targets: ProjectMutationTarget[]): NoWorkGateDecision {
  const first = targets[0];
  const direction = routeDirectionForPath(first.path);
  const listed = targets.slice(0, 5).map((target) => `${target.path} (${target.kind})`).join(", ");
  const more = targets.length > 5 ? `, ... +${targets.length - 5} more` : "";
  return block(
    `project file mutation: ${listed}${more}`,
    "Modifying project files requires an active Cynos work record so the change can be audited and completed through checkpoints.",
    `Direction: ${direction}. Call cynos_start_work with the appropriate practice before mutating project files.`,
  );
}

function blockRelease(command: string): NoWorkGateDecision {
  return block(
    `release side-effect command: ${command}`,
    "Push, tag, publish, deploy, CI/CD release, and post-release side effects require release practice authorization.",
    "Call cynos_start_work(practice=\"release\") after confirming the release scope with the user.",
  );
}

function block(feature: string, why: string, next: string): NoWorkGateDecision {
  const text = [
    "Cynos no-work gate blocked this action.",
    `Blocked: ${feature}`,
    `Why: ${why}`,
    `Next: ${next}`,
    "Allowed without active work: read-only exploration, non-mutating build/test/lint, and project-external temporary/personal files.",
  ].join("\n");
  return { block: true, reason: text, message: text };
}

function isReadOnlyTool(toolName: string): boolean {
  return new Set(["read", "grep", "find", "ls", "cynos_search", "cynos_fetch"]).has(toolName);
}
