/**
 * ClipCommand - Toggle noclip mode (collision)
 */

import type { CameraSystem } from "../../camera/CameraSystem";
import { Command, type CommandDef } from "../Command";

export default class ClipCommand extends Command {
  readonly definition: CommandDef = {
    name: "noclip",
    description: "Toggle collision (noclip mode)",
    developer: true,
  };

  async execute(): Promise<string | undefined> {
    // Get camera controller
    let cameraSystem: CameraSystem;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      cameraSystem = CameraSystem.getInstance();
    } catch {
      return "CameraSystem not available";
    }

    const controller = cameraSystem.getActiveController();
    if (!controller) {
      return "No active camera controller";
    }

    // Only the free-fly camera has a collision switch; first-person play always collides.
    if (controller.type !== "freefly") {
      return "noclip works in the free-fly camera";
    }
    const { FreeflyController } = await import("../../camera/controllers/FreeflyController");
    const enabled = !FreeflyController.isCollisionEnabled();
    FreeflyController.setCollisionEnabled(enabled);
    return `Collision: ${enabled ? "ON" : "OFF (noclip)"}`;
  }
}
