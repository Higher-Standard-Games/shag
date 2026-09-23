/**
 * Behaviour cloning labels: what the person did, not how well it went.
 *
 * The scheme these replace built every target from the frame's reward, so on a
 * neutral frame — most frames — every target was 0.5 whatever the human had
 * done. TF-4 in docs/research/BOT_TF_IMPROVEMENTS.md.
 */

import { describe, expect, it } from "vitest";
import { InputButtons } from "../BotConfig";
import type { TrainingFrame } from "../BotEpisodeRecorder";
import { angleDelta, buildCombatTarget, buildTacticalTarget, encodeAimDelta } from "../CloningTargets";

const frame = (over: {
  buttons?: number;
  yaw?: number;
  pitch?: number;
  directionX?: number;
  directionZ?: number;
  weaponSlot?: number;
  damageTaken?: number;
  reward?: number;
}): TrainingFrame =>
  ({
    tick: 0,
    tacticalInput: [],
    combatInput: null,
    reward: over.reward ?? 0,
    action: {
      buttons: over.buttons ?? 0,
      weaponSlot: over.weaponSlot ?? 0,
      yaw: over.yaw ?? 0,
      pitch: over.pitch ?? 0,
      directionX: over.directionX ?? 0,
      directionZ: over.directionZ ?? 0,
    },
    events: {
      damageDealt: 0,
      damageTaken: over.damageTaken ?? 0,
      kill: false,
      death: false,
      itemPickedUp: false,
      healthBefore: 100,
      healthAfter: 100,
      armorBefore: 0,
      armorAfter: 0,
    },
  }) as unknown as TrainingFrame;

describe("tactical targets", () => {
  it("labels the buttons the person held, whatever the reward", () => {
    const pressed = frame({ buttons: InputButtons.SPRINT | InputButtons.JUMP, reward: 0 });
    const target = buildTacticalTarget(pressed);
    // A neutral reward used to erase this: both would have been 0.5
    expect(target[3]).toBe(1); // sprint
    expect(target[5]).toBe(1); // jump
  });

  it("labels a button not held as zero, not as an inverse of the reward", () => {
    const target = buildTacticalTarget(frame({ buttons: 0, reward: 0.9 }));
    expect(target[3]).toBe(0);
    expect(target[5]).toBe(0);
  });

  it("notices a weapon switch and which slot was chosen", () => {
    const before = frame({ weaponSlot: 2 });
    const after = frame({ weaponSlot: 5 });
    expect(buildTacticalTarget(after, before)[6]).toBe(1);
    expect(buildTacticalTarget(after, before)[7]).toBeCloseTo(5 / 9, 5);
    expect(buildTacticalTarget(after, after)[6]).toBe(0);
  });

  it("derives a mode proxy from behaviour rather than leaving it undecided", () => {
    const fighting = buildTacticalTarget(frame({ buttons: InputButtons.FIRE }));
    expect(fighting[0]).toBe(1);
    const retreating = buildTacticalTarget(frame({ damageTaken: 30, directionZ: -1 }));
    expect(retreating[1]).toBe(1);
    const hunting = buildTacticalTarget(frame({}));
    expect(hunting[2]).toBe(1);
  });
});

describe("combat targets", () => {
  it("labels fire and alt-fire from the buttons", () => {
    const target = buildCombatTarget(frame({ buttons: InputButtons.FIRE | InputButtons.ALT_FIRE }));
    expect(target[0]).toBe(1);
    expect(target[1]).toBe(1);
  });

  it("uses the turn the person made, which the old scheme discarded", () => {
    const before = frame({ yaw: 0 });
    const right = buildCombatTarget(frame({ yaw: 0.5 }), before);
    const left = buildCombatTarget(frame({ yaw: -0.5 }), before);
    expect(right[2]).toBeGreaterThan(0.5);
    expect(left[2]).toBeLessThan(0.5);
    // No previous frame means no measurable turn
    expect(buildCombatTarget(frame({ yaw: 0.5 }))[2]).toBe(0.5);
  });

  it("strafes from the wish direction, not from velocity", () => {
    expect(buildCombatTarget(frame({ directionX: -1 }))[4]).toBe(1);
    expect(buildCombatTarget(frame({ directionX: 1 }))[5]).toBe(1);
    expect(buildCombatTarget(frame({ directionX: 0 }))[4]).toBe(0);
  });
});

describe("angle handling", () => {
  it("takes the short way round the circle", () => {
    expect(angleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6.0, 5);
    expect(angleDelta(0, 1)).toBeCloseTo(1, 5);
  });

  it("keeps a flick inside the sigmoid range", () => {
    expect(encodeAimDelta(0)).toBe(0.5);
    expect(encodeAimDelta(99)).toBe(1);
    expect(encodeAimDelta(-99)).toBe(0);
  });
});
