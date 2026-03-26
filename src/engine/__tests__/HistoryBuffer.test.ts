/**
 * HistoryBuffer — Circular buffer for lag compensation history
 *
 * Verifies push/evict, getStateAtTick, getClosestState,
 * getInterpolatedState, containsTick, and boundary accessors.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { HistoryBuffer } from "../server/lagcomp/HistoryBuffer";
import { WorldState } from "../server/core/WorldState";
import { tickNumber } from "@shared/server/simulation/types";

function makeState(tick: number): WorldState {
  return new WorldState(tickNumber(tick));
}

describe("HistoryBuffer", () => {
  let buffer: HistoryBuffer;

  beforeEach(() => {
    // 1000ms capacity at 125Hz = 125 slots
    buffer = new HistoryBuffer(1000, 125);
  });

  describe("Initial state", () => {
    it("should be empty", () => {
      expect(buffer.size).toBe(0);
    });

    it("should have correct capacity", () => {
      expect(buffer.maxSize).toBe(125);
    });

    it("should have null oldest/newest tick", () => {
      expect(buffer.oldestTick).toBeNull();
      expect(buffer.newestTick).toBeNull();
    });

    it("should not contain any tick", () => {
      expect(buffer.containsTick(tickNumber(0))).toBe(false);
    });
  });

  describe("push", () => {
    it("should add entries and update size", () => {
      buffer.push(makeState(1));
      expect(buffer.size).toBe(1);

      buffer.push(makeState(2));
      expect(buffer.size).toBe(2);
    });

    it("should track oldest and newest ticks", () => {
      buffer.push(makeState(10));
      buffer.push(makeState(11));
      buffer.push(makeState(12));

      expect(buffer.oldestTick).toBe(10);
      expect(buffer.newestTick).toBe(12);
    });

    it("should evict oldest when capacity reached", () => {
      // Small buffer: 200ms @ 10Hz = 2 slots
      const smallBuffer = new HistoryBuffer(200, 10);

      smallBuffer.push(makeState(1));
      smallBuffer.push(makeState(2));
      expect(smallBuffer.size).toBe(2);

      // Push a 3rd — should evict tick 1
      smallBuffer.push(makeState(3));
      expect(smallBuffer.size).toBe(2);
      expect(smallBuffer.getStateAtTick(tickNumber(1))).toBeNull();
      expect(smallBuffer.getStateAtTick(tickNumber(2))).not.toBeNull();
      expect(smallBuffer.getStateAtTick(tickNumber(3))).not.toBeNull();
    });
  });

  describe("getStateAtTick", () => {
    it("should return exact tick match", () => {
      buffer.push(makeState(5));
      buffer.push(makeState(6));
      buffer.push(makeState(7));

      const state = buffer.getStateAtTick(tickNumber(6));
      expect(state).not.toBeNull();
      expect(state!.tick).toBe(6);
    });

    it("should return null for missing tick", () => {
      buffer.push(makeState(1));
      buffer.push(makeState(3));

      expect(buffer.getStateAtTick(tickNumber(2))).toBeNull();
    });

    it("should return null for empty buffer", () => {
      expect(buffer.getStateAtTick(tickNumber(1))).toBeNull();
    });
  });

  describe("getClosestState", () => {
    it("should return exact match if available", () => {
      buffer.push(makeState(5));
      buffer.push(makeState(10));
      buffer.push(makeState(15));

      const state = buffer.getClosestState(tickNumber(10));
      expect(state).not.toBeNull();
      expect(state!.tick).toBe(10);
    });

    it("should return closest tick (preferring earlier)", () => {
      buffer.push(makeState(5));
      buffer.push(makeState(15));

      // Tick 9 is closer to 5 (dist=4) than 15 (dist=6) → should return 5
      const state = buffer.getClosestState(tickNumber(9));
      expect(state).not.toBeNull();
      expect(state!.tick).toBe(5);
    });

    it("should prefer earlier tick on equal distance", () => {
      buffer.push(makeState(5));
      buffer.push(makeState(15));

      // Tick 10 is equidistant from 5 (dist=5) and 15 (dist=5) → prefer 5 (earlier)
      const state = buffer.getClosestState(tickNumber(10));
      expect(state).not.toBeNull();
      expect(state!.tick).toBe(5);
    });

    it("should return null for empty buffer", () => {
      expect(buffer.getClosestState(tickNumber(1))).toBeNull();
    });
  });

  describe("getInterpolatedState", () => {
    it("should find before and after states", () => {
      buffer.push(makeState(10));
      buffer.push(makeState(20));

      const result = buffer.getInterpolatedState(tickNumber(15), 0.5);

      expect(result.before).not.toBeNull();
      expect(result.after).not.toBeNull();
      expect(result.before!.tick).toBe(10);
      expect(result.after!.tick).toBe(20);
      expect(result.fraction).toBe(0.5);
    });

    it("should handle tick before all entries", () => {
      buffer.push(makeState(10));
      buffer.push(makeState(20));

      const result = buffer.getInterpolatedState(tickNumber(5));
      expect(result.before).toBeNull();
      expect(result.after).not.toBeNull();
    });

    it("should handle tick after all entries", () => {
      buffer.push(makeState(10));
      buffer.push(makeState(20));

      const result = buffer.getInterpolatedState(tickNumber(25));
      expect(result.before).not.toBeNull();
      expect(result.after).toBeNull();
    });
  });

  describe("containsTick", () => {
    it("should return true for ticks within range", () => {
      buffer.push(makeState(5));
      buffer.push(makeState(10));
      buffer.push(makeState(15));

      expect(buffer.containsTick(tickNumber(5))).toBe(true);
      expect(buffer.containsTick(tickNumber(10))).toBe(true);
      expect(buffer.containsTick(tickNumber(15))).toBe(true);
      expect(buffer.containsTick(tickNumber(12))).toBe(true); // Between entries
    });

    it("should return false for ticks outside range", () => {
      buffer.push(makeState(5));
      buffer.push(makeState(15));

      expect(buffer.containsTick(tickNumber(4))).toBe(false);
      expect(buffer.containsTick(tickNumber(16))).toBe(false);
    });
  });

  describe("clear", () => {
    it("should empty the buffer", () => {
      buffer.push(makeState(1));
      buffer.push(makeState(2));
      expect(buffer.size).toBe(2);

      buffer.clear();
      expect(buffer.size).toBe(0);
      expect(buffer.oldestTick).toBeNull();
      expect(buffer.newestTick).toBeNull();
    });
  });
});
