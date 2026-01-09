/**
 * CameraCommand - Camera control and debugging
 */

import { Command, CommandDef } from '../Command';

export default class CameraCommand extends Command {
  readonly definition: CommandDef = {
    name: 'camera',
    description: 'Camera control and debugging',
    usage: 'camera <subcommand> [args]',
    subcommands: [
      { name: 'mode', description: 'Set camera mode', args: [{ name: 'mode', type: 'enum', options: ['iso', 'fps', 'freefly', 'follow', 'sidescroll'] }] },
      { name: 'fov', description: 'Set field of view', args: [{ name: 'degrees', type: 'number' }] },
      { name: 'pos', description: 'Show/set camera position' },
      { name: 'info', description: 'Show camera info' },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    let cameraSystem;
    try {
      const { CameraSystem } = await import('../../camera/CameraSystem');
      cameraSystem = CameraSystem.getInstance();
    } catch {
      return 'CameraSystem not available';
    }

    const camera = cameraSystem.getCamera();
    if (!camera) {
      return 'No active camera';
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'mode': {
        const mode = args[1]?.toLowerCase();
        if (!mode) {
          const current = cameraSystem.getActiveController()?.constructor.name || 'unknown';
          return `Current mode: ${current}\nAvailable: iso, fps, freefly, follow, sidescroll`;
        }
        
        // CameraSystem.setController expects a registered controller type name
        const modeMap: Record<string, string> = {
          'iso': 'isometric',
          'isometric': 'isometric',
          'fps': 'fps',
          'freefly': 'freefly',
          'follow': 'follow',
          'sidescroll': 'sidescroll',
        };
        
        const controllerType = modeMap[mode];
        if (!controllerType) {
          return `Unknown mode: ${mode}`;
        }
        
        const success = cameraSystem.setController(controllerType);
        if (success) {
          return `Camera mode set to: ${mode}`;
        } else {
          return `Failed to set mode: ${mode} (controller not registered)`;
        }
      }

      case 'fov': {
        const fov = parseFloat(args[1]);
        if (isNaN(fov)) {
          return `Current FOV: ${(camera.fov * 180 / Math.PI).toFixed(1)}°`;
        }
        if (fov < 10 || fov > 170) {
          return 'FOV must be between 10 and 170 degrees';
        }
        camera.fov = fov * Math.PI / 180;
        return `FOV set to ${fov}°`;
      }

      case 'pos': {
        const pos = camera.position;
        return `Camera position: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`;
      }

      case 'info':
      default: {
        const pos = camera.position;
        const controller = cameraSystem.getActiveController();
        return `Camera Info:\n` +
          `  Controller: ${controller?.constructor.name || 'none'}\n` +
          `  Position: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}\n` +
          `  FOV: ${(camera.fov * 180 / Math.PI).toFixed(1)}°`;
      }
    }
  }
  
  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ['mode', 'fov', 'pos', 'info'];
    }
    if (args.length === 1 && args[0] === 'mode') {
      return ['iso', 'fps', 'freefly', 'follow', 'sidescroll'];
    }
    return [];
  }
}
