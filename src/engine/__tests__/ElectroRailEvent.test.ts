import { describe, expect, it } from "vitest";
import { GameState } from "../network/core/GameState";
import { BinaryProtocol } from "../network/protocol/BinaryProtocol";

describe("electro_rail event (WO-EB2)", () => {
  it("round-trips the authoritative ray, endpoint, normal, and impact kind", () => {
    const state = new GameState();
    state.tick = 7;
    state.events = [
      {
        type: "electro_rail",
        entityId: "player_3",
        originX: -2.5,
        originY: 24,
        originZ: 10.75,
        dirX: 0.6,
        dirY: 0.0,
        dirZ: -0.8,
        endX: 512.25,
        endY: 40.5,
        endZ: -680.5,
        normalX: 0.0,
        normalY: 1.0,
        normalZ: 0.0,
        impactKind: 1,
      },
    ];

    const decoded = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(state));
    const event = decoded.events.find((candidate) => candidate.type === "electro_rail");

    expect(event).toMatchObject({ entityId: "player_3", impactKind: 1 });
    expect(event?.originZ).toBeCloseTo(10.75);
    expect(event?.dirX).toBeCloseTo(0.6);
    expect(event?.endX).toBeCloseTo(512.25);
    expect(event?.normalY).toBeCloseTo(1.0);
  });

  it("keeps electro_rail and voltaic_beam distinct through the shared codec path", () => {
    const state = new GameState();
    state.events = [
      {
        type: "voltaic_beam",
        entityId: "player_1",
        originX: 0,
        originY: 0,
        originZ: 0,
        dirX: 0,
        dirY: 0,
        dirZ: 1,
        endX: 1,
        endY: 0,
        endZ: 0,
        normalX: 0,
        normalY: 0,
        normalZ: 1,
        impactKind: 2,
      },
      {
        type: "electro_rail",
        entityId: "player_2",
        originX: 0,
        originY: 0,
        originZ: 0,
        dirX: 0,
        dirY: 0,
        dirZ: 1,
        endX: 2,
        endY: 0,
        endZ: 0,
        normalX: 0,
        normalY: 0,
        normalZ: 1,
        impactKind: 0,
      },
    ];

    const decoded = BinaryProtocol.decodeSnapshot(BinaryProtocol.encodeSnapshot(state));

    expect(decoded.events.find((e) => e.type === "voltaic_beam")).toMatchObject({ entityId: "player_1" });
    expect(decoded.events.find((e) => e.type === "electro_rail")).toMatchObject({ entityId: "player_2" });
  });
});
