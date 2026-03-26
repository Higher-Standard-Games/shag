/**
 * GodCommand - Toggle god mode (invincibility)
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";

export default class GodCommand extends Command {
  readonly definition: CommandDef = {
    name: "god",
    description: "Toggle god mode (invincibility)",
    developer: true,
  };

  async execute(): Promise<string | undefined> {
    const cvarName = "g_godmode";

    // Toggle or create the cvar
    if (Cvar.exists(cvarName)) {
      const current = Cvar.getBool(cvarName);
      Cvar.set(cvarName, !current);
      return `God mode: ${!current ? "ON" : "OFF"}`;
    }

    // Register if it doesn't exist
    Cvar.register(cvarName, true, {
      type: "bool",
      description: "God mode (invincibility)",
    });

    return "God mode: ON";
  }
}
