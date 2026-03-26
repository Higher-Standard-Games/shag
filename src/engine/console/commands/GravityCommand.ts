/**
 * GravityCommand - Scene gravity control
 */

import { Command, type CommandDef } from "../Command";

export default class GravityCommand extends Command {
  readonly definition: CommandDef = {
    name: "gravity",
    description: "Scene gravity control",
    usage: "gravity [value]",
    developer: true,
  };

  async execute(args: string[]): Promise<string | void> {
    // Get scene physics
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

    // Check if physics is enabled
    const physicsEngine = scene.getPhysicsEngine?.();
    if (!physicsEngine) {
      return "Physics not enabled in scene";
    }

    const value = parseFloat(args[0]);

    if (isNaN(value)) {
      const gravity = physicsEngine.gravity;
      return `Gravity: (${gravity.x}, ${gravity.y}, ${gravity.z})`;
    }

    // Set gravity (negative Y is down)
    const { Vector3 } = await import("@babylonjs/core/Maths/math.vector");
    physicsEngine.setGravity(new Vector3(0, -value, 0));
    return `Gravity set to ${value}`;
  }
}
