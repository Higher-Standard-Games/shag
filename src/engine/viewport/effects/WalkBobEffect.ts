/**
 * WalkBobEffect - Realistic view bobbing while moving
 *
 * Creates a vertical sine wave (up/down) synced to footstep cycle,
 * with horizontal sway and forward lean when running.
 *
 * Features:
 * - Vertical bob (up/down) synced to footsteps
 * - Horizontal sway (left/right) for realistic running
 * - Forward lean (pitch down) when sprinting - like a cheetah!
 * - Speed-based frequency matching stride
 *
 * Cvars:
 * - cg_bob: Enable view bobbing (0/1)
 * - cg_bobamplitude: Vertical bob strength (units)
 * - cg_bobfrequency: Bob cycle speed base
 * - cg_bobroll: Roll tilt during bob (degrees)
 * - cg_boblean: Forward lean when running (degrees)
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Cvar } from "../../core/Cvar";
import type { PlayerState } from "../PlayerState";
import { BASE_SPEED, getSpeedRatio } from "../SpeedConstants";
import { createNeutralDelta, type ViewportDelta } from "../ViewportDelta";
import { BaseViewportEffect } from "../ViewportEffect";

export class WalkBobEffect extends BaseViewportEffect {
  readonly name = "walkbob";

  // Bob cycle accumulator (increases with distance traveled)
  private bobCycle: number = 0;
  // Current forward lean (smoothed)
  private currentLean: number = 0;

  constructor() {
    super();
    WalkBobEffect.ensureCvars();
  }

  /** Register the shared view-bob controls without requiring an effect instance. */
  static ensureCvars(): void {
    if (!Cvar.exists("cg_bob")) {
      Cvar.register("cg_bob", 1, {
        type: "int",
        min: 0,
        max: 1,
        description: "Enable view bobbing while walking",
        persist: true,
      });
    }

    if (!Cvar.exists("cg_bobamplitude")) {
      Cvar.register("cg_bobamplitude", 1.0, {
        type: "float",
        min: 0,
        max: 5,
        description: "Vertical bob strength (units)",
        persist: true,
      });
    }

    if (!Cvar.exists("cg_bobfrequency")) {
      Cvar.register("cg_bobfrequency", 0.03, {
        type: "float",
        min: 0.01,
        max: 0.06,
        description: "Bob cycle speed - higher = faster footsteps",
        persist: true,
      });
    }

    if (!Cvar.exists("cg_bobroll")) {
      Cvar.register("cg_bobroll", 0.35, {
        type: "float",
        min: 0,
        max: 2,
        description: "Roll tilt during bob (degrees)",
        persist: true,
      });
    }

    if (!Cvar.exists("cg_boblean")) {
      Cvar.register("cg_boblean", 1.0, {
        type: "float",
        min: 0,
        max: 5,
        description: "Forward lean when running fast (degrees)",
        persist: true,
      });
    }
  }

  /**
   * The bob FORMULA, shared verbatim by live play (this effect) and demo POV
   * reconstruction (DemoPovState) — one source so the two can never drift.
   * Pure: advances the given cycle by the given delta and returns the offsets.
   * Integration policy (lean smoothing, decay-when-idle) stays with callers.
   */
  static computeBob(
    bobCycle: number,
    horizontalSpeed: number,
    deltaSeconds: number,
  ): { newBobCycle: number; bobRight: number; bobUp: number; rollDegrees: number; targetLean: number } {
    const amplitude = Cvar.getNumber("cg_bobamplitude") ?? 1.5;
    const frequency = Cvar.getNumber("cg_bobfrequency") ?? 0.015;
    const rollAmount = Cvar.getNumber("cg_bobroll") ?? 0.5;
    const leanAmount = Cvar.getNumber("cg_boblean") ?? 1.5;

    // Speed factor: scale bob intensity with movement speed (walk 1x → 2x cap).
    const speedFactor = Math.min(horizontalSpeed / BASE_SPEED, 2.0);
    // Speed ratio: 0 at base, 1 at 2x base (shared gradient).
    const speedRatio = getSpeedRatio(horizontalSpeed);

    // Bob cycle advances with distance traveled; cadence rises with speed.
    const effectiveFrequency = frequency * (1 + speedRatio * 0.3);
    const newBobCycle = bobCycle + horizontalSpeed * deltaSeconds * effectiveFrequency;

    return {
      newBobCycle,
      // Vertical bob (primary), synced to footsteps.
      bobUp: Math.sin(newBobCycle * 2) * amplitude * speedFactor,
      // Horizontal sway (secondary), 90° phase offset, stronger when fast.
      bobRight: Math.sin(newBobCycle) * amplitude * 0.4 * speedFactor * (1 + speedRatio * 0.5),
      // Subtle shoulder roll matching the sway.
      rollDegrees: Math.sin(newBobCycle) * rollAmount * speedFactor,
      // Forward lean target when going fast (callers integrate/smooth it).
      targetLean: speedRatio * leanAmount,
    };
  }

  update(deltaTime: number, state: PlayerState): ViewportDelta {
    const delta = createNeutralDelta();

    // Check if bobbing is enabled
    const bobEnabled = Cvar.getNumber("cg_bob") !== 0;
    if (!bobEnabled) return delta;

    // Disable bob when sliding (crouchslide should have no walk bob)
    if (state.isSliding) {
      // Smoothly decay bob cycle and lean to avoid jarring transition
      this.bobCycle *= 0.85;
      this.currentLean *= 0.85;
      return delta;
    }

    // Only bob when grounded and moving
    if (!state.isGrounded || state.horizontalSpeed < 10) {
      // Smoothly decay bob cycle and lean when stopping
      this.bobCycle *= 0.9;
      this.currentLean *= 0.9;
      return delta;
    }

    const bob = WalkBobEffect.computeBob(this.bobCycle, state.horizontalSpeed, deltaTime);
    this.bobCycle = bob.newBobCycle;

    // Forward lean integration (live: per-frame lerp).
    const leanSpeed = 5; // How fast we lean forward/back
    this.currentLean += (bob.targetLean - this.currentLean) * Math.min(1, deltaTime * leanSpeed);

    // Write shared bob values to state (for weapon bob to sync with)
    state.bobCycle = this.bobCycle;
    state.speedRatio = getSpeedRatio(state.horizontalSpeed);

    // Build delta
    delta.positionOffset = new Vector3(bob.bobRight, bob.bobUp, 0);
    delta.rotationOffset = new Vector3(this.currentLean, 0, bob.rollDegrees);

    return delta;
  }

  reset(): void {
    this.bobCycle = 0;
    this.currentLean = 0;
  }
}
