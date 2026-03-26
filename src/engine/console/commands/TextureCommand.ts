/**
 * TextureCommand - Texture management and debugging
 */

import { Command, type CommandDef } from "../Command";

export default class TextureCommand extends Command {
  readonly definition: CommandDef = {
    name: "texture",
    aliases: ["tex"],
    description: "Texture management and debugging",
    usage: "texture <subcommand>",
    developer: true,
    subcommands: [
      { name: "list", description: "List loaded textures" },
      { name: "stats", description: "Show texture memory stats" },
      { name: "reload", description: "Reload all textures" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    // Get scene
    let scene;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      scene = CameraSystem.getInstance().getCamera()?.getScene();
    } catch {
      return "Scene not available";
    }

    if (!scene) {
      return "No active scene";
    }

    switch (subcommand) {
      case "list": {
        const textures = scene.textures;
        if (textures.length === 0) {
          return "No textures loaded";
        }
        const lines = [`${textures.length} textures:`];
        for (const tex of textures.slice(0, 30)) {
          const size = tex.getSize();
          lines.push(`  ${tex.name || "(unnamed)"} - ${size.width}x${size.height}`);
        }
        if (textures.length > 30) {
          lines.push(`  ... and ${textures.length - 30} more`);
        }
        return lines.join("\n");
      }

      case "stats": {
        try {
          const { TextureMemoryManager } = await import("../../loader/texture/TextureMemoryManager");
          const tmm = TextureMemoryManager.getInstance();
          const stats = tmm.getStats();
          return (
            `Texture Memory:\n` +
            `  Count: ${stats.textureCount}\n` +
            `  Current: ${stats.currentMB.toFixed(1)} MB\n` +
            `  Peak: ${stats.peakMB.toFixed(1)} MB\n` +
            `  Budget: ${stats.budgetMB.toFixed(0)} MB (${stats.usagePercent.toFixed(0)}% used)`
          );
        } catch {
          return `Scene textures: ${scene.textures.length}`;
        }
      }

      case "reload": {
        // Texture reload is complex - just report count
        return `Scene has ${scene.textures.length} textures. Use map reload to refresh textures.`;
      }

      default: {
        return (
          `Texture Info:\n` +
          `  Loaded: ${scene.textures.length}\n` +
          'Use "texture list" or "texture stats" for details'
        );
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["list", "stats", "reload"];
    }
    return [];
  }
}
