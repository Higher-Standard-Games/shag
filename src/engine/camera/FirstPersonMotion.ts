/**
 * FirstPersonMotion — how a first-person eye moves with its body beyond the
 * view effects: the dip into a slide, the lift through a ledge grab, and the
 * ease up a step. The local camera and every view behind someone else's eyes
 * use these, so a watched screen moves the way the player's own did.
 */

/** The view's dip while sliding, in radians, from the slide's phase (0 – 1). */
export function slidePitch(phase: number): number {
  return phase > 0.01 ? phase * -0.22 : 0;
}

/**
 * Ease the ledge grab lift toward its phase's target. The phase drops from 1
 * to 0 at once when the grab completes, so the lift settles back rather than
 * snapping the view.
 */
export function easeLedgePitch(current: number, phase: number, dt: number): number {
  const target = phase > 0.01 ? phase * 0.15 : 0;
  return current + (target - current) * Math.min(1, dt * 8);
}

/**
 * The eye's height as it climbs: small steps up ease in by `factor` per frame;
 * anything else is followed exactly — a fall, a big jump in height, a teleport,
 * or whenever `snap` is set (a ledge grab, which lifts the body itself).
 */
export function smoothStepUp(
  smoothedY: number,
  y: number,
  options: { stepHeight: number; factor: number; snap: boolean },
): number {
  const rise = y - smoothedY;
  if (options.snap || Math.abs(rise) > options.stepHeight * 2 || rise < -0.5) return y;
  return smoothedY + rise * options.factor;
}
