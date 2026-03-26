/**
 * InterpolationBuffer — Server snapshot interpolation tests
 *
 * Verifies interpolation between GameState snapshots, buffer management,
 * and entity position/transform lerping.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InterpolationBuffer } from "../network/client/InterpolationBuffer";
import { Entity } from "../network/core/Entity";
import { GameState, PlayerState } from "../network/core/GameState";

// Helper: Create entity with position component
function createEntityWithPosition(id: string, x: number, y: number, z: number): Entity {
  const entity = new Entity(id);
  entity.addComponent("position", {
    x, y, z,
    serialize() {},
    deserialize() {},
    clone() { return { ...this }; },
  });
  return entity;
}

// Helper: Create a GameState snapshot
function createSnapshot(tick: number, entities: [string, number, number, number][]): GameState {
  const state = new GameState();
  state.tick = tick;
  for (const [id, x, y, z] of entities) {
    state.entities.set(id, createEntityWithPosition(id, x, y, z));
  }
  return state;
}

describe("InterpolationBuffer", () => {
  let buffer: InterpolationBuffer;

  beforeEach(() => {
    buffer = new InterpolationBuffer();
  });

  describe("Empty buffer", () => {
    it("should return empty GameState", () => {
      const result = buffer.getInterpolatedState(1000);
      expect(result.entities.size).toBe(0);
    });

    it("should have zero buffer size", () => {
      expect(buffer.getBufferSize()).toBe(0);
    });
  });

  describe("Single snapshot", () => {
    it("should return it as-is", () => {
      const state = createSnapshot(1, [["e1", 100, 50, -200]]);
      buffer.addSnapshot(state, 1000);

      const result = buffer.getInterpolatedState(1100);
      expect(result.entities.size).toBe(1);
    });
  });

  describe("Two snapshots — interpolation", () => {
    it("should interpolate position at midpoint", () => {
      const s1 = createSnapshot(1, [["e1", 0, 0, 0]]);
      const s2 = createSnapshot(2, [["e1", 100, 0, 200]]);

      buffer.addSnapshot(s1, 1000);
      buffer.addSnapshot(s2, 1100);

      // interpDelay = 50ms. renderTime = 1050 + 50 = 1100. targetTime = 1100 - 50 = 1050.
      // t = (1050 - 1000) / (1100 - 1000) = 0.5 → midpoint
      const result = buffer.getInterpolatedState(1100);
      const pos = result.entities.get("e1")?.getComponent("position") as any;

      expect(pos).not.toBeUndefined();
      expect(pos.x).toBeCloseTo(50, 0);  // lerp(0, 100, 0.5)
      expect(pos.z).toBeCloseTo(100, 0); // lerp(0, 200, 0.5)
    });

    it("should use state1 values at t=0", () => {
      const s1 = createSnapshot(1, [["e1", 10, 20, 30]]);
      const s2 = createSnapshot(2, [["e1", 110, 120, 130]]);

      buffer.addSnapshot(s1, 1000);
      buffer.addSnapshot(s2, 1100);

      // targetTime = renderTime - 50. For t=0, targetTime = 1000 → renderTime = 1050
      const result = buffer.getInterpolatedState(1050);
      const pos = result.entities.get("e1")?.getComponent("position") as any;

      expect(pos.x).toBeCloseTo(10, 0);
      expect(pos.y).toBeCloseTo(20, 0);
      expect(pos.z).toBeCloseTo(30, 0);
    });

    it("should use state2 values at t=1", () => {
      const s1 = createSnapshot(1, [["e1", 10, 20, 30]]);
      const s2 = createSnapshot(2, [["e1", 110, 120, 130]]);

      buffer.addSnapshot(s1, 1000);
      buffer.addSnapshot(s2, 1100);

      // targetTime = 1100 → renderTime = 1150
      const result = buffer.getInterpolatedState(1150);
      const pos = result.entities.get("e1")?.getComponent("position") as any;

      expect(pos.x).toBeCloseTo(110, 0);
      expect(pos.y).toBeCloseTo(120, 0);
      expect(pos.z).toBeCloseTo(130, 0);
    });
  });

  describe("New entity handling", () => {
    it("should clone entity that only exists in second snapshot", () => {
      const s1 = createSnapshot(1, [["e1", 0, 0, 0]]);
      const s2 = createSnapshot(2, [["e1", 100, 0, 0], ["e2", 50, 50, 50]]);

      buffer.addSnapshot(s1, 1000);
      buffer.addSnapshot(s2, 1100);

      const result = buffer.getInterpolatedState(1100);
      expect(result.entities.has("e2")).toBe(true);
    });
  });

  describe("Buffer eviction", () => {
    it("should cap at 10 snapshots", () => {
      for (let i = 0; i < 15; i++) {
        buffer.addSnapshot(createSnapshot(i, [["e1", i, 0, 0]]), 1000 + i * 50);
      }
      expect(buffer.getBufferSize()).toBe(10);
    });
  });

  describe("Player data", () => {
    it("should copy players from state2", () => {
      const s1 = createSnapshot(1, [["e1", 0, 0, 0]]);
      const s2 = createSnapshot(2, [["e1", 100, 0, 0]]);

      const player = new PlayerState();
      player.name = "Alice";
      player.entityId = "e1";
      s2.players.set("p1", player);

      buffer.addSnapshot(s1, 1000);
      buffer.addSnapshot(s2, 1100);

      const result = buffer.getInterpolatedState(1100);
      expect(result.players.has("p1")).toBe(true);
      expect(result.players.get("p1")!.name).toBe("Alice");
    });
  });

  describe("Interpolation delay", () => {
    it("should have default delay of 50ms", () => {
      expect(buffer.getInterpolationDelay()).toBe(50);
    });
  });
});
