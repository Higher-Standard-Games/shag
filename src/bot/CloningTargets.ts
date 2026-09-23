/**
 * Turning a recorded human frame into what the network should have answered.
 *
 * This is behaviour cloning: the label is **what the person did**, not how well
 * it went. The previous scheme built every target from the frame's reward —
 * `(reward + 1) / 2` — which meant that on a neutral frame, which is most of
 * them, every target became 0.5 whatever the human had done, and the network
 * learned nothing from the majority of its data.
 *
 * Reward is not useless; it is the right signal for self-play sharpening later.
 * It is simply not an answer to "what would a person do here".
 *
 * TF-4 in docs/research/BOT_TF_IMPROVEMENTS.md.
 */

import { InputButtons } from "./BotConfig";
import type { TrainingFrame } from "./BotEpisodeRecorder";

/** Tactical head, 8 outputs. Index order matches HybridBrain's TACT map. */
export const TACTICAL_TARGET_SIZE = 8;
/** Combat head, 6 outputs. Index order matches HybridBrain's COMBAT map. */
export const COMBAT_TARGET_SIZE = 6;

/**
 * How far the view may turn between two frames before the label saturates.
 *
 * The aim heads are sigmoids, so a turn has to be squeezed into [0,1] with 0.5
 * meaning "no change". A whole radian between snapshots is a fast flick; using
 * that as the edge keeps ordinary tracking in the middle of the range instead
 * of pinned at the ends, where the network cannot tell one correction from
 * another. TF-5 should replace this encoding with a linear head.
 */
export const AIM_DELTA_SCALE = 1.0;

const held = (buttons: number, bit: number): number => ((buttons & bit) !== 0 ? 1 : 0);

/** Shortest signed distance from `from` to `to` on a circle, in radians. */
export function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/** Encode a turn into the sigmoid range, 0.5 being no turn. */
export function encodeAimDelta(delta: number, scale = AIM_DELTA_SCALE): number {
  const clamped = Math.max(-scale, Math.min(scale, delta));
  return 0.5 + clamped / (2 * scale);
}

/**
 * What the tactical head should have said, from what the person did.
 *
 * The three mode outputs are the honest weak spot: a person never emits "my
 * mode is HUNT", so they are derived from behaviour — firing means fighting,
 * backing away hurt means retreating, neither means hunting. They are labelled
 * as proxies rather than truth, and TF-5 removes them from the cloning
 * objective, leaving modes to self-play where the bot knows its own.
 */
export function buildTacticalTarget(frame: TrainingFrame, previous?: TrainingFrame): number[] {
  const { buttons, weaponSlot } = frame.action;
  const target = new Array<number>(TACTICAL_TARGET_SIZE).fill(0);

  const firing = held(buttons, InputButtons.FIRE);
  const hurt = frame.events.damageTaken > 0;
  const movingBack = frame.action.directionZ < -0.3;

  // 0-2: mode proxies — derived, not observed. See the note above.
  target[0] = firing ? 1 : 0; // FIGHT
  target[1] = hurt && movingBack ? 1 : 0; // RETREAT
  target[2] = !firing && !hurt ? 1 : 0; // HUNT

  // 3-5: movement, straight from the buttons the person held
  target[3] = held(buttons, InputButtons.SPRINT);
  target[4] = held(buttons, InputButtons.CROUCH);
  target[5] = held(buttons, InputButtons.JUMP);

  // 6-7: weapon — did they switch, and to what
  const switched = previous !== undefined && previous.action.weaponSlot !== weaponSlot;
  target[6] = switched ? 1 : 0;
  target[7] = Math.max(0, Math.min(1, weaponSlot / 9));

  return target;
}

/**
 * What the combat head should have said.
 *
 * Aim is the part worth having: view angles are recorded state, so the turn a
 * person made between two frames is the one label in this whole pipeline that
 * was never a guess — and the previous scheme threw it away, leaving both aim
 * outputs at 0.5 on every frame.
 */
export function buildCombatTarget(frame: TrainingFrame, previous?: TrainingFrame): number[] {
  const { buttons } = frame.action;
  const target = new Array<number>(COMBAT_TARGET_SIZE).fill(0);

  target[0] = held(buttons, InputButtons.FIRE);
  target[1] = held(buttons, InputButtons.ALT_FIRE);

  // 2-3: where the view actually went, not where it ended up
  if (previous) {
    target[2] = encodeAimDelta(angleDelta(previous.action.yaw, frame.action.yaw));
    target[3] = encodeAimDelta(angleDelta(previous.action.pitch, frame.action.pitch));
  } else {
    target[2] = 0.5;
    target[3] = 0.5;
  }

  // 4-5: strafing, from the wish direction the person gave — not from velocity,
  // which in an air-strafe points somewhere the player never pressed
  target[4] = frame.action.directionX < -0.3 ? 1 : 0;
  target[5] = frame.action.directionX > 0.3 ? 1 : 0;

  return target;
}

/** Pair each frame with the one before it, so deltas have something to measure. */
export function withPrevious<T>(frames: readonly T[]): Array<{ frame: T; previous?: T }> {
  return frames.map((frame, index) => ({ frame, previous: index > 0 ? frames[index - 1] : undefined }));
}
