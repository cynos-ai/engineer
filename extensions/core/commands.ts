import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCurrentWork, readLastOutcome } from "./state";
import { buildReportSummary } from "./report";

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("cynos-report", {
    description: "Analyze the completion status of the current/most recent Cynos task.",
    handler: async (_args, ctx) => {
      const loaded = await loadCurrentWork(ctx.cwd);
      const last = await readLastOutcome(ctx.cwd);
      pi.sendMessage({
        customType: "cynos-report",
        content: buildReportSummary(loaded, last),
        display: true,
      });
    },
  });
}
