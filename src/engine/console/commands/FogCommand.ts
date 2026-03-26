/**
 * FogCommand - Scene fog control
 */

import { Command, type CommandDef } from "../Command";

export default class FogCommand extends Command {
  readonly definition: CommandDef = {
    name: "fog",
    description: "Scene fog control",
    usage: "fog <on|off|color|density> [args]",
    developer: true,
    subcommands: [
      { name: "on", description: "Enable fog" },
      { name: "off", description: "Disable fog" },
      { name: "color", description: "Set fog color (hex)", args: [{ name: "hex", type: "string" }] },
      { name: "density", description: "Set fog density", args: [{ name: "value", type: "number" }] },
      { name: "info", description: "Show fog info" },
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
      case "on":
        scene.fogEnabled = true;
        if (!scene.fogMode) {
          scene.fogMode = 3; // Exponential2
          scene.fogDensity = 0.01;
        }
        return "Fog enabled";

      case "off":
        scene.fogEnabled = false;
        return "Fog disabled";

      case "color": {
        const hex = args[1];
        if (!hex) {
          const current = scene.fogColor;
          return `Current fog color: rgb(${current.r.toFixed(2)}, ${current.g.toFixed(2)}, ${current.b.toFixed(2)})`;
        }
        try {
          const { Color3 } = await import("@babylonjs/core/Maths/math.color");
          scene.fogColor = Color3.FromHexString(hex.startsWith("#") ? hex : `#${hex}`);
          return `Fog color set to ${hex}`;
        } catch {
          return "Invalid hex color";
        }
      }

      case "density": {
        const value = parseFloat(args[1]);
        if (Number.isNaN(value)) {
          return `Current fog density: ${scene.fogDensity}`;
        }
        scene.fogDensity = value;
        scene.fogMode = 3; // Exponential2
        return `Fog density set to ${value}`;
      }
      default: {
        return (
          `Fog Info:\n` +
          `  Enabled: ${scene.fogEnabled ? "yes" : "no"}\n` +
          `  Mode: ${scene.fogMode} (0=none, 1=exp, 2=exp2, 3=linear)\n` +
          `  Density: ${scene.fogDensity}\n` +
          `  Color: rgb(${scene.fogColor.r.toFixed(2)}, ${scene.fogColor.g.toFixed(2)}, ${scene.fogColor.b.toFixed(2)})`
        );
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["on", "off", "color", "density", "info"];
    }
    return [];
  }
}
