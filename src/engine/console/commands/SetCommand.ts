/**
 * SetCommand - Set a cvar value (alternative to typing cvar name directly)
 */

import { Command, CommandDef } from '../Command';
import { Cvar } from '../../core/Cvar';

export default class SetCommand extends Command {
  readonly definition: CommandDef = {
    name: 'set',
    description: 'Set a cvar value',
    usage: 'set <cvar> <value>',
  };

  async execute(args: string[]): Promise<string | void> {
    if (args.length < 2) {
      return 'Usage: set <cvar> <value>';
    }
    
    const name = args[0];
    const value = args.slice(1).join(' ');
    
    if (!Cvar.exists(name)) {
      return `Unknown cvar: ${name}`;
    }
    
    const success = Cvar.set(name, value);
    if (success) {
      return `${name} = ${JSON.stringify(Cvar.get(name))}`;
    } else {
      return `Failed to set ${name}`;
    }
  }
  
  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return Cvar.getNames();
    }
    return [];
  }
}
