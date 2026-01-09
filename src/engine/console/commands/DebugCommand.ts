/**
 * DebugCommand - Debug overlays and visualization
 */

import { Command, CommandDef } from '../Command';

export default class DebugCommand extends Command {
  readonly definition: CommandDef = {
    name: 'debug',
    description: 'Debug overlays and visualization',
    usage: 'debug <subcommand> [args]',
    developer: true,
    subcommands: [
      { name: 'collision', description: 'Toggle collision visualization' },
      { name: 'wireframe', description: 'Toggle wireframe rendering' },
      { name: 'bounds', description: 'Toggle bounding box display' },
      { name: 'info', description: 'Show debug info overlay' },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

    // Get scene from camera system
    let scene;
    try {
      const { CameraSystem } = await import('../../camera/CameraSystem');
      scene = CameraSystem.getInstance().getCamera()?.getScene();
    } catch {
      return 'Scene not available';
    }

    if (!scene) {
      return 'No active scene';
    }

    switch (subcommand) {
      case 'wireframe': {
        const enabled = args[1] === '1' || args[1] === 'on';
        if (args[1] === undefined) {
          // Toggle
          scene.forceWireframe = !scene.forceWireframe;
        } else {
          scene.forceWireframe = enabled;
        }
        return `Wireframe: ${scene.forceWireframe ? 'ON' : 'OFF'}`;
      }

      case 'bounds': {
        const enabled = args[1] === '1' || args[1] === 'on';
        if (args[1] === undefined) {
          scene.forceShowBoundingBoxes = !scene.forceShowBoundingBoxes;
        } else {
          scene.forceShowBoundingBoxes = enabled;
        }
        return `Bounding boxes: ${scene.forceShowBoundingBoxes ? 'ON' : 'OFF'}`;
      }

      case 'collision': {
        // This would toggle collision mesh visualization
        // Implementation depends on collision system
        return 'Collision visualization not yet implemented';
      }

      case 'info':
      default: {
        const engine = scene.getEngine();
        return `Debug Info:\n` +
          `  FPS: ${engine.getFps().toFixed(1)}\n` +
          `  Active meshes: ${scene.getActiveMeshes().length}\n` +
          `  Total meshes: ${scene.meshes.length}\n` +
          `  Wireframe: ${scene.forceWireframe ? 'ON' : 'OFF'}\n` +
          `  Bounding boxes: ${scene.forceShowBoundingBoxes ? 'ON' : 'OFF'}`;
      }
    }
  }
  
  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ['collision', 'wireframe', 'bounds', 'info'];
    }
    if (args.length === 1) {
      return ['0', '1', 'on', 'off'];
    }
    return [];
  }
}
