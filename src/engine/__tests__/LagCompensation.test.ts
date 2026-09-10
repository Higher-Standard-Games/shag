/**
 * LagCompensation — Rewind tick calculation and ray-capsule intersection tests
 *
 * Verifies the math behind hit registration: latency-to-tick conversion,
 * max compensation clamping, and ray-capsule geometry.
 */

import { playerId, tickNumber } from "@shared/server/simulation/types";
import { describe, expect, it } from "vitest";
import { extractLifts, LiftSystem } from "../../shared/bsp/LiftSystem";
import type { CollisionWorld } from "../../shared/collision/CollisionWorld";
import type { WorldState } from "../server/core/WorldState";
import type { EntityId } from "../server/ecs/types";
import { CASUAL_CONFIG, TOURNAMENT_CONFIG } from "../server/lagcomp/config";
import { LagCompensation } from "../server/lagcomp/LagCompensation";
import { liftBsp } from "./fixtures/liftBsp";

/** Minimal state: history only needs a tick, a clone and a checksum. */
function fakeWorldState(tick: number): WorldState {
  const state = {
    tick: tickNumber(tick),
    clone: () => state,
    checksum: () => 0,
    entitiesByType: () => [],
  };
  return state as unknown as WorldState;
}

describe("LagCompensation", () => {
  describe("getRewindTick", () => {
    it("should rewind by correct number of ticks for given ping", () => {
      const lagComp = new LagCompensation(CASUAL_CONFIG); // 125Hz, 200ms max

      // At 125Hz, 1 tick = 8ms. Half-tick = 4ms.
      // 50ms ping + 0ms input delay + 4ms half-tick = 54ms
      // 54ms / 8ms-per-tick = 6.75 → round to 7 ticks
      const rewind = lagComp.getRewindTick(tickNumber(100), 50, 0);
      expect(rewind).toBe(tickNumber(93)); // 100 - 7
    });

    it("should clamp to max compensation", () => {
      const lagComp = new LagCompensation(CASUAL_CONFIG); // max 200ms

      // 500ms ping would be 504ms total, but clamped to 200ms
      // 200ms / 8ms = 25 ticks
      const rewind = lagComp.getRewindTick(tickNumber(100), 500, 0);
      expect(rewind).toBe(tickNumber(75)); // 100 - 25
    });

    it("should not go below tick 0", () => {
      const lagComp = new LagCompensation(CASUAL_CONFIG);

      const rewind = lagComp.getRewindTick(tickNumber(5), 200, 0);
      expect(rewind).toBeGreaterThanOrEqual(0);
    });

    it("should include client input delay", () => {
      const lagComp = new LagCompensation(CASUAL_CONFIG);

      // 50ms ping + 20ms input delay + 4ms = 74ms → 9.25 → 9 ticks
      const rewind = lagComp.getRewindTick(tickNumber(100), 50, 20);
      expect(rewind).toBe(tickNumber(91)); // 100 - 9
    });

    it("should differ between configs", () => {
      // Same ping, different max compensation
      const casual = new LagCompensation(CASUAL_CONFIG); // 200ms max
      const tournament = new LagCompensation(TOURNAMENT_CONFIG); // 50ms max

      // 100ms ping: casual allows full rewind, tournament clamps
      const casualRewind = casual.getRewindTick(tickNumber(100), 100, 0);
      const tournamentRewind = tournament.getRewindTick(tickNumber(100), 100, 0);

      // Tournament should rewind less (stricter)
      expect(tournamentRewind).toBeGreaterThan(casualRewind);
    });
  });

  describe("Client latency tracking", () => {
    it("should store half-RTT as one-way latency", () => {
      const lagComp = new LagCompensation();
      lagComp.updateClientLatency(playerId(1), 100); // 100ms RTT → 50ms one-way

      expect(lagComp.getClientLatency(playerId(1))).toBe(50);
    });

    it("should return 0 for unknown client", () => {
      const lagComp = new LagCompensation();
      expect(lagComp.getClientLatency(playerId(999))).toBe(0);
    });

    it("should update latency on new measurement", () => {
      const lagComp = new LagCompensation();
      lagComp.updateClientLatency(playerId(1), 100);
      lagComp.updateClientLatency(playerId(1), 60);

      expect(lagComp.getClientLatency(playerId(1))).toBe(30);
    });
  });

  describe("Stats", () => {
    it("should report correct initial stats", () => {
      const lagComp = new LagCompensation();
      const stats = lagComp.getStats();

      expect(stats.bufferSize).toBe(0);
      expect(stats.connectedClients).toBe(0);
      expect(stats.avgLatency).toBe(0);
    });

    it("should report average latency across clients", () => {
      const lagComp = new LagCompensation();
      lagComp.updateClientLatency(playerId(1), 100); // 50ms one-way
      lagComp.updateClientLatency(playerId(2), 200); // 100ms one-way

      const stats = lagComp.getStats();
      expect(stats.connectedClients).toBe(2);
      expect(stats.avgLatency).toBe(75); // (50 + 100) / 2
    });
  });

  describe("Collision world integration", () => {
    it("should not crash when no collision world is set", () => {
      const lagComp = new LagCompensation();
      expect(() => lagComp.setCollisionWorld(null)).not.toThrow();
    });

    it("traces a rewound shot against the mover position recorded for that tick", () => {
      const bsp = liftBsp();
      const lifts = new LiftSystem(extractLifts(bsp.entities, bsp.models), () => ({
        fraction: 1,
        solid: false,
        normalY: 0,
        modelIndex: -1,
      }));
      const sampled: number[] = [];
      const world = {
        lifts,
        trace: () => {
          sampled.push(lifts.offsets()[0]);
          return { hit: false, fraction: 1 };
        },
      } as unknown as CollisionWorld;
      const lagComp = new LagCompensation(CASUAL_CONFIG);
      lagComp.setCollisionWorld(world);

      // Record the world while the plat is still down, then send it up.
      lagComp.recordSnapshot(fakeWorldState(0));
      const whenFired = lifts.offsets()[0];
      const rider = { position: { x: 0, y: 24.03125, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
      for (let i = 0; i < 60; i++) lifts.step(1 / 60, [rider]);
      expect(lifts.offsets()[0]).not.toBe(whenFired);

      const ray = { origin: { x: 0, y: 60, z: 0 }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 100 };
      lagComp.traceHitscan(ray, 9 as unknown as EntityId, 0, fakeWorldState(0));
      expect(sampled).toEqual([whenFired]);
      // The live world is handed back untouched for the next simulation tick.
      expect(lifts.offsets()[0]).not.toBe(whenFired);
    });
  });
});
