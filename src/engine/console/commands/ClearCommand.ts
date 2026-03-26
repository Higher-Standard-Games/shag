/**
 * ClearCommand - Clear console output
 */

import { Command, type CommandDef } from "../Command";

export default class ClearCommand extends Command {
  readonly definition: CommandDef = {
    name: "clear",
    aliases: ["cls"],
    description: "Clear console output",
  };

  async execute(): Promise<string | undefined> {
    // The console UI will handle the actual clearing
    // This command returns a special marker that the console recognizes
    return "__CLEAR__";
  }
}
