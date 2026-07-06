/**
 * weapon_chain event — binary snapshot round-trip (F5 chain-lightning arcs).
 *
 * The chain-lightning arc positions ride in a new weapon_chain event (type code
 * 13) with a variable-length point list. This guards the encode/decode of that
 * variable payload through the live snapshot codec.
 */

import { describe, expect, it } from "vitest";
import { GameState } from "../network/core/GameState";
import { BinaryProtocol } from "../network/protocol/BinaryProtocol";

describe("weapon_chain event", () => {
  it("round-trips the shooter id and ordered link points", () => {
    const state = new GameState();
    state.tick = 42;
    state.events = [
      {
        type: "weapon_chain",
        entityId: "player_7",
        points: [
          { x: 10, y: 20, z: 30 },
          { x: -100.5, y: 64.25, z: 200.75 },
          { x: 5, y: 6, z: 7 },
        ],
      },
    ];

    const decoded = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(state));
    const ev = decoded.events.find((e) => e.type === "weapon_chain") as
      | { type: string; entityId: string; points: { x: number; y: number; z: number }[] }
      | undefined;

    expect(ev).toBeDefined();
    expect(ev!.entityId).toBe("player_7");
    expect(ev!.points).toHaveLength(3);
    expect(ev!.points[1].x).toBeCloseTo(-100.5, 2);
    expect(ev!.points[1].y).toBeCloseTo(64.25, 2);
    expect(ev!.points[2].z).toBeCloseTo(7, 2);
  });

  it("handles an empty point list", () => {
    const state = new GameState();
    state.events = [{ type: "weapon_chain", entityId: "player_1", points: [] }];
    const decoded = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(state));
    const ev = decoded.events.find((e) => e.type === "weapon_chain") as { points: unknown[] } | undefined;
    expect(ev).toBeDefined();
    expect(ev!.points).toHaveLength(0);
  });
});
