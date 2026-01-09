/**
 * CommandRegistry - Command registration and execution system
 * 
 * Manages registered commands and provides autocomplete functionality.
 * Integrates with Cvar system for console variables.
 * 
 * Commands are auto-discovered from:
 * - src/engine/console/commands/ (engine commands)
 * - src/games/{game}/console/commands/ (game commands)
 */

import { Command, CommandDef } from './Command';
import { Cvar } from '../core/Cvar';

export type CommandHandler = (args: string[]) => string | void | Promise<string | void>;

interface RegisteredCommand {
  command: Command;
  definition: CommandDef;
}

export class CommandRegistry {
  private static instance: CommandRegistry;
  
  private commands: Map<string, RegisteredCommand> = new Map();
  private aliases: Map<string, string> = new Map(); // alias -> primary name
  private cvarNames: Set<string> = new Set();
  
  private constructor() {
    this.setupCvarIntegration();
  }
  
  static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }
  
  /**
   * Register a command instance
   */
  register(command: Command): void {
    const def = command.definition;
    const key = def.name.toLowerCase();
    
    // Check developer mode for developer-only commands
    if (def.developer && !Cvar.getBool('developer')) {
      // Still register but mark as developer-only
      // Will be filtered in autocomplete and rejected on execute
    }
    
    this.commands.set(key, { command, definition: def });
    
    // Register aliases
    if (def.aliases) {
      for (const alias of def.aliases) {
        this.aliases.set(alias.toLowerCase(), key);
      }
    }
    
    console.log(`[CommandRegistry] Registered: ${def.name}${def.aliases ? ` (aliases: ${def.aliases.join(', ')})` : ''}`);
  }
  
  /**
   * Unregister a command by name
   */
  unregister(name: string): void {
    const key = name.toLowerCase();
    const registered = this.commands.get(key);
    
    if (registered) {
      // Remove aliases
      if (registered.definition.aliases) {
        for (const alias of registered.definition.aliases) {
          this.aliases.delete(alias.toLowerCase());
        }
      }
      this.commands.delete(key);
    }
  }
  
  /**
   * Execute a command string
   */
  async execute(input: string): Promise<string | void> {
    const trimmed = input.trim();
    if (!trimmed) return;
    
    // Parse command and arguments
    const parts = this.parseInput(trimmed);
    if (parts.length === 0) return;
    
    const [commandName, ...args] = parts;
    const key = commandName.toLowerCase();
    
    // Check for alias
    const primaryKey = this.aliases.get(key) || key;
    
    // Try as command first
    const registered = this.commands.get(primaryKey);
    if (registered) {
      // Check developer mode
      if (registered.definition.developer && !Cvar.getBool('developer')) {
        return `Command '${commandName}' requires developer mode`;
      }
      
      try {
        return await registered.command.execute(args);
      } catch (error) {
        return `Error executing '${commandName}': ${error}`;
      }
    }
    
    // Try as cvar
    if (this.cvarNames.has(key)) {
      return this.handleCvar(key, args);
    }
    
    // Check if it's a cvar we haven't tracked yet
    const cvarValue = Cvar.get(key);
    if (cvarValue !== undefined) {
      this.cvarNames.add(key);
      return this.handleCvar(key, args);
    }
    
    return `Unknown command: ${commandName}`;
  }
  
  /**
   * Handle cvar get/set
   */
  private handleCvar(name: string, args: string[]): string {
    if (args.length === 0) {
      // Get value - use formatInfo for full display
      return Cvar.formatInfo(name);
    } else {
      // Set value
      const value = args.join(' ');
      const success = Cvar.set(name, value);
      if (success) {
        return `${name} = ${JSON.stringify(Cvar.get(name))}`;
      } else {
        return `Failed to set ${name}`;
      }
    }
  }
  
  /**
   * Get autocomplete suggestions for input
   */
  getCompletions(input: string): string[] {
    const trimmed = input.trim().toLowerCase();
    const parts = this.parseInput(trimmed);
    const suggestions: string[] = [];
    
    if (parts.length <= 1) {
      // Complete command name
      const prefix = parts[0] || '';
      
      // Add matching commands
      for (const [name, registered] of this.commands) {
        // Skip developer commands in non-developer mode
        if (registered.definition.developer && !Cvar.getBool('developer')) {
          continue;
        }
        if (name.startsWith(prefix)) {
          suggestions.push(name);
        }
      }
      
      // Add matching aliases
      for (const alias of this.aliases.keys()) {
        const primary = this.aliases.get(alias)!;
        const registered = this.commands.get(primary);
        if (registered?.definition.developer && !Cvar.getBool('developer')) {
          continue;
        }
        if (alias.startsWith(prefix)) {
          suggestions.push(alias);
        }
      }
      
      // Add matching cvars
      for (const cvarName of Cvar.getNames()) {
        if (cvarName.startsWith(prefix)) {
          suggestions.push(cvarName);
        }
      }
    } else {
      // Complete subcommand or argument
      const commandName = parts[0];
      const primaryKey = this.aliases.get(commandName) || commandName;
      const registered = this.commands.get(primaryKey);
      
      if (registered) {
        // Check for custom completions
        if (registered.command.getCompletions) {
          return registered.command.getCompletions(input, parts.slice(1));
        }
        
        // Use subcommand definitions
        if (registered.definition.subcommands && parts.length === 2) {
          const subPrefix = parts[1] || '';
          for (const sub of registered.definition.subcommands) {
            if (sub.name.startsWith(subPrefix)) {
              suggestions.push(sub.name);
            }
          }
        }
      }
    }
    
    return suggestions.sort();
  }
  
  /**
   * Get all registered commands
   */
  getCommands(): Map<string, CommandDef> {
    const result = new Map<string, CommandDef>();
    for (const [name, registered] of this.commands) {
      // Filter developer commands in non-developer mode
      if (registered.definition.developer && !Cvar.getBool('developer')) {
        continue;
      }
      result.set(name, registered.definition);
    }
    return result;
  }
  
  /**
   * Get help for a command
   */
  getHelp(commandName: string): string | null {
    const key = commandName.toLowerCase();
    const primaryKey = this.aliases.get(key) || key;
    const registered = this.commands.get(primaryKey);
    
    if (registered) {
      return registered.command.getHelp();
    }
    
    // Check if it's a cvar
    const cvar = Cvar.getCvar(key);
    if (cvar) {
      return `${key} - ${cvar.description || 'Console variable'}\nCurrent value: ${Cvar.get(key)}`;
    }
    
    return null;
  }
  
  /**
   * Parse input string into parts, respecting quotes
   */
  private parseInput(input: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of input) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current) {
      parts.push(current);
    }
    
    return parts;
  }
  
  /**
   * Set up integration with Cvar system
   */
  private setupCvarIntegration(): void {
    // Track existing cvars
    for (const name of Cvar.getNames()) {
      this.cvarNames.add(name.toLowerCase());
    }
    
    // Register built-in cvar commands
    this.registerCvarCommands();
  }
  
  /**
   * Register built-in cvar management commands
   */
  private registerCvarCommands(): void {
    // These will be migrated to proper Command classes later
    // For now, create simple inline commands
  }
}
