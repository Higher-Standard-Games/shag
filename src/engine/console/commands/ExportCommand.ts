/**
 * ExportCommand - Export current settings to JSON
 */

import { Cvar } from "../../core/Cvar";
import { Command, type CommandDef } from "../Command";

export default class ExportCommand extends Command {
  readonly definition: CommandDef = {
    name: "export",
    description: "Export settings to clipboard",
    usage: "export <all|cvars|camera|fx>",
    subcommands: [
      { name: "all", description: "Export all settings" },
      { name: "cvars", description: "Export cvars" },
      { name: "camera", description: "Export camera settings" },
      { name: "fx", description: "Export post-processing settings" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "cvars": {
        const config = Cvar.exportConfig();
        if (!config.trim()) {
          return "No modified cvars to export";
        }
        await navigator.clipboard.writeText(config);
        return "Cvars exported to clipboard";
      }

      case "camera": {
        const camera = window.camera;
        if (!camera) return "Camera not available";

        const cam = camera.get?.();
        if (!cam) return "Camera not available";

        const settings = {
          camera: {
            mode: camera.getMode?.() || "freefly",
            height: camera.getHeight?.() || Math.round(cam.radius || 800),
            fov: parseFloat(cam.fov?.toFixed(3) || "0.4"),
          },
        };

        const json = JSON.stringify(settings, null, 2);
        await navigator.clipboard.writeText(json);
        return "Camera settings exported to clipboard";
      }

      case "fx": {
        const fx = window.fx;
        if (!fx) return "Post-processing not available";

        const settings = fx.settings?.();
        if (!settings) return "Post-processing not available";

        const json = JSON.stringify({ postProcessing: settings }, null, 2);
        await navigator.clipboard.writeText(json);
        return "Post-processing settings exported to clipboard";
      }

      case "all": {
        const allSettings: Record<string, unknown> = {};

        // Cvars
        const cvars = Cvar.list().filter((c) => c.value !== c.defaultValue);
        if (cvars.length > 0) {
          allSettings.cvars = Object.fromEntries(cvars.map((c) => [c.name, c.value]));
        }

        const json = JSON.stringify(allSettings, null, 2);
        await navigator.clipboard.writeText(json);
        return "All settings exported to clipboard";
      }

      default:
        return "Subcommands: all, cvars, camera, fx";
    }
  }

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["all", "cvars", "camera", "fx"];
    }
    return [];
  }
}
