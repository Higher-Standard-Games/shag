import { Command } from '../Command';
import { NetworkManager } from '../../network/NetworkManager';

/**
 * Disconnect command - shortcut for 'network disconnect'
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
      const networkManager = NetworkManager.getInstance();
      const serverUrl = networkManager.getServerUrl();

      if (!serverUrl) {
        return 'Not connected to any server';
      }

      await networkManager.disconnect();
      return `Disconnected from ${serverUrl}`;
    } catch (error) {
      return `Failed to disconnect: ${error}`;
    }
  }
}
