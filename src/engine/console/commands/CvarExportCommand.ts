/**
 * CvarExportCommand - Export cvars to clipboard
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";

export default class CvarExportCommand extends Command {
  readonly definition: CommandDef = {
    name: "cvarexport",
    description: "Export modified cvars to clipboard",
  };

  async execute(): Promise<string | void> {
    const config = Cvar.exportConfig();

    if (!config.trim()) {
      return "No modified cvars to export";
    }

    try {
      await navigator.clipboard.writeText(config);
      const lineCount = config.split("\n").filter((l) => l.trim()).length;
      return `Exported ${lineCount} cvars to clipboard`;
    } catch (e) {
      return `Failed to copy: ${e}`;
    }
  }
}
