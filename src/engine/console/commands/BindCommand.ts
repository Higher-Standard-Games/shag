/**
 * BindCommand — bind a key to a console command.
 *
 * Separate from the action map in Settings → Controls: an action binding says
 * what a key *means* while it is held, a command binding runs a command once on
 * the press. A key can be both.
 */

import { CommandBindings, displayKey } from "../../input/CommandBindings";
import { Command, type CommandDef, type CommandOutput, fail } from "../Command";

export default class BindCommand extends Command {
  readonly definition: CommandDef = {
    name: "bind",
    description: "Bind a key to a console command",
    usage: 'bind [key] [command]  —  e.g. bind f "give all"',
  };

  async execute(args: string[]): Promise<CommandOutput> {
    if (args.length === 0) {
      const all = CommandBindings.all();
      if (all.size === 0) return "No keys are bound. Try: bind f screenshot";
      const lines = [...all.entries()].map(([code, command]) => `  ${displayKey(code).padEnd(12)} ${command}`);
      return [`${all.size} bound key${all.size === 1 ? "" : "s"}:`, ...lines].join("\n");
    }

    const key = args[0];
    if (args.length === 1) {
      const command = CommandBindings.get(key);
      return command ? `${displayKey(key)} is bound to: ${command}` : `${key} is not bound`;
    }

    const command = args.slice(1).join(" ");
    const code = CommandBindings.bind(key, command);
    if (!code) return fail(`Not a key this browser reports: ${key}`);
    return `${displayKey(code)} → ${command}`;
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length <= 1) return [...CommandBindings.all().keys()].map(displayKey);
    return [];
  }
}
