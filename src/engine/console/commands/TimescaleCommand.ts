/**
 * TimescaleCommand - Time scale control
 */

import { Command, CommandDef } from '../Command';

export default class TimescaleCommand extends Command {
  readonly definition: CommandDef = {
    name: 'timescale',
    description: 'Time scale control (slow-mo/fast-forward)',
    usage: 'timescale [value]',
    developer: true,
  };

  async execute(args: string[]): Promise<string | void> {
    // Get scene
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

    const engine = scene.getEngine();
    const value = parseFloat(args[0]);
    
    if (isNaN(value)) {
      // Get current time scale from engine
      const current = (engine as any)._timeScale ?? 1.0;
      return `Timescale: ${current}`;
    }

    if (value <= 0 || value > 10) {
      return 'Timescale must be between 0.01 and 10';
    }

    // Set time scale
    (engine as any)._timeScale = value;
    
    // Also update scene animation ratio if available
    if (scene.animationTimeScale !== undefined) {
      scene.animationTimeScale = value;
    }

    return `Timescale set to ${value}`;
  }
}
