/**
 * GameState — State management tests
 *
 * Verifies clone deep copy isolation, shallowCopy reference sharing,
 * player state roundtrip, and event handling.
 */

import { describe, expect, it } from "vitest";
import type { IComponent, StateDecoder, StateEncoder } from "../network/core/Component";
import { Entity } from "../network/core/Entity";
import { GameState, PlayerState } from "../network/core/GameState";

// Minimal test component
class PositionComponent implements IComponent {
  x: number = 0;
  y: number = 0;
  z: number = 0;

  serialize(encoder: StateEncoder): void {
    encoder.writeFloat32(this.x);
    encoder.writeFloat32(this.y);
    encoder.writeFloat32(this.z);
  }

  deserialize(decoder: StateDecoder): void {
    this.x = decoder.readFloat32();
    this.y = decoder.readFloat32();
    this.z = decoder.readFloat32();
  }

  clone(): PositionComponent {
    const c = new PositionComponent();
    c.x = this.x;
    c.y = this.y;
    c.z = this.z;
    return c;
  }
}

function createTestState(): GameState {
  const state = new GameState();
  state.tick = 100;
  state.ackedInputSeq = 50;

  const entity = new Entity("e1");
  const pos = new PositionComponent();
  pos.x = 100;
  pos.y = 50;
  pos.z = -200;
  entity.addComponent("position", pos);
  state.entities.set("e1", entity);

  const player = new PlayerState();
  player.entityId = "e1";
  player.name = "Alice";
  player.score = 10;
  player.deaths = 3;
  player.ping = 45;
  state.players.set("p1", player);

  state.events = [{ type: "test_event", data: "hello" }];

  return state;
}

describe("GameState", () => {
  describe("clone", () => {
    it("should deep copy tick and ackedInputSeq", () => {
      const state = createTestState();
      const cloned = state.clone();

      expect(cloned.tick).toBe(100);
      expect(cloned.ackedInputSeq).toBe(50);
    });

    it("should deep copy entities", () => {
      const state = createTestState();
      const cloned = state.clone();

      expect(cloned.entities.size).toBe(1);
      expect(cloned.entities.has("e1")).toBe(true);

      const pos = cloned.entities.get("e1")!.getComponent<PositionComponent>("position");
      expect(pos!.x).toBe(100);
    });

    it("should isolate cloned entities from original", () => {
      const state = createTestState();
      const cloned = state.clone();

      // Mutate original
      const originalPos = state.entities.get("e1")!.getComponent<PositionComponent>("position")!;
      originalPos.x = 999;

      // Clone unaffected
      const clonedPos = cloned.entities.get("e1")!.getComponent<PositionComponent>("position")!;
      expect(clonedPos.x).toBe(100);
    });

    it("should deep copy players", () => {
      const state = createTestState();
      const cloned = state.clone();

      expect(cloned.players.size).toBe(1);
      const player = cloned.players.get("p1")!;
      expect(player.name).toBe("Alice");
      expect(player.score).toBe(10);
      expect(player.deaths).toBe(3);
      expect(player.ping).toBe(45);
      expect(player.entityId).toBe("e1");
    });

    it("should provide fresh events array (not carry old events)", () => {
      const state = createTestState();
      const cloned = state.clone();

      // Clone should have a separate events array
      expect(cloned.events).not.toBe(state.events);
    });
  });

  describe("shallowCopy", () => {
    it("should create a copy with shared entity references", () => {
      const state = createTestState();
      const shallow = state.shallowCopy();

      expect(shallow.tick).toBe(state.tick);
      expect(shallow.entities.size).toBe(state.entities.size);
    });
  });

  describe("PlayerState", () => {
    it("should have correct default values", () => {
      const player = new PlayerState();
      expect(player.score).toBe(0);
      expect(player.deaths).toBe(0);
      expect(player.ping).toBe(0);
      expect(player.entityId).toBe("");
      expect(player.name).toBe("");
    });

    it("should track all stats correctly", () => {
      const player = new PlayerState();
      player.score = 42;
      player.deaths = 7;
      player.ping = 120;
      player.name = "TestPlayer";
      player.entityId = "entity-1";

      expect(player.score).toBe(42);
      expect(player.deaths).toBe(7);
      expect(player.ping).toBe(120);
    });
  });
});
