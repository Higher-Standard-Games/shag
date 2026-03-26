/**
 * IdleBreathingEffect - Subtle camera movement when standing still
 *
 * Very slow, small amplitude sine wave when player is idle.
 * Fades in/out smoothly based on movement speed.
 *
 * Cvars:
 * - cg_idle: Enable idle breathing (0/1)
 * - cg_idleamplitude: Breathing amplitude (units)
 * - cg_idlefrequency: Breathing cycle speed
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Cvar } from "../../core/Cvar";
import type { PlayerState } from "../PlayerState";
import { createNeutralDelta, type ViewportDelta } from "../ViewportDelta";
import { BaseViewportEffect } from "../ViewportEffect";

export class IdleBreathingEffect extends BaseViewportEffect {
  readonly name = "idle";

  // Breathing cycle accumulator
  private breathCycle: number = 0;

  // Speed at which player is considered "idle"
  private readonly IDLE_THRESHOLD = 50;

  constructor() {
    super();
    this.registerCvars();
  }

  private registerCvars(): void {
    if (!Cvar.exists("cg_idle")) {
      Cvar.register("cg_idle", 1, {
        type: "int",
        min: 0,
        max: 1,
        description: "Enable idle breathing effect (0=off for competitive, 1=on for immersion)",
        persist: true,
      });
    }

    if (!Cvar.exists("cg_idleamplitude")) {
      Cvar.register("cg_idleamplitude", 0.02, {
        type: "float",
        min: 0,
        max: 0.5,
        description: "Idle breathing amplitude (units) - should be barely perceptible",
        persist: true,
      });
    }

    if (!Cvar.exists("cg_idlefrequency")) {
      Cvar.register("cg_idlefrequency", 0.6, {
        type: "float",
        min: 0.3,
        max: 2,
        description: "Idle breathing cycle speed (slower = more natural)",
        persist: true,
      });
    }
  }

  update(deltaTime: number, state: PlayerState): ViewportDelta {
    const delta = createNeutralDelta();

    // Check if idle breathing is enabled
    const idleEnabled = Cvar.getNumber("cg_idle") !== 0;
    if (!idleEnabled) return delta;

    const amplitude = Cvar.getNumber("cg_idleamplitude") ?? 0.02;
    const frequency = Cvar.getNumber("cg_idlefrequency") ?? 0.6;

    // Calculate idle factor: 1 when still, 0 when moving fast
    const idleFactor = 1.0 - Math.min(state.horizontalSpeed / this.IDLE_THRESHOLD, 1);

    // Update breathing cycle (always runs to maintain smooth phase)
    this.breathCycle += deltaTime * frequency;

    // Only apply if somewhat idle
    if (idleFactor < 0.1) return delta;

    // Breathing motion
    // Y: slow up/down (main breathing) - very subtle
    const offsetY = Math.sin(this.breathCycle) * amplitude * idleFactor;

    // X: barely any horizontal sway (almost none - breathing is vertical)
    const offsetX = Math.sin(this.breathCycle * 0.7) * amplitude * 0.03 * idleFactor;

    // NOTE: We intentionally don't add pitch rotation here.
    // Rotation offsets would accumulate on top of mouse-controlled pitch,
    // causing slow drift. Position-only breathing is safer and still effective.

    delta.positionOffset = new Vector3(offsetX, offsetY, 0);
    // delta.rotationOffset stays neutral (0, 0, 0)

    return delta;
  }

  reset(): void {
    this.breathCycle = 0;
  }
}
