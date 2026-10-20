/**
 * ResetCommand - Reset cvars to default values
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";

export default class ResetCommand extends Command {
  readonly definition: CommandDef = {
    name: "reset",
    description: "Reset a cvar to its default value",
    usage: "reset <cvar>",
  };

  async execute(args: string[]): Promise<string | undefined> {
    if (args.length === 0) {
      return "Usage: reset <cvar>";
    }

    const name = args[0];

    if (!Cvar.exists(name)) {
      return `Unknown cvar: ${name}`;
    }

    const success = Cvar.reset(name);
    if (success) {
      return `${name} reset to ${Cvar.get(name)}`;
    } else {
      return `Failed to reset ${name}`;
    }
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return Cvar.getNames();
    }
    return [];
  }
}
