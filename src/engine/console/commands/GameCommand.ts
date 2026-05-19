/**
 * GameCommand - Game path control
 */

import type { GamePaths } from "../../core/GamePaths";
import { Command, type CommandDef } from "../Command";

export default class GameCommand extends Command {
  readonly definition: CommandDef = {
    name: "game",
    description: "Game path control",
    usage: "game <info|load|switch|reload>",
    subcommands: [
      { name: "info", description: "Show current game paths" },
      { name: "load", description: "Set game (requires reload)", args: [{ name: "name", type: "string" }] },
      { name: "switch", description: "Switch game and reload", args: [{ name: "name", type: "string" }] },
      { name: "reload", description: "Reload with current game" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    let gamePaths: GamePaths;
    try {
      const { GamePaths } = await import("../../core/GamePaths");
      gamePaths = GamePaths.getInstance();
    } catch {
      return "GamePaths not available";
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "info":
        return gamePaths.getDebugInfo();

      case "load": {
        const name = args[1];
        if (!name) {
          return `Usage: game load <name>\nCurrent game: ${gamePaths.getGameName()}`;
        }
        gamePaths.setGame(name);
        return `Game set to: ${name}\nReload the page to apply changes, or use: game reload`;
      }

      case "reload":
        window.location.href = `${window.location.pathname}?game=${gamePaths.getGameName()}`;
        return "Reloading...";

      case "switch": {
        const name = args[1];
        if (!name) {
          return `Usage: game switch <name>\nThis will reload the page with the new game.`;
        }
        window.location.href = `${window.location.pathname}?game=${name}`;
        return `Switching to game: ${name}...`;
      }

      default:
        return `Game Commands:\n  info - Show current game paths\n  load <name> - Set game (requires reload)\n  switch <name> - Switch game and reload\n  reload - Reload with current game\n\nCurrent game: ${gamePaths.getGameName()}`;
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["info", "load", "switch", "reload"];
    }
    return [];
  }
}
