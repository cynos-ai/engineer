import type { WorkState } from "../core/types";
import { normalizePath, pathAllowedForTest, pathLooksLikeTestAsset } from "./helpers";

export function isAllowedTestFinalizationGitCommand(command: string, cwd: string, work?: WorkState): boolean {
  const segments = gitCommandSegments(command).filter((segment) => !/^cd\b/.test(segment));
  if (segments.length === 0) return false;
  const stagedProof = work ? findLatestStagedTestAssetProof(work, cwd) : undefined;
  return segments.every((segment) => isAllowedTestGitAdd(segment, cwd) || isAllowedLocalGitCommit(segment, stagedProof));
}

function isAllowedTestGitAdd(segment: string, cwd: string): boolean {
  const tokens = shellTokens(segment);
  if (tokens[0] !== "git" || tokens[1] !== "add") return false;
  const args = tokens.slice(2);
  if (args.length === 0) return false;
  // Keep test finalization narrow: no broad staging, update-only staging, interactive/patch staging,
  // or other options whose path effect is not visible from the command text. Plain pathspecs only.
  if (args.some((token) => token !== "--" && token.startsWith("-"))) return false;
  const paths = args.filter((token) => token !== "--");
  if (paths.length === 0) return false;
  return paths.every((item) => isAllowedTestAssetPath(item, cwd));
}

function isAllowedLocalGitCommit(segment: string, stagedProof: StagedTestAssetProof | undefined): boolean {
  if (!stagedProof) return false;
  const tokens = shellTokens(segment);
  if (tokens[0] !== "git" || tokens[1] !== "commit") return false;
  if (!tokens.some((token) => token === "-m" || token.startsWith("-m") || token === "--message" || token.startsWith("--message="))) return false;
  if (tokens.some(isUnsafeCommitToken)) return false;
  return stagedProof.paths.length > 0 && stagedProof.paths.every((path) => isAllowedTestAssetPath(path, stagedProof.cwd));
}

function isUnsafeCommitToken(token: string): boolean {
  if (["-a", "--all", "--amend", "--allow-empty", "--allow-empty-message", "--no-verify", "--fixup", "--squash", "-C", "-c", "--reuse-message", "--reedit-message"].includes(token)) return true;
  if (/^--(fixup|squash|reuse-message|reedit-message)=/.test(token)) return true;
  // Short option clusters such as -am / -avm include -a and would commit tracked non-test changes.
  if (/^-[^-].*a/.test(token)) return true;
  return false;
}

interface StagedTestAssetProof {
  cwd: string;
  paths: string[];
}

function findLatestStagedTestAssetProof(work: WorkState, cwd: string): StagedTestAssetProof | undefined {
  const results = work.capturedToolResults ?? [];
  for (let index = results.length - 1; index >= 0; index--) {
    const result = results[index];
    if (result.toolName !== "bash" || result.isError) continue;
    const command = String(result.input.command ?? "");
    if (!isCachedNameOnlyDiff(command)) continue;
    const paths = parsePathLines(result.outputSummary ?? "");
    if (paths.length === 0) return undefined;
    if (paths.every((path) => isAllowedTestAssetPath(path, cwd))) return { cwd, paths };
    return undefined;
  }
  return undefined;
}

function isCachedNameOnlyDiff(command: string): boolean {
  return gitCommandSegments(command).some((segment) => {
    const tokens = shellTokens(segment);
    if (tokens[0] !== "git" || tokens[1] !== "diff") return false;
    return tokens.includes("--name-only") && (tokens.includes("--cached") || tokens.includes("--staged"));
  });
}

function parsePathLines(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

function isAllowedTestAssetPath(item: string, cwd: string): boolean {
  const normalized = normalizePath(item).replace(/^\.\//, "");
  if (normalized === "." || normalized === "") return false;
  return pathLooksLikeTestAsset(normalized) && pathAllowedForTest(item, cwd);
}

function gitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    const next = command[index + 1];
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if ((char === "&" && next === "&") || (char === "|" && next === "|") || char === ";" || char === "\n") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      if ((char === "&" && next === "&") || (char === "|" && next === "|")) index++;
      continue;
    }
    current += char;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function shellTokens(segment: string): string[] {
  return segment.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? [];
}
