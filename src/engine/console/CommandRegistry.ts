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

import { Cvar } from "../core/Cvar";
import { devLog } from "../core/DevLog";
import { Command, type CommandDef, type CommandOutput, fail, isCommandFailure } from "./Command";

export type CommandHandler = (args: string[]) => CommandOutput | Promise<CommandOutput>;

/** Structured result of {@link CommandRegistry.executeChecked}. */
export interface CommandExecResult {
  /** False for structural failures, thrown exceptions, or explicit CommandFailure returns. */
  ok: boolean;
  /** Human-readable output/error string to display (may be undefined for no-output). */
  output: string | undefined;
}

interface RegisteredCommand {
  command: Command;
  definition: CommandDef;
}

/**
 * Simple wrapper for legacy handler-based commands
 */
class LegacyCommand extends Command {
  readonly definition: CommandDef;
  private handler: CommandHandler;

  constructor(name: string, handler: CommandHandler, description: string = "No description") {
    super();
    this.definition = { name, description };
    this.handler = handler;
  }

  async execute(args: string[]): Promise<CommandOutput> {
    return this.handler(args);
  }
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
  register(command: Command): void;
  /**
   * Register a legacy handler-based command (backwards compatibility)
   */
  register(name: string, handler: CommandHandler, description?: string): void;
  register(commandOrName: Command | string, handler?: CommandHandler, description?: string): void {
    if (typeof commandOrName === "string") {
      // Legacy handler-based registration
      const command = new LegacyCommand(commandOrName, handler!, description);
      this.registerCommand(command);
      return;
    }
    this.registerCommand(commandOrName);
  }

  private registerCommand(command: Command): void {
    const def = command.definition;
    const key = def.name.toLowerCase();

    // Check developer mode for developer-only commands
    if (def.developer && !Cvar.getBool("developer")) {
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

    devLog(`[CommandRegistry] Registered: ${def.name}${def.aliases ? ` (aliases: ${def.aliases.join(", ")})` : ""}`);
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
   * Execute a command string, returning only its display output.
   *
   * Backwards-compatible thin wrapper over {@link executeChecked}; callers that
   * need to know whether the command failed (batch/headless runners) should use
   * `executeChecked` so they can gate the process exit code (QA-23).
   */
  async execute(input: string): Promise<string | undefined> {
    return (await this.executeChecked(input)).output;
  }

  /**
   * Execute a command string and report success/failure explicitly.
   *
   * `ok` is false for structural failures (unknown command, developer-mode
   * rejection), thrown exceptions, explicit {@link CommandOutput} failures a
   * command returns via `fail()`, and failed cvar sets. This is the signal
   * batch/headless runners use to set a non-zero exit code instead of printing
   * an error string and exiting 0.
   */
  async executeChecked(input: string): Promise<CommandExecResult> {
    const trimmed = input.trim();
    if (!trimmed) return { ok: true, output: undefined };

    // Parse command and arguments
    const parts = this.parseInput(trimmed);
    if (parts.length === 0) return { ok: true, output: undefined };

    const [commandName, ...args] = parts;
    const key = commandName.toLowerCase();

    // Check for alias
    const primaryKey = this.aliases.get(key) || key;

    // Try as command first
    const registered = this.commands.get(primaryKey);
    if (registered) {
      // Check developer mode
      if (registered.definition.developer && !Cvar.getBool("developer")) {
        return { ok: false, output: `Command '${commandName}' requires developer mode` };
      }

      try {
        return this.normalize(await registered.command.execute(args));
      } catch (error) {
        return { ok: false, output: `Error executing '${commandName}': ${error}` };
      }
    }

    // Try as cvar
    if (this.cvarNames.has(key)) {
      return this.normalize(this.handleCvar(key, args));
    }

    // Check if it's a cvar we haven't tracked yet
    const cvarValue = Cvar.get(key);
    if (cvarValue !== undefined) {
      this.cvarNames.add(key);
      return this.normalize(this.handleCvar(key, args));
    }

    return { ok: false, output: `Unknown command: ${commandName}` };
  }

  /** Normalize a command's raw output into a checked result. */
  private normalize(result: CommandOutput): CommandExecResult {
    if (isCommandFailure(result)) {
      return { ok: false, output: result.output };
    }
    return { ok: true, output: result };
  }

  /**
   * Handle cvar get/set
   */
  private handleCvar(name: string, args: string[]): CommandOutput {
    if (args.length === 0) {
      // Get value - use formatInfo for full display
      return Cvar.formatInfo(name);
    } else {
      // Set value
      const value = args.join(" ");
      const success = Cvar.set(name, value);
      if (success) {
        return `${name} = ${JSON.stringify(Cvar.get(name))}`;
      } else {
        return fail(`Failed to set ${name}`);
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
      const prefix = parts[0] || "";

      // Add matching commands
      for (const [name, registered] of this.commands) {
        // Skip developer commands in non-developer mode
        if (registered.definition.developer && !Cvar.getBool("developer")) {
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
        if (registered?.definition.developer && !Cvar.getBool("developer")) {
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
          const subPrefix = parts[1] || "";
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
      if (registered.definition.developer && !Cvar.getBool("developer")) {
        continue;
      }
      result.set(name, registered.definition);
    }
    return result;
  }

  /**
   * Check if a name is a cvar (not a command)
   */
  isCvar(name: string): boolean {
    const key = name.toLowerCase();
    return !this.commands.has(key) && Cvar.exists(key);
  }

  /**
   * Get all command definitions (for help listing)
   */
  getAllDefinitions(): CommandDef[] {
    const result: CommandDef[] = [];
    for (const [_, registered] of this.commands) {
      // Filter developer commands in non-developer mode
      if (registered.definition.developer && !Cvar.getBool("developer")) {
        continue;
      }
      result.push(registered.definition);
    }
    return result;
  }

  /**
   * Get command definition (for autocomplete display)
   */
  getDefinition(name: string): CommandDef | undefined {
    const key = name.toLowerCase();
    const primaryKey = this.aliases.get(key) || key;
    return this.commands.get(primaryKey)?.definition;
  }

  /**
   * Get autocomplete suggestions for input (compatibility with DebugConsole)
   */
  getAutocompleteSuggestions(input: string): string[] {
    return this.getCompletions(input);
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
      return `${key} - ${cvar.description || "Console variable"}\nCurrent value: ${Cvar.get(key)}`;
    }

    return null;
  }

  /**
   * Parse input string into parts, respecting quotes
   */
  private parseInput(input: string): string[] {
    const parts: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of input) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === " " && !inQuotes) {
        if (current) {
          parts.push(current);
          current = "";
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
