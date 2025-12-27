/**
 * ConsoleCommandRegistry - Command registration and execution system
 * 
 * Manages registered command handlers and provides autocomplete functionality.
 */

import commandDefinitions from './console-commands.json';

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

export type CommandHandler = (args: string[]) => string | void | Promise<string | void>;

interface RegisteredCommand {
  definition: CommandDefinition;
  handler: CommandHandler;
}

export class ConsoleCommandRegistry {
  private static instance: ConsoleCommandRegistry;
  
  private commands: Map<string, RegisteredCommand> = new Map();
  private definitions: CommandDefinition[] = [];

  private constructor() {
    this.loadDefinitions();
  }

  static getInstance(): ConsoleCommandRegistry {
    if (!ConsoleCommandRegistry.instance) {
      ConsoleCommandRegistry.instance = new ConsoleCommandRegistry();
    }
    return ConsoleCommandRegistry.instance;
  }

  /**
   * Load command definitions from JSON
   */
  private loadDefinitions(): void {
    this.definitions = commandDefinitions.commands as CommandDefinition[];
  }

  /**
   * Register a command handler
   */
  register(name: string, handler: CommandHandler): void {
    const definition = this.definitions.find(d => d.name === name);
    if (!definition) {
      console.warn(`[ConsoleCommandRegistry] No definition found for command: ${name}`);
      // Create a basic definition
      this.commands.set(name, {
        definition: { name, description: 'Custom command' },
        handler
      });
      return;
    }
    
    this.commands.set(name, { definition, handler });
  }

  /**
   * Unregister a command
   */
  unregister(name: string): void {
    this.commands.delete(name);
  }

  /**
   * Execute a command string
   */
  async execute(input: string): Promise<string> {
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
    return this.commands.get(name)?.definition;
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
    return this.commands.has(name);
  }
}
