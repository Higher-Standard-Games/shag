/**
 * ResetAllCommand - Reset all cvars to default values
 */

import { Command, CommandDef } from '../Command';
import { Cvar } from '../../core/Cvar';

export default class ResetAllCommand extends Command {
  readonly definition: CommandDef = {
    name: 'resetall',
    description: 'Reset all cvars to default values',
  };

  async execute(): Promise<string | void> {
    Cvar.resetAll();
    return 'All cvars reset to default values';
  }
}
