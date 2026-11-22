/**
 * A thrown weapon's rotation rides behind entity flag 0x80, an extension byte
 * whose bit 0 marks four int16 quaternion words. It is delta-compressed: sent
 * when it changes, carried forward from the baseline otherwise. A recording
 * made before it never sets 0x80 and still reads, with no orientation.
 */

import { describe, expect, it } from "vitest";
import type { IComponent } from "../network/core/Component";
import { Entity } from "../network/core/Entity";
import { GameState } from "../network/core/GameState";
import { BinaryProtocol } from "../network/protocol/BinaryProtocol";

const noop = {
  serialize() {},
  deserialize() {},
  clone() {
    return { ...this };
  },
};

function item(rotation?: { x: number; y: number; z: number; w: number }, settled = false): GameState {
  const state = new GameState();
  state.tick = 7;
  const entity = new Entity("item_50001");
  entity.addComponent("transform", {
    position: { x: 10, y: 20, z: 30 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    ...noop,
  } as unknown as IComponent);
  entity.addComponent("weaponMeta", { weaponId: "rlauncher", settled, ...noop } as unknown as IComponent);
  if (rotation) entity.addComponent("orientation", { ...rotation, ...noop } as unknown as IComponent);
  state.entities.set("item_50001", entity);
  return state;
}

const orientationOf = (state: GameState) =>
  state.entities.get("item_50001")!.getComponent("orientation") as unknown as
    | { x: number; y: number; z: number; w: number }
    | undefined;

const tilted = { x: 0.5, y: -0.5, z: 0.5, w: 0.5 };

describe("thrown weapon orientation on the wire", () => {
  it("carries the rotation to within an int16 step", () => {
    const got = orientationOf(BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(item(tilted))))!;
    for (const k of ["x", "y", "z", "w"] as const) expect(Math.abs(got[k] - tilted[k])).toBeLessThan(1 / 32767);
  });

  it("reads a recording made before rotations: no extension byte, no orientation", () => {
    const bytes = BinaryProtocol.encodeSnapshot(item());
    const state = BinaryProtocol.decodeSnapshot(bytes);
    expect(orientationOf(state)).toBeUndefined();
    expect(state.entities.get("item_50001")!.getComponent("weaponMeta")).toMatchObject({ weaponId: "rlauncher" });
  });

  it("sends nothing for an unchanged rotation and carries the baseline's forward", () => {
    const baselineSent = item(tilted);
    const baseline = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(baselineSent));
    const full = BinaryProtocol.encodeSnapshot(item(tilted));
    const delta = BinaryProtocol.encodeSnapshot(item(tilted), baselineSent);
    expect(delta.byteLength).toBeLessThan(full.byteLength - 8);
    const got = orientationOf(BinaryProtocol.decodeSnapshot(delta, baseline))!;
    expect(got.x).toBeCloseTo(tilted.x, 4);
    expect(got.w).toBeCloseTo(tilted.w, 4);
  });

  it("sends a changed rotation against the baseline", () => {
    const baselineSent = item(tilted);
    const baseline = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(baselineSent));
    const turned = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const got = orientationOf(
      BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(item(turned), baselineSent), baseline),
    )!;
    expect(got.y).toBeCloseTo(Math.SQRT1_2, 4);
    expect(got.x).toBeCloseTo(0, 4);
  });
});
