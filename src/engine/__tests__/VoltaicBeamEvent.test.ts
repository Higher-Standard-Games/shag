import { describe, expect, it } from "vitest";
import { GameState } from "../network/core/GameState";
import { BinaryProtocol } from "../network/protocol/BinaryProtocol";

describe("voltaic_beam event", () => {
  it("round-trips the authoritative ray, endpoint, normal, and player contact", () => {
    const state = new GameState();
    state.tick = 42;
    state.events = [
      {
        type: "voltaic_beam",
        entityId: "player_7",
        originX: 1.25,
        originY: 26,
        originZ: -3.5,
        dirX: 0.1,
        dirY: -0.2,
        dirZ: 0.97,
        endX: 81.5,
        endY: -134.25,
        endZ: 774.75,
        normalX: -0.5,
        normalY: 0.25,
        normalZ: -0.75,
        impactKind: 2,
      },
    ];

    const decoded = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(state));
    const event = decoded.events.find((candidate) => candidate.type === "voltaic_beam");

    expect(event).toMatchObject({ entityId: "player_7", impactKind: 2 });
    expect(event?.originX).toBeCloseTo(1.25);
    expect(event?.dirZ).toBeCloseTo(0.97);
    expect(event?.endY).toBeCloseTo(-134.25);
    expect(event?.normalZ).toBeCloseTo(-0.75);
  });
});
