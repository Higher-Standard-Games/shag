/**
 * HelpCommand - Display help for commands
 */

import { Command, type CommandDef } from "../Command";
import { CommandRegistry } from "../CommandRegistry";

export default class HelpCommand extends Command {
  readonly definition: CommandDef = {
    name: "help",
    aliases: ["?", "commands"],
    description: "Display help for commands",
    usage: "help [command]",
  };

  async execute(args: string[]): Promise<string | void> {
    const registry = CommandRegistry.getInstance();

    if (args.length === 0) {
      // List all commands
      return this.listCommands(registry);
    }

    // Show help for specific command
    const commandName = args[0];
    const help = registry.getHelp(commandName);

    if (help) {
      return help;
    }

    return `Unknown command: ${commandName}`;
  }

  private listCommands(registry: CommandRegistry): string {
    const commands = registry.getCommands();
    const lines: string[] = ["Available commands:"];

    // Group by first letter or prefix
    const sorted = Array.from(commands.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    for (const [name, def] of sorted) {
      lines.push(`  ${name} - ${def.description}`);
    }

    lines.push("");
    lines.push('Type "help <command>" for more info on a specific command.');
    lines.push('Type a cvar name to see/set its value (e.g., "r_bloom 0.5").');

    return lines.join("\n");
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      // Complete command names
      const registry = CommandRegistry.getInstance();
      const commands = registry.getCommands();
      return Array.from(commands.keys());
    }
    return [];
  }
}
