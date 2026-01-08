/**
 * ConsoleCommandRegistry - Command registration and execution system
 * 
 * Manages registered command handlers and provides autocomplete functionality.
 * Supports loading definitions from multiple JSON sources (engine + game).
 * Integrates with Cvar system for console variables.
 */

import engineCommands from './engine-commands.json';
import { Cvar, type CvarInstance } from '../core/Cvar';

export interface CommandArg {
  name: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean';
}

export interface CommandDefinition {
  name: string;
  description: string;
  usage?: string;
  subcommands?: {
    name: string;
    description: string;
    args?: string[];
  }[];
}

export interface CommandsFile {
  commands: CommandDefinition[];
}

export type CommandHandler = (args: string[]) => string | void | Promise<string | void>;

interface RegisteredCommand {
  definition: CommandDefinition;
  handler: CommandHandler;
}

export class ConsoleCommandRegistry {
  private static instance: ConsoleCommandRegistry;
  
  private commands: Map<string, RegisteredCommand> = new Map();
  private definitions: Map<string, CommandDefinition> = new Map();
  private cvarNames: Set<string> = new Set(); // Track cvars separately for autocomplete

  private constructor() {
    // Load engine commands by default
    this.loadDefinitionsFromJson(engineCommands as CommandsFile);
    
    // Set up cvar integration
    this.setupCvarIntegration();
    
    // Register cvar management commands
    this.registerCvarCommands();
  }

  static getInstance(): ConsoleCommandRegistry {
    if (!ConsoleCommandRegistry.instance) {
      ConsoleCommandRegistry.instance = new ConsoleCommandRegistry();
    }
    return ConsoleCommandRegistry.instance;
  }

  /**
   * Load command definitions from a JSON object
   * Can be called multiple times to add definitions from different sources
   */
  loadDefinitionsFromJson(json: CommandsFile): void {
    for (const cmd of json.commands) {
      this.definitions.set(cmd.name.toLowerCase(), cmd);
    }
    console.log(`[ConsoleCommandRegistry] Loaded ${json.commands.length} command definitions`);
  }

  /**
   * Register a command handler
   */
  register(name: string, handler: CommandHandler): void {
    const key = name.toLowerCase();
    const definition = this.definitions.get(key);
    if (!definition) {
      console.warn(`[ConsoleCommandRegistry] No definition found for command: ${key}`);
      // Create a basic definition
      this.commands.set(key, {
        definition: { name: key, description: 'No description available' },
        handler
      });
      return;
    }
    
    this.commands.set(key, { definition, handler });
  }

  /**
   * Unregister a command
   */
  unregister(name: string): void {
    this.commands.delete(name.toLowerCase());
  }

  /**
   * Execute a command string
   * Supports multiple commands separated by semicolons (;)
   * Example: "wind on; debris leaves; weather rain 0.5"
   */
  async execute(input: string): Promise<string> {
    // Split by semicolon for multiple commands
    const commands = input.split(';').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
    
    if (commands.length === 0) {
      return '';
    }
    
    // Execute multiple commands and collect results
    if (commands.length > 1) {
      const results: string[] = [];
      for (const cmd of commands) {
        const result = await this.executeSingle(cmd);
        if (result) {
          results.push(result);
        }
      }
      return results.join('\n');
    }
    
    // Single command
    return this.executeSingle(commands[0]);
  }
  
  /**
   * Execute a single command
   */
  private async executeSingle(input: string): Promise<string> {
    const parts = input.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) {
      return '';
    }

    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    const command = this.commands.get(commandName);
    if (!command) {
      return `Unknown command: ${commandName}. Type 'help' for available commands.`;
    }

    try {
      const result = await command.handler(args);
      return result ?? '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }

  /**
   * Get autocomplete suggestions for input
   */
  getAutocompleteSuggestions(input: string): string[] {
    const parts = input.trim().toLowerCase().split(/\s+/);
    const suggestions: string[] = [];

    if (parts.length === 0 || (parts.length === 1 && input.slice(-1) !== ' ')) {
      // Autocomplete command name
      const prefix = parts[0] || '';
      for (const [name] of this.commands) {
        if (name.startsWith(prefix)) {
          suggestions.push(name);
        }
      }
    } else {
      // Autocomplete subcommand
      const commandName = parts[0];
      const command = this.commands.get(commandName);
      if (command?.definition.subcommands) {
        const subPrefix = parts[1] || '';
        for (const sub of command.definition.subcommands) {
          if (sub.name.startsWith(subPrefix)) {
            suggestions.push(`${commandName} ${sub.name}`);
          }
        }
      }
    }

    return suggestions.sort();
  }

  /**
   * Get all registered command names
   */
  getCommandNames(): string[] {
    return Array.from(this.commands.keys()).sort();
  }

  /**
   * Get command definition
   */
  getDefinition(name: string): CommandDefinition | undefined {
    return this.commands.get(name.toLowerCase())?.definition;
  }

  /**
   * Get all definitions (for help)
   */
  getAllDefinitions(): CommandDefinition[] {
    return Array.from(this.commands.values()).map(c => c.definition);
  }

  /**
   * Check if a command is registered
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  /**
   * Check if a name is a cvar
   */
  isCvar(name: string): boolean {
    return this.cvarNames.has(name.toLowerCase());
  }

  // ==================== Cvar Integration ====================

  /**
   * Set up Cvar integration - cvars auto-register as commands
   */
  private setupCvarIntegration(): void {
    Cvar.setConsoleIntegration((cvar: CvarInstance) => {
      this.registerCvar(cvar);
    });
  }

  /**
   * Register a cvar as a console command
   */
  private registerCvar(cvar: CvarInstance): void {
    const name = cvar.name.toLowerCase();
    this.cvarNames.add(name);
    
    // Create command handler for cvar
    const handler: CommandHandler = (args: string[]) => {
      if (args.length === 0) {
        // No args: show current value
        return Cvar.formatInfo(name);
      }
      
      // Set value
      const value = args.join(' ');
      if (Cvar.set(name, value)) {
        return `${name} set to "${Cvar.get(name)}"`;
      }
      return `Failed to set ${name}`;
    };
    
    // Create definition
    const definition: CommandDefinition = {
      name: name,
      description: cvar.description || `Cvar: ${name}`,
      usage: `${name} [value]`,
    };
    
    this.definitions.set(name, definition);
    this.commands.set(name, { definition, handler });
  }

  /**
   * Register built-in cvar management commands
   */
  private registerCvarCommands(): void {
    // cvarlist - list all cvars
    this.definitions.set('cvarlist', {
      name: 'cvarlist',
      description: 'List all console variables',
      usage: 'cvarlist [filter]',
    });
    this.commands.set('cvarlist', {
      definition: this.definitions.get('cvarlist')!,
      handler: (args: string[]) => {
        const filter = args[0];
        const cvars = Cvar.list(filter);
        if (cvars.length === 0) {
          return filter ? `No cvars matching "${filter}"` : 'No cvars registered';
        }
        const lines = cvars.map(c => {
          const modified = c.value !== c.defaultValue ? '*' : ' ';
          return `${modified}${c.name} = "${c.value}"`;
        });
        lines.push(`\n${cvars.length} cvar(s)${filter ? ` matching "${filter}"` : ''}`);
        return lines.join('\n');
      },
    });

    // toggle - toggle a bool cvar
    this.definitions.set('toggle', {
      name: 'toggle',
      description: 'Toggle a boolean cvar',
      usage: 'toggle <cvar>',
    });
    this.commands.set('toggle', {
      definition: this.definitions.get('toggle')!,
      handler: (args: string[]) => {
        if (args.length === 0) {
          return 'Usage: toggle <cvar>';
        }
        const name = args[0];
        if (!Cvar.exists(name)) {
          return `Unknown cvar: ${name}`;
        }
        Cvar.toggle(name);
        return `${name} = "${Cvar.get(name)}"`;
      },
    });

    // reset - reset cvar to default
    this.definitions.set('reset', {
      name: 'reset',
      description: 'Reset a cvar to its default value',
      usage: 'reset <cvar>',
    });
    this.commands.set('reset', {
      definition: this.definitions.get('reset')!,
      handler: (args: string[]) => {
        if (args.length === 0) {
          return 'Usage: reset <cvar>';
        }
        const name = args[0];
        if (!Cvar.exists(name)) {
          return `Unknown cvar: ${name}`;
        }
        Cvar.reset(name);
        const cvar = Cvar.getCvar(name);
        return `${name} reset to "${cvar?.defaultValue}"`;
      },
    });

    // resetall - reset all cvars
    this.definitions.set('resetall', {
      name: 'resetall',
      description: 'Reset all cvars to default values',
      usage: 'resetall',
    });
    this.commands.set('resetall', {
      definition: this.definitions.get('resetall')!,
      handler: () => {
        Cvar.resetAll();
        return 'All cvars reset to defaults';
      },
    });

    // set - explicit set command (Quake-style)
    this.definitions.set('set', {
      name: 'set',
      description: 'Set a cvar value',
      usage: 'set <cvar> <value>',
    });
    this.commands.set('set', {
      definition: this.definitions.get('set')!,
      handler: (args: string[]) => {
        if (args.length < 2) {
          return 'Usage: set <cvar> <value>';
        }
        const name = args[0];
        const value = args.slice(1).join(' ');
        if (!Cvar.exists(name)) {
          return `Unknown cvar: ${name}`;
        }
        Cvar.set(name, value);
        return `${name} = "${Cvar.get(name)}"`;
      },
    });

    // cvarexport - export modified cvars as config
    this.definitions.set('cvarexport', {
      name: 'cvarexport',
      description: 'Export modified cvars as config text',
      usage: 'cvarexport',
    });
    this.commands.set('cvarexport', {
      definition: this.definitions.get('cvarexport')!,
      handler: () => {
        const config = Cvar.exportConfig();
        if (!config) {
          return 'No modified cvars';
        }
        return config;
      },
    });
  }
}
