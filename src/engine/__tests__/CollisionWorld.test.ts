/**
 * CollisionWorld.test.ts — NullCollisionWorld contract + Contents flag layout
 *
 * NullCollisionWorld is the reference CollisionWorld used by tests and the
 * fallback when no world is loaded. It must:
 *   - return no-hit from trace()
 *   - resolve a stepSlideMove with a hard floor at y=-bounds.min.y
 *   - preserve horizontal velocity under floor contact
 *   - report EMPTY contents everywhere
 *   - expose a world-sized AABB
 *
 * We also lock the Contents bit assignments (SOLID/WATER/...) as they act as
 * a wire contract with BSP maps.
 */

import { describe, expect, it } from "vitest";
import type { AABB } from "../network/systems/collision/CollisionWorld";
import { Contents, NullCollisionWorld } from "../network/systems/collision/CollisionWorld";

type Vec3 = { x: number; y: number; z: number };

const PLAYER_BOUNDS: AABB = {
  min: { x: -16, y: -24, z: -16 },
  max: { x: 16, y: 32, z: 16 },
};

// ── trace() ─────────────────────────────────────────────────────────

describe("NullCollisionWorld — trace", () => {
  it("never hits", () => {
    const w = new NullCollisionWorld();
    const r = w.trace({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 100 });
    expect(r.hit).toBe(false);
    expect(r.fraction).toBe(1);
  });

  it("ignores AABB bounds arg", () => {
    const w = new NullCollisionWorld();
    const r = w.trace({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, PLAYER_BOUNDS);
    expect(r.hit).toBe(false);
  });

  it("returns no normal or hitPoint when missing", () => {
    const r = new NullCollisionWorld().trace({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(r.normal).toBeUndefined();
    expect(r.hitPoint).toBeUndefined();
    expect(r.entityId).toBeUndefined();
  });
});

// ── stepSlideMove() ─────────────────────────────────────────────────

describe("NullCollisionWorld — stepSlideMove", () => {
  it("moves freely when not contacting the floor", () => {
    const w = new NullCollisionWorld();
    const r = w.stepSlideMove({ x: 0, y: 200, z: 0 }, { x: 50, y: 0, z: 0 }, 0.1, PLAYER_BOUNDS);
    expect(r.endPos.x).toBeCloseTo(5, 5);
    expect(r.endPos.y).toBeCloseTo(200, 5);
    expect(r.grounded).toBe(false);
    expect(r.velocity.y).toBe(0);
  });

  it("clamps Y to floor height (=-bounds.min.y) and zeroes negative vy", () => {
    const w = new NullCollisionWorld();
    const r = w.stepSlideMove({ x: 0, y: 10, z: 0 }, { x: 0, y: -1000, z: 0 }, 0.1, PLAYER_BOUNDS);
    // floorHeight = -(-24) = 24
    expect(r.endPos.y).toBe(24);
    expect(r.velocity.y).toBe(0);
    expect(r.grounded).toBe(true);
  });

  it("preserves positive vy through the clamp (upward motion)", () => {
    const w = new NullCollisionWorld();
    const r = w.stepSlideMove({ x: 0, y: 30, z: 0 }, { x: 0, y: 100, z: 0 }, 0.1, PLAYER_BOUNDS);
    // 30 + 100*0.1 = 40, above floor — no clamp
    expect(r.endPos.y).toBeCloseTo(40, 5);
    expect(r.velocity.y).toBe(100);
    expect(r.grounded).toBe(false);
  });

  it("preserves horizontal velocity under floor contact", () => {
    const w = new NullCollisionWorld();
    const r = w.stepSlideMove({ x: 0, y: 10, z: 0 }, { x: 100, y: -500, z: 50 }, 0.1, PLAYER_BOUNDS);
    expect(r.velocity.x).toBe(100);
    expect(r.velocity.z).toBe(50);
  });

  it("honors non-default bounds (different floor height)", () => {
    const w = new NullCollisionWorld();
    const tallBounds: AABB = { min: { x: -16, y: -48, z: -16 }, max: { x: 16, y: 48, z: 16 } };
    const r = w.stepSlideMove({ x: 0, y: 10, z: 0 }, { x: 0, y: -1000, z: 0 }, 0.1, tallBounds);
    expect(r.endPos.y).toBe(48); // -(-48)
  });

  it("when starting exactly at floor, stays at floor and reports grounded", () => {
    const w = new NullCollisionWorld();
    const r = w.stepSlideMove({ x: 0, y: 24, z: 0 }, { x: 0, y: -100, z: 0 }, 0.016, PLAYER_BOUNDS);
    expect(r.endPos.y).toBe(24);
    expect(r.grounded).toBe(true);
    expect(r.velocity.y).toBe(0);
  });

  it("does not mutate input position or velocity", () => {
    const w = new NullCollisionWorld();
    const pos: Vec3 = { x: 1, y: 30, z: -2 };
    const vel: Vec3 = { x: 0, y: -500, z: 0 };
    const posCopy = { ...pos };
    const velCopy = { ...vel };
    w.stepSlideMove(pos, vel, 0.1, PLAYER_BOUNDS);
    expect(pos).toEqual(posCopy);
    expect(vel).toEqual(velCopy);
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    const w = new NullCollisionWorld();
    const args: [Vec3, Vec3, number, AABB] = [{ x: 1, y: 30, z: -2 }, { x: 10, y: -50, z: 5 }, 0.016, PLAYER_BOUNDS];
    const a = w.stepSlideMove(...args);
    const b = w.stepSlideMove(...args);
    expect(a).toEqual(b);
  });
});

// ── pointContents() ────────────────────────────────────────────────

describe("NullCollisionWorld — pointContents", () => {
  it("returns EMPTY everywhere", () => {
    const w = new NullCollisionWorld();
    expect(w.pointContents({ x: 0, y: 0, z: 0 })).toBe(Contents.EMPTY);
    expect(w.pointContents({ x: 1e9, y: -1e9, z: 0 })).toBe(Contents.EMPTY);
  });
});

// ── findEntitiesInRadius() ──────────────────────────────────────────

describe("NullCollisionWorld — findEntitiesInRadius", () => {
  it("returns an empty array", () => {
    const w = new NullCollisionWorld();
    expect(w.findEntitiesInRadius({ x: 0, y: 0, z: 0 }, 100)).toEqual([]);
  });
});

// ── getWorldBounds() ───────────────────────────────────────────────

describe("NullCollisionWorld — world bounds", () => {
  it("returns a symmetric ±10000 box", () => {
    const b = new NullCollisionWorld().getWorldBounds();
    expect(b.min).toEqual({ x: -10000, y: -10000, z: -10000 });
    expect(b.max).toEqual({ x: 10000, y: 10000, z: 10000 });
  });

  it("is well-formed (min <= max componentwise)", () => {
    const b = new NullCollisionWorld().getWorldBounds();
    expect(b.min.x).toBeLessThanOrEqual(b.max.x);
    expect(b.min.y).toBeLessThanOrEqual(b.max.y);
    expect(b.min.z).toBeLessThanOrEqual(b.max.z);
  });
});

// ── Contents flag wire contract ────────────────────────────────────

describe("Contents — BSP content flag codes", () => {
  // These bit values are shared with BSP map geometry and must not drift.
  it("has stable bit assignments", () => {
    expect(Contents.EMPTY).toBe(0);
    expect(Contents.SOLID).toBe(1);
    expect(Contents.WATER).toBe(2);
    expect(Contents.LAVA).toBe(4);
    expect(Contents.SLIME).toBe(8);
    expect(Contents.PLAYERCLIP).toBe(16);
    expect(Contents.MONSTERCLIP).toBe(32);
    expect(Contents.TRIGGER).toBe(64);
  });

  it("flags are mutually independent bits (powers of 2 except EMPTY)", () => {
    const nonZero = [
      Contents.SOLID,
      Contents.WATER,
      Contents.LAVA,
      Contents.SLIME,
      Contents.PLAYERCLIP,
      Contents.MONSTERCLIP,
      Contents.TRIGGER,
    ];
    for (const f of nonZero) {
      // Power of 2: exactly one bit set.
      expect(f & (f - 1)).toBe(0);
    }
  });

  it("flags can be OR'd into a composite without collision", () => {
    const composite = Contents.SOLID | Contents.WATER | Contents.TRIGGER;
    expect(composite & Contents.SOLID).toBeTruthy();
    expect(composite & Contents.WATER).toBeTruthy();
    expect(composite & Contents.TRIGGER).toBeTruthy();
    expect(composite & Contents.LAVA).toBe(0);
  });
});
