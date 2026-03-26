/**
 * SkyboxCommand - Skybox control
 */

import { Command, type CommandDef } from "../Command";

export default class SkyboxCommand extends Command {
  readonly definition: CommandDef = {
    name: "skybox",
    aliases: ["sky"],
    description: "Skybox control",
    usage: "skybox <load|clear|info> [name]",
    developer: true,
    subcommands: [
      { name: "load", description: "Load skybox", args: [{ name: "name", type: "string" }] },
      { name: "clear", description: "Remove skybox" },
      { name: "info", description: "Show skybox info" },
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
      case "load": {
        const name = args[1];
        if (!name) {
          return "Usage: skybox load <name>";
        }
        return `Skybox loading: use map command to load maps with skyboxes`;
      }

      case "clear": {
        // Find and dispose skybox meshes
        const skyboxMeshes = scene.meshes.filter((m) => m.name.includes("skyBox") || m.name.includes("skybox"));
        for (const mesh of skyboxMeshes) {
          mesh.dispose();
        }
        return `Cleared ${skyboxMeshes.length} skybox meshes`;
      }
      default: {
        const skyboxMeshes = scene.meshes.filter((m) => m.name.includes("skyBox") || m.name.includes("skybox"));
        if (skyboxMeshes.length === 0) {
          return "No skybox loaded";
        }
        return `Skybox meshes: ${skyboxMeshes.map((m) => m.name).join(", ")}`;
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["load", "clear", "info"];
    }
    return [];
  }
}
