/**
 * SimpleMovement.test.ts — Movement physics determinism tests
 *
 * SimpleMovement is the reference MovementProfile used for prototyping and as
 * the shape contract for more complex profiles (Q3Movement, etc.). These tests
 * lock the physics behaviour: gravity, jump, ground friction, acceleration,
 * collision clipping. Movement must be deterministic (same inputs → same
 * outputs) for client-side prediction / server reconciliation to hold.
 */

import { describe, expect, it } from "vitest";
import { InputButtons } from "../network/components/InputComponent";
import type { Vec3 } from "../network/components/TransformComponent";
import {
  type CollisionWorld,
  NullCollisionWorld,
  type TraceResult,
} from "../network/systems/collision/CollisionWorld";
import type { MovementInput } from "../network/systems/movement/MovementProfile";
import { SimpleMovement, type SimpleMovementConfig } from "../network/systems/movement/SimpleMovement";

// ── Helpers ────────────────────────────────────────────────────────

function makeInput(partial: { buttons?: number; direction?: Vec3 } = {}): MovementInput {
  const buttons = partial.buttons ?? 0;
  return {
    buttons,
    viewAngles: { pitch: 0, yaw: 0 },
    direction: partial.direction ?? { x: 0, y: 0, z: 0 },
    isPressed: (b: number) => (buttons & b) !== 0,
  };
}

/** A collision world that pretends we're standing on an infinite floor at y=0. */
function floorAtZero(): CollisionWorld {
  return {
    trace(start: Vec3, end: Vec3): TraceResult {
      // Downward trace: "below me is solid" at y <= 0
      if (end.y < start.y && end.y <= 0) {
        return { hit: true, fraction: 0.5, normal: { x: 0, y: 1, z: 0 } };
      }
      return { hit: false, fraction: 1 };
    },
    stepSlideMove() {
      throw new Error("not used by SimpleMovement");
    },
    pointContents() {
      return 0;
    },
    findEntitiesInRadius() {
      return [];
    },
    getWorldBounds() {
      return { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    },
  };
}

/**
 * A collision world whose ground-probe (the short downward trace SimpleMovement
 * does at y - 0.1) misses, but any larger-span trace hits at fraction 0.25 with
 * a -z normal. This isolates movement-phase collision from the grounded check.
 */
function northWall(): CollisionWorld {
  return {
    trace(start: Vec3, end: Vec3): TraceResult {
      const dy = end.y - start.y;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const spanSq = dx * dx + dy * dy + dz * dz;
      // Ground probe is a ~0.1-unit downward poke. Anything that short: miss.
      if (spanSq < 0.5) return { hit: false, fraction: 1 };
      return {
        hit: true,
        fraction: 0.25,
        normal: { x: 0, y: 0, z: -1 },
      };
    },
    stepSlideMove() {
      throw new Error("not used");
    },
    pointContents() {
      return 0;
    },
    findEntitiesInRadius() {
      return [];
    },
    getWorldBounds() {
      return { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    },
  };
}

// ── Config and identity ────────────────────────────────────────────

describe("SimpleMovement — config", () => {
  it("uses documented defaults", () => {
    const m = new SimpleMovement();
    expect(m.getDefaults()).toEqual({
      maxSpeed: 280,
      acceleration: 10,
      friction: 6,
      gravity: 800,
      jumpVelocity: 270,
    });
  });

  it("applies partial config overrides", () => {
    const m = new SimpleMovement({ gravity: 1200, jumpVelocity: 400 });
    const d = m.getDefaults();
    expect(d.gravity).toBe(1200);
    expect(d.jumpVelocity).toBe(400);
    // Untouched fields remain at defaults.
    expect(d.maxSpeed).toBe(280);
    expect(d.friction).toBe(6);
  });

  it("getName returns SimpleMovement", () => {
    expect(new SimpleMovement().getName()).toBe("SimpleMovement");
  });

  it("does not share config between instances", () => {
    const a = new SimpleMovement({ gravity: 100 });
    const b = new SimpleMovement();
    expect(a.getDefaults().gravity).toBe(100);
    expect(b.getDefaults().gravity).toBe(800);
  });
});

// ── Purity / determinism ───────────────────────────────────────────

describe("SimpleMovement — determinism", () => {
  it("produces identical results for identical inputs", () => {
    const m = new SimpleMovement();
    const pos = { x: 5, y: 10, z: -3 };
    const vel = { x: 50, y: 0, z: 0 };
    const input = makeInput({ direction: { x: 1, y: 0, z: 0 }, buttons: InputButtons.FORWARD });

    const a = m.simulate(pos, vel, input, 0.016, null);
    const b = m.simulate(pos, vel, input, 0.016, null);
    expect(a).toEqual(b);
  });

  it("does not mutate the input position or velocity", () => {
    const m = new SimpleMovement();
    const pos = { x: 5, y: 10, z: -3 };
    const vel = { x: 50, y: 0, z: 0 };
    const posCopy = { ...pos };
    const velCopy = { ...vel };

    m.simulate(pos, vel, null, 0.016, null);

    expect(pos).toEqual(posCopy);
    expect(vel).toEqual(velCopy);
  });

  it("returned position and velocity are new objects (not aliased)", () => {
    const m = new SimpleMovement();
    const pos = { x: 0, y: 10, z: 0 };
    const vel = { x: 0, y: 0, z: 0 };
    const r = m.simulate(pos, vel, null, 0.016, null);
    expect(r.position).not.toBe(pos);
    expect(r.velocity).not.toBe(vel);
  });
});

// ── Gravity and grounded ───────────────────────────────────────────

describe("SimpleMovement — gravity + ground snap", () => {
  it("applies gravity when airborne (no collision world)", () => {
    const m = new SimpleMovement();
    const r = m.simulate({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }, null, 0.1, null);
    // gravity 800 * 0.1 = 80 subtracted from vy
    expect(r.velocity.y).toBeCloseTo(-80, 5);
    expect(r.grounded).toBe(false);
  });

  it("clamps position to y=0 when no collision world (fallback floor)", () => {
    const m = new SimpleMovement();
    // Start falling: one large step would take us below 0 without the clamp.
    const r = m.simulate({ x: 0, y: 0.05, z: 0 }, { x: 0, y: -100, z: 0 }, null, 1.0, null);
    expect(r.position.y).toBe(0);
    expect(r.velocity.y).toBe(0);
    expect(r.grounded).toBe(true);
  });

  it("keeps y>=0 invariant across many ticks without collision world", () => {
    const m = new SimpleMovement();
    let pos: Vec3 = { x: 0, y: 5, z: 0 };
    let vel: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 100; i++) {
      const r = m.simulate(pos, vel, null, 0.016, null);
      pos = r.position;
      vel = r.velocity;
    }
    expect(pos.y).toBeGreaterThanOrEqual(0);
    // After settling, vertical velocity should be ~0 and we should be grounded.
    expect(vel.y).toBeCloseTo(0, 3);
  });

  it("does not apply gravity when grounded (collision world reports contact)", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: 0, z: 0 },
      null,
      0.016,
      floorAtZero(),
    );
    expect(r.grounded).toBe(true);
    // With floor beneath, gravity is skipped — vy stays at 0.
    expect(r.velocity.y).toBeCloseTo(0, 5);
  });

  it("clamps negative vy to zero on ground contact", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: -50, z: 0 },
      null,
      0.016,
      floorAtZero(),
    );
    expect(r.grounded).toBe(true);
    expect(r.velocity.y).toBe(0);
  });
});

// ── Jump ────────────────────────────────────────────────────────────

describe("SimpleMovement — jump", () => {
  it("jump sets vy = jumpVelocity when grounded and JUMP pressed", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: 0, z: 0 },
      makeInput({ buttons: InputButtons.JUMP }),
      0.016,
      floorAtZero(),
    );
    expect(r.velocity.y).toBe(270);
    expect(r.grounded).toBe(false); // jump lifts us off
  });

  it("jump does nothing when airborne", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 100, z: 0 },
      { x: 0, y: 0, z: 0 },
      makeInput({ buttons: InputButtons.JUMP }),
      0.016,
      null, // no collision => airborne
    );
    // Gravity applied, no jump kick.
    expect(r.velocity.y).toBeLessThan(0);
  });

  it("jump requires JUMP button specifically", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: 0, z: 0 },
      makeInput({ buttons: InputButtons.FIRE }),
      0.016,
      floorAtZero(),
    );
    expect(r.velocity.y).not.toBe(270);
  });

  it("respects custom jumpVelocity", () => {
    const m = new SimpleMovement({ jumpVelocity: 500 });
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: 0, z: 0 },
      makeInput({ buttons: InputButtons.JUMP }),
      0.016,
      floorAtZero(),
    );
    expect(r.velocity.y).toBe(500);
  });
});

// ── Ground acceleration + friction ─────────────────────────────────

describe("SimpleMovement — ground movement", () => {
  it("accelerates toward wishDir from rest", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: 0, z: 0 },
      makeInput({ direction: { x: 1, y: 0, z: 0 } }),
      0.016,
      floorAtZero(),
    );
    // accel = 10 * maxSpeed(280) * dt(0.016) = 44.8 per tick, clamped to addSpeed (maxSpeed - currentSpeed=0) = 280.
    expect(r.velocity.x).toBeCloseTo(44.8, 3);
    expect(r.velocity.z).toBeCloseTo(0, 5);
  });

  it("accelerates toward wishDir only, not away from it", () => {
    const m = new SimpleMovement();
    // Already at max speed in +X: further acceleration in +X should not increase speed beyond maxSpeed.
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 280, y: 0, z: 0 }, // at max
      makeInput({ direction: { x: 1, y: 0, z: 0 } }),
      0.016,
      floorAtZero(),
    );
    // Friction applied first (6 * 280 * 0.016 = 26.88 drop), then accel back up — net ≤ 280.
    expect(r.velocity.x).toBeLessThanOrEqual(280.01);
  });

  it("applies friction when grounded with no input", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 100, y: 0, z: 0 },
      makeInput({ direction: { x: 0, y: 0, z: 0 } }),
      0.016,
      floorAtZero(),
    );
    // drop = 100 * 6 * 0.016 = 9.6 → new speed 90.4
    expect(r.velocity.x).toBeCloseTo(90.4, 3);
  });

  it("applies friction with null input (e.g., bot with no input component)", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 100, y: 0, z: 0 },
      null,
      0.016,
      floorAtZero(),
    );
    expect(r.velocity.x).toBeCloseTo(90.4, 3);
  });

  it("zeroes very low horizontal speed (< 0.1) to avoid creep", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0.05, y: 0, z: 0.05 },
      null,
      0.016,
      floorAtZero(),
    );
    expect(r.velocity.x).toBe(0);
    expect(r.velocity.z).toBe(0);
  });

  it("does not apply horizontal friction while airborne", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 100, z: 0 },
      { x: 200, y: 0, z: 0 },
      null,
      0.016,
      null,
    );
    // x velocity unchanged in air (no input, no collision).
    expect(r.velocity.x).toBe(200);
  });

  it("air control is reduced (~10% of ground maxSpeed)", () => {
    const m = new SimpleMovement();
    // In air, wishDir adds at most accel * (maxSpeed * 0.1) * dt = 10*28*0.016 = 4.48
    const r = m.simulate(
      { x: 0, y: 100, z: 0 },
      { x: 0, y: 0, z: 0 },
      makeInput({ direction: { x: 1, y: 0, z: 0 } }),
      0.016,
      null,
    );
    expect(r.velocity.x).toBeCloseTo(4.48, 3);
  });

  it("normalizes non-unit wishDir magnitude", () => {
    const m = new SimpleMovement();
    const unit = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: 0, z: 0 },
      makeInput({ direction: { x: 1, y: 0, z: 0 } }),
      0.016,
      floorAtZero(),
    );
    const doubled = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: 0, z: 0 },
      makeInput({ direction: { x: 2, y: 0, z: 0 } }), // non-unit
      0.016,
      floorAtZero(),
    );
    // Unit and non-unit wishDir of the same heading must yield identical acceleration.
    expect(doubled.velocity.x).toBeCloseTo(unit.velocity.x, 5);
  });

  it("wish speed below epsilon (0.01) is treated as no input", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 100, y: 0, z: 0 },
      makeInput({ direction: { x: 0.005, y: 0, z: 0 } }), // below 0.01 threshold
      0.016,
      floorAtZero(),
    );
    // Tiny wishDir → friction path triggers (no input effectively).
    expect(r.velocity.x).toBeLessThan(100);
    expect(r.velocity.x).toBeCloseTo(90.4, 3);
  });
});

// ── Collision clipping ─────────────────────────────────────────────

describe("SimpleMovement — collision response", () => {
  it("stops at hit fraction when a trace hits", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 100, z: 0 }, // high up so no floor interference
      { x: 100, y: 0, z: 0 },
      null,
      0.1, // big step: 10 units
      northWall(),
    );
    // Wall hits at fraction 0.25 → we only move 25% of the step.
    // x displacement = 100 * 0.1 * 0.25 = 2.5
    expect(r.position.x).toBeCloseTo(2.5, 5);
  });

  it("clips velocity against the surface normal", () => {
    const m = new SimpleMovement();
    const r = m.simulate(
      { x: 0, y: 100, z: 0 },
      { x: 0, y: 0, z: 100 }, // moving north
      null,
      0.1,
      northWall(), // normal points -z: dot(vel, normal) = -100, subtract normal * -100 => z stays 100-(-(-100))=0? Actually:
      //   clipped_v = v - n * dot(v, n)
      //   dot(v={0,0,100}, n={0,0,-1}) = -100
      //   v_new.z = 100 - (-1) * (-100) = 100 - 100 = 0
    );
    expect(r.velocity.z).toBeCloseTo(0, 5);
  });

  it("moves freely when trace misses", () => {
    const m = new SimpleMovement();
    const collision = new NullCollisionWorld();
    const r = m.simulate(
      { x: 0, y: 100, z: 0 },
      { x: 50, y: 0, z: 50 },
      null,
      0.02,
      collision,
    );
    // NullCollisionWorld.trace always returns hit:false, so free movement.
    expect(r.position.x).toBeCloseTo(1.0, 5);
    expect(r.position.z).toBeCloseTo(1.0, 5);
  });
});

// ── Config surface ──────────────────────────────────────────────────

describe("SimpleMovement — custom config knobs", () => {
  it("gravity=0 yields no vertical velocity change in air", () => {
    const m = new SimpleMovement({ gravity: 0 });
    const r = m.simulate({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 0 }, null, 0.5, null);
    expect(r.velocity.y).toBe(0);
  });

  it("friction=0 preserves horizontal speed when grounded with no input", () => {
    const m = new SimpleMovement({ friction: 0 });
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 100, y: 0, z: 0 },
      null,
      0.016,
      floorAtZero(),
    );
    expect(r.velocity.x).toBe(100);
  });

  it("acceleration=0 means wishDir input has no effect", () => {
    const m = new SimpleMovement({ acceleration: 0 });
    const r = m.simulate(
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: 0, z: 0 },
      makeInput({ direction: { x: 1, y: 0, z: 0 } }),
      0.016,
      floorAtZero(),
    );
    // Friction is still applied before accel, but speed is 0 so friction is a no-op.
    expect(r.velocity.x).toBe(0);
  });

  it("config is fully customisable via SimpleMovementConfig", () => {
    // Contract: every public config field is overridable.
    const overrides: SimpleMovementConfig = {
      maxSpeed: 1,
      acceleration: 1,
      friction: 1,
      gravity: 1,
      jumpVelocity: 1,
    };
    const m = new SimpleMovement(overrides);
    expect(m.getDefaults()).toEqual(overrides);
  });
});
