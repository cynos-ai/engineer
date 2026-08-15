import * as fs from "node:fs/promises";
import { pathExists } from "./fs-utils";
import { projectMdPath } from "./paths";
import { getProjectMdMaxLines } from "./config";

export interface ProjectContext {
  available: boolean;
  content?: string;
  truncated?: boolean;
  warning?: string;
}

// best-effort read of PROJECT.md.
// Missing file, permission errors, or encoding issues do not block start; return a warning instead.
// Truncation is per-line (default 600 lines), overridable via config.projectMdMaxLines.
export async function readProjectMd(cwd: string): Promise<ProjectContext> {
  const filePath = projectMdPath(cwd);
  if (!(await pathExists(filePath))) {
    return { available: false, warning: "PROJECT.md not found. Supplement the project context from the codebase and local exploration." };
  }
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return { available: false, warning: `PROJECT.md read failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const maxLines = await getProjectMdMaxLines(cwd);
  const lines = content.split("\n");
  if (lines.length > maxLines) {
    return {
      available: true,
      content: lines.slice(0, maxLines).join("\n") + `\n\n<!-- Truncated: PROJECT.md exceeds the limit; showing the first ${maxLines} lines (of ${lines.length}). See ${filePath} for the full content -->`,
      truncated: true,
    };
  }
  return { available: true, content };
}
