/**
 * CameraCommand - Camera control and debugging
 */

import type { CameraSystem } from "../../camera/CameraSystem";
import { MovementVars } from "../../movement/MovementVars";
import { Command, type CommandDef } from "../Command";

/** Console names for the registered controller types, including short forms. */
const MODE_ALIASES: Record<string, string> = {
  iso: "isometric",
  isometric: "isometric",
  fps: "fps",
  freefly: "freefly",
  follow: "follow",
  sidescroll: "sidescroll",
};

export default class CameraCommand extends Command {
  readonly definition: CommandDef = {
    name: "camera",
    description: "Camera control and debugging",
    usage: "camera <subcommand> [args]",
    subcommands: [
      {
        name: "mode",
        description: "Set camera mode",
        args: [{ name: "mode", type: "enum", options: ["iso", "fps", "freefly", "follow", "sidescroll"] }],
      },
      { name: "fov", description: "Set field of view", args: [{ name: "degrees", type: "number" }] },
      { name: "pos", description: "Show/set camera position" },
      { name: "info", description: "Show camera info" },
    ],
  };

  async execute(args: string[]): Promise<string | undefined> {
    let cameraSystem: CameraSystem;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      cameraSystem = CameraSystem.getInstance();
    } catch {
      return "CameraSystem not available";
    }

    const camera = cameraSystem.getCamera();
    if (!camera) {
      return "No active camera";
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case "mode": {
        const mode = args[1]?.toLowerCase();
        if (!mode) {
          // A controller's own type is the word a player can type back
          const current = cameraSystem.getActiveController()?.type || "unknown";
          return `Current mode: ${current}\nAvailable: ${Object.keys(MODE_ALIASES).join(", ")}`;
        }

        const controllerType = MODE_ALIASES[mode];
        if (!controllerType) {
          return `Unknown mode: ${mode}`;
        }

        const success = cameraSystem.setController(controllerType);
        if (success) {
          return `Camera mode set to: ${mode}`;
        } else {
          return `Failed to set mode: ${mode} (controller not registered)`;
        }
      }

      case "fov": {
        // Writing camera.fov directly only held until the next frame, when the
        // viewport effects overwrote it with baseFOV × their multipliers. Drive
        // cl_fov instead, which is what baseFOV is derived from.
        const mv = MovementVars.getInstance();
        const def = mv.getVar("cl_fov");
        const fov = parseFloat(args[1]);
        if (Number.isNaN(fov)) {
          return `cl_fov ${mv.get("cl_fov")}° horizontal at 16:9`;
        }
        // set() clamps silently, so say so rather than appearing to ignore them.
        if (def && (fov < def.min || fov > def.max)) {
          return `cl_fov must be between ${def.min} and ${def.max} degrees`;
        }
        mv.set("cl_fov", fov);
        return `cl_fov set to ${mv.get("cl_fov")}°`;
      }

      case "pos": {
        const pos = camera.position;
        return `Camera position: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`;
      }
      default: {
        const pos = camera.position;
        const controller = cameraSystem.getActiveController();
        return (
          `Camera Info:\n` +
          `  Controller: ${controller?.constructor.name || "none"}\n` +
          `  Position: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}\n` +
          `  FOV: ${((camera.fov * 180) / Math.PI).toFixed(1)}°`
        );
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["mode", "fov", "pos", "info"];
    }
    if (args.length === 1 && args[0] === "mode") {
      return ["iso", "fps", "freefly", "follow", "sidescroll"];
    }
    return [];
  }
}
