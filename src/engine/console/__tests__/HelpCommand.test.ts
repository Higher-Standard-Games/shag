/**
 * `help`: grouped, clickable, hoverable. Also the regression for a real bug —
 * `DebugConsole.enable()` used to register its own "help" with this same
 * shape, but `registerEngineCommands()` (commands/ auto-discovery) runs
 * after it and auto-discovers this file's `HelpCommand`, overwriting that
 * entry in `CommandRegistry` silently (one entry per name). The console's
 * categorized, clickable output was dead code in the running app the whole
 * time; a plain alphabetical list from the auto-discovered command is what
 * actually rendered. Fixed by moving the real implementation here, the one
 * registration that wins.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { CommandRegistry } from "../CommandRegistry";
import HelpCommand from "../commands/HelpCommand";
import VersionCommand from "../commands/VersionCommand";

beforeEach(() => {
  CommandRegistry.getInstance().register(new HelpCommand());
  CommandRegistry.getInstance().register(new VersionCommand());
});

describe("HelpCommand", () => {
  it("lists commands grouped by category, each clickable and hover-helpable", async () => {
    const help = await new HelpCommand().execute([]);

    expect(help).toContain("CONSOLE COMMANDS");
    expect(help).toContain('<span class="hl-label">▸ System</span>');
    expect(help).toContain('data-cmd="version"');
    expect(help).toContain('data-help-cmd="version"');
    expect(help).toContain('class="clickable-cmd console-help-term"');
  });

  it("is still the one 'help' left standing after the auto-discovery loader runs last", () => {
    // The order a real boot uses: DebugConsole's own commands first (none of
    // them "help" any more), then the commands/ directory auto-discovery
    // that finds this file — simulated here by registering HelpCommand last,
    // same as registerEngineCommands() does for every *Command.ts file.
    const registry = CommandRegistry.getInstance();
    registry.register("help", () => "a stand-in for whatever ran first");
    registry.register(new HelpCommand());

    expect(registry.getDefinition("help")?.description).toBe("Display help for commands");
  });

  it("describes one command, with its usage and subcommands", async () => {
    const text = await new HelpCommand().execute(["version"]);
    expect(text).toContain('<span class="hl-command">version</span>');
  });

  it("reports an unknown command by name", async () => {
    expect(await new HelpCommand().execute(["not_a_real_command"])).toBe("Unknown command: not_a_real_command");
  });

  it("describes a cvar: type, value and range", async () => {
    const { Cvar } = await import("../../core/Cvar");
    Cvar.register("help_test_cvar", 5, { description: "a test cvar", min: 0, max: 10 });

    const text = await new HelpCommand().execute(["help_test_cvar"]);

    expect(text).toContain("a test cvar");
    expect(text).toContain('<span class="hl-label">Range:</span>');
    expect(text).toContain('<span class="hl-number">5</span>');
  });
});
