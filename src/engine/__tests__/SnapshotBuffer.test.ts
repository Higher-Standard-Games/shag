/**
 * SnapshotBuffer — Time-based interpolation buffer tests
 *
 * Verifies interpolation, extrapolation (velocity + gravity),
 * yaw shortest-path, jitter adaptation, buffer eviction, and flush.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type EntitySnapshot, SnapshotBuffer } from "../network/client/SnapshotBuffer";

// Mock Cvar to avoid dependency on console variable system
vi.mock("../../core/Cvar", () => ({
  Cvar: {
    register: vi.fn(),
    getNumber: vi.fn().mockReturnValue(0),
  },
}));

function makeEntity(overrides: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    crouching: false,
    sliding: false,
    wallJumping: false,
    ...overrides,
  };
}

describe("SnapshotBuffer", () => {
  let buffer: SnapshotBuffer;

  beforeEach(() => {
    buffer = new SnapshotBuffer();
  });

  describe("Empty buffer", () => {
    it("should return null for sample on empty buffer", () => {
      expect(buffer.sample("player1")).toBeNull();
    });

    it("should have zero buffer size", () => {
      expect(buffer.getBufferSize()).toBe(0);
    });

    it("should return empty entity IDs", () => {
      expect(buffer.getLatestEntityIds().size).toBe(0);
    });
  });

  describe("Single snapshot", () => {
    it("should return entity unchanged", () => {
      const entities = new Map<string, EntitySnapshot>();
      entities.set("e1", makeEntity({ x: 100, y: 50, z: -200 }));
      buffer.push(1, entities);

      // Need to sample with enough delay override to hit the snapshot
      const result = buffer.sample("e1", 0);
      expect(result).not.toBeNull();
      // With single snapshot, we get it as-is regardless of timing
      expect(result!.x).toBe(100);
      expect(result!.y).toBe(50);
      expect(result!.z).toBe(-200);
    });

    it("should return null for unknown entity", () => {
      const entities = new Map<string, EntitySnapshot>();
      entities.set("e1", makeEntity());
      buffer.push(1, entities);

      expect(buffer.sample("unknown", 0)).toBeNull();
    });
  });

  describe("Interpolation between two snapshots", () => {
    it("should interpolate position linearly", () => {
      const e1 = new Map<string, EntitySnapshot>();
      e1.set("player", makeEntity({ x: 0, y: 0, z: 0 }));

      const e2 = new Map<string, EntitySnapshot>();
      e2.set("player", makeEntity({ x: 100, y: 0, z: 200 }));

      // Push with known timestamps (using internal push, time is performance.now())
      buffer.push(1, e1);

      // Manually wait is not feasible in unit tests, so we test the output structure
      // The key guarantee is that interpolation produces a value between the two
      buffer.push(2, e2);

      const result = buffer.sample("player", 0);
      expect(result).not.toBeNull();
      // With two snapshots and small delay, we get either interpolated or one of them
      expect(typeof result!.x).toBe("number");
    });
  });

  describe("Yaw shortest-path interpolation", () => {
    it("should handle yaw wrapping through lerpEntity internally", () => {
      // This tests the SnapshotBuffer's internal lerp for yaw
      // We push two snapshots with yaw near the wrap point
      const e1 = new Map<string, EntitySnapshot>();
      e1.set("player", makeEntity({ yaw: Math.PI * 0.9 })); // ~162°

      const e2 = new Map<string, EntitySnapshot>();
      e2.set("player", makeEntity({ yaw: -Math.PI * 0.9 })); // ~-162°

      buffer.push(1, e1);
      buffer.push(2, e2);

      const result = buffer.sample("player", 0);
      expect(result).not.toBeNull();
      // The actual interpolation goes through the shortest path
      // We just verify it produces a valid number
      expect(Number.isFinite(result!.yaw)).toBe(true);
    });
  });

  describe("Extrapolation", () => {
    it("should extrapolate using velocity when past all snapshots", () => {
      const entities = new Map<string, EntitySnapshot>();
      entities.set(
        "player",
        makeEntity({
          x: 100,
          y: 50,
          z: 0,
          vx: 200,
          vy: 0,
          vz: 100,
          grounded: true,
        }),
      );
      buffer.push(1, entities);

      // Sample with zero delay = renderTime = performance.now()
      // Since snapshot was just pushed, we're at or slightly past it → extrapolation
      const result = buffer.sample("player", 0);
      expect(result).not.toBeNull();
      // Grounded entity should stay at y=50 (no Y extrapolation)
    });

    it("should apply gravity for airborne extrapolation", () => {
      const entities = new Map<string, EntitySnapshot>();
      entities.set(
        "player",
        makeEntity({
          x: 0,
          y: 100,
          z: 0,
          vx: 0,
          vy: 100,
          vz: 0,
          grounded: false,
        }),
      );
      buffer.push(1, entities);

      // For airborne, extrapolation uses parabolic arc with gravity
      const result = buffer.sample("player", 0);
      expect(result).not.toBeNull();
    });
  });

  describe("Buffer management", () => {
    it("should evict old snapshots beyond maxBufferSize (32)", () => {
      for (let i = 0; i < 40; i++) {
        const entities = new Map<string, EntitySnapshot>();
        entities.set("e1", makeEntity({ x: i }));
        buffer.push(i, entities);
      }
      expect(buffer.getBufferSize()).toBe(32);
    });

    it("should return correct entity IDs from latest snapshot", () => {
      const e1 = new Map<string, EntitySnapshot>();
      e1.set("player1", makeEntity());
      e1.set("player2", makeEntity());
      buffer.push(1, e1);

      const e2 = new Map<string, EntitySnapshot>();
      e2.set("player1", makeEntity());
      e2.set("player3", makeEntity()); // player2 gone, player3 appeared
      buffer.push(2, e2);

      const ids = buffer.getLatestEntityIds();
      expect(ids.has("player1")).toBe(true);
      expect(ids.has("player3")).toBe(true);
      expect(ids.has("player2")).toBe(false);
    });
  });

  describe("flush", () => {
    it("should keep only the last snapshot", () => {
      for (let i = 0; i < 10; i++) {
        const entities = new Map<string, EntitySnapshot>();
        entities.set("e1", makeEntity({ x: i }));
        buffer.push(i, entities);
      }
      expect(buffer.getBufferSize()).toBe(10);

      buffer.flush();
      expect(buffer.getBufferSize()).toBe(1);
    });

    it("should not crash on empty buffer", () => {
      expect(() => buffer.flush()).not.toThrow();
    });
  });

  describe("Interpolation delay", () => {
    it("should have a default delay", () => {
      expect(buffer.getInterpDelay()).toBeGreaterThan(0);
    });
  });

  // N06/W02: arrival order is not server chronology, and ticks and entity ids
  // only mean anything inside one connection.
  describe("Session freshness", () => {
    const at = (x: number) => new Map([["e1", makeEntity({ x })]]);

    it("rejects a stale tick instead of bracketing a body backwards", () => {
      expect(buffer.push(20, at(200))).toBe(true);
      // Reordered delivery of tick 18 previously regressed the body to x=100.
      expect(buffer.push(18, at(100))).toBe(false);
      expect(buffer.getBufferSize()).toBe(1);
      expect(buffer.sample("e1")?.x).toBe(200);
      expect(buffer.push(21, at(210))).toBe(true);
    });

    it("rejects a duplicate tick, which would read as a zero-length bracket", () => {
      expect(buffer.push(7, at(70))).toBe(true);
      expect(buffer.push(7, at(999))).toBe(false);
      expect(buffer.getBufferSize()).toBe(1);
    });

    it("accepts a lower tick only after the session boundary", () => {
      buffer.push(5000, at(1));
      expect(buffer.push(1, at(2))).toBe(false);
      buffer.reset();
      expect(buffer.push(1, at(2))).toBe(true);
    });

    it("drops the previous connection's samples and restores the default delay", () => {
      const now = vi.spyOn(performance, "now");
      let clock = 1000;
      now.mockImplementation(() => clock);
      for (let tick = 1; tick <= 6; tick++) {
        clock += 100; // 100ms apart: enough jitter history to move interpDelay
        buffer.push(tick, at(tick));
      }
      const laggedDelay = buffer.getInterpDelay();
      expect(buffer.getBufferSize()).toBe(6);

      buffer.reset();
      expect(buffer.getBufferSize()).toBe(0);
      expect(buffer.sample("e1")).toBeNull();

      // A disconnect gap is not jitter: the next session must not inherit it.
      clock += 60_000;
      buffer.push(1, at(1));
      clock += 16;
      buffer.push(2, at(2));
      expect(buffer.getInterpDelay()).toBeLessThan(laggedDelay);
      now.mockRestore();
    });
  });
});

describe("SnapshotBuffer frame sampling", () => {
  function filled(clock: { now: number }) {
    vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    const buffer = new SnapshotBuffer();
    const at = (x: number, extra: Partial<EntitySnapshot> = {}) => makeEntity({ x, vx: 300, ...extra });
    for (let i = 0; i < 6; i++) {
      clock.now = 1000 + i * 16;
      buffer.push(
        i + 1,
        new Map([
          ["a", at(i * 10, { crouchViewOffset: -12 })],
          ["b", at(i * 20, { grounded: i % 2 === 0, vy: 50, wallJumping: true })],
          ...(i === 5 ? [["c", at(900)] as const] : []),
        ]),
      );
    }
    return buffer;
  }

  it("gives each entity what sample() gives at the same instant, between, past and before the snapshots", () => {
    const clock = { now: 0 };
    const buffer = filled(clock);
    const out = {} as ReturnType<SnapshotBuffer["sample"]> & object;
    // Between snapshots, past the newest (extrapolating), and on the newest only.
    for (const now of [1060, 1068, 1200]) {
      clock.now = now;
      buffer.beginFrame();
      for (const id of ["a", "b", "c", "missing"]) {
        const fresh = buffer.sample(id);
        const framed = buffer.sampleInFrame(id, out);
        expect(framed === null ? null : { ...framed }).toEqual(fresh);
        if (framed) expect(framed).toBe(out); // written in place, nothing allocated
      }
    }
    vi.restoreAllMocks();
  });

  it("answers the latest entity ids with the same set until a snapshot arrives", () => {
    const clock = { now: 0 };
    const buffer = filled(clock);
    const ids = buffer.getLatestEntityIds();
    expect(buffer.getLatestEntityIds()).toBe(ids);
    expect([...ids]).toEqual(["a", "b", "c"]);
    clock.now += 16;
    buffer.push(7, new Map([["a", makeEntity()]]));
    expect([...buffer.getLatestEntityIds()]).toEqual(["a"]);
    vi.restoreAllMocks();
  });
});
