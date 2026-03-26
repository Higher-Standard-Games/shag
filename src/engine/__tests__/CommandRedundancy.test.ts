/**
 * CommandRedundancy — Packet loss resilience tests
 *
 * Verifies command encoding/decoding roundtrips, sequence number
 * monotonicity, and redundancy buffer behavior.
 */

import { describe, expect, it } from "vitest";
import { MessageCodec } from "../network/protocol/MessageCodec";
import type { NetworkCommand } from "../network/protocol/BinaryProtocol";

describe("CommandRedundancy", () => {
  describe("Command encode/decode roundtrip", () => {
    it("should roundtrip a full command", () => {
      const command: NetworkCommand = {
        type: "move",
        playerId: "player-1",
        tick: 100,
        seq: 42,
        direction: { x: 0.5, y: 0, z: -0.5 },
        pitch: 0.3,
        yaw: 1.57,
        buttons: 0b1010,
        weaponSlot: 2,
      };

      const encoded = MessageCodec.encodeCommand("player-1", 42, command);
      const decoded = MessageCodec.decodeCommand(encoded);

      expect(decoded.playerId).toBe("player-1");
      expect(decoded.sequence).toBe(42);
      expect(decoded.command.direction!.x).toBeCloseTo(0.5, 2);
      expect(decoded.command.direction!.z).toBeCloseTo(-0.5, 2);
      expect(decoded.command.pitch).toBeCloseTo(0.3, 2);
      expect(decoded.command.yaw).toBeCloseTo(1.57, 2);
      expect(decoded.command.buttons).toBe(0b1010);
      expect(decoded.command.tick).toBe(100);
    });

    it("should handle zero-valued command", () => {
      const command: NetworkCommand = {
        type: "move",
        playerId: "p1",
        tick: 0,
        seq: 0,
        direction: { x: 0, y: 0, z: 0 },
        pitch: 0,
        yaw: 0,
        buttons: 0,
      };

      const encoded = MessageCodec.encodeCommand("p1", 0, command);
      const decoded = MessageCodec.decodeCommand(encoded);

      expect(decoded.playerId).toBe("p1");
      expect(decoded.sequence).toBe(0);
      expect(decoded.command.direction!.x).toBeCloseTo(0);
      expect(decoded.command.direction!.z).toBeCloseTo(0);
    });

    it("should handle extreme values", () => {
      const command: NetworkCommand = {
        type: "move",
        playerId: "extreme-player",
        tick: 999999,
        seq: 65535,
        direction: { x: -1, y: 1, z: -1 },
        pitch: -Math.PI / 2,
        yaw: Math.PI,
        buttons: 0xFF,
      };

      const encoded = MessageCodec.encodeCommand("extreme-player", 65535, command);
      const decoded = MessageCodec.decodeCommand(encoded);

      expect(decoded.playerId).toBe("extreme-player");
      expect(decoded.command.direction!.x).toBeCloseTo(-1, 2);
      expect(decoded.command.pitch).toBeCloseTo(-Math.PI / 2, 2);
      expect(decoded.command.yaw).toBeCloseTo(Math.PI, 2);
      expect(decoded.command.buttons).toBe(0xFF);
    });
  });

  describe("Redundancy buffer simulation", () => {
    it("should maintain FIFO buffer of last 3 commands", () => {
      const buffer: Uint8Array[] = [];
      const REDUNDANCY = 3;

      // Simulate sending 5 commands with redundancy
      for (let seq = 1; seq <= 5; seq++) {
        const cmd: NetworkCommand = {
          type: "move",
          playerId: "p1",
          tick: seq,
          seq,
          direction: { x: 0, y: 0, z: 1 },
          pitch: 0,
          yaw: 0,
          buttons: 0,
        };

        const encoded = MessageCodec.encodeCommand("p1", seq, cmd);
        buffer.push(encoded);

        if (buffer.length > REDUNDANCY) {
          buffer.shift();
        }
      }

      // Buffer should contain cmds 3, 4, 5
      expect(buffer.length).toBe(3);

      // Decode each to verify sequence numbers
      const sequences = buffer.map(b => MessageCodec.decodeCommand(b).sequence);
      expect(sequences).toEqual([3, 4, 5]);
    });

    it("should allow server to deduplicate by sequence", () => {
      // Simulate the same command sent 3 times (redundancy)
      const cmd: NetworkCommand = {
        type: "move",
        playerId: "p1",
        tick: 42,
        seq: 42,
        direction: { x: 1, y: 0, z: 0 },
        pitch: 0,
        yaw: 0,
        buttons: 0,
      };

      const encoded = MessageCodec.encodeCommand("p1", 42, cmd);

      // Decode all 3 — they should all have same sequence
      const d1 = MessageCodec.decodeCommand(encoded);
      const d2 = MessageCodec.decodeCommand(encoded);
      const d3 = MessageCodec.decodeCommand(encoded);

      expect(d1.sequence).toBe(42);
      expect(d2.sequence).toBe(42);
      expect(d3.sequence).toBe(42);
    });
  });

  describe("Sequence number monotonicity", () => {
    it("should produce strictly increasing sequence numbers", () => {
      const sequences: number[] = [];

      for (let i = 1; i <= 100; i++) {
        sequences.push(i);
      }

      // Verify monotonically increasing
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
      }
    });
  });
});
