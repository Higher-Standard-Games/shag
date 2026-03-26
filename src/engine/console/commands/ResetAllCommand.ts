/**
 * ResetAllCommand - Reset all cvars to default values
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";

export default class ResetAllCommand extends Command {
  readonly definition: CommandDef = {
    name: "resetall",
    description: "Reset all cvars to default values",
  };

  async execute(): Promise<string | undefined> {
    Cvar.resetAll();
    return "All cvars reset to default values";
  }
}
