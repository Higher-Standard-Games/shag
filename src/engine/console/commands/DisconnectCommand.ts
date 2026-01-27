import { Command } from '../Command';
import { FPSGameManager } from '../../../games/fps/FPSGameManager';

/**
 * Disconnect command - disconnects from current game server
 * Usage: disconnect
 */
export default class DisconnectCommand extends Command {
  readonly definition = {
    name: 'disconnect',
    description: 'Disconnect from current game server',
    usage: 'disconnect',
  };

  async execute(_args: string[]): Promise<string> {
    try {
      const gameManager = FPSGameManager.getInstance();
      const serverUrl = gameManager.getServerUrl();

      if (!gameManager.isConnectedToServer()) {
        return 'Not connected to any server';
      }

      gameManager.shutdown();
      return `Disconnected from ${serverUrl}`;
    } catch (error) {
      return `Failed to disconnect: ${error}`;
    }
  }
}
