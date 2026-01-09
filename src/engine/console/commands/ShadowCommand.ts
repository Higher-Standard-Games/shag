/**
 * ShadowCommand - Shadow control
 */

import { Command, CommandDef } from '../Command';

export default class ShadowCommand extends Command {
  readonly definition: CommandDef = {
    name: 'shadow',
    aliases: ['shadows'],
    description: 'Shadow control',
    usage: 'shadow <on|off|quality> [value]',
    developer: true,
    subcommands: [
      { name: 'on', description: 'Enable shadows' },
      { name: 'off', description: 'Disable shadows' },
      { name: 'quality', description: 'Set shadow quality', args: [{ name: 'value', type: 'number' }] },
      { name: 'info', description: 'Show shadow info' },
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

    // Find shadow generators
    const shadowGenerators = scene.lights
      .map(l => l.getShadowGenerator?.())
      .filter(Boolean);

    switch (subcommand) {
      case 'on':
        scene.shadowsEnabled = true;
        return 'Shadows enabled';

      case 'off':
        scene.shadowsEnabled = false;
        return 'Shadows disabled';

      case 'quality': {
        const quality = parseInt(args[1]);
        if (isNaN(quality) || quality < 256 || quality > 4096) {
          return 'Usage: shadow quality <256-4096>';
        }
        for (const sg of shadowGenerators) {
          if (sg && 'mapSize' in sg) {
            (sg as any).mapSize = quality;
          }
        }
        return `Shadow map size set to ${quality}`;
      }

      case 'info':
      default: {
        return `Shadows:\n` +
          `  Enabled: ${scene.shadowsEnabled ? 'yes' : 'no'}\n` +
          `  Generators: ${shadowGenerators.length}`;
      }
    }
  }
  
  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ['on', 'off', 'quality', 'info'];
    }
    return [];
  }
}
