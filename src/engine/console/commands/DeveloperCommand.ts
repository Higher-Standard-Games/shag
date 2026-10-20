import { Cvar } from "../../core/Cvar";
import { Command, type CommandOutput, fail } from "../Command";

export default class DeveloperCommand extends Command {
  definition = {
    name: "developer",
    description: "Enable or disable developer mode",
    usage: "developer [0|1]",
    aliases: ["dev"],
  };

  async execute(args: string[]): Promise<CommandOutput> {
    if (args.length === 0) {
      const current = Cvar.getBool("developer");
      return `Developer mode is ${current ? "enabled" : "disabled"}`;
    }

    const value = args[0].toLowerCase();
    let newValue: number;

    if (value === "1" || value === "on" || value === "true" || value === "enable") {
      newValue = 1;
    } else if (value === "0" || value === "off" || value === "false" || value === "disable") {
      newValue = 0;
    } else {
      return "Usage: developer [0|1|on|off|enable|disable]";
    }

    // Register the cvar if it doesn't exist
    if (!Cvar.getNames().includes("developer")) {
      Cvar.register("developer", 0, {
        type: "int",
        min: 0,
        max: 1,
        description: "Enable developer mode (shows/hides developer commands)",
      });
    }

    if (!Cvar.set("developer", newValue)) {
      return fail("Developer mode is disabled in production builds");
    }
    return `Developer mode ${newValue ? "enabled" : "disabled"}`;
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["0", "1", "on", "off", "enable", "disable"];
    }
    return [];
  }
}
