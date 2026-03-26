/**
 * EchoCommand - Print text to console
 */

import { Command, type CommandDef } from "../Command";

export default class EchoCommand extends Command {
  readonly definition: CommandDef = {
    name: "echo",
    description: "Print text to console",
    usage: "echo <text>",
  };

  async execute(args: string[]): Promise<string | undefined> {
    return args.join(" ");
  }
}
