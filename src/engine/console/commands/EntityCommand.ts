/**
 * EntityCommand - Entity listing and inspection
 */

import { Command, type CommandDef } from "../Command";

export default class EntityCommand extends Command {
  readonly definition: CommandDef = {
    name: "entity",
    aliases: ["ent"],
    description: "Entity listing and inspection",
    usage: "entity <list|info|count>",
    developer: true,
    subcommands: [
      { name: "list", description: "List all entities" },
      { name: "count", description: "Show entity count" },
      { name: "info", description: "Show entity info", args: [{ name: "name", type: "string" }] },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
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
        const meshes = scene.meshes.filter((m) => m.metadata?.entity);
        if (meshes.length === 0) {
          return "No entities found";
        }
        const lines = [`${meshes.length} entities:`];
        for (const mesh of meshes.slice(0, 30)) {
          const entityType = mesh.metadata?.entity?.type || "unknown";
          lines.push(`  ${mesh.name} (${entityType})`);
        }
        if (meshes.length > 30) {
          lines.push(`  ... and ${meshes.length - 30} more`);
        }
        return lines.join("\n");
      }

      case "info": {
        const name = args[1];
        if (!name) {
          return "Usage: entity info <name>";
        }
        const mesh = scene.getMeshByName(name);
        if (!mesh) {
          return `Entity not found: ${name}`;
        }
        const pos = mesh.position;
        return (
          `Entity: ${name}\n` +
          `  Position: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})\n` +
          `  Enabled: ${mesh.isEnabled()}\n` +
          `  Metadata: ${JSON.stringify(mesh.metadata || {}).slice(0, 100)}`
        );
      }
      default: {
        const total = scene.meshes.length;
        const entities = scene.meshes.filter((m) => m.metadata?.entity).length;
        return `Meshes: ${total}, Entities: ${entities}`;
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["list", "count", "info"];
    }
    return [];
  }
}
