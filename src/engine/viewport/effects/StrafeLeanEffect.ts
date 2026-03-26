/**
 * StrafeLeanEffect - Camera tilts into strafe direction
 *
 * Creates a "leaning into turns" feel by rolling the camera
 * toward the strafe direction. Smoothly interpolates.
 *
 * Cvars:
 * - cg_strafetilt: Max strafe lean (degrees)
 * - cg_strafetiltspeed: Lean interpolation speed
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Cvar } from "../../core/Cvar";
import type { PlayerState } from "../PlayerState";
import { createNeutralDelta, type ViewportDelta } from "../ViewportDelta";
import { BaseViewportEffect } from "../ViewportEffect";

export class StrafeLeanEffect extends BaseViewportEffect {
  readonly name = "strafelean";

  // Current lean amount (smoothed)
  private currentLean: number = 0;

  constructor() {
    super();
    this.registerCvars();
  }

  private registerCvars(): void {
    if (!Cvar.exists("cg_strafetilt")) {
      Cvar.register("cg_strafetilt", 1.5, {
        type: "float",
        min: 0,
        max: 5,
        description: "Max strafe lean (degrees)",
        persist: true,
      });
    }

    if (!Cvar.exists("cg_strafetiltspeed")) {
      Cvar.register("cg_strafetiltspeed", 8, {
        type: "float",
        min: 1,
        max: 20,
        description: "Lean interpolation speed",
        persist: true,
      });
    }
  }

  update(deltaTime: number, state: PlayerState): ViewportDelta {
    const delta = createNeutralDelta();

    const maxTilt = Cvar.getNumber("cg_strafetilt") ?? 1.5;
    const tiltSpeed = Cvar.getNumber("cg_strafetiltspeed") ?? 8;

    // Skip if no tilt configured
    if (maxTilt === 0) {
      this.currentLean = 0;
      return delta;
    }

    // Target lean based on strafe input
    // strafeInput: -1 (left), 0 (none), 1 (right)
    // Lean direction: negative roll = lean right, positive = lean left
    // So we invert: right strafe (-1 input) = lean right (negative roll)
    const targetLean = -state.strafeInput * maxTilt;

    // Smooth interpolation
    const lerpFactor = Math.min(1, deltaTime * tiltSpeed);
    this.currentLean = this.currentLean + (targetLean - this.currentLean) * lerpFactor;

    // Apply as roll
    delta.rotationOffset = new Vector3(0, 0, this.currentLean);

    return delta;
  }

  reset(): void {
    this.currentLean = 0;
  }
}
