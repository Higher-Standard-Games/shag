import { Command } from '../Command';
import { NetworkManager } from '../../network/NetworkManager';

/**
 * Connect command - shortcut for 'network connect <server>'
 * Usage: connect <server_url>
 */
export default class ConnectCommand extends Command {
  readonly definition = {
    name: 'connect',
    description: 'Connect to a game server',
    usage: 'connect <server_url>',
  };

  async execute(args: string[]): Promise<string> {
    const serverUrl = args[0];

    if (!serverUrl) {
      return 'Usage: connect <server_url>\nExample: connect localhost:7777\nExample: connect ws://192.168.1.100:7777';
    }

    // Add ws:// prefix if not present
    let url = serverUrl;
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = `ws://${url}`;
    }

    try {
      const networkManager = NetworkManager.getInstance();
      await networkManager.connect(url);
      return `Connected to ${url}`;
    } catch (error) {
      return `Failed to connect: ${error}`;
    }
  }
}
