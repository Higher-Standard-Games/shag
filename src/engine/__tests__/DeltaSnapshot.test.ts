/**
 * Delta Snapshot — Edge case tests for delta compression
 *
 * Verifies entity add/remove between snapshots, player add/remove,
 * unchanged entities carrying forward, and large state diffs.
 */

import { describe, expect, it } from "vitest";
import { Entity } from "../network/core/Entity";
import { GameState, PlayerState } from "../network/core/GameState";
import { BinaryProtocol } from "../network/protocol/BinaryProtocol";

/** Create entity with position + velocity components (matches BinaryProtocol expectations) */
function createEntity(id: string, x: number, y: number, z: number, grounded = true): Entity {
  const entity = new Entity(id);
  entity.addComponent("position", {
    x, y, z,
    serialize() {}, deserialize() {},
    clone() { return { ...this }; },
  });
  entity.addComponent("transform", {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    serialize() {}, deserialize() {},
    clone() {
      return {
        position: { ...this.position },
        rotation: { ...this.rotation },
        serialize: this.serialize,
        deserialize: this.deserialize,
        clone: this.clone,
      };
    },
  } as any);
  entity.addComponent("velocity", {
    x: 0, y: 0, z: 0,
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
    grounded,
    isCrouching: false,
    isSliding: false,
    serialize() {}, deserialize() {},
    clone() { return { ...this, linear: { ...this.linear }, angular: { ...this.angular } }; },
  } as any);
  return entity;
}

function addPlayer(state: GameState, playerId: string, entityId: string, name: string): void {
  const player = new PlayerState();
  player.entityId = entityId;
  player.name = name;
  player.score = 0;
  player.deaths = 0;
  player.ping = 50;
  state.players.set(playerId, player);
}

describe("Delta Snapshot", () => {
  describe("Entity added between baselines", () => {
    it("should include new entity in delta snapshot", () => {
      // Baseline: 1 entity
      const baseline = new GameState();
      baseline.tick = 1;
      baseline.entities.set("e1", createEntity("e1", 0, 0, 0));
      addPlayer(baseline, "p1", "e1", "Alice");

      // Current: 2 entities (e2 added)
      const current = new GameState();
      current.tick = 2;
      current.entities.set("e1", createEntity("e1", 0, 0, 0));
      current.entities.set("e2", createEntity("e2", 100, 50, -200));
      addPlayer(current, "p1", "e1", "Alice");
      addPlayer(current, "p2", "e2", "Bob");

      const encoded = BinaryProtocol.encodeSnapshot(current, baseline);
      const decoded = BinaryProtocol.decodeSnapshot(encoded, baseline);

      expect(decoded.entities.size).toBe(2);
      expect(decoded.entities.has("e1")).toBe(true);
      expect(decoded.entities.has("e2")).toBe(true);

      // New entity should have correct position
      const e2Pos = decoded.entities.get("e2")!.getComponent("position") as any;
      expect(e2Pos.x).toBeCloseTo(100, 1);
      expect(e2Pos.y).toBeCloseTo(50, 1);
    });
  });

  describe("Entity removed between baselines", () => {
    it("should not include removed entity in decoded state", () => {
      // Baseline: 2 entities
      const baseline = new GameState();
      baseline.tick = 1;
      baseline.entities.set("e1", createEntity("e1", 0, 0, 0));
      baseline.entities.set("e2", createEntity("e2", 100, 0, 0));
      addPlayer(baseline, "p1", "e1", "Alice");
      addPlayer(baseline, "p2", "e2", "Bob");

      // Current: 1 entity (e2 removed — player disconnected)
      const current = new GameState();
      current.tick = 2;
      current.entities.set("e1", createEntity("e1", 5, 0, 0));
      addPlayer(current, "p1", "e1", "Alice");

      const encoded = BinaryProtocol.encodeSnapshot(current, baseline);
      const decoded = BinaryProtocol.decodeSnapshot(encoded, baseline);

      // Only e1 should remain
      expect(decoded.entities.size).toBe(1);
      expect(decoded.entities.has("e1")).toBe(true);
      expect(decoded.entities.has("e2")).toBe(false);
    });
  });

  describe("Unchanged entity carries forward from baseline", () => {
    it("should carry forward unchanged components from baseline", () => {
      const baseline = new GameState();
      baseline.tick = 1;
      baseline.entities.set("e1", createEntity("e1", 100, 50, -200));
      addPlayer(baseline, "p1", "e1", "Alice");

      // Same entity, same position — nothing changed
      const current = new GameState();
      current.tick = 2;
      current.entities.set("e1", createEntity("e1", 100, 50, -200));
      addPlayer(current, "p1", "e1", "Alice");

      const encoded = BinaryProtocol.encodeSnapshot(current, baseline);
      const decoded = BinaryProtocol.decodeSnapshot(encoded, baseline);

      const pos = decoded.entities.get("e1")!.getComponent("position") as any;
      expect(pos.x).toBeCloseTo(100, 1);
      expect(pos.y).toBeCloseTo(50, 1);
      expect(pos.z).toBeCloseTo(-200, 1);
    });

    it("should produce smaller encoding for unchanged state", () => {
      const state = new GameState();
      state.tick = 1;
      state.entities.set("e1", createEntity("e1", 100, 50, -200));
      addPlayer(state, "p1", "e1", "Alice");

      // Full encode (no baseline)
      const fullEncoded = BinaryProtocol.encodeSnapshot(state);

      // Delta encode with identical baseline
      const deltaEncoded = BinaryProtocol.encodeSnapshot(state, state);

      // Delta should be smaller (no component data to send)
      expect(deltaEncoded.length).toBeLessThan(fullEncoded.length);
    });
  });

  describe("Player added between baselines", () => {
    it("should include new player in delta snapshot", () => {
      const baseline = new GameState();
      baseline.tick = 1;
      addPlayer(baseline, "p1", "e1", "Alice");

      const current = new GameState();
      current.tick = 2;
      addPlayer(current, "p1", "e1", "Alice");
      addPlayer(current, "p2", "e2", "Bob");

      const encoded = BinaryProtocol.encodeSnapshot(current, baseline);
      const decoded = BinaryProtocol.decodeSnapshot(encoded, baseline);

      expect(decoded.players.size).toBe(2);
      expect(decoded.players.get("p2")!.name).toBe("Bob");
    });
  });

  describe("Player removed between baselines", () => {
    it("should not include removed player", () => {
      const baseline = new GameState();
      baseline.tick = 1;
      addPlayer(baseline, "p1", "e1", "Alice");
      addPlayer(baseline, "p2", "e2", "Bob");

      const current = new GameState();
      current.tick = 2;
      addPlayer(current, "p1", "e1", "Alice");
      // p2 disconnected

      const encoded = BinaryProtocol.encodeSnapshot(current, baseline);
      const decoded = BinaryProtocol.decodeSnapshot(encoded, baseline);

      expect(decoded.players.size).toBe(1);
      expect(decoded.players.has("p1")).toBe(true);
      expect(decoded.players.has("p2")).toBe(false);
    });
  });

  describe("Large state diff", () => {
    it("should handle many entities changing at once", () => {
      const baseline = new GameState();
      baseline.tick = 1;

      const current = new GameState();
      current.tick = 2;

      // 16 entities, all at different positions
      for (let i = 0; i < 16; i++) {
        const id = `e${i}`;
        baseline.entities.set(id, createEntity(id, i * 10, 0, 0));
        current.entities.set(id, createEntity(id, i * 10 + 5, 0, 0)); // All moved +5 on X
      }

      const encoded = BinaryProtocol.encodeSnapshot(current, baseline);
      const decoded = BinaryProtocol.decodeSnapshot(encoded, baseline);

      expect(decoded.entities.size).toBe(16);

      // Verify all positions updated
      for (let i = 0; i < 16; i++) {
        const pos = decoded.entities.get(`e${i}`)!.getComponent("position") as any;
        expect(pos.x).toBeCloseTo(i * 10 + 5, 1);
      }
    });
  });

  describe("No baseline (full snapshot)", () => {
    it("should encode and decode complete state", () => {
      const state = new GameState();
      state.tick = 42;
      state.ackedInputSeq = 10;
      state.entities.set("e1", createEntity("e1", 100, 50, -200));
      state.entities.set("e2", createEntity("e2", -300, 0, 150));
      addPlayer(state, "p1", "e1", "Alice");

      const encoded = BinaryProtocol.encodeSnapshot(state);
      const decoded = BinaryProtocol.decodeSnapshot(encoded);

      expect(decoded.tick).toBe(42);
      expect(decoded.ackedInputSeq).toBe(10);
      expect(decoded.entities.size).toBe(2);
      expect(decoded.players.size).toBe(1);
    });
  });
});
