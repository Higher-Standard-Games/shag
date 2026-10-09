/**
 * damage event hit location — binary snapshot round-trip.
 *
 * A head or leg hit travels under its own event code (23) with one extra byte; a body hit
 * keeps the original code and layout, so it costs nothing extra and every demo recorded
 * before the location existed decodes exactly as it did.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { GameState } from "../network/core/GameState";
import { BinaryProtocol } from "../network/protocol/BinaryProtocol";

const damage = (over: Record<string, unknown> = {}) => ({
  type: "damage",
  entityId: "player_2",
  attackerId: "player_1",
  damage: 44,
  weaponId: "bullet",
  x: 1.5,
  y: -2.25,
  z: 300,
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

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("damage event hit location", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["head", "legs"])("round-trips a %s hit with every other field intact", (hitLocation) => {
    const [event] = roundTrip([damage({ hitLocation })]);

    expect(event).toMatchObject({
      type: "damage",
      entityId: "player_2",
      attackerId: "player_1",
      damage: 44,
      weaponId: "bullet",
      hitLocation,
    });
    expect(event.x).toBeCloseTo(1.5, 5);
    expect(event.y).toBeCloseTo(-2.25, 5);
    expect(event.z).toBeCloseTo(300, 5);
  });

  it("leaves a body hit without a location, which means body", () => {
    const [event] = roundTrip([damage({ hitLocation: "body" })]);
    expect(event.type).toBe("damage");
    expect(event.hitLocation).toBeUndefined();
  });

  it("sends a body hit in exactly the bytes an event without a location takes", () => {
    expect(hex(encode([damage({ hitLocation: "body" })]))).toBe(hex(encode([damage()])));
  });

  it("costs one extra byte for a head or leg hit", () => {
    expect(encode([damage({ hitLocation: "head" })]).length).toBe(encode([damage()]).length + 1);
  });

  it("keeps the old layout byte for byte (the format older demos were recorded in)", () => {
    // Captured from the encoder before hit locations existed, with the clock frozen because
    // the snapshot header carries a timestamp.
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const golden =
      "4d00000000008056febc7842000000000000000001000a0800706c617965725f320800706c617965725f312c00060062756c6c65740000c03f000010c0000096430000";
    expect(hex(encode([damage()]))).toBe(golden);
  });

  it("stays in step with the events around it", () => {
    // The located event is one byte longer than a plain one, so a reader that got it wrong
    // would misread everything after it.
    const events = roundTrip([
      damage({ entityId: "a", hitLocation: "head" }),
      damage({ entityId: "b" }),
      damage({ entityId: "c", hitLocation: "legs" }),
      { type: "combat_state", entityId: "a", health: 60, armor: 5, dead: false },
    ]);

    expect(events.map((e) => e.type)).toEqual(["damage", "damage", "damage", "combat_state"]);
    expect(events.map((e) => e.entityId)).toEqual(["a", "b", "c", "a"]);
    expect(events.map((e) => e.hitLocation)).toEqual(["head", undefined, "legs", undefined]);
    expect(events[3]).toMatchObject({ health: 60, armor: 5, dead: false });
  });
});
