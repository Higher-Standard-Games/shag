/**
 * FreeflyCommand - Freefly camera controls
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";
// Side-effect import: registers cam_freefly_speed cvar
import "../../camera/controllers/FreeflyController";

export default class FreeflyCommand extends Command {
  readonly definition: CommandDef = {
    name: "freefly_speed",
    description: "Get/set freefly camera speed",
    usage: "freefly_speed [value]",
    developer: true,
  };

  async execute(args: string[]): Promise<string | undefined> {
    const cvarName = "cam_freefly_speed";

    if (args.length === 0) {
      const current = Cvar.get(cvarName);
      if (current !== undefined) {
        return `freefly_speed = ${current}`;
      }
      return "Freefly speed cvar not registered";
    }

    const value = parseFloat(args[0]);
    if (Number.isNaN(value) || value < 0) {
      return "Usage: freefly_speed <value> (positive number)";
    }

    if (Cvar.exists(cvarName)) {
      Cvar.set(cvarName, value);
      return `freefly_speed = ${value}`;
    }

    return "Freefly speed cvar not registered";
  }
}
