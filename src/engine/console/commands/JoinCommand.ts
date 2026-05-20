/**
 * JoinCommand - Join the currently connected authoritative server.
 */

import { Command, type CommandDef } from "../Command";

export default class JoinCommand extends Command {
  readonly definition: CommandDef = {
    name: "join",
    description: "Join the connected game server",
    usage: "join",
    developer: false,
  };

  async execute(_args: string[]): Promise<string> {
    try {
      const { Game } = await import("../../../games/fps/Game");
      const gameManager = Game.getInstance();

      if (!gameManager.isConnectedToServer()) {
        return 'No server connection. Use "developer 1" then "map <mapname> [gametype]" or "connect <url>".';
      }

      await gameManager.joinGame();
      return "Join requested";
    } catch (error) {
      return `Failed to join: ${error}`;
    }
  }
}
