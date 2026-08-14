import { readJsonFileOptional } from "./fs-utils";
import { cynosToolsConfigPath, legacyCynosConfigPath } from "./paths";

// Read-only access to the visionModel configured in @cynos-ai/tools.
//
// looker (cynos_subagent agent="looker") still needs a visionModel to run. After the
// Tools split, that setting lives in ~/.pi/agent/cynos-tools.json. This reader never
// writes either file — Tools owns the write path via /cynos-tools-config.
//
// Fallback chain:
//   1. ~/.pi/agent/cynos-tools.json -> visionModel
//   2. ~/.pi/agent/cynos-config.json -> visionModel   (legacy, kept for one or two versions)
//
// This keeps looker working for users who have not re-run /cynos-tools-config since
// the split, without Engineer reaching into Tools internals.

export async function readToolsVisionModel(): Promise<string | undefined> {
  const tools = await readJsonFileOptional<{ visionModel?: unknown }>(cynosToolsConfigPath());
  if (typeof tools?.visionModel === "string" && tools.visionModel.trim()) {
    return tools.visionModel.trim();
  }
  const legacy = await readJsonFileOptional<{ visionModel?: unknown }>(legacyCynosConfigPath());
  if (typeof legacy?.visionModel === "string" && legacy.visionModel.trim()) {
    return legacy.visionModel.trim();
  }
  return undefined;
}
