/**
 * GodCommand - Toggle god mode (invincibility)
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef, type CommandOutput, fail } from "../Command";

const CVAR_NAME = "g_godmode";
Cvar.register(CVAR_NAME, false, {
  developer: true,
  type: "bool",
  description: "God mode (invincibility)",
});

export default class GodCommand extends Command {
  readonly definition: CommandDef = {
    name: "god",
    description: "Toggle god mode (invincibility)",
    developer: true,
  };

  async execute(): Promise<CommandOutput> {
    const enabled = !Cvar.getBool(CVAR_NAME);
    if (!Cvar.set(CVAR_NAME, enabled)) return fail("God mode requires developer mode.");
    return `God mode: ${enabled ? "ON" : "OFF"}`;
  }
}
