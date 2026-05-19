/**
 * LightCommand - Scene lighting control
 */

import type { Scene } from "@babylonjs/core/scene";
import { Command, type CommandDef } from "../Command";

export default class LightCommand extends Command {
  readonly definition: CommandDef = {
    name: "light",
    description: "Scene lighting control",
    usage: "light <subcommand> [args]",
    developer: true,
    subcommands: [
      { name: "ambient", description: "Set ambient light", args: [{ name: "intensity", type: "number" }] },
      { name: "list", description: "List all lights" },
      { name: "info", description: "Show lighting info" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    const subcommand = args[0]?.toLowerCase();

    // Get scene
    let scene: Scene | null | undefined;
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
      case "ambient": {
        const intensity = parseFloat(args[1]);
        if (Number.isNaN(intensity)) {
          return `Ambient intensity: ${scene.ambientColor.r.toFixed(2)}`;
        }
        const { Color3 } = await import("@babylonjs/core/Maths/math.color");
        scene.ambientColor = new Color3(intensity, intensity, intensity);
        return `Ambient intensity set to ${intensity}`;
      }

      case "list": {
        const lights = scene.lights;
        if (lights.length === 0) {
          return "No lights in scene";
        }
        const lines = [`${lights.length} lights:`];
        for (const light of lights) {
          lines.push(`  ${light.name} - ${light.getClassName()} (intensity: ${light.intensity.toFixed(2)})`);
        }
        return lines.join("\n");
      }
      default: {
        return (
          `Lighting Info:\n` +
          `  Lights: ${scene.lights.length}\n` +
          `  Ambient: rgb(${scene.ambientColor.r.toFixed(2)}, ${scene.ambientColor.g.toFixed(2)}, ${scene.ambientColor.b.toFixed(2)})`
        );
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["ambient", "list", "info"];
    }
    return [];
  }
}
