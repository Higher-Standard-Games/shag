/**
 * UnbindCommand — drop one key binding, or all of them.
 */

import { CommandBindings, displayKey } from "../../input/CommandBindings";
import { Command, type CommandDef, type CommandOutput, fail } from "../Command";

export default class UnbindCommand extends Command {
  readonly definition: CommandDef = {
    name: "unbind",
    description: "Remove a key binding",
    usage: "unbind <key|all>",
  };

  async execute(args: string[]): Promise<CommandOutput> {
    const key = args[0];
    if (!key) return fail("Usage: unbind <key|all>");

    if (key.toLowerCase() === "all") {
      const count = CommandBindings.unbindAll();
      return count === 0 ? "Nothing was bound" : `Unbound ${count} key${count === 1 ? "" : "s"}`;
    }

    const had = CommandBindings.unbind(key);
    return had ? `${displayKey(key)} no longer runs: ${had}` : `${key} was not bound`;
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length <= 1) return ["all", ...[...CommandBindings.all().keys()].map(displayKey)];
    return [];
  }
}
