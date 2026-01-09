/**
 * PhysicsCommand - Physics debugging
 */

import { Command, CommandDef } from '../Command';

export default class PhysicsCommand extends Command {
  readonly definition: CommandDef = {
    name: 'physics',
    aliases: ['phys'],
    description: 'Physics debugging',
    usage: 'physics <on|off|info>',
    developer: true,
    subcommands: [
      { name: 'on', description: 'Enable physics' },
      { name: 'off', description: 'Disable physics' },
      { name: 'debug', description: 'Toggle physics debug rendering' },
      { name: 'info', description: 'Show physics info' },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

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

    const physicsEngine = scene.getPhysicsEngine?.();

    switch (subcommand) {
      case 'on':
        if (!physicsEngine) {
          return 'Physics engine not initialized';
        }
        scene.physicsEnabled = true;
        return 'Physics enabled';

      case 'off':
        scene.physicsEnabled = false;
        return 'Physics disabled';

      case 'debug': {
        if (!physicsEngine) {
          return 'Physics engine not initialized';
        }
        // Toggle debug viewer
        const viewer = (scene as any)._physicsViewer;
        if (viewer) {
          viewer.dispose();
          (scene as any)._physicsViewer = null;
          return 'Physics debug: OFF';
        } else {
          try {
            const { PhysicsViewer } = await import('@babylonjs/core/Debug/physicsViewer');
            (scene as any)._physicsViewer = new PhysicsViewer(scene);
            return 'Physics debug: ON';
          } catch {
            return 'PhysicsViewer not available';
          }
        }
      }

      case 'info':
      default: {
        if (!physicsEngine) {
          return 'Physics: not initialized';
        }
        const gravity = physicsEngine.gravity;
        return `Physics Info:\n` +
          `  Enabled: ${scene.physicsEnabled ? 'yes' : 'no'}\n` +
          `  Gravity: (${gravity.x}, ${gravity.y}, ${gravity.z})`;
      }
    }
  }
  
  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ['on', 'off', 'debug', 'info'];
    }
    return [];
  }
}
