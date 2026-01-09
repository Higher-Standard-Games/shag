/**
 * CvarListCommand - List all console variables
 */

import { Command, CommandDef } from '../Command';
import { Cvar } from '../../core/Cvar';

export default class CvarListCommand extends Command {
  readonly definition: CommandDef = {
    name: 'cvarlist',
    description: 'List all console variables',
    usage: 'cvarlist [filter]',
  };

  async execute(args: string[]): Promise<string | void> {
    const filter = args[0];
    const cvars = Cvar.list(filter);
    
    if (cvars.length === 0) {
      return filter ? `No cvars matching "${filter}"` : 'No cvars registered';
    }
    
    const lines: string[] = [];
    lines.push(`${cvars.length} cvar${cvars.length !== 1 ? 's' : ''}${filter ? ` matching "${filter}"` : ''}:`);
    
    for (const cvar of cvars) {
      const value = JSON.stringify(cvar.value);
      const defaultMark = cvar.value !== cvar.defaultValue ? '*' : ' ';
      lines.push(`${defaultMark} ${cvar.name} = ${value}`);
    }
    
    return lines.join('\n');
  }
  
  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      // Suggest common prefixes
      return ['r_', 's_', 'g_', 'ui_', 'cam_', 'con_', 'm_'];
    }
    return [];
  }
}
