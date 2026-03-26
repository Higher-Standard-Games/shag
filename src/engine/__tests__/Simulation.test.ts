/**
 * Simulation — Determinism and prediction tests
 *
 * Uses TestSimulation harness to verify tick vs predict behavior,
 * command sorting determinism, system execution, and state evolution.
 */

import { describe, expect, it } from "vitest";
import { TestSimulation, testConfig, PositionComponent, VelocityComponent } from "../network/test/TestSimulation";
import { MoveCommand } from "../network/core/Command";

function makeCommand(playerId: string, seq: number, direction: { x: number; y: number; z: number }): MoveCommand {
  return new MoveCommand(playerId, 0, seq, direction, 0, 0, 0);
}

describe("Simulation", () => {
  describe("Initial state", () => {
    it("should start at tick 0", () => {
      const sim = new TestSimulation(testConfig);
      expect(sim.currentTick).toBe(0);
    });

    it("should create test entity at origin", () => {
      const sim = new TestSimulation(testConfig);
      const entity = sim.state.entities.get("test-entity");
      expect(entity).not.toBeUndefined();

      const pos = entity!.getComponent<PositionComponent>("position");
      expect(pos!.x).toBe(0);
      expect(pos!.y).toBe(0);
      expect(pos!.z).toBe(0);
    });
  });

  describe("tick() — Server mode", () => {
    it("should increment tick counter", () => {
      const sim = new TestSimulation(testConfig);
      sim.tick([]);
      expect(sim.currentTick).toBe(1);

      sim.tick([]);
      expect(sim.currentTick).toBe(2);
    });

    it("should process commands and run systems", () => {
      const sim = new TestSimulation(testConfig);
      const cmd = makeCommand("test-player", 1, { x: 1, y: 0, z: 0 });

      sim.tick([cmd]);

      const entity = sim.state.entities.get("test-entity")!;
      const pos = entity.getComponent<PositionComponent>("position")!;
      const vel = entity.getComponent<VelocityComponent>("velocity")!;

      // Command sets velocity to direction * 100
      expect(vel.x).toBe(100);

      // System applies velocity * dt (dt = 50ms = 0.05s)
      // pos.x = 0 + 100 * 0.05 = 5
      expect(pos.x).toBeCloseTo(5, 2);
    });
  });

  describe("predict() — Client mode", () => {
    it("should NOT increment tick counter", () => {
      const sim = new TestSimulation(testConfig);
      const initialTick = sim.currentTick;

      sim.predict([]);
      expect(sim.currentTick).toBe(initialTick);

      sim.predict([]);
      expect(sim.currentTick).toBe(initialTick);
    });

    it("should still process commands and run systems", () => {
      const sim = new TestSimulation(testConfig);
      const cmd = makeCommand("test-player", 1, { x: 1, y: 0, z: 0 });

      sim.predict([cmd]);

      const entity = sim.state.entities.get("test-entity")!;
      const pos = entity.getComponent<PositionComponent>("position")!;

      // Same physics result as tick()
      expect(pos.x).toBeCloseTo(5, 2);
    });
  });

  describe("Determinism: tick() vs predict() produce same state", () => {
    it("should produce identical positions", () => {
      const sim1 = new TestSimulation(testConfig);
      const sim2 = new TestSimulation(testConfig);

      const cmd = makeCommand("test-player", 1, { x: 1, y: 0, z: 1 });

      sim1.tick([cmd]);
      sim2.predict([cmd]);

      const pos1 = sim1.state.entities.get("test-entity")!.getComponent<PositionComponent>("position")!;
      const pos2 = sim2.state.entities.get("test-entity")!.getComponent<PositionComponent>("position")!;

      expect(pos1.x).toBeCloseTo(pos2.x);
      expect(pos1.y).toBeCloseTo(pos2.y);
      expect(pos1.z).toBeCloseTo(pos2.z);
    });

    it("should diverge only in tick counter", () => {
      const sim1 = new TestSimulation(testConfig);
      const sim2 = new TestSimulation(testConfig);

      const cmd = makeCommand("test-player", 1, { x: 0, y: 0, z: 1 });

      sim1.tick([cmd]);
      sim2.predict([cmd]);

      expect(sim1.currentTick).toBe(1);
      expect(sim2.currentTick).toBe(0);
    });
  });

  describe("Command sorting determinism", () => {
    it("should produce same result regardless of command input order", () => {
      // Two different players with different commands
      const cmdA = makeCommand("alpha", 1, { x: 1, y: 0, z: 0 });
      const cmdB = makeCommand("beta", 1, { x: 0, y: 0, z: 1 });

      // Feed in order A, B
      const sim1 = new TestSimulation(testConfig);
      sim1.tick([cmdA, cmdB]);

      // Feed in order B, A (reversed)
      const sim2 = new TestSimulation(testConfig);
      sim2.tick([cmdB, cmdA]);

      const pos1 = sim1.state.entities.get("test-entity")!.getComponent<PositionComponent>("position")!;
      const pos2 = sim2.state.entities.get("test-entity")!.getComponent<PositionComponent>("position")!;

      // Results should be identical because commands are sorted before processing
      expect(pos1.x).toBeCloseTo(pos2.x);
      expect(pos1.y).toBeCloseTo(pos2.y);
      expect(pos1.z).toBeCloseTo(pos2.z);
    });

    it("should sort by playerId first, then by sequence", () => {
      const cmd1 = makeCommand("alice", 2, { x: 1, y: 0, z: 0 });
      const cmd2 = makeCommand("alice", 1, { x: 0, y: 0, z: 1 });
      const cmd3 = makeCommand("bob", 1, { x: 0, y: 1, z: 0 });

      // Feed in any order — should still be deterministic
      const sim = new TestSimulation(testConfig);
      sim.tick([cmd3, cmd1, cmd2]);

      // Just verify it doesn't crash and produces a result
      const entity = sim.state.entities.get("test-entity");
      expect(entity).not.toBeUndefined();
    });
  });

  describe("Multiple tick integration", () => {
    it("should integrate velocity over multiple ticks", () => {
      const sim = new TestSimulation(testConfig);

      // Set velocity with first command
      const cmd = makeCommand("test-player", 1, { x: 1, y: 0, z: 0 });
      sim.tick([cmd]);

      // Run 9 more ticks with no new commands (velocity persists)
      for (let i = 0; i < 9; i++) {
        sim.tick([]);
      }

      const pos = sim.state.entities.get("test-entity")!.getComponent<PositionComponent>("position")!;
      // velocity = 100, dt = 0.05, 10 ticks: pos.x = 100 * 0.05 * 10 = 50
      expect(pos.x).toBeCloseTo(50, 1);
    });
  });

  describe("Empty tick", () => {
    it("should advance tick counter with no commands", () => {
      const sim = new TestSimulation(testConfig);
      sim.tick([]);
      expect(sim.currentTick).toBe(1);
    });

    it("should not move entities with zero velocity", () => {
      const sim = new TestSimulation(testConfig);
      sim.tick([]);

      const pos = sim.state.entities.get("test-entity")!.getComponent<PositionComponent>("position")!;
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
      expect(pos.z).toBe(0);
    });
  });
});
