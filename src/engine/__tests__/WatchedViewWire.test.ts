/**
 * A watcher rebuilds a player's screen from the snapshot: their keys (the
 * strafe lean), the slide and ledge grab phases (the view's dip and lift) and
 * the crouch view offset (the eye's height mid-crouch). They ride behind bit 7
 * of the movement byte; a recording made before it never sets that bit and
 * still reads.
 */

import { describe, expect, it } from "vitest";
import { easeLedgePitch, slidePitch, smoothStepUp } from "../camera/FirstPersonMotion";
import type { IComponent } from "../network/core/Component";
import { Entity } from "../network/core/Entity";
import { GameState } from "../network/core/GameState";
import { BinaryProtocol } from "../network/protocol/BinaryProtocol";

const noop = {
  serialize() {},
  deserialize() {},
  clone() {
    return this;
  },
};

function player(movement: Record<string, unknown>): GameState {
  const state = new GameState();
  state.tick = 7;
  const entity = new Entity("player_1");
  entity.addComponent("transform", {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0.5, z: 0 },
    ...noop,
  } as unknown as IComponent);
  entity.addComponent("velocity", {
    x: 0,
    y: 0,
    z: 0,
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
    grounded: true,
    ...noop,
  } as unknown as IComponent);
  entity.addComponent("movementState", {
    isCrouching: true,
    isSliding: false,
    wallJumpState: "none",
    ...movement,
    ...noop,
  } as unknown as IComponent);
  state.entities.set("player_1", entity);
  return state;
}

const movementOf = (state: GameState) =>
  state.entities.get("player_1")!.getComponent("movementState") as unknown as Record<string, unknown>;

describe("watched view on the wire", () => {
  it("carries a player's keys, slide and ledge phases and crouch eye", () => {
    const sent = player({
      strafeInput: -1,
      forwardInput: 1,
      slidePhase: 0.5,
      ledgeGrabPhase: 1,
      crouchViewOffset: -13.25,
    });
    const got = movementOf(BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(sent)));
    expect(got).toMatchObject({
      isCrouching: true,
      strafeInput: -1,
      forwardInput: 1,
      ledgeGrabPhase: 1,
      crouchViewOffset: -13.25,
    });
    expect(got.slidePhase as number).toBeCloseTo(0.5, 2);
  });

  it("reads a recording made before the view: the movement byte alone", () => {
    const old = movementOf(BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(player({}))));
    expect(old.isCrouching).toBe(true);
    expect(old.strafeInput).toBeUndefined();
    expect(old.crouchViewOffset).toBeUndefined();
  });
});

describe("first-person motion", () => {
  it("dips into a slide, eases a ledge lift, and eases only small steps up", () => {
    expect(slidePitch(1)).toBeCloseTo(-0.22);
    expect(slidePitch(0)).toBe(0);
    expect(easeLedgePitch(0, 1, 1 / 60)).toBeCloseTo(0.15 * (8 / 60));
    const step = { stepHeight: 18, factor: 0.15, snap: false };
    expect(smoothStepUp(0, 16, step)).toBeCloseTo(2.4);
    expect(smoothStepUp(0, 100, step)).toBe(100);
    expect(smoothStepUp(10, 0, step)).toBe(0);
    expect(smoothStepUp(0, 16, { ...step, snap: true })).toBe(16);
  });
});
