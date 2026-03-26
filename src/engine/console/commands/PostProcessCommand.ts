/**
 * PostProcessCommand - Post-processing effects control
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";

export default class PostProcessCommand extends Command {
  readonly definition: CommandDef = {
    name: "pp",
    aliases: ["postprocess"],
    description: "Post-processing effects control",
    usage: "pp <effect> [value]",
    developer: true,
    subcommands: [
      { name: "bloom", description: "Set bloom intensity", args: [{ name: "value", type: "number" }] },
      { name: "exposure", description: "Set exposure", args: [{ name: "value", type: "number" }] },
      { name: "contrast", description: "Set contrast", args: [{ name: "value", type: "number" }] },
      { name: "info", description: "Show post-process info" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    // Map effect names to cvar names
    const cvarMap: Record<string, string> = {
      bloom: "r_bloom",
      exposure: "r_exposure",
      contrast: "r_contrast",
      saturation: "r_saturation",
      vignette: "r_vignette",
    };

    switch (subcommand) {
      case "bloom":
      case "exposure":
      case "contrast":
      case "saturation":
      case "vignette": {
        const cvarName = cvarMap[subcommand];
        const value = parseFloat(args[1]);

        if (Number.isNaN(value)) {
          const current = Cvar.get(cvarName);
          return current !== undefined ? `${subcommand} = ${current}` : `${subcommand} cvar not registered`;
        }

        if (Cvar.exists(cvarName)) {
          Cvar.set(cvarName, value);
          return `${subcommand} = ${value}`;
        }
        return `${subcommand} cvar not registered`;
      }
      default: {
        const effects = ["bloom", "exposure", "contrast", "saturation", "vignette"];
        const lines = ["Post-Process Effects:"];

        for (const effect of effects) {
          const cvarName = cvarMap[effect];
          if (cvarName && Cvar.exists(cvarName)) {
            lines.push(`  ${effect}: ${Cvar.get(cvarName)}`);
          }
        }

        if (lines.length === 1) {
          lines.push("  No post-process cvars registered");
        }

        return lines.join("\n");
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["bloom", "exposure", "contrast", "saturation", "vignette", "info"];
    }
    return [];
  }
}
