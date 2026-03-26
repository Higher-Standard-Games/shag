/**
 * PhysicsCommand - Havok physics system control
 */

import { MovementVars } from "../../movement/MovementVars";
import { PhysicsSystem } from "../../physics/PhysicsSystem";
import { Command, type CommandDef } from "../Command";

export default class PhysicsCommand extends Command {
  readonly definition: CommandDef = {
    name: "physics",
    aliases: ["phys"],
    description: "Havok physics system control",
    usage: "physics <init|on|off|gravity|info>",
    developer: true,
    subcommands: [
      { name: "init", description: "Initialize Havok physics engine" },
      { name: "on", description: "Enable physics simulation" },
      { name: "off", description: "Disable physics simulation" },
      { name: "gravity", description: "Set gravity (physics gravity <value>)" },
      { name: "debug", description: "Toggle physics debug rendering" },
      { name: "info", description: "Show physics system info" },
    ],
  };

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();
    const physics = PhysicsSystem.getInstance();

    // Get scene
    let scene;
    try {
      const { CameraSystem } = await import("../../camera/CameraSystem");
      scene = CameraSystem.getInstance().getCamera()?.getScene();
    } catch {
      return "Scene not available";
    }

    switch (subcommand) {
      case "init": {
        if (!scene) {
          return "No active scene. Load a map first.";
        }
        if (physics.isInitialized()) {
          return "Physics already initialized";
        }
        const success = await physics.enablePhysics(scene);
        if (success) {
          return "Havok physics initialized and enabled";
        } else {
          return "Failed to initialize Havok physics";
        }
      }

      case "on":
        if (!scene) return "No active scene";
        if (!physics.isInitialized()) {
          return 'Physics not initialized. Run "physics init" first.';
        }
        scene.physicsEnabled = true;
        return "Physics simulation enabled";

      case "off":
        if (!scene) return "No active scene";
        scene.physicsEnabled = false;
        return "Physics simulation disabled";

      case "gravity": {
        const value = parseFloat(args[1]);
        if (isNaN(value)) {
          const mv = MovementVars.getInstance();
          const current = mv.get("sv_gravity");
          return `Current gravity: ${current} (use: physics gravity <value>)`;
        }
        const mv = MovementVars.getInstance();
        mv.set("sv_gravity", Math.abs(value));
        if (physics.isInitialized()) {
          const { Vector3 } = await import("@babylonjs/core/Maths/math.vector");
          physics.setGravity(new Vector3(0, -Math.abs(value), 0));
        }
        return `Gravity set to ${Math.abs(value)}`;
      }

      case "debug": {
        if (!scene) return "No active scene";
        const physicsEngine = scene.getPhysicsEngine?.();
        if (!physicsEngine) {
          return "Physics engine not initialized";
        }
        const viewer = (scene as any)._physicsViewer;
        if (viewer) {
          viewer.dispose();
          (scene as any)._physicsViewer = null;
          return "Physics debug: OFF";
        } else {
          try {
            const { PhysicsViewer } = await import("@babylonjs/core/Debug/physicsViewer");
            (scene as any)._physicsViewer = new PhysicsViewer(scene);
            return "Physics debug: ON";
          } catch {
            return "PhysicsViewer not available";
          }
        }
      }

      case "info":
      default: {
        const mv = MovementVars.getInstance();
        const lines = [
          "=== Physics System ===",
          `Havok loaded: ${physics.isHavokLoaded() ? "yes" : "no"}`,
          `Initialized: ${physics.isInitialized() ? "yes" : "no"}`,
        ];

        if (physics.isInitialized() && scene) {
          const gravity = physics.getGravity();
          lines.push(`Gravity: ${gravity.y}`);
          lines.push(`Simulation: ${scene.physicsEnabled ? "running" : "paused"}`);
        }

        lines.push("");
        lines.push("CVars:");
        lines.push(`  sv_gravity: ${mv.get("sv_gravity")}`);
        lines.push(`  sv_jumpheight: ${mv.get("sv_jumpheight")}`);
        lines.push(`  sv_friction: ${mv.get("sv_friction")}`);

        return lines.join("\n");
      }
    }
  }

  getCompletions(_input: string, args: string[]): string[] {
    if (args.length === 0) {
      return ["init", "on", "off", "gravity", "debug", "info"];
    }
    return [];
  }
}
