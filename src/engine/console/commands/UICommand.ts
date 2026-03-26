/**
 * UICommand - UI settings and controls
 */

import { Command, type CommandDef } from "../Command";

export default class UICommand extends Command {
  readonly definition: CommandDef = {
    name: "ui",
    description: "UI settings and controls",
    usage: "ui <subcommand> [args]",
    subcommands: [
      { name: "scale", description: "Get/set UI scale", args: [{ name: "scale", type: "number" }] },
      {
        name: "theme",
        description: "Get/set UI theme",
        args: [{ name: "theme", type: "enum", options: ["light", "dark"] }],
      },
      { name: "info", description: "Show UI info" },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "scale": {
        try {
          const { UIScale } = await import("../../ui/UIScale");
          const uiScale = UIScale.getInstance();
          return `Current UI scale: ${uiScale.getScale()}`;
        } catch {
          return "UIScale not available";
        }
      }

      case "theme": {
        return "Theme control: Use settings menu or UITheme.setTheme() in code";
      }
      default: {
        const lines = ["UI Settings:"];

        try {
          const { UIScale } = await import("../../ui/UIScale");
          lines.push(`  Scale: ${UIScale.getInstance().getScale()}`);
        } catch {
          lines.push("  Scale: not available");
        }

        return lines.join("\n");
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["scale", "theme", "info"];
    }
    if (args.length === 1 && args[0] === "theme") {
      return ["light", "dark"];
    }
    return [];
  }
}
