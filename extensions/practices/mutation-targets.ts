import * as path from "node:path";
import type { CapturedToolResult, WorkState } from "../core/types";
import { commandSegments, normalizePath, pathLooksLikeEvidenceOrScratchArtifact, pathLooksLikePackageOrBehavioralConfig, pathLooksLikeRuntimeConfig, pathLooksLikeSourceOrTest, pathLooksLikeTestAsset } from "./helpers";

export type ProjectMutationKind =
  | "tool-write"
  | "tool-edit"
  | "redirect-write"
  | "tee-write"
  | "copy-write"
  | "move"
  | "delete"
  | "touch"
  | "mkdir"
  | "sed-in-place"
  | "dependency-mutation"
  | "git-mutation";

export interface ProjectMutationTarget {
  path: string;
  kind: ProjectMutationKind;
  segment?: string;
}

export function detectProjectMutationTargets(cwd: string, toolName: string, input: Record<string, unknown> = {}): ProjectMutationTarget[] {
  if (toolName === "write" || toolName === "edit") {
    const target = resolveToolPath(input);
    const path = target ? projectRelativePath(cwd, target) : undefined;
    return path ? [{ path, kind: toolName === "write" ? "tool-write" : "tool-edit" }] : [];
  }

  if (toolName !== "bash") return [];
  const command = String(input.command ?? "").trim();
  if (!command) return [];

  const targets: ProjectMutationTarget[] = [];
  for (const segment of commandSegments(command, { splitPipe: true })) {
    targets.push(...detectBashSegmentTargets(cwd, segment));
  }
  return targets;
}

export function isInsideCwd(target: string, cwd: string): boolean {
  const resolved = path.isAbsolute(target) ? path.resolve(target) : path.resolve(cwd, target);
  const normalizedCwd = path.resolve(cwd);
  const relative = path.relative(normalizedCwd, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function projectRelativePath(cwd: string, target: string): string | undefined {
  const cleaned = cleanShellToken(target);
  if (!cleaned || isFdOrDevice(cleaned)) return undefined;
  if (!isInsideCwd(cleaned, cwd)) return undefined;
  const resolved = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(cwd, cleaned);
  const relative = path.relative(path.resolve(cwd), resolved) || ".";
  return normalizePath(relative);
}

function detectBashSegmentTargets(cwd: string, segment: string): ProjectMutationTarget[] {
  const tokens = tokenize(segment);
  const first = tokens[0] ?? "";
  const targets: ProjectMutationTarget[] = [];

  for (const target of redirectTargets(segment)) {
    const rel = projectRelativePath(cwd, target);
    if (rel) targets.push({ path: rel, kind: "redirect-write", segment });
  }

  if (first === "tee") {
    for (const token of nonOptionArgs(tokens.slice(1))) {
      const rel = projectRelativePath(cwd, token);
      if (rel) targets.push({ path: rel, kind: "tee-write", segment });
    }
  }

  if (first === "cp" || first === "install") {
    const target = lastNonOptionArg(tokens);
    const rel = target ? projectRelativePath(cwd, target) : undefined;
    if (rel) targets.push({ path: rel, kind: "copy-write", segment });
  }

  if (["mv", "move", "rename"].includes(first)) {
    for (const token of nonOptionArgs(tokens.slice(1))) {
      const rel = projectRelativePath(cwd, token);
      if (rel) targets.push({ path: rel, kind: "move", segment });
    }
  }

  if (["rm", "rmdir", "del"].includes(first)) {
    for (const token of nonOptionArgs(tokens.slice(1))) {
      const rel = projectRelativePath(cwd, token);
      if (rel) targets.push({ path: rel, kind: "delete", segment });
    }
  }

  if (first === "git") {
    const sub = tokens[1] ?? "";
    if (sub === "rm") {
      for (const token of nonOptionArgs(tokens.slice(2))) {
        const rel = projectRelativePath(cwd, token);
        if (rel) targets.push({ path: rel, kind: "delete", segment });
      }
    } else if (isGitWorkingTreeMutation(sub, tokens, segment)) {
      targets.push({ path: ".", kind: "git-mutation", segment });
    }
  }

  if (first === "touch") {
    for (const token of nonOptionArgs(tokens.slice(1))) {
      const rel = projectRelativePath(cwd, token);
      if (rel) targets.push({ path: rel, kind: "touch", segment });
    }
  }

  if (first === "mkdir") {
    for (const token of nonOptionArgs(tokens.slice(1))) {
      const rel = projectRelativePath(cwd, token);
      if (rel) targets.push({ path: rel, kind: "mkdir", segment });
    }
  }

  if (first === "sed" && /\s-i(?:\b|[^a-zA-Z])/.test(segment)) {
    for (const token of nonOptionArgs(tokens.slice(1))) {
      if (token === "sed") continue;
      const rel = projectRelativePath(cwd, token);
      if (rel) targets.push({ path: rel, kind: "sed-in-place", segment });
    }
  }

  const dependencyTarget = dependencyMutationTarget(first, tokens, segment);
  if (dependencyTarget) targets.push({ path: dependencyTarget, kind: "dependency-mutation", segment });

  return uniqueTargets(targets);
}

function resolveToolPath(input: Record<string, unknown>): string | undefined {
  for (const key of ["path", "filePath", "filename", "target"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function redirectTargets(segment: string): string[] {
  const targets: string[] = [];
  const re = /(?:\d+|&)?(>>?)\s*([^&|;\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(segment)) !== null) {
    const target = match[2];
    if (!target || target.startsWith("&")) continue;
    targets.push(target);
  }
  return targets;
}

function tokenize(segment: string): string[] {
  const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.map(cleanShellToken).filter(Boolean);
}

function cleanShellToken(token: string): string {
  return token.trim().replace(/^['"]|['"]$/g, "");
}

function nonOptionArgs(tokens: string[]): string[] {
  return tokens.filter((token) => token && !token.startsWith("-") && !token.includes("="));
}

function lastNonOptionArg(tokens: string[]): string | undefined {
  for (let i = tokens.length - 1; i >= 1; i--) {
    const token = tokens[i];
    if (token && !token.startsWith("-")) return token;
  }
  return undefined;
}

function isFdOrDevice(target: string): boolean {
  return target.startsWith("&") || /^\/dev\/(null|zero|stdout|stderr)$/i.test(target);
}

function isGitWorkingTreeMutation(sub: string, tokens: string[], segment: string): boolean {
  if (!sub) return false;
  const readOnly = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "ls-tree", "blame", "check-ignore", "describe", "for-each-ref", "merge-base", "grep"]);
  if (readOnly.has(sub)) return false;
  if (sub === "remote") return !isReadOnlyGitRemote(tokens);
  if (sub === "branch") return !isReadOnlyGitBranch(tokens, segment);
  if (sub === "tag") return !isReadOnlyGitTag(tokens);
  if (sub === "stash") return !["list", "show"].includes(tokens[2] ?? "");
  return true;
}

function isReadOnlyGitRemote(tokens: string[]): boolean {
  const action = tokens.find((token, index) => index > 1 && !token.startsWith("-"));
  return !action || ["show", "get-url"].includes(action);
}

function isReadOnlyGitBranch(tokens: string[], segment: string): boolean {
  if (/\s(-d|-D|-m|-M|--delete|--move|--set-upstream-to|--unset-upstream)\b/.test(segment)) return false;
  if (tokens.slice(2).some((token) => ["-l", "--list"].includes(token))) return true;
  const args = nonOptionArgs(tokens.slice(2));
  if (args.length > 0) return false;
  return true;
}

function isReadOnlyGitTag(tokens: string[]): boolean {
  const rest = tokens.slice(2);
  if (rest.some((token) => token === "-l" || token === "--list")) return true;
  return nonOptionArgs(rest).length === 0;
}

function dependencyMutationTarget(first: string, tokens: string[], segment: string): string | undefined {
  const sub = tokens[1] ?? "";
  if (["npm", "pnpm", "yarn", "bun"].includes(first) && /^(install|add|remove|uninstall|upgrade|update|i|rm|un)$/.test(sub)) return "package.json";
  if (["pip", "pip3", "uv", "poetry", "pipenv"].includes(first) && /^(install|add|remove|uninstall|download)$/.test(sub)) return "requirements.txt";
  if (first === "go" && (sub === "get" || sub === "install")) return "go.mod";
  if (first === "go" && sub === "mod" && /^(tidy|download|edit|vendor)$/.test(tokens[2] ?? "")) return "go.mod";
  if (first === "cargo" && /^(add|remove|update)$/.test(sub)) return "Cargo.toml";
  if (first === "dotnet" && /^(add|remove|restore)$/.test(sub)) return ".";
  if (["gem", "bundle", "bundler"].includes(first)) return "Gemfile";
  if (first === "composer") return "composer.json";
  if (first === "pub" && /^(add|remove|get|upgrade)$/.test(sub)) return "pubspec.yaml";
  if (first === "rebar3" && /^(add|upgrade)$/.test(sub)) return "rebar.config";
  if (first === "mix" && (/^(deps\.(get|unlock|add)|archive)$/.test(sub) || /^deps\./.test(sub))) return "mix.exs";
  return undefined;
}

function uniqueTargets(targets: ProjectMutationTarget[]): ProjectMutationTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.kind}:${target.path}:${target.segment ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ProjectMutationEvidence extends ProjectMutationTarget {
  toolCallId: string;
  toolResult: CapturedToolResult;
}

export function listProjectMutationTargets(work: WorkState, options: { excludeEvidenceArtifacts?: boolean } = {}): ProjectMutationEvidence[] {
  const cwd = work.cwd;
  if (!cwd) return [];
  const mutations: ProjectMutationEvidence[] = [];
  for (const result of work.capturedToolResults ?? []) {
    if (result.isError) continue;
    for (const target of detectProjectMutationTargets(cwd, result.toolName, result.input)) {
      if (options.excludeEvidenceArtifacts !== false && pathLooksLikeEvidenceOrScratchArtifact(target.path, cwd)) continue;
      mutations.push({ ...target, toolCallId: result.toolCallId, toolResult: result });
    }
  }
  return mutations;
}

export function findMutationEvidenceForPath(work: WorkState, expectedPath: string, options: { excludeEvidenceArtifacts?: boolean; allowBroadGitMutation?: boolean } = {}): ProjectMutationEvidence | undefined {
  const expected = normalizePath(expectedPath).replace(/^\.\//, "");
  return listProjectMutationTargets(work, options).find((target) => {
    const actual = normalizePath(target.path).replace(/^\.\//, "");
    if (actual === expected) return true;
    if (options.allowBroadGitMutation === true && actual === ".") return true;
    return false;
  });
}

export function listProjectContentMutations(work: WorkState): ProjectMutationEvidence[] {
  return listProjectMutationTargets(work, { excludeEvidenceArtifacts: true }).filter((mutation) => {
    if (mutation.kind === "git-mutation") return false;
    if (mutation.path === ".") return false;
    return true;
  });
}

export function mutationLooksLikeProjectContent(target: ProjectMutationTarget): boolean {
  const normalized = normalizePath(target.path).replace(/^\.\//, "");
  if (!normalized) return false;
  if ([".", "package.json", "requirements.txt", "go.mod", "Cargo.toml", "Gemfile", "composer.json", "pubspec.yaml", "rebar.config", "mix.exs"].includes(normalized)) return true;
  if (pathLooksLikeTestAsset(normalized)) return true;
  if (pathLooksLikeSourceOrTest(normalized)) return true;
  if (pathLooksLikeRuntimeConfig(normalized)) return true;
  if (pathLooksLikePackageOrBehavioralConfig(normalized)) return true;
  if (/^\.github\/(workflows|actions)\//i.test(normalized)) return true;
  if (/^\.gitlab-ci\.ya?ml$/i.test(normalized)) return true;
  if (/^\.circleci\//i.test(normalized)) return true;
  return false;
}
