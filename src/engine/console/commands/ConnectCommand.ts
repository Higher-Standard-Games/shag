import { Command } from '../Command';
import { FPSGameManager } from '../../../games/fps/FPSGameManager';

/**
 * Connect command - connects to a multiplayer game server
 * Usage: connect <server_url>
 * 
 * Examples:
 *   connect localhost:7777
 *   connect ws://192.168.1.100:7777
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
      const gameManager = FPSGameManager.getInstance();

      // Check if already connected
      if (gameManager.isConnectedToServer()) {
        const currentUrl = gameManager.getServerUrl();
        return `Already connected to ${currentUrl}. Use 'disconnect' first.`;
      }

      await gameManager.initializeNetwork(url);

      // Switch to FPS camera mode for proper movement
      try {
        const { CameraSystem } = await import('../../camera/CameraSystem');
        const cameraSystem = CameraSystem.getInstance();
        cameraSystem.setController('fps');
        console.log('[ConnectCommand] Switched to FPS camera mode');

        // Enable network mode on the FPSController
        const controller = cameraSystem.getActiveController();
        if (controller && controller.type === 'fps' && typeof (controller as any).enableNetworkMode === 'function') {
          (controller as any).enableNetworkMode();
          console.log('[ConnectCommand] Enabled network mode on FPSController');
        }
      } catch (e) {
        console.warn('[ConnectCommand] Could not switch to FPS camera:', e);
      }

      return `Connected to ${url}`;
    } catch (error) {
      return `Failed to connect: ${error}`;
    }
  }
}
