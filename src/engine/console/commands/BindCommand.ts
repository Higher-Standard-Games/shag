/**
 * BindCommand - Key binding placeholder (future feature)
 */

import { Command, type CommandDef } from "../Command";

export default class BindCommand extends Command {
  readonly definition: CommandDef = {
    name: "bind",
    description: "Bind a key to a command (placeholder)",
    usage: "bind <key> <command>",
  };

  async execute(args: string[]): Promise<string | void> {
    if (args.length < 2) {
      return "Usage: bind <key> <command>\nNote: Key binding is planned for a future update.";
    }

    const key = args[0];
    const command = args.slice(1).join(" ");

    return `Bind "${key}" -> "${command}" (not yet implemented - planned for future)`;
  }
}
