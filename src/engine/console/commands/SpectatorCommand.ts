/**
 * SpectatorCommand - Toggle between FPS and spectator (freefly) camera controllers
 * 
 * Usage:
 *   spectator      - Toggle mode
 *   spectator 0    - FPS mode (gravity, physics, ground movement)
 *   spectator 1    - Spectator mode (freefly camera, fly anywhere)
 */

import { Command, CommandDef } from '../Command';
import { CameraSystem } from '../../camera/CameraSystem';
import { FreeflyController } from '../../camera/controllers/FreeflyController';
import { FPSController } from '../../camera/controllers/FPSController';

export default class SpectatorCommand extends Command {
  readonly definition: CommandDef = {
    name: 'spectator',
    description: 'Toggle between FPS and spectator (freefly) camera',
    usage: 'spectator [0|1]',
    developer: true,
  };

  async execute(args: string[]): Promise<string | void> {
    const cameraSystem = CameraSystem.getInstance();
    const activeController = cameraSystem.getActiveController();
    const isSpectator = activeController?.type === 'freefly';
    
    // Register FPS controller if not already registered
    if (!cameraSystem.getController('fps')) {
      cameraSystem.registerController('fps', new FPSController());
    }
    // Register freefly controller if not already registered  
    if (!cameraSystem.getController('freefly')) {
      cameraSystem.registerController('freefly', new FreeflyController());
    }
    
    if (args.length === 0) {
      // Toggle
      if (isSpectator) {
        cameraSystem.setController('fps');
        return 'FPS mode (gravity, physics)';
      } else {
        cameraSystem.setController('freefly');
        return 'Spectator mode (freefly)';
      }
    }
    
    const val = parseInt(args[0]);
    if (val === 0) {
      cameraSystem.setController('fps');
      return 'FPS mode (gravity, physics)';
    } else if (val === 1) {
      cameraSystem.setController('freefly');
      return 'Spectator mode (freefly)';
    } else {
      return 'Usage: spectator [0|1]';
    }
  }

  getCompletions(_input: string, _args: string[]): string[] {
    return ['0', '1'];
  }
}
