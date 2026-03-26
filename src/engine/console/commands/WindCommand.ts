/**
 * WindCommand - Wind control (uses game's weather system)
 */

import { Command, type CommandDef } from "../Command";

export default class WindCommand extends Command {
  readonly definition: CommandDef = {
    name: "wind",
    description: "Wind control",
    usage: "wind <on|off|strength|direction> [value]",
    subcommands: [
      { name: "on", description: "Enable wind" },
      { name: "off", description: "Disable wind" },
      { name: "strength", description: "Set wind strength", args: [{ name: "value", type: "number" }] },
      {
        name: "direction",
        description: "Set wind direction",
        args: [
          { name: "x", type: "number" },
          { name: "y", type: "number" },
          { name: "z", type: "number" },
        ],
      },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const weather = (window as any).weather;

    if (!weather) {
      return "Weather system not available (game not started)";
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "on":
        weather.wind(true);
        return "Wind started";

      case "off":
        weather.wind(false);
        return "Wind stopped";

      case "strength": {
        const strength = parseFloat(args[1]);
        if (Number.isNaN(strength)) {
          return "Usage: wind strength <0-1>";
        }
        weather.windStrength(strength);
        return `Wind strength: ${strength}`;
      }

      case "direction": {
        const x = parseFloat(args[1]);
        const y = parseFloat(args[2]);
        const z = parseFloat(args[3]);
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
          return "Usage: wind direction <x> <y> <z>";
        }
        weather.windDirection?.(x, y, z);
        return `Wind direction: (${x}, ${y}, ${z})`;
      }

      default:
        return "Subcommands: on, off, strength <0-1>, direction <x> <y> <z>";
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["on", "off", "strength", "direction"];
    }
    return [];
  }
}
