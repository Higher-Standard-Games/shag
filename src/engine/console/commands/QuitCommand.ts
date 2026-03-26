/**
 * QuitCommand - Exit/reload the application
 */

import { Command, type CommandDef } from "../Command";

export default class QuitCommand extends Command {
  readonly definition: CommandDef = {
    name: "quit",
    aliases: ["exit", "q"],
    description: "Reload the application",
  };

  async execute(): Promise<string | void> {
    // In browser, we can't truly "quit" - reload instead
    setTimeout(() => {
      window.location.reload();
    }, 100);
    return "Reloading...";
  }
}
