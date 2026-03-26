/**
 * SettingsCommand - Engine settings export/import
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";

export default class SettingsCommand extends Command {
  readonly definition: CommandDef = {
    name: "settings",
    description: "Engine settings export/import",
    usage: "settings <export|import|list>",
    subcommands: [
      { name: "export", description: "Export settings to clipboard" },
      { name: "import", description: "Import settings from clipboard" },
      { name: "list", description: "List all modified settings" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "export": {
        const config = Cvar.exportConfig();
        if (!config.trim()) {
          return "No modified settings to export";
        }

        try {
          await navigator.clipboard.writeText(config);
          const lineCount = config.split("\n").filter((l) => l.trim()).length;
          return `Exported ${lineCount} settings to clipboard`;
        } catch (e) {
          return `Failed to copy: ${e}`;
        }
      }

      case "import": {
        try {
          const config = await navigator.clipboard.readText();
          if (!config.trim()) {
            return "Clipboard is empty";
          }

          Cvar.execConfig(config);
          const lineCount = config.split("\n").filter((l) => l.trim() && !l.startsWith("//")).length;
          return `Imported ${lineCount} settings from clipboard`;
        } catch (e) {
          return `Failed to read clipboard: ${e}`;
        }
      }
      default: {
        const cvars = Cvar.list();
        const modified = cvars.filter((c) => c.value !== c.defaultValue);

        if (modified.length === 0) {
          return "No modified settings";
        }

        const lines = [`${modified.length} modified settings:`];
        for (const cvar of modified) {
          lines.push(`  ${cvar.name} = ${JSON.stringify(cvar.value)} (default: ${JSON.stringify(cvar.defaultValue)})`);
        }
        return lines.join("\n");
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["export", "import", "list"];
    }
    return [];
  }
}
