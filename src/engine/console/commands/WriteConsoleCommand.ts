/**
 * WriteConsoleCommand - Copy console output to clipboard
 */

import { Command, type CommandDef } from "../Command";

export default class WriteConsoleCommand extends Command {
  readonly definition: CommandDef = {
    name: "writeconsole",
    aliases: ["condump"],
    description: "Copy console output to clipboard",
  };

  async execute(): Promise<string | void> {
    try {
      // Get visible console output from DOM
      const outputEl = document.querySelector(".debug-console-output");
      if (!outputEl) {
        return "Console output not available";
      }

      const content = outputEl.textContent || "";
      if (!content.trim()) {
        return "No console output to copy";
      }

      await navigator.clipboard.writeText(content);
      return `Console output copied to clipboard (${content.length} chars)`;
    } catch (e) {
      return `Failed to copy: ${e}`;
    }
  }
}
