/**
 * JoinCommand - Join the currently connected authoritative server.
 */

import { getNetworkConnector } from "../../ui/components/NetworkConnector";
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
      const connector = getNetworkConnector();

      if (!connector?.isConnected()) {
        return 'No server connection. Use "developer 1" then "map <mapname> [gametype]" or "connect <url>".';
      }

      if (!connector.join) {
        return "The active game does not support joining the connected server.";
      }

      await connector.join();
      return "Join requested";
    } catch (error) {
      return `Failed to join: ${error}`;
    }
  }
}
