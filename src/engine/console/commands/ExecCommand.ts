/**
 * ExecCommand - Execute config files
 */

import { Command, CommandDef } from '../Command';
import { CommandRegistry } from '../CommandRegistry';

export default class ExecCommand extends Command {
  readonly definition: CommandDef = {
    name: 'exec',
    description: 'Execute a config file',
    usage: 'exec <filename>',
  };

  async execute(args: string[]): Promise<string | void> {
    const file = args[0];
    if (!file) {
      return 'Usage: exec <filename>';
    }

    try {
      const { GamePaths } = await import('../../core/GamePaths');
      const gamePaths = GamePaths.getInstance();
      
      // Try with and without .cfg extension
      const filename = file.endsWith('.cfg') ? file : `${file}.cfg`;
      const path = gamePaths.game(filename);
      
      const response = await fetch(path);
      if (!response.ok) {
        return `Config not found: ${filename}`;
      }
      
      const content = await response.text();
      const registry = CommandRegistry.getInstance();
      
      let executed = 0;
      let errors = 0;
      
      // Execute each line
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
          continue;
        }
        
        try {
          await registry.execute(trimmed);
          executed++;
        } catch {
          errors++;
        }
      }
      
      return `Executed ${filename}: ${executed} commands${errors > 0 ? `, ${errors} errors` : ''}`;
    } catch (e) {
      return `Failed to execute: ${e}`;
    }
  }
}
