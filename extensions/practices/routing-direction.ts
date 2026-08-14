import { classifyDefaultBoundary, normalizePath, pathAllowedForDocs, pathLooksLikePackageOrBehavioralConfig, pathLooksLikeRuntimeConfig, pathLooksLikeSourceOrTest, pathLooksLikeTestAsset } from "./helpers";

export type RoutePracticeHint = "default" | "docs" | "develop" | "test" | "release" | "onboard";

export function routePracticeForPath(path: string): RoutePracticeHint {
  const normalized = normalizePath(path).replace(/^\.\//, "");
  const boundary = classifyDefaultBoundary(normalized);
  if (boundary.allowed) return "default";
  if (boundary.targetPractice !== "none") return boundary.targetPractice as RoutePracticeHint;
  if (pathAllowedForDocs(normalized)) return "docs";
  if (pathLooksLikeRuntimeConfig(normalized) || pathLooksLikePackageOrBehavioralConfig(normalized)) return "develop";
  if (pathLooksLikeTestAsset(normalized)) return "test";
  if (pathLooksLikeSourceOrTest(normalized)) return "develop";
  return "default";
}

export function routeDirectionForPath(path: string): string {
  const normalized = normalizePath(path).replace(/^\.\//, "");
  const boundary = classifyDefaultBoundary(normalized);
  if (boundary.allowed && boundary.kind === "default-hint") return "repo metadata (.gitignore/.editorconfig/root LICENSE*) -> default";
  if (boundary.allowed) return "unknown/gray project maintenance -> default fallback if no specific practice fits";
  if (boundary.targetPractice === "docs") return "prose docs/reports -> docs";
  if (boundary.targetPractice === "test") return "test assets / testing a feature -> test if testing is the primary purpose; develop if the test is part of implementation";
  if (boundary.targetPractice === "release") return "release side effects or release-system files -> release";
  if (boundary.targetPractice === "onboard") return "project memory -> onboard";
  if (boundary.targetPractice === "none") return "project-external/personal config -> no project practice";
  return "source/runtime/build/package/CI config -> develop (or debug/refactor if that is the user's intent)";
}
