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

/** Tactical head, 5 outputs. Index order matches HybridBrain's TACT map. */
export const TACTICAL_TARGET_SIZE = 5;
/** Combat head, 6 outputs. Index order matches HybridBrain's COMBAT map. */
export const COMBAT_TARGET_SIZE = 6;

/**
 * How far the view may turn between two frames before the label saturates.
 *
 * The aim heads are sigmoids, so a turn has to be squeezed into [0,1] with 0.5
 * meaning "no change". A whole radian between snapshots is a fast flick; using
 * that as the edge keeps ordinary tracking in the middle of the range instead
 * of pinned at the ends, where the network cannot tell one correction from
 * another. TF-12 replaces this encoding with a linear head.
 */
export const AIM_DELTA_SCALE = 1.0;

/**
 * Slots a weapon label is spread over: the keyboard's worth of them.
 *
 * A commanded slot is a 1-based index into the player's own inventory, which the
 * server resolves against the weapons they are actually carrying. Fixing the
 * range at nine keeps one output meaning one slot however many weapons happen to
 * be held — encoding against the current inventory size instead would make the
 * same number mean a different weapon from one pickup to the next, which is not
 * something a network can learn.
 */
export const MAX_WEAPON_SLOT = 9;

/** A commanded slot as a [0,1] label. Zero means no weapon named. */
export function encodeWeaponSlot(slot: number): number {
  return Math.max(0, Math.min(1, slot / MAX_WEAPON_SLOT));
}

/**
 * A head's weapon output back to a slot number, or 0 for none.
 *
 * The inverse of the label, so the two sides cannot drift apart. The caller
 * still has to check the slot against what the bot is carrying.
 */
export function decodeWeaponSlot(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const slot = Math.round(Math.max(0, Math.min(1, value)) * MAX_WEAPON_SLOT);
  return slot;
}

/**
 * How far apart two frames may be and still be treated as consecutive.
 *
 * A run has holes in it: the extractor skips every frame where the player is
 * dead or not in the roster, so the array jumps from the moment of death to the
 * moment of respawn — hundreds of ticks. Measuring a turn across that gap
 * invents a flick made while the player was staring at a respawn screen.
 *
 * Twelve ticks is roomy for real adjacency (a 125 Hz simulation at 60 Hz
 * snapshots is about two, at 20 Hz about six) and far below any death gap,
 * which a respawn delay alone puts past a hundred.
 */
export const MAX_LABEL_GAP_TICKS = 12;

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
 * Every output here is something a person pressed. The head used to carry three
 * more — FIGHT, RETREAT and HUNT — which nobody can label, because a player
 * never emits "my mode is HUNT". They were derived from behaviour instead, which
 * made them a guess dressed as a target; two of the three were then never read
 * at inference, and the third overrode the state machine on the strength of
 * "hurt and walking backwards". Which mode to be in stays the state machine's
 * decision, and belongs to self-play, where the bot knows its own.
 */
export function buildTacticalTarget(frame: TrainingFrame, previous?: TrainingFrame): number[] {
  const { buttons, weaponSlot } = frame.action;
  const target = new Array<number>(TACTICAL_TARGET_SIZE).fill(0);

  // 0-2: movement, straight from the buttons the person held
  target[0] = held(buttons, InputButtons.SPRINT);
  target[1] = held(buttons, InputButtons.CROUCH);
  target[2] = held(buttons, InputButtons.JUMP);

  // 3-4: weapon — did they switch, and to what
  const switched = previous !== undefined && previous.action.weaponSlot !== weaponSlot;
  target[3] = switched ? 1 : 0;
  target[4] = encodeWeaponSlot(weaponSlot);

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

export interface TrainingPair {
  input: number[];
  target: number[];
  /**
   * The frame's reward, normalised to [-1, 1], carried along rather than mixed
   * into the target. Cloning a person ignores it — what they did is the answer
   * whether or not the frame went well. Self-play uses it as a weight, which is
   * where a reward belongs: it says how much to listen, not what to say.
   */
  reward: number;
}

/**
 * A normalised reward as a sample weight in [0, 1].
 *
 * The worst frame of a round weighs nothing and the best weighs one, so a bot
 * training on its own play leans on what went well without being told that
 * anything it did was a different action than the one it took.
 */
export function rewardToWeight(reward: number): number {
  if (!Number.isFinite(reward)) return 0;
  return Math.max(0, Math.min(1, (reward + 1) / 2));
}

/**
 * Build training pairs for one run — one player, one match, in order.
 *
 * Runs matter because the aim labels are *differences*. Concatenate two
 * players and the frame before the seam belongs to someone else, so the
 * network is taught a turn nobody made and a weapon switch nobody performed.
 * The previous frame is taken before filtering on input width, so a frame
 * dropped for the wrong feature size does not silently make its neighbour's
 * delta span a gap.
 */
export function buildRunPairs(
  run: readonly TrainingFrame[],
  head: "tactical" | "combat",
  expectedInputSize: number,
): TrainingPair[] {
  const pairs: TrainingPair[] = [];
  for (let index = 0; index < run.length; index++) {
    const frame = run[index];
    const previous = index > 0 ? adjacentOrNothing(run[index - 1], frame) : undefined;
    const input = head === "tactical" ? frame.tacticalInput : frame.combatInput;
    if (!input || input.length !== expectedInputSize) continue;
    const target = head === "tactical" ? buildTacticalTarget(frame, previous) : buildCombatTarget(frame, previous);

    // One non-finite number turns the loss to NaN and takes the weights with
    // it, silently and irreversibly. A corrupt frame is not worth a training
    // run, so it is dropped here rather than discovered afterwards.
    if (!allFinite(input) || !allFinite(target)) continue;

    pairs.push({ input, target, reward: frame.reward });
  }
  return pairs;
}

/** Every element present and a real number. */
function allFinite(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/**
 * The previous frame, but only if it really is the previous frame.
 *
 * Array adjacency is not time adjacency: see MAX_LABEL_GAP_TICKS.
 */
export function adjacentOrNothing(
  previous: TrainingFrame,
  frame: TrainingFrame,
  maxGap = MAX_LABEL_GAP_TICKS,
): TrainingFrame | undefined {
  const gap = frame.tick - previous.tick;
  return gap > 0 && gap <= maxGap ? previous : undefined;
}

/**
 * Build pairs across many runs, each kept separate, and say how many frames
 * were dropped on the way — a silent drop is how a training set quietly
 * becomes a tenth of what the operator believes it is.
 */
export function buildCorpusPairs(
  runs: readonly (readonly TrainingFrame[])[],
  head: "tactical" | "combat",
  expectedInputSize: number,
): { pairs: TrainingPair[]; dropped: number } {
  const pairs = runs.flatMap((run) => buildRunPairs(run, head, expectedInputSize));
  const total = runs.reduce((sum, run) => sum + run.length, 0);
  return { pairs, dropped: total - pairs.length };
}
