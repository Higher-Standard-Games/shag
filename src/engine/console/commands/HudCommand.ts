/**
 * HudCommand - HUD management and control
 */

import { Command, type CommandDef } from "../Command";

export class HudCommand extends Command {
  readonly definition: CommandDef = {
    name: "hud",
    description: "HUD management",
    usage: "hud <subcommand>",
  };

  async execute(args: string[]): Promise<string> {
    const { HUD } = await import("../../ui/hud");
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "info":
        return HUD.getDebugInfo();

      case "interval": {
        const ms = parseInt(args[1], 10);
        if (!args[1]) {
          return `Current interval: ${HUD.getInterval()}ms`;
        }
        if (Number.isNaN(ms) || ms < 16) {
          return `Usage: hud interval <ms>\nCurrent: ${HUD.getInterval()}ms\nMinimum: 16ms`;
        }
        HUD.setInterval(ms);
        return `HUD update interval: ${ms}ms`;
      }

      case "show": {
        const id = args[1];
        if (!id) return "Usage: hud show <element-id>";
        HUD.show(id);
        return `Showing: ${id}`;
      }

      case "hide": {
        const id = args[1];
        if (!id) return "Usage: hud hide <element-id>";
        HUD.hide(id);
        return `Hidden: ${id}`;
      }

      case "toggle": {
        const id = args[1];
        if (!id) return "Usage: hud toggle <element-id>";
        HUD.toggle(id);
        return `Toggled: ${id}`;
      }

      case "refresh":
        HUD.refresh();
        return "HUD refreshed";

      case "theme": {
        const theme = args[1];
        if (!theme) {
          return `Current theme: ${HUD.getTheme()}\nAvailable: default, dark`;
        }
        HUD.setTheme(theme);
        return `Theme: ${theme}`;
      }

      case "collapse": {
        const id = args[1];
        if (!id) {
          HUD.collapseAll();
          return "All accordions collapsed";
        }
        HUD.collapse(id);
        return `Collapsed: ${id}`;
      }

      case "expand": {
        const id = args[1];
        if (!id) return "Usage: hud expand <element-id>";
        HUD.expand(id);
        return `Expanded: ${id}`;
      }

      case "start":
        HUD.start();
        return "HUD update loop started";

      case "stop":
        HUD.stop();
        return "HUD update loop stopped";

      case "reset":
        HUD.reset();
        return "HUD reset to defaults";

      default:
        return [
          "HUD Commands:",
          "  hud info          - Show HUD status",
          "  hud interval <ms> - Set update interval",
          "  hud show <id>     - Show element",
          "  hud hide <id>     - Hide element",
          "  hud toggle <id>   - Toggle element",
          "  hud refresh       - Force refresh",
          "  hud theme <name>  - Set theme",
          "  hud collapse [id] - Collapse accordion(s)",
          "  hud expand <id>   - Expand accordion",
          "  hud start/stop    - Control update loop",
          "  hud reset         - Reset to defaults",
        ].join("\n");
    }
  }
}

export default HudCommand;
