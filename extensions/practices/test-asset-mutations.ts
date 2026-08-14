import type { CapturedToolResult, WorkState } from "../core/types";
import { extractToolPath, isWriteLike, pathLooksLikeTestAsset } from "./helpers";
import { detectProjectMutationTargets, type ProjectMutationKind } from "./mutation-targets";

export interface TestAssetMutation {
  result: CapturedToolResult;
  index: number;
  path: string;
  kind: ProjectMutationKind;
}

const TEST_ASSET_WRITE_KINDS = new Set<ProjectMutationKind>([
  "tool-write",
  "tool-edit",
  "redirect-write",
  "tee-write",
  "copy-write",
  "move",
  "touch",
  "mkdir",
  "sed-in-place",
]);

const TEST_ASSET_DELETE_KINDS = new Set<ProjectMutationKind>([
  "delete",
]);

export function findTestAssetMutations(work: WorkState): TestAssetMutation[] {
  const results = work.capturedToolResults ?? [];
  const mutations: TestAssetMutation[] = [];
  for (const [index, result] of results.entries()) {
    if (result.isError) continue;
    for (const target of mutationTargetsForResult(work, result)) {
      if (!pathLooksLikeTestAsset(target.path)) continue;
      mutations.push({ result, index, path: target.path, kind: target.kind });
    }
  }
  return mutations;
}

export function findTestAssetWrites(work: WorkState): TestAssetMutation[] {
  return findTestAssetMutations(work).filter((mutation) => TEST_ASSET_WRITE_KINDS.has(mutation.kind));
}

export function findRetainedTestAssetPaths(work: WorkState): string[] {
  const retained = new Set<string>();
  for (const mutation of findTestAssetMutations(work)) {
    if (TEST_ASSET_DELETE_KINDS.has(mutation.kind)) {
      retained.delete(mutation.path);
    } else if (TEST_ASSET_WRITE_KINDS.has(mutation.kind)) {
      retained.add(mutation.path);
    }
  }
  return [...retained];
}

function mutationTargetsForResult(work: WorkState, result: CapturedToolResult): Array<{ path: string; kind: ProjectMutationKind }> {
  if (work.cwd) return detectProjectMutationTargets(work.cwd, result.toolName, result.input);
  if (!isWriteLike(result)) return [];
  const path = extractToolPath(result);
  return path && pathLooksLikeTestAsset(path)
    ? [{ path, kind: result.toolName === "write" ? "tool-write" : "tool-edit" }]
    : [];
}
