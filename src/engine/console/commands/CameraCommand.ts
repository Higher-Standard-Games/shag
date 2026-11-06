/**
 * CameraCommand - Camera control and debugging
 */

import type { CameraSystem } from "../../camera/CameraSystem";
import { Cvar } from "../../core/Cvar";
import { MovementVars } from "../../movement/MovementVars";
import { Command, type CommandDef, type CommandOutput, fail } from "../Command";

/** Console names for the registered controller types, including short forms. */
const MODE_ALIASES = new Map<string, string>([
  ["iso", "isometric"],
  ["isometric", "isometric"],
  ["fps", "fps"],
  ["freefly", "freefly"],
  ["follow", "follow"],
  ["sidescroll", "sidescroll"],
]);

export default class CameraCommand extends Command {
  readonly definition: CommandDef = {
    name: "camera",
    description: "Camera control and debugging",
    usage: "camera <subcommand> [args]",
    subcommands: [
      {
        name: "mode",
        description: "Set camera mode (requires developer 1)",
        args: [{ name: "mode", type: "enum", options: ["iso", "fps", "freefly", "follow", "sidescroll"] }],
      },
      { name: "fov", description: "Set field of view", args: [{ name: "degrees", type: "number" }] },
      { name: "pos", description: "Show/set camera position" },
      { name: "info", description: "Show camera info" },
    ],
  };

  async execute(args: string[]): Promise<CommandOutput> {
    const subcommand = args[0]?.toLowerCase();
    if (subcommand === "mode" && !Cvar.getBool("developer")) {
      return fail("Command 'camera mode' requires developer mode");
    }

    let cameraSystem: CameraSystem;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      cameraSystem = CameraSystem.getInstance();
    } catch {
      return fail("CameraSystem not available");
    }

    const camera = cameraSystem.getCamera();
    if (!camera) {
      return fail("No active camera");
    }

    switch (subcommand) {
      case "mode": {
        const mode = args[1]?.toLowerCase();
        if (!mode) {
          // Report the active type alongside the accepted console names.
          const current = cameraSystem.getActiveController()?.type || "unknown";
          return `Current mode: ${current}\nAvailable: ${[...MODE_ALIASES.keys()].join(", ")}`;
        }

        const controllerType = MODE_ALIASES.get(mode);
        if (!controllerType) {
          return fail(`Unknown mode: ${mode}`);
        }

        const success = cameraSystem.setController(controllerType);
        if (success) {
          return `Camera mode set to: ${mode}`;
        } else {
          return fail(`Failed to set mode: ${mode} (controller not registered or camera not initialized)`);
        }
      }

      case "fov": {
        // Viewport effects derive the camera FOV from cl_fov each frame.
        const mv = MovementVars.getInstance();
        const def = mv.getVar("cl_fov");
        if (args.length === 1) {
          return `cl_fov ${mv.get("cl_fov")}° horizontal at 16:9`;
        }
        const fov = Number(args[1]);
        if (args.length !== 2 || !args[1].trim() || !Number.isFinite(fov)) {
          return fail("Usage: camera fov [degrees] (finite number)");
        }
        if (def && (fov < def.min || fov > def.max)) {
          return fail(`cl_fov must be between ${def.min} and ${def.max} degrees`);
        }
        if (!mv.set("cl_fov", fov)) return fail("Failed to set cl_fov.");
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

  override getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return Cvar.getBool("developer") ? ["mode", "fov", "pos", "info"] : ["fov", "pos", "info"];
    }
    if (args.length === 1 && args[0].toLowerCase() === "mode" && Cvar.getBool("developer")) {
      return [...MODE_ALIASES.keys()];
    }
    return [];
  }
}
