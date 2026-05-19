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

    // Toggle collision on controller if it supports it
    if ("setCollision" in controller) {
      const current = (controller as any).hasCollision?.() ?? true;
      (controller as any).setCollision(!current);
      return `Collision: ${!current ? "ON" : "OFF (noclip)"}`;
    }

    // For freefly, toggle collision flag
    if ("collisionEnabled" in controller) {
      (controller as any).collisionEnabled = !(controller as any).collisionEnabled;
      return `Collision: ${(controller as any).collisionEnabled ? "ON" : "OFF (noclip)"}`;
    }

    return "Current controller does not support collision toggle";
  }
}
