/**
 * DebrisCommand - Debris particle control (uses game's weather system)
 */

import { Command, type CommandDef } from "../Command";

export default class DebrisCommand extends Command {
  readonly definition: CommandDef = {
    name: "debris",
    description: "Debris particle control",
    usage: "debris <leaves|trash|dust|mixed|off|density|size|speed>",
    subcommands: [
      { name: "leaves", description: "Start leaves debris" },
      { name: "trash", description: "Start trash debris" },
      { name: "dust", description: "Start dust debris" },
      { name: "mixed", description: "Start mixed debris" },
      { name: "off", description: "Stop debris" },
      { name: "density", description: "Set debris density", args: [{ name: "value", type: "number" }] },
      { name: "size", description: "Set debris size", args: [{ name: "value", type: "number" }] },
      {
        name: "speed",
        description: "Set debris speed",
        args: [
          { name: "min", type: "number" },
          { name: "max", type: "number" },
        ],
      },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const weather = window.weather;

    if (!weather) {
      return "Weather system not available (game not started)";
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "leaves":
        weather.debris("leaves");
        return "Leaves debris started";

      case "trash":
        weather.debris("trash");
        return "Trash debris started";

      case "dust":
        weather.debris("dust");
        return "Dust debris started";

      case "mixed":
        weather.debris("mixed");
        return "Mixed debris started";

      case "off":
        weather.debris(false);
        return "Debris stopped";

      case "density": {
        const v = parseFloat(args[1]);
        if (Number.isNaN(v)) return "Usage: debris density <0-1>";
        weather.debrisDensity(v);
        return `Debris density: ${v}`;
      }

      case "size": {
        const v = parseFloat(args[1]);
        if (Number.isNaN(v)) return "Usage: debris size <number>";
        weather.debrisSize(v);
        return `Debris size: ${v}`;
      }

      case "speed": {
        const min = parseFloat(args[1]);
        const max = parseFloat(args[2]) || min * 2;
        if (Number.isNaN(min)) return "Usage: debris speed <min> [max]";
        weather.debrisSpeed?.(min, max);
        return `Debris speed: ${min} - ${max}`;
      }

      default:
        return "Subcommands: leaves, trash, dust, mixed, off, density <0-1>, size <n>, speed <min> [max]";
    }
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["leaves", "trash", "dust", "mixed", "off", "density", "size", "speed"];
    }
    return [];
  }
}
