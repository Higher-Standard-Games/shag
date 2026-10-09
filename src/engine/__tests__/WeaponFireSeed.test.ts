/**
 * weapon_fire pellet seed — binary snapshot round-trip.
 *
 * A pellet shot travels under its own event code (24) with its seed and cone, so
 * every client can rebuild the server's pellets. Every other shot keeps code 4 and
 * its layout, so demos recorded before the seed existed decode exactly as they did.
 */

import { describe, expect, it } from "vitest";
import { GameState } from "../network/core/GameState";
import { BinaryProtocol } from "../network/protocol/BinaryProtocol";

const fire = (over: Record<string, unknown> = {}) => ({
  type: "weapon_fire",
  entityId: "player_1",
  weaponId: "riotgun",
  originX: 10,
  originY: 56,
  originZ: -30,
  dirX: 0.6,
  dirY: 0,
  dirZ: 0.8,
  ...over,
});

function encode(events: Record<string, unknown>[]): Uint8Array {
  const state = new GameState();
  state.tick = 77;
  state.events = events as never;
  return BinaryProtocol.encodeSnapshot(state);
}

function roundTrip(events: Record<string, unknown>[]) {
  return BinaryProtocol.decodeSnapshot(encode(events)).events as Record<string, unknown>[];
}

describe("weapon_fire pellet seed", () => {
  it("round-trips the seed and cone, negative seeds included, with every other field intact", () => {
    for (const pelletSeed of [123456789, -987654321]) {
      const [event] = roundTrip([fire({ pelletSeed, pelletSpread: 8 })]);
      expect(event).toMatchObject({ type: "weapon_fire", entityId: "player_1", weaponId: "riotgun", pelletSeed });
      expect(event.pelletSpread).toBeCloseTo(8, 5);
      expect(event.dirX).toBeCloseTo(0.6, 5);
      expect(event.originY).toBeCloseTo(56, 5);
    }
  });

  it("leaves a shot without a seed in the old layout, and costs a seeded one 8 bytes", () => {
    const [plain] = roundTrip([fire()]);
    expect(plain.pelletSeed).toBeUndefined();
    expect(plain.pelletSpread).toBeUndefined();
    expect(encode([fire({ pelletSeed: 1, pelletSpread: 2 })]).length).toBe(encode([fire()]).length + 8);
  });

  it("stays in step with the events around it", () => {
    const events = roundTrip([
      fire({ entityId: "a", pelletSeed: 5, pelletSpread: 2 }),
      fire({ entityId: "b", weaponId: "machinegun" }),
      { type: "combat_state", entityId: "a", health: 60, armor: 5, dead: false },
    ]);
    expect(events.map((e) => e.entityId)).toEqual(["a", "b", "a"]);
    expect(events.map((e) => e.pelletSeed)).toEqual([5, undefined, undefined]);
    expect(events[2]).toMatchObject({ health: 60, armor: 5, dead: false });
  });
});
