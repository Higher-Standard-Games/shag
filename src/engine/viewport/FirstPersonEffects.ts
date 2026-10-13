/**
 * FirstPersonEffects — the view effects of a first-person screen, as one list.
 *
 * The local player's camera and every view behind someone else's eyes (demo
 * playback, live spectating) run these same effects, so a watched screen moves
 * the way the player's own did. Only the clock differs: the local camera hands
 * in frame time, a demo hands in recorded time.
 */

import { Cvar } from "../core/Cvar";
import { IdleBreathingEffect } from "./effects/IdleBreathingEffect";
import { LandingImpactEffect } from "./effects/LandingImpactEffect";
import { SpeedFOVEffect } from "./effects/SpeedFOVEffect";
import { StrafeLeanEffect } from "./effects/StrafeLeanEffect";
import { WalkBobEffect } from "./effects/WalkBobEffect";
import type { PlayerState } from "./PlayerState";
import { combineDelta, createNeutralDelta, type ViewportDelta } from "./ViewportDelta";
import type { ViewportEffect } from "./ViewportEffect";

/** A fresh set of the movement effects a first-person view runs, in order. */
export function createFirstPersonEffects(): ViewportEffect[] {
  return [
    new WalkBobEffect(),
    new LandingImpactEffect(),
    new StrafeLeanEffect(),
    new SpeedFOVEffect(),
    new IdleBreathingEffect(),
  ];
}

/**
 * The effects for a watched player's screen: one stack per watched view, with
 * its own state, so it never disturbs the local camera's.
 */
export class FirstPersonEffectStack {
  private readonly effects = createFirstPersonEffects();
  private last: ViewportDelta = createNeutralDelta();

  /**
   * Advance by `deltaTime` seconds and return the combined offsets. A step of
   * zero (a paused demo) holds the last result: some effects decay per call,
   * and a frozen frame must stay frozen.
   */
  update(deltaTime: number, state: PlayerState): ViewportDelta {
    if (deltaTime <= 0) return this.last;
    const combined = createNeutralDelta();
    // The master switch is registered with the local camera; unregistered is on.
    if (!Cvar.exists("cl_vieweffects") || Cvar.getNumber("cl_vieweffects") !== 0) {
      for (const effect of this.effects) {
        if (effect.enabled) combineDelta(combined, effect.update(deltaTime, state));
      }
    }
    this.last = combined;
    return combined;
  }

  reset(): void {
    for (const effect of this.effects) effect.reset();
    this.last = createNeutralDelta();
  }
}
