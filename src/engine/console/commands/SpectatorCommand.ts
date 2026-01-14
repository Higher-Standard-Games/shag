/**
 * SpectatorCommand - Toggle between physics and spectator (noclip) mode
 * 
 * Usage:
 *   spectator      - Toggle mode
 *   spectator 0    - Physics mode (solid, gravity)
 *   spectator 1    - Spectator mode (noclip, fly)
 */

import { Command, CommandDef } from '../Command';
import { MovementVars } from '../../movement/MovementVars';

export default class SpectatorCommand extends Command {
  readonly definition: CommandDef = {
    name: 'spectator',
    description: 'Toggle spectator/noclip mode',
    usage: 'spectator [0|1]',
    developer: true,
  };

  async execute(args: string[]): Promise<string | void> {
    const mv = MovementVars.getInstance();
    
    if (args.length === 0) {
      // Toggle
      const current = mv.get('sv_spectator');
      const newVal = current >= 0.5 ? 0 : 1;
      mv.set('sv_spectator', newVal);
      return newVal ? 'Spectator mode ON (noclip, fly)' : 'Spectator mode OFF (physics)';
    }
    
    const val = parseInt(args[0]);
    if (val === 0) {
      mv.set('sv_spectator', 0);
      return 'Spectator mode OFF (physics mode)';
    } else if (val === 1) {
      mv.set('sv_spectator', 1);
      return 'Spectator mode ON (noclip, fly)';
    } else {
      return 'Usage: spectator [0|1]';
    }
  }

  getCompletions(_input: string, _args: string[]): string[] {
    return ['0', '1'];
  }
}
