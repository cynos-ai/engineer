import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildPracticeCommandPrompt, PRACTICE_SLASH_COMMANDS } from "./definitions";

export function registerPracticeSlashCommands(pi: ExtensionAPI): void {
  for (const definition of PRACTICE_SLASH_COMMANDS) {
    pi.registerCommand(definition.name, {
      description: `${definition.description} ${definition.supplementHint}`,
      handler: async (args, ctx) => {
        const prompt = buildPracticeCommandPrompt(definition, args ?? "");
        if (ctx.isIdle()) {
          pi.sendUserMessage(prompt);
          return;
        }
        pi.sendUserMessage(prompt, { deliverAs: "followUp" });
        ctx.ui.notify(`/${definition.name} queued as follow-up`, "info");
      },
    });
  }
}
