/**
 * GameEvent Serialization — Roundtrip tests for all 9 event types
 *
 * GameState.serialize/deserialize contains custom binary encoding for each event type.
 * If any of these break: corrupt damage numbers, missing kill feeds, broken weapons.
 */

import { describe, expect, it } from "vitest";
import { GameState } from "../network/core/GameState";
import { BinaryEncoder, BinaryDecoder } from "../network/protocol/BinaryProtocol";

/** Helper: serialize a GameState with events and deserialize it back */
function roundtripEvents(events: any[]): any[] {
  const state = new GameState();
  state.tick = 1;
  state.events = events;

  const encoder = new BinaryEncoder(4096);
  state.serialize(encoder);
  const data = encoder.getData();

  const decoded = new GameState();
  const decoder = new BinaryDecoder(data);
  decoded.deserialize(decoder);

  return decoded.events;
}

describe("GameEvent Serialization", () => {
  describe("damage event", () => {
    it("should roundtrip all damage fields", () => {
      const events = roundtripEvents([{
        type: "damage",
        entityId: "player-1",
        attackerId: "player-2",
        damage: 75.5,
        weaponId: "rlauncher",
        x: 100.25,
        y: 50.5,
        z: -200.75,
      }]);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("damage");
      expect(events[0].entityId).toBe("player-1");
      expect(events[0].attackerId).toBe("player-2");
      expect(events[0].damage).toBeCloseTo(75.5, 1);
      expect(events[0].weaponId).toBe("rlauncher");
      expect(events[0].x).toBeCloseTo(100.25, 1);
      expect(events[0].y).toBeCloseTo(50.5, 1);
      expect(events[0].z).toBeCloseTo(-200.75, 1);
    });

    it("should handle empty attackerId", () => {
      const events = roundtripEvents([{
        type: "damage",
        entityId: "p1",
        attackerId: "",
        damage: 10,
        weaponId: "",
        x: 0, y: 0, z: 0,
      }]);

      expect(events[0].attackerId).toBe("");
      expect(events[0].weaponId).toBe("");
    });
  });

  describe("death event", () => {
    it("should roundtrip death with position and velocity", () => {
      const events = roundtripEvents([{
        type: "death",
        entityId: "victim",
        killerId: "killer",
        weaponId: "railgun",
        x: 50, y: 100, z: -50,
        velX: 200, velY: 300, velZ: -100,
      }]);

      expect(events[0].type).toBe("death");
      expect(events[0].entityId).toBe("victim");
      expect(events[0].killerId).toBe("killer");
      expect(events[0].weaponId).toBe("railgun");
      expect(events[0].x).toBeCloseTo(50);
      expect(events[0].velX).toBeCloseTo(200);
      expect(events[0].velY).toBeCloseTo(300);
      expect(events[0].velZ).toBeCloseTo(-100);
    });
  });

  describe("combat_state event", () => {
    it("should roundtrip health, armor, and dead status", () => {
      const events = roundtripEvents([{
        type: "combat_state",
        entityId: "player-1",
        health: 75,
        armor: 150,
        dead: false,
      }]);

      expect(events[0].type).toBe("combat_state");
      expect(events[0].entityId).toBe("player-1");
      expect(events[0].health).toBe(75);
      expect(events[0].armor).toBe(150);
      expect(events[0].dead).toBe(false);
    });

    it("should handle dead=true", () => {
      const events = roundtripEvents([{
        type: "combat_state",
        entityId: "dead-player",
        health: 0,
        armor: 0,
        dead: true,
      }]);

      expect(events[0].dead).toBe(true);
      expect(events[0].health).toBe(0);
    });
  });

  describe("chat event", () => {
    it("should roundtrip chat message", () => {
      const events = roundtripEvents([{
        type: "chat",
        playerId: "p1",
        message: "gg wp!",
      }]);

      expect(events[0].type).toBe("chat");
      expect(events[0].playerId).toBe("p1");
      expect(events[0].message).toBe("gg wp!");
    });

    it("should handle unicode in messages", () => {
      const events = roundtripEvents([{
        type: "chat",
        playerId: "p1",
        message: "🎮 héllo wörld 日本語",
      }]);

      expect(events[0].message).toBe("🎮 héllo wörld 日本語");
    });
  });

  describe("weapon_fire event", () => {
    it("should roundtrip fire origin and direction", () => {
      const events = roundtripEvents([{
        type: "weapon_fire",
        entityId: "shooter",
        weaponId: "rlauncher",
        originX: 100, originY: 64, originZ: -200,
        dirX: 0.707, dirY: 0, dirZ: -0.707,
      }]);

      expect(events[0].type).toBe("weapon_fire");
      expect(events[0].entityId).toBe("shooter");
      expect(events[0].weaponId).toBe("rlauncher");
      expect(events[0].originX).toBeCloseTo(100);
      expect(events[0].dirX).toBeCloseTo(0.707, 2);
      expect(events[0].dirZ).toBeCloseTo(-0.707, 2);
    });
  });

  describe("weapon_stop event", () => {
    it("should roundtrip entity and weapon ID", () => {
      const events = roundtripEvents([{
        type: "weapon_stop",
        entityId: "shooter",
        weaponId: "lgbeam",
      }]);

      expect(events[0].type).toBe("weapon_stop");
      expect(events[0].entityId).toBe("shooter");
      expect(events[0].weaponId).toBe("lgbeam");
    });
  });

  describe("weapon_charge event", () => {
    it("should roundtrip charging state", () => {
      const events = roundtripEvents([{
        type: "weapon_charge",
        entityId: "charger",
        weaponId: "plasmagun",
        charging: true,
      }]);

      expect(events[0].type).toBe("weapon_charge");
      expect(events[0].entityId).toBe("charger");
      expect(events[0].weaponId).toBe("plasmagun");
      expect(events[0].charging).toBe(true);
    });

    it("should handle charging=false", () => {
      const events = roundtripEvents([{
        type: "weapon_charge",
        entityId: "e1",
        weaponId: "w1",
        charging: false,
      }]);

      expect(events[0].charging).toBe(false);
    });
  });

  describe("projectile_impact event", () => {
    it("should roundtrip impact position and surface normal", () => {
      const events = roundtripEvents([{
        type: "projectile_impact",
        defId: "rlauncher",
        x: 200, y: 30, z: -150,
        normalX: 0, normalY: 1, normalZ: 0,
      }]);

      expect(events[0].type).toBe("projectile_impact");
      expect(events[0].defId).toBe("rlauncher");
      expect(events[0].x).toBeCloseTo(200);
      expect(events[0].normalY).toBeCloseTo(1);
    });
  });

  describe("projectile_spawn event", () => {
    it("should roundtrip projectile entity and definition IDs", () => {
      const events = roundtripEvents([{
        type: "projectile_spawn",
        entityId: "proj_001",
        defId: "glauncher",
      }]);

      expect(events[0].type).toBe("projectile_spawn");
      expect(events[0].entityId).toBe("proj_001");
      expect(events[0].defId).toBe("glauncher");
    });
  });

  describe("Unknown event (JSON fallback)", () => {
    it("should roundtrip unknown events via JSON", () => {
      const events = roundtripEvents([{
        type: "custom_event",
        data: "hello",
        value: 42,
      }]);

      expect(events[0].type).toBe("custom_event");
      expect(events[0].data).toBe("hello");
      expect(events[0].value).toBe(42);
    });
  });

  describe("Multiple events in one state", () => {
    it("should roundtrip mixed event types", () => {
      const events = roundtripEvents([
        { type: "damage", entityId: "p1", attackerId: "p2", damage: 50, weaponId: "rail", x: 0, y: 0, z: 0 },
        { type: "death", entityId: "p1", killerId: "p2", weaponId: "rail", x: 0, y: 0, z: 0, velX: 0, velY: 0, velZ: 0 },
        { type: "chat", playerId: "p2", message: "nice shot" },
      ]);

      expect(events.length).toBe(3);
      expect(events[0].type).toBe("damage");
      expect(events[1].type).toBe("death");
      expect(events[2].type).toBe("chat");
      expect(events[2].message).toBe("nice shot");
    });
  });

  describe("Empty events", () => {
    it("should handle zero events", () => {
      const events = roundtripEvents([]);
      expect(events.length).toBe(0);
    });
  });
});
