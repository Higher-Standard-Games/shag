/**
 * TickOrchestrator — Fixed-timestep accumulator tests
 *
 * Verifies shouldTick math, multi-rate subsystems, tick duration,
 * disabled subsystems, and reset behavior.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { TickOrchestrator } from "../server/tick/TickOrchestrator";
import type { TickConfig } from "../server/tick/TickConfig";

const testConfig: TickConfig = {
  physics: 125,   // 8ms per tick
  collision: 125,
  ai: 20,         // 50ms per tick
  networking: 60, // ~16.7ms per tick
  economy: 0,     // Disabled
  pathfinding: 0, // Disabled
};

describe("TickOrchestrator", () => {
  let orchestrator: TickOrchestrator;

  beforeEach(() => {
    orchestrator = new TickOrchestrator(testConfig);
  });

  describe("shouldTick basic", () => {
    it("should return 1 tick when enough time has accumulated", () => {
      // Physics: 125Hz = 8ms per tick. Feed 8ms → 1 tick
      const ticks = orchestrator.shouldTick("physics", 0.008);
      expect(ticks).toBe(1);
    });

    it("should return 0 when not enough time has accumulated", () => {
      // Physics needs 8ms, feed 5ms
      const ticks = orchestrator.shouldTick("physics", 0.005);
      expect(ticks).toBe(0);
    });

    it("should return multiple ticks for large dt", () => {
      // Feed 25ms to 125Hz physics → 3 ticks (8ms * 3 = 24ms, 1ms remainder)
      const ticks = orchestrator.shouldTick("physics", 0.025);
      expect(ticks).toBe(3);
    });

    it("should accumulate across multiple calls", () => {
      // Feed 5ms twice → 10ms total = 1 tick + 2ms remainder
      expect(orchestrator.shouldTick("physics", 0.005)).toBe(0);
      expect(orchestrator.shouldTick("physics", 0.005)).toBe(1);
    });
  });

  describe("Multi-rate subsystems", () => {
    it("should tick different subsystems at different rates", () => {
      // Feed 50ms
      const physicsTicks = orchestrator.shouldTick("physics", 0.05);  // 6 ticks (50/8=6.25)
      const aiTicks = orchestrator.shouldTick("ai", 0.05);            // 1 tick (50/50=1.0)
      const netTicks = orchestrator.shouldTick("networking", 0.05);   // 3 ticks (50/16.7=2.99)

      expect(physicsTicks).toBe(6);
      expect(aiTicks).toBe(1);
      expect(netTicks).toBe(3);
    });
  });

  describe("Disabled subsystems", () => {
    it("should return 0 for disabled subsystems (Hz=0)", () => {
      const ticks = orchestrator.shouldTick("economy", 1.0); // 1 whole second
      expect(ticks).toBe(0);
    });
  });

  describe("getTickDuration", () => {
    it("should return correct duration for physics (125Hz)", () => {
      expect(orchestrator.getTickDuration("physics")).toBeCloseTo(0.008);
    });

    it("should return correct duration for AI (20Hz)", () => {
      expect(orchestrator.getTickDuration("ai")).toBeCloseTo(0.05);
    });

    it("should return 0 for disabled subsystems", () => {
      expect(orchestrator.getTickDuration("economy")).toBe(0);
    });
  });

  describe("reset", () => {
    it("should clear all accumulators", () => {
      // Accumulate some time
      orchestrator.shouldTick("physics", 0.005); // Not enough for a tick
      orchestrator.shouldTick("ai", 0.03);       // Not enough for a tick

      orchestrator.reset();

      // After reset, another 5ms shouldn't trigger (no accumulated time)
      expect(orchestrator.shouldTick("physics", 0.005)).toBe(0);
    });
  });

  describe("start/stop lifecycle", () => {
    it("should not be running initially", () => {
      expect(orchestrator.isRunning).toBe(false);
    });

    it("should not crash when stopping without starting", () => {
      expect(() => orchestrator.stop()).not.toThrow();
    });
  });

  describe("Accumulator precision", () => {
    it("should preserve remainder across ticks", () => {
      // 125Hz = 8ms. Feed 10ms → 1 tick + 2ms remainder
      expect(orchestrator.shouldTick("physics", 0.010)).toBe(1);

      // Feed 6ms → 6ms + 2ms remainder = 8ms → 1 tick
      expect(orchestrator.shouldTick("physics", 0.006)).toBe(1);
    });

    it("should handle very small dt without drift", () => {
      // Feed 1ms increments for 8 frames → should get exactly 1 tick
      let totalTicks = 0;
      for (let i = 0; i < 8; i++) {
        totalTicks += orchestrator.shouldTick("physics", 0.001);
      }
      expect(totalTicks).toBe(1);
    });
  });
});
