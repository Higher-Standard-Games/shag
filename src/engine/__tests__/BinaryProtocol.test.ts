/**
 * BinaryProtocol roundtrip test
 *
 * Verifies encode→decode produces identical data.
 * Run BEFORE and AFTER optimization changes to confirm wire format is preserved.
 */

import { describe, expect, it } from "vitest";
import { Entity } from "../network/core/Entity";
import { GameState, PlayerState } from "../network/core/GameState";
import { BinaryDecoder, BinaryEncoder, BinaryProtocol, MessageType } from "../network/protocol/BinaryProtocol";
import { MessageCodec } from "../network/protocol/MessageCodec";

// ── Helpers ──────────────────────────────────────────────────────

/** Create a test entity with transform + velocity components */
function createTestEntity(
  id: string,
  pos: { x: number; y: number; z: number },
  vel: { x: number; y: number; z: number },
  grounded: boolean,
): Entity {
  const entity = new Entity(id);
  entity.addComponent("position", {
    ...pos,
    serialize() {},
    deserialize() {},
    clone() {
      return { ...this };
    },
  });
  entity.addComponent("transform", {
    position: { ...pos },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    serialize() {},
    deserialize() {},
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
    x: vel.x,
    y: vel.y,
    z: vel.z,
    linear: { ...vel },
    angular: { x: 0, y: 0, z: 0 },
    grounded,
    isCrouching: false,
    isSliding: false,
    serialize() {},
    deserialize() {},
    clone() {
      return { ...this, linear: { ...this.linear }, angular: { ...this.angular } };
    },
  } as any);
  return entity;
}

function createTestState(): GameState {
  const state = new GameState();
  state.tick = 42;
  state.ackedInputSeq = 10;

  // Add entities
  const e1 = createTestEntity("e1", { x: 100.5, y: 50.25, z: -200 }, { x: 1, y: -9.8, z: 0 }, true);
  const e2 = createTestEntity("e2", { x: -300, y: 0, z: 150.75 }, { x: 0, y: 0, z: 5.5 }, false);
  state.entities.set("e1", e1);
  state.entities.set("e2", e2);

  // Add players
  const p1 = new PlayerState();
  p1.entityId = "e1";
  p1.name = "Alice";
  p1.score = 7;
  p1.deaths = 3;
  p1.ping = 45;
  state.players.set("p1", p1);

  const p2 = new PlayerState();
  p2.entityId = "e2";
  p2.name = "Bob";
  p2.score = 5;
  p2.deaths = 4;
  p2.ping = 120;
  state.players.set("p2", p2);

  return state;
}

// ── Tests ────────────────────────────────────────────────────────

describe("BinaryProtocol", () => {
  describe("Snapshot roundtrip (no baseline)", () => {
    it("should encode and decode matching entity positions", () => {
      const state = createTestState();
      const encoded = BinaryProtocol.encodeSnapshot(state);
      const decoded = BinaryProtocol.decodeSnapshot(encoded);

      expect(decoded.tick).toBe(state.tick);
      expect(decoded.ackedInputSeq).toBe(state.ackedInputSeq);
      expect(decoded.entities.size).toBe(2);

      // Check entity e1 position
      const de1 = decoded.entities.get("e1")!;
      const pos1 = de1.getComponent("position") as any;
      expect(pos1.x).toBeCloseTo(100.5, 2);
      expect(pos1.y).toBeCloseTo(50.25, 2);
      expect(pos1.z).toBeCloseTo(-200, 2);

      // Check entity e1 velocity
      const vel1 = de1.getComponent("velocity") as any;
      expect(vel1.linear.x).toBeCloseTo(1, 2);
      expect(vel1.linear.y).toBeCloseTo(-9.8, 1);
      expect(vel1.grounded).toBe(true);
    });

    it("should encode and decode matching player data", () => {
      const state = createTestState();
      const encoded = BinaryProtocol.encodeSnapshot(state);
      const decoded = BinaryProtocol.decodeSnapshot(encoded);

      expect(decoded.players.size).toBe(2);

      const dp1 = decoded.players.get("p1")!;
      expect(dp1.entityId).toBe("e1");
      expect(dp1.name).toBe("Alice");
      expect(dp1.score).toBe(7);
      expect(dp1.deaths).toBe(3);
      expect(dp1.ping).toBe(45);
    });
  });

  describe("Snapshot roundtrip (with baseline)", () => {
    it("should delta-encode unchanged entities", () => {
      const baseline = createTestState();
      const current = createTestState();

      // Only change one entity's position
      const e1 = current.entities.get("e1")!;
      (e1.getComponent("position") as any).x = 105;
      (e1.getComponent("transform") as any).position.x = 105;
      current.tick = 43;
      current.ackedInputSeq = 11;

      const encoded = BinaryProtocol.encodeSnapshot(current, baseline);
      const decoded = BinaryProtocol.decodeSnapshot(encoded, baseline);

      expect(decoded.tick).toBe(43);

      // e1 position should be updated
      const dPos1 = decoded.entities.get("e1")!.getComponent("position") as any;
      expect(dPos1.x).toBeCloseTo(105, 2);

      // e2 position should be carried from baseline
      const dPos2 = decoded.entities.get("e2")!.getComponent("position") as any;
      expect(dPos2.x).toBeCloseTo(-300, 2);
    });
  });

  describe("Command roundtrip", () => {
    it("should encode and decode command data", () => {
      const command = {
        type: "move" as const,
        playerId: "player1",
        tick: 100,
        seq: 42,
        direction: { x: 0.707, y: 0, z: -0.707 },
        pitch: 0.5,
        yaw: 1.2,
        buttons: 0b0101, // fire + jump
      };
      const encoded = BinaryProtocol.encodeCommand("player1", 42, command);
      const decoded = BinaryProtocol.decodeCommand(encoded);

      expect(decoded.playerId).toBe("player1");
      expect(decoded.sequence).toBe(42);
      expect(decoded.command.direction.x).toBeCloseTo(0.707, 2);
      expect(decoded.command.direction.z).toBeCloseTo(-0.707, 2);
      expect(decoded.command.pitch).toBeCloseTo(0.5);
      expect(decoded.command.yaw).toBeCloseTo(1.2);
      expect(decoded.command.buttons).toBe(0b0101);
      expect(decoded.command.tick).toBe(100);
    });
  });
});

describe("MessageCodec", () => {
  it("should roundtrip snapshot via MessageCodec wrapper", () => {
    const state = createTestState();
    const encoded = MessageCodec.encodeSnapshot(state);
    const decoded = MessageCodec.decodeSnapshot(encoded);

    expect(decoded.tick).toBe(42);
    expect(decoded.entities.size).toBe(2);
    expect(decoded.players.size).toBe(2);
  });

  it("should roundtrip command via MessageCodec wrapper", () => {
    const command = {
      type: "move" as const,
      playerId: "p1",
      tick: 50,
      seq: 99,
      direction: { x: 1, y: 0, z: -1 },
      pitch: 0,
      yaw: 3.14,
      buttons: 0,
    };
    const encoded = MessageCodec.encodeCommand("p1", 99, command);
    const decoded = MessageCodec.decodeCommand(encoded);

    expect(decoded.playerId).toBe("p1");
    expect(decoded.sequence).toBe(99);
    expect(decoded.command.direction.x).toBeCloseTo(1);
    expect(decoded.command.direction.z).toBeCloseTo(-1);
    expect(decoded.command.yaw).toBeCloseTo(3.14, 2);
  });

  it("should roundtrip welcome message", () => {
    const encoded = MessageCodec.encodeWelcome("srv1", "Test Server", "wdm7", 125, 16, 3);
    const decoded = MessageCodec.decodeWelcome(encoded);

    expect(decoded.serverId).toBe("srv1");
    expect(decoded.serverName).toBe("Test Server");
    expect(decoded.map).toBe("wdm7");
    expect(decoded.tickRate).toBe(125);
    expect(decoded.maxPlayers).toBe(16);
    expect(decoded.currentPlayers).toBe(3);
  });

  it("should roundtrip ping/pong", () => {
    const sendTime = Date.now();
    const encoded = MessageCodec.encodePing(sendTime);
    const decoded = MessageCodec.decodePing(encoded);
    expect(decoded.clientSendTime).toBe(sendTime);

    const serverTime = Date.now() + 50;
    const encodedPong = MessageCodec.encodePong(sendTime, serverTime);
    const decodedPong = MessageCodec.decodePong(encodedPong);
    expect(decodedPong.clientSendTime).toBe(sendTime);
    expect(decodedPong.serverTime).toBe(serverTime);
  });

  it("should roundtrip ack", () => {
    const encoded = MessageCodec.encodeAck(1234);
    const decoded = MessageCodec.decodeAck(encoded);
    expect(decoded.tick).toBe(1234);
  });

  it("should peek message type without consuming", () => {
    const encoded = MessageCodec.encodeReady();
    const type = MessageCodec.peekMessageType(encoded);
    expect(type).toBe(MessageType.Ready);
  });
});

describe("BinaryEncoder", () => {
  it("should reset and reuse without corruption", () => {
    const encoder = new BinaryEncoder(64);

    // First use
    encoder.writeUint32(0xdeadbeef);
    encoder.writeString("hello");
    const data1 = encoder.getData();

    // Reset and reuse
    encoder.reset();
    encoder.writeUint32(0xcafebabe);
    encoder.writeString("world");
    const data2 = encoder.getData();

    // Decode first (should still be valid since getData copies)
    const dec1 = new BinaryDecoder(data1);
    expect(dec1.readUint32()).toBe(0xdeadbeef);
    expect(dec1.readString()).toBe("hello");

    // Decode second
    const dec2 = new BinaryDecoder(data2);
    expect(dec2.readUint32()).toBe(0xcafebabe);
    expect(dec2.readString()).toBe("world");
  });
});
