/**
 * PlayerState Serialization — Binary roundtrip tests
 *
 * Verifies that PlayerState.serialize/deserialize preserves all fields
 * through the specific binary encoding (uint32 score, uint16 deaths/ping).
 */

import { describe, expect, it } from "vitest";
import { PlayerState } from "../network/core/GameState";
import { BinaryEncoder, BinaryDecoder } from "../network/protocol/BinaryProtocol";

function roundtrip(input: PlayerState): PlayerState {
  const encoder = new BinaryEncoder(256);
  input.serialize(encoder);
  const data = encoder.getData();

  const output = new PlayerState();
  const decoder = new BinaryDecoder(data);
  output.deserialize(decoder);
  return output;
}

describe("PlayerState Serialization", () => {
  describe("Complete roundtrip", () => {
    it("should preserve all fields", () => {
      const player = new PlayerState();
      player.entityId = "entity-42";
      player.name = "FragMaster";
      player.team = "red";
      player.score = 1337;
      player.deaths = 42;
      player.ping = 25;

      const decoded = roundtrip(player);

      expect(decoded.entityId).toBe("entity-42");
      expect(decoded.name).toBe("FragMaster");
      expect(decoded.team).toBe("red");
      expect(decoded.score).toBe(1337);
      expect(decoded.deaths).toBe(42);
      expect(decoded.ping).toBe(25);
    });
  });

  describe("Encoding boundaries", () => {
    it("should handle score at uint32 max (4,294,967,295)", () => {
      const player = new PlayerState();
      player.score = 4294967295;
      const decoded = roundtrip(player);
      expect(decoded.score).toBe(4294967295);
    });

    it("should handle deaths at uint16 max (65535)", () => {
      const player = new PlayerState();
      player.deaths = 65535;
      const decoded = roundtrip(player);
      expect(decoded.deaths).toBe(65535);
    });

    it("should handle ping at uint16 max (65535)", () => {
      const player = new PlayerState();
      player.ping = 65535;
      const decoded = roundtrip(player);
      expect(decoded.ping).toBe(65535);
    });
  });

  describe("Zero/empty fields", () => {
    it("should handle all-zero fields", () => {
      const player = new PlayerState();
      const decoded = roundtrip(player);

      expect(decoded.entityId).toBe("");
      expect(decoded.name).toBe("");
      expect(decoded.team).toBe("");
      expect(decoded.score).toBe(0);
      expect(decoded.deaths).toBe(0);
      expect(decoded.ping).toBe(0);
    });
  });

  describe("Unicode in player names", () => {
    it("should handle unicode player names", () => {
      const player = new PlayerState();
      player.name = "プレイヤー1";
      player.team = "ブルー";

      const decoded = roundtrip(player);
      expect(decoded.name).toBe("プレイヤー1");
      expect(decoded.team).toBe("ブルー");
    });

    it("should handle emoji in names", () => {
      const player = new PlayerState();
      player.name = "🔥FragGod🔥";

      const decoded = roundtrip(player);
      expect(decoded.name).toBe("🔥FragGod🔥");
    });
  });

  describe("Clone roundtrip", () => {
    it("clone should produce identical serialization", () => {
      const player = new PlayerState();
      player.entityId = "e1";
      player.name = "Alice";
      player.team = "blue";
      player.score = 100;
      player.deaths = 5;
      player.ping = 30;

      const cloned = player.clone();

      const encoder1 = new BinaryEncoder(256);
      player.serialize(encoder1);

      const encoder2 = new BinaryEncoder(256);
      cloned.serialize(encoder2);

      const data1 = encoder1.getData();
      const data2 = encoder2.getData();

      expect(data1.length).toBe(data2.length);
      for (let i = 0; i < data1.length; i++) {
        expect(data1[i]).toBe(data2[i]);
      }
    });
  });
});
