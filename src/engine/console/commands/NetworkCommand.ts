import { Command } from '../Command';
import { NetworkManager } from '../../network/NetworkManager';
import { MoveCommand } from '../../network/core/Command';

/**
 * Network command for controlling networking features
 */
export default class NetworkCommand extends Command {
  readonly definition = {
    name: 'network',
    description: 'Control networking features',
    usage: 'network <subcommand>',
    aliases: ['net'],
    subcommands: [
      { name: 'connect', description: 'Connect to server (ws://host:port)' },
      { name: 'disconnect', description: 'Disconnect from server' },
      { name: 'init', description: 'Initialize networking (local|network|listen)' },
      { name: 'mode', description: 'Show current networking mode' },
      { name: 'status', description: 'Show networking status' },
      { name: 'send', description: 'Send a test command' },
      { name: 'shutdown', description: 'Shutdown networking' },
      { name: 'help', description: 'Show this help' }
    ]
  };

  async execute(args: string[]): Promise<string> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'connect':
        return this.connect(args[1]);

      case 'disconnect':
        return this.disconnectFromServer();

      case 'init':
        return this.initialize(args[1]);

      case 'mode':
        return this.showMode();

      case 'status':
        return this.getStatus();

      case 'send':
        return this.sendTestCommand();

      case 'shutdown':
        return this.shutdown();

      default:
        return this.showHelp();
    }
  }

  private async connect(serverUrl?: string): Promise<string> {
    if (!serverUrl) {
      return 'Usage: network connect <server_url>\nExample: network connect ws://localhost:7777';
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

  private async disconnectFromServer(): Promise<string> {
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

  private async initialize(mode?: string): Promise<string> {
    try {
      const networkManager = NetworkManager.getInstance();
      
      const initMode = mode || 'local';
      
      await networkManager.initialize({
        mode: initMode as 'local' | 'network' | 'listen'
      });
      
      return `✅ Network initialized in ${initMode} mode`;
    } catch (error) {
      return `❌ Failed to initialize network: ${error}`;
    }
  }

  private showMode(): string {
    const networkManager = NetworkManager.getInstance();
    const mode = networkManager.getMode();
    
    return mode ? `Current network mode: ${mode}` : 'Network not initialized';
  }

  private getStatus(): string {
    const networkManager = NetworkManager.getInstance();

    const status = {
      initialized: networkManager.getMode() !== null,
      mode: networkManager.getMode(),
      connected: networkManager.isConnected(),
      serverUrl: networkManager.getServerUrl()
    };

    let result = `Network Status:\n` +
           `  Initialized: ${status.initialized}\n` +
           `  Mode: ${status.mode || 'None'}\n` +
           `  Connected: ${status.connected}`;

    if (status.serverUrl) {
      result += `\n  Server: ${status.serverUrl}`;
    }

    return result;
  }

  private sendTestCommand(): string {
    try {
      const networkManager = NetworkManager.getInstance();
      
      if (!networkManager.isConnected()) {
        return '❌ Network not connected';
      }
      
      // Create test move command
      const moveCmd = new MoveCommand(
        'console-player',
        0,
        1,
        { x: 1, y: 0, z: 0 },
        0,
        0,
        0
      );
      
      networkManager.sendCommand(moveCmd);
      
      const state = networkManager.getLocalState();
      const entity = state?.entities.get('test-entity');
      const pos = entity?.getComponent('position') as any;
      
      return `✅ Test command sent\n` +
             `   Position: (${pos?.x.toFixed(2)}, ${pos?.y.toFixed(2)}, ${pos?.z.toFixed(2)})`;
    } catch (error) {
      return `❌ Failed to send command: ${error}`;
    }
  }

  private shutdown(): string {
    try {
      const networkManager = NetworkManager.getInstance();
      networkManager.shutdown();
      
      return '✅ Network shutdown complete';
    } catch (error) {
      return `❌ Failed to shutdown network: ${error}`;
    }
  }

  private showHelp(): string {
    return `Network Commands:\n` +
           `  network connect <url>  - Connect to server (e.g., ws://localhost:7777)\n` +
           `  network disconnect     - Disconnect from server\n` +
           `  network init [mode]    - Initialize networking (local|network|listen)\n` +
           `  network mode           - Show current networking mode\n` +
           `  network status         - Show networking status\n` +
           `  network send           - Send test command\n` +
           `  network shutdown       - Shutdown networking\n` +
           `  network help           - Show this help\n\n` +
           `Aliases: net, connect, disconnect`;
  }
}
