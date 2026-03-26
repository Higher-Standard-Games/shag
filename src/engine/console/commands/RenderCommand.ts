/**
 * RenderCommand - Render variable control (consolidates r_list, r_reset, r_export, r_apply)
 */

import { Command, type CommandDef } from "../Command";

export default class RenderCommand extends Command {
  readonly definition: CommandDef = {
    name: "render",
    aliases: ["r"],
    description: "Render variable control",
    usage: "render <list|reset|export|apply>",
    developer: true,
    subcommands: [
      { name: "list", description: "List all render variables" },
      { name: "reset", description: "Reset all render variables to defaults" },
      { name: "export", description: "Export render config" },
      { name: "apply", description: "Force apply to scene" },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

    // Get RenderVars
    let renderVars;
    try {
      const { RenderVars } = await import("../../rendering/RenderVars");
      renderVars = RenderVars.getInstance();
    } catch {
      return "RenderVars not available";
    }

    switch (subcommand) {
      case "list": {
        const vars = renderVars.getAll();
        if (vars.length === 0) {
          return "No render variables registered";
        }
        const lines = [`${vars.length} render variables:`];
        for (const v of vars) {
          lines.push(`  ${v.name} = ${v.value}`);
        }
        return lines.join("\n");
      }

      case "reset":
        renderVars.resetAll();
        return "All render variables reset to defaults";

      case "export":
        return renderVars.exportConfig();

      case "apply":
        // Apply is handled automatically by RenderVars onChange callbacks
        return "Render variables are applied automatically on change";

      default:
        return "Subcommands: list, reset, export, apply\nUse r_<varname> to get/set individual render variables";
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["list", "reset", "export", "apply"];
    }
    return [];
  }
}
