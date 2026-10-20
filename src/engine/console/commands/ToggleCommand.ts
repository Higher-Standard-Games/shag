/**
 * ToggleCommand - Toggle a boolean cvar
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";

export default class ToggleCommand extends Command {
  readonly definition: CommandDef = {
    name: "toggle",
    description: "Toggle a boolean cvar",
    usage: "toggle <cvar>",
  };

  async execute(args: string[]): Promise<string | undefined> {
    if (args.length === 0) {
      return "Usage: toggle <cvar>";
    }

    const name = args[0];

    if (!Cvar.exists(name)) {
      return `Unknown cvar: ${name}`;
    }

    const success = Cvar.toggle(name);
    if (success) {
      return `${name} = ${Cvar.get(name)}`;
    } else {
      return `Failed to toggle ${name}`;
    }
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      // Return boolean cvars
      return Cvar.getNames().filter((name) => {
        const cvar = Cvar.getCvar(name);
        return cvar?.type === "bool";
      });
    }
    return [];
  }
}
