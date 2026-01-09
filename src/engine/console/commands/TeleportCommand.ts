/**
 * TeleportCommand - Teleport camera to position
 */

import { Command, CommandDef } from '../Command';

export default class TeleportCommand extends Command {
  readonly definition: CommandDef = {
    name: 'teleport',
    aliases: ['tp', 'goto'],
    description: 'Teleport camera to position',
    usage: 'teleport <x> <y> <z>',
    developer: true,
  };

  async execute(args: string[]): Promise<string | void> {
    if (args.length < 3) {
      return 'Usage: teleport <x> <y> <z>';
    }

    const x = parseFloat(args[0]);
    const y = parseFloat(args[1]);
    const z = parseFloat(args[2]);

    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      return 'Invalid coordinates. Usage: teleport <x> <y> <z>';
    }

    // Get camera
    let camera;
    try {
      const { CameraSystem } = await import('../../camera/CameraSystem');
      camera = CameraSystem.getInstance().getCamera();
    } catch {
      return 'CameraSystem not available';
    }

    if (!camera) {
      return 'No active camera';
    }

    camera.position.set(x, y, z);
    return `Teleported to (${x}, ${y}, ${z})`;
  }
}
