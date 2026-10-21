/**
 * TimescaleCommand - Time scale control
 */

import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import { Command, type CommandDef } from "../Command";

/**
 * The time scale is kept on the engine as a field Babylon does not declare.
 * Babylon never reads it; only scene.animationTimeScale changes playback speed.
 */
type EngineWithTimeScale = AbstractEngine & { _timeScale?: number };

export default class TimescaleCommand extends Command {
  readonly definition: CommandDef = {
    name: "timescale",
    description: "Time scale control (slow-mo/fast-forward)",
    usage: "timescale [value]",
    developer: true,
  };

  async execute(args: string[]): Promise<string | undefined> {
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

    const engine: EngineWithTimeScale = scene.getEngine();
    const value = parseFloat(args[0]);

    if (Number.isNaN(value)) {
      // Get current time scale from engine
      const current = engine._timeScale ?? 1.0;
      return `Timescale: ${current}`;
    }

    if (value <= 0 || value > 10) {
      return "Timescale must be between 0.01 and 10";
    }

    // Set time scale
    engine._timeScale = value;

    // Also update scene animation ratio if available
    if (scene.animationTimeScale !== undefined) {
      scene.animationTimeScale = value;
    }

    return `Timescale set to ${value}`;
  }
}
