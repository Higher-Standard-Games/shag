/**
 * HelpCommand - command and cvar help, grouped and with clickable/hoverable
 * command names.
 *
 * This is the one "help" the auto-discovery loader (`commands/index.ts`)
 * registers; it used to be shadowed by an inline "help" the debug console
 * built in to itself (`DebugConsole.registerBuiltinCommands`), since
 * `registerEngineCommands()` runs after `DebugConsole.enable()` and
 * `CommandRegistry` keeps one entry per name — last write wins. The
 * console's richer version, with categories and the hover-help popover's
 * hook (`.console-help-term[data-help-cmd]`), lives here now instead, so
 * there is exactly one "help" and it is the one that actually runs.
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";
import { CommandRegistry } from "../CommandRegistry";

/** Curated command name → category, for the full listing. Not exhaustive by
 * design — anything not named here falls into "Other" rather than blocking
 * on an up-to-date list. */
const CATEGORY_BY_NAME: Record<string, string> = Object.fromEntries(
  [
    ["System", ["help", "clear", "version", "con_size", "console_debug"]],
    ["Cvars", ["cvarlist", "toggle", "reset", "resetall", "set", "cvarexport"]],
    [
      "Debug",
      [
        "debug",
        "camera",
        "map",
        "weather",
        "wind",
        "audio",
        "time",
        "export",
        "shader",
        "bsp",
        "pvs",
        "fog",
        "pk3",
        "mem",
        "scene",
        "ui",
        "hud",
        "show_fps",
        "freefly_speed",
        "freefly_collision",
      ],
    ],
    ["Game", ["game", "plant", "quest", "spawn", "give", "save", "load", "teleport", "unlock", "custom"]],
  ].flatMap(([category, names]) => (names as string[]).map((name) => [name, category as string])),
);
const CATEGORY_ORDER = ["System", "Cvars", "Game", "Debug", "Other"];

export default class HelpCommand extends Command {
  readonly definition: CommandDef = {
    name: "help",
    aliases: ["?", "commands"],
    description: "Display help for commands",
    usage: "help [command]",
  };

  async execute(args: string[]): Promise<string | undefined> {
    const registry = CommandRegistry.getInstance();
    if (args.length === 0) return this.listCommands(registry);
    return this.describeOne(registry, args[0].toLowerCase());
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return Array.from(CommandRegistry.getInstance().getCommands().keys());
    }
    return [];
  }

  /** `help <command>` or `help <cvar>`. */
  private describeOne(registry: CommandRegistry, name: string): string {
    if (registry.isCvar(name)) {
      const cvar = Cvar.getCvar(name);
      if (cvar) {
        let help = `<span class="hl-command">${cvar.name}</span> - ${cvar.description || "Console variable"}\n`;
        help += `<span class="hl-label">Type:</span> <span class="hl-string">${cvar.type}</span>\n`;
        help += `<span class="hl-label">Value:</span> <span class="hl-number">${cvar.value}</span>`;
        if (cvar.value !== cvar.defaultValue) {
          help += ` <span class="hl-label">(default: ${cvar.defaultValue})</span>`;
        }
        help += "\n";
        if (cvar.min !== undefined || cvar.max !== undefined) {
          help += `<span class="hl-label">Range:</span> <span class="hl-number">${cvar.min ?? "-∞"}</span> to <span class="hl-number">${cvar.max ?? "∞"}</span>\n`;
        }
        help += `<span class="hl-label">Usage:</span> <span class="hl-string">${name} [value]</span>`;
        return help;
      }
    }

    const def = registry.getDefinition(name);
    if (!def) return `Unknown command: ${name}`;

    let help = `<span class="hl-command">${def.name}</span> - ${def.description}\n`;
    if (def.usage) {
      help += `<span class="hl-label">Usage:</span> <span class="hl-string">${def.usage}</span>\n`;
    }
    if (def.subcommands) {
      help += '<span class="hl-label">Subcommands:</span>\n';
      for (const sub of def.subcommands) {
        help += `  <span class="hl-command">${sub.name.padEnd(12)}</span> ${sub.description}\n`;
      }
    }
    return help.trim();
  }

  /** Bare `help`: every command, grouped, with hover help wired on each name. */
  private listCommands(registry: CommandRegistry): string {
    const sortedDefs = [...registry.getAllDefinitions()].sort((a, b) => a.name.localeCompare(b.name));
    const categories: Record<string, CommandDef[]> = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, []]));

    for (const def of sortedDefs) {
      const name = def.name.toLowerCase();
      // Cvars themselves are skipped here — too many to list; cvarlist and
      // this command's own "help <cvar>" cover them instead.
      if (registry.isCvar(name)) continue;
      categories[CATEGORY_BY_NAME[name] ?? "Other"].push(def);
    }

    let help = '<span class="hl-label">═══════════════════════════════════════</span>\n';
    help += '<span class="hl-string">           CONSOLE COMMANDS</span>\n';
    help += '<span class="hl-label">═══════════════════════════════════════</span>\n\n';

    for (const category of CATEGORY_ORDER) {
      const cmds = categories[category];
      if (cmds.length === 0) continue;

      help += `<span class="hl-label">▸ ${category}</span>\n`;
      for (const def of cmds) {
        help += `  <span class="clickable-cmd console-help-term" data-cmd="${def.name}" data-help-cmd="${def.name}">${def.name.padEnd(14)}</span> ${def.description}\n`;
      }
      help += "\n";
    }

    help += '<span class="hl-label">▸ Console Variables</span>\n';
    help += '  Use <span class="hl-command">cvarlist</span> to see all cvars (r_*, s_*, g_*)\n';
    help += '  Use <span class="hl-command">help &lt;cvar&gt;</span> for cvar details\n\n';

    help += '<span class="hl-label">───────────────────────────────────────</span>\n';
    help += 'Type <span class="hl-command">help &lt;command&gt;</span> for detailed info.\n';
    help += 'Use <span class="hl-command">Tab</span> for autocomplete.';
    return help;
  }
}
