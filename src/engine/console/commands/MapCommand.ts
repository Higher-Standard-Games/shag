/**
 * MapCommand - Map loading and information
 */

import { Command, CommandDef } from '../Command';

export default class MapCommand extends Command {
  readonly definition: CommandDef = {
    name: 'map',
    description: 'Map loading and information',
    usage: 'map <subcommand> [args]',
    subcommands: [
      { name: 'load', description: 'Load a map', args: [{ name: 'mapname', type: 'string', required: true }] },
      { name: 'reload', description: 'Reload current map' },
      { name: 'info', description: 'Show current map info' },
      { name: 'list', description: 'List available maps' },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'load': {
        const mapName = args[1];
        if (!mapName) {
          return 'Usage: map load <mapname>';
        }
        // Map loading would be handled by game-specific code
        // This is a placeholder - actual implementation depends on game architecture
        return `Map loading not implemented in engine. Use game-specific map command.`;
      }

      case 'reload': {
        return `Map reload not implemented in engine.`;
      }

      case 'list': {
        // Try to get map list from PK3Index
        try {
          const { PK3Index } = await import('../../loader/pk3/PK3Index');
          const pk3Index = PK3Index.getInstance();
          const stats = pk3Index.getStats();
          
          if (stats.mapCount === 0) {
            return 'No maps indexed. Run "pk3 index" first.';
          }
          
          return `${stats.mapCount} maps available in PK3 index`;
        } catch {
          return 'Map list not available';
        }
      }

      case 'info':
      default: {
        return 'Map info: Use game-specific map commands for detailed info.';
      }
    }
  }
  
  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ['load', 'reload', 'info', 'list'];
    }
    return [];
  }
}
