/**
 * Command - Base class for console commands
 *
 * Commands are actions that can be executed from the console.
 * Each command defines its own metadata (name, description, subcommands)
 * which is used for help text and autocomplete.
 *
 * Usage:
 *   export default class MyCommand extends Command {
 *     readonly definition: CommandDef = {
 *       name: 'mycommand',
 *       description: 'Does something useful',
 *       subcommands: [...]
 *     };
 *
 *     async execute(args: string[]): Promise<string | void> {
 *       // Implementation
 *     }
 *   }
 */

export interface ArgumentDef {
  /** Argument name for help text */
  name: string;
  /** Argument type for validation */
  type: "string" | "number" | "boolean" | "enum";
  /** Whether argument is required */
  required?: boolean;
  /** Valid options for enum type */
  options?: string[];
  /** Description for help text */
  description?: string;
}

export interface SubcommandDef {
  /** Subcommand name */
  name: string;
  /** Description for help text */
  description: string;
  /** Arguments for this subcommand */
  args?: ArgumentDef[];
}

export interface CommandDef {
  /** Primary command name */
  name: string;
  /** Description for help text */
  description: string;
  /** Usage string (e.g., "map <subcommand> [args]") */
  usage?: string;
  /** Alternative names for this command */
  aliases?: string[];
  /** Only available when developer mode is enabled */
  developer?: boolean;
  /** Subcommands */
  subcommands?: SubcommandDef[];
}

/**
 * Explicit failure result a command may return instead of a plain string.
 *
 * Plain-string / `undefined` returns are treated as success. Returning a
 * `CommandFailure` lets batch/headless runners gate on it (exit non-zero)
 * instead of printing an error string and exiting 0 (QA-23). In interactive
 * mode the `output` is displayed exactly like a normal string result.
 */
export interface CommandFailure {
  readonly ok: false;
  readonly output: string;
}

/** Result of executing a command: display string, no output, or explicit failure. */
export type CommandOutput = string | undefined | CommandFailure;

/** Construct an explicit command failure (see {@link CommandFailure}). */
export function fail(output: string): CommandFailure {
  return { ok: false, output };
}

/** Type guard: did a command signal an explicit failure? */
export function isCommandFailure(result: CommandOutput): result is CommandFailure {
  return typeof result === "object" && result !== null && result.ok === false;
}

/**
 * Base class for all console commands
 */
export abstract class Command {
  /** Command definition - used for help and autocomplete */
  abstract readonly definition: CommandDef;

  /**
   * Execute the command with parsed arguments
   * @param args Command arguments (already split by spaces)
   * @returns Output string to display, `undefined` for no output, or a
   *   {@link CommandFailure} to signal an error to batch/headless runners
   */
  abstract execute(args: string[]): Promise<CommandOutput>;

  /**
   * Optional: Custom autocomplete logic beyond definition
   * Override this for dynamic completions (e.g., map names, file lists)
   * @param input Current input text
   * @param args Already parsed arguments
   * @returns Array of completion suggestions
   */
  getCompletions?(input: string, args: string[]): string[];

  /**
   * Generate help text from definition
   */
  getHelp(): string {
    const def = this.definition;
    const lines: string[] = [];

    lines.push(`${def.name} - ${def.description}`);

    if (def.usage) {
      lines.push(`Usage: ${def.usage}`);
    }

    if (def.aliases && def.aliases.length > 0) {
      lines.push(`Aliases: ${def.aliases.join(", ")}`);
    }

    if (def.subcommands && def.subcommands.length > 0) {
      lines.push("Subcommands:");
      for (const sub of def.subcommands) {
        let subLine = `  ${sub.name}`;
        if (sub.args) {
          const argsStr = sub.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" ");
          subLine += ` ${argsStr}`;
        }
        subLine += ` - ${sub.description}`;
        lines.push(subLine);
      }
    }

    return lines.join("\n");
  }
}
