/**
 * MovementSystem.test.ts — Entity iteration + player-vs-player separation
 *
 * MovementSystem is the ECS-style glue that drives a MovementProfile per
 * entity and resolves player-vs-player overlap (Q3-style cylinder separation).
 * These tests verify:
 *   - Only entities with transform+velocity are simulated
 *   - InputComponent feeds MovementInput correctly
 *   - Profile result is applied back to components (position, velocity, grounded)
 *   - MovementStateComponent updates from extended results
 *   - setMovementProfile / setCollisionWorld swap at runtime
 *   - Post-move player separation handles all the edge cases
 */

import { describe, expect, it } from "vitest";
import { InputComponent } from "../network/components/InputComponent";
import { MovementStateComponent } from "../network/components/MovementStateComponent";
import { TransformComponent, type Vec3 } from "../network/components/TransformComponent";
import { VelocityComponent } from "../network/components/VelocityComponent";
import { Entity } from "../network/core/Entity";
import { GameState } from "../network/core/GameState";
import { NullCollisionWorld } from "../network/systems/collision/CollisionWorld";
import { MovementSystem } from "../network/systems/MovementSystem";
import type { MovementInput, MovementProfile, MovementResult } from "../network/systems/movement/MovementProfile";
import { SimpleMovement } from "../network/systems/movement/SimpleMovement";

// ── Test helpers ───────────────────────────────────────────────────

/**
 * A MovementProfile stub that records every call and returns whatever the
 * caller configures. Ideal for verifying the system contract without coupling
 * to real physics.
 */
class StubProfile implements MovementProfile {
  public calls: {
    position: Vec3;
    velocity: Vec3;
    input: MovementInput | null;
    deltaTime: number;
    hasCollision: boolean;
  }[] = [];
  public result: MovementResult = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    grounded: false,
  };
  public nextResultFactory?: (pos: Vec3, vel: Vec3) => MovementResult;

  simulate(
    position: Vec3,
    velocity: Vec3,
    input: MovementInput | null,
    deltaTime: number,
    collision: ReturnType<typeof Object> | null,
  ): MovementResult {
    this.calls.push({
      position: { ...position },
      velocity: { ...velocity },
      input,
      deltaTime,
      hasCollision: collision !== null,
    });
    if (this.nextResultFactory) return this.nextResultFactory(position, velocity);
    return {
      position: { ...this.result.position },
      velocity: { ...this.result.velocity },
      grounded: this.result.grounded,
      rotation: this.result.rotation ? { ...this.result.rotation } : undefined,
    };
  }
  getDefaults() {
    return { maxSpeed: 1, acceleration: 1, friction: 1, gravity: 1, jumpVelocity: 1 };
  }
  getName() {
    return "StubProfile";
  }
}

function makeEntity(id: string, position: Vec3, velocity: Vec3 = { x: 0, y: 0, z: 0 }): Entity {
  const e = new Entity(id);
  e.addComponent("transform", new TransformComponent({ position }));
  e.addComponent("velocity", new VelocityComponent({ linear: velocity }));
  return e;
}

function makeState(entities: Entity[]): GameState {
  const s = new GameState();
  for (const e of entities) s.entities.set(e.id, e);
  return s;
}

// ── Contract with MovementProfile ──────────────────────────────────

describe("MovementSystem — profile contract", () => {
  it("skips entities missing transform", () => {
    const e = new Entity("e1");
    e.addComponent("velocity", new VelocityComponent());
    const stub = new StubProfile();
    new MovementSystem(stub).update(makeState([e]), 0.016);
    expect(stub.calls.length).toBe(0);
  });

  it("skips entities missing velocity", () => {
    const e = new Entity("e1");
    e.addComponent("transform", new TransformComponent());
    const stub = new StubProfile();
    new MovementSystem(stub).update(makeState([e]), 0.016);
    expect(stub.calls.length).toBe(0);
  });

  it("calls simulate exactly once per qualifying entity", () => {
    const entities = [
      makeEntity("a", { x: 0, y: 0, z: 0 }),
      makeEntity("b", { x: 50, y: 0, z: 50 }),
      makeEntity("c", { x: 200, y: 0, z: 200 }),
    ];
    const stub = new StubProfile();
    new MovementSystem(stub).update(makeState(entities), 0.02);
    expect(stub.calls.length).toBe(3);
    expect(stub.calls.every((c) => c.deltaTime === 0.02)).toBe(true);
  });

  it("forwards transform.position and velocity.linear to simulate", () => {
    const pos = { x: 10, y: 20, z: 30 };
    const vel = { x: -1, y: 2, z: -3 };
    const stub = new StubProfile();
    new MovementSystem(stub).update(makeState([makeEntity("e1", pos, vel)]), 0.016);
    expect(stub.calls[0].position).toEqual(pos);
    expect(stub.calls[0].velocity).toEqual(vel);
  });

  it("passes null input when entity has no InputComponent", () => {
    const stub = new StubProfile();
    new MovementSystem(stub).update(makeState([makeEntity("e1", { x: 0, y: 0, z: 0 })]), 0.016);
    expect(stub.calls[0].input).toBeNull();
  });

  it("builds MovementInput from InputComponent", () => {
    const e = makeEntity("e1", { x: 0, y: 0, z: 0 });
    const input = new InputComponent({
      buttons: 0b1010,
      viewAngles: { pitch: 0.5, yaw: 1.2 },
      moveDirection: { x: 1, y: 0, z: 0 },
    });
    e.addComponent("input", input);
    const stub = new StubProfile();
    new MovementSystem(stub).update(makeState([e]), 0.016);

    const mi = stub.calls[0].input!;
    expect(mi.buttons).toBe(0b1010);
    expect(mi.viewAngles).toEqual({ pitch: 0.5, yaw: 1.2 });
    expect(mi.direction).toEqual({ x: 1, y: 0, z: 0 });
    // isPressed delegates to InputComponent's bitfield logic.
    expect(mi.isPressed(0b0010)).toBe(true);
    expect(mi.isPressed(0b0001)).toBe(false);
  });

  it("passes collision world reference to simulate", () => {
    const stub = new StubProfile();
    const col = new NullCollisionWorld();
    new MovementSystem(stub, col).update(makeState([makeEntity("e1", { x: 0, y: 0, z: 0 })]), 0.016);
    expect(stub.calls[0].hasCollision).toBe(true);
  });

  it("passes null collision when none is set", () => {
    const stub = new StubProfile();
    new MovementSystem(stub, null).update(makeState([makeEntity("e1", { x: 0, y: 0, z: 0 })]), 0.016);
    expect(stub.calls[0].hasCollision).toBe(false);
  });
});

// ── Result application ─────────────────────────────────────────────

describe("MovementSystem — result application", () => {
  it("writes result.position back to transform.position", () => {
    const e = makeEntity("e1", { x: 0, y: 0, z: 0 });
    const stub = new StubProfile();
    stub.result = {
      position: { x: 10, y: 20, z: 30 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
    };
    new MovementSystem(stub).update(makeState([e]), 0.016);
    const t = e.getComponent<TransformComponent>("transform")!;
    expect(t.position).toEqual({ x: 10, y: 20, z: 30 });
  });

  it("writes result.velocity back to velocity.linear", () => {
    const e = makeEntity("e1", { x: 0, y: 0, z: 0 });
    const stub = new StubProfile();
    stub.result = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 1, y: 2, z: 3 },
      grounded: false,
    };
    new MovementSystem(stub).update(makeState([e]), 0.016);
    const v = e.getComponent<VelocityComponent>("velocity")!;
    expect(v.linear).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("writes result.grounded back to velocity.grounded", () => {
    const e = makeEntity("e1", { x: 0, y: 0, z: 0 });
    const stub = new StubProfile();
    stub.result = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
    };
    new MovementSystem(stub).update(makeState([e]), 0.016);
    expect(e.getComponent<VelocityComponent>("velocity")!.grounded).toBe(true);
  });

  it("applies optional result.rotation to transform.rotation", () => {
    const e = makeEntity("e1", { x: 0, y: 0, z: 0 });
    const stub = new StubProfile();
    stub.result = {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      rotation: { x: 0.1, y: 0.2, z: 0.3 },
    };
    new MovementSystem(stub).update(makeState([e]), 0.016);
    expect(e.getComponent<TransformComponent>("transform")!.rotation).toEqual({
      x: 0.1,
      y: 0.2,
      z: 0.3,
    });
  });

  it("leaves transform.rotation alone when result omits rotation", () => {
    const e = makeEntity("e1", { x: 0, y: 0, z: 0 });
    const originalRot = { x: 5, y: 5, z: 5 };
    e.getComponent<TransformComponent>("transform")!.rotation = { ...originalRot };
    const stub = new StubProfile();
    new MovementSystem(stub).update(makeState([e]), 0.016);
    expect(e.getComponent<TransformComponent>("transform")!.rotation).toEqual(originalRot);
  });

  it("propagates advanced result fields to MovementStateComponent", () => {
    const e = makeEntity("e1", { x: 0, y: 0, z: 0 });
    const ms = new MovementStateComponent();
    e.addComponent("movementState", ms);

    const stub = new StubProfile();
    stub.nextResultFactory = () =>
      ({
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: true,
        // Extended fields — MovementSystem forwards them via updateFrom().
        isSliding: true,
        isCrouching: true,
        crouchViewOffset: -12,
        wallJumpState: "charging",
        ledgeGrabState: "grabbing",
        actualHorizSpeed: 420,
      }) as MovementResult;

    new MovementSystem(stub).update(makeState([e]), 0.016);

    expect(ms.isSliding).toBe(true);
    expect(ms.isCrouching).toBe(true);
    expect(ms.crouchViewOffset).toBe(-12);
    expect(ms.wallJumpState).toBe("charging");
    expect(ms.ledgeGrabState).toBe("grabbing");
    expect(ms.actualHorizSpeed).toBe(420);
  });

  it("does not create a MovementStateComponent when absent", () => {
    const e = makeEntity("e1", { x: 0, y: 0, z: 0 });
    const stub = new StubProfile();
    new MovementSystem(stub).update(makeState([e]), 0.016);
    expect(e.hasComponent("movementState")).toBe(false);
  });
});

// ── Runtime swapping ───────────────────────────────────────────────

describe("MovementSystem — runtime swapping", () => {
  it("setMovementProfile swaps which profile simulate() targets", () => {
    const a = new StubProfile();
    const b = new StubProfile();
    const sys = new MovementSystem(a);
    sys.update(makeState([makeEntity("e1", { x: 0, y: 0, z: 0 })]), 0.016);
    sys.setMovementProfile(b);
    sys.update(makeState([makeEntity("e2", { x: 0, y: 0, z: 0 })]), 0.016);
    expect(a.calls.length).toBe(1);
    expect(b.calls.length).toBe(1);
  });

  it("setCollisionWorld toggles the collision reference", () => {
    const stub = new StubProfile();
    const sys = new MovementSystem(stub);
    sys.update(makeState([makeEntity("e1", { x: 0, y: 0, z: 0 })]), 0.016);
    expect(stub.calls[0].hasCollision).toBe(false);

    sys.setCollisionWorld(new NullCollisionWorld());
    sys.update(makeState([makeEntity("e2", { x: 0, y: 0, z: 0 })]), 0.016);
    expect(stub.calls[1].hasCollision).toBe(true);

    sys.setCollisionWorld(null);
    sys.update(makeState([makeEntity("e3", { x: 0, y: 0, z: 0 })]), 0.016);
    expect(stub.calls[2].hasCollision).toBe(false);
  });

  it("getProfileName reflects the current profile", () => {
    const sys = new MovementSystem(new SimpleMovement());
    expect(sys.getProfileName()).toBe("SimpleMovement");
    sys.setMovementProfile(new StubProfile());
    expect(sys.getProfileName()).toBe("StubProfile");
  });
});

// ── Player-vs-player separation ────────────────────────────────────

describe("MovementSystem — player separation", () => {
  // Use an identity profile (pass-through) so only the separation step mutates positions.
  function identityProfile(): MovementProfile {
    return {
      simulate: (position, velocity) => ({
        position: { ...position },
        velocity: { ...velocity },
        grounded: false,
      }),
      getDefaults: () => ({ maxSpeed: 0, acceleration: 0, friction: 0, gravity: 0, jumpVelocity: 0 }),
      getName: () => "identity",
    };
  }

  function dist(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  it("does not move isolated entities (farther apart than 2*radius=32)", () => {
    const a = makeEntity("a", { x: 0, y: 0, z: 0 });
    const b = makeEntity("b", { x: 100, y: 0, z: 0 });
    new MovementSystem(identityProfile()).update(makeState([a, b]), 0.016);
    expect(a.getComponent<TransformComponent>("transform")!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.getComponent<TransformComponent>("transform")!.position).toEqual({ x: 100, y: 0, z: 0 });
  });

  it("pushes overlapping entities to at least the separation distance (32)", () => {
    const a = makeEntity("a", { x: 0, y: 0, z: 0 });
    const b = makeEntity("b", { x: 10, y: 0, z: 0 }); // overlap: 32 - 10 = 22
    new MovementSystem(identityProfile()).update(makeState([a, b]), 0.016);
    const aPos = a.getComponent<TransformComponent>("transform")!.position;
    const bPos = b.getComponent<TransformComponent>("transform")!.position;
    // Each entity is pushed by the full overlap amount independently, so the
    // final XZ distance ends up >= 32 (the separation dist).
    expect(dist(aPos, bPos)).toBeGreaterThanOrEqual(32 - 1e-5);
  });

  it("pushes along the horizontal connecting vector (XZ only)", () => {
    const a = makeEntity("a", { x: 0, y: 0, z: 0 });
    const b = makeEntity("b", { x: 10, y: 0, z: 0 });
    new MovementSystem(identityProfile()).update(makeState([a, b]), 0.016);
    const aPos = a.getComponent<TransformComponent>("transform")!.position;
    const bPos = b.getComponent<TransformComponent>("transform")!.position;
    // Y is preserved (no vertical push).
    expect(aPos.y).toBe(0);
    expect(bPos.y).toBe(0);
    // Push is symmetric around midpoint.
    expect(aPos.x + bPos.x).toBeCloseTo(10, 3);
  });

  it("does not separate entities whose Y cylinders don't overlap", () => {
    // Cylinder: -24 .. +32 relative to position. Two entities with Y=0 and Y=80
    // do not overlap vertically (first cylinder max=32, second cylinder min=56).
    const a = makeEntity("a", { x: 0, y: 0, z: 0 });
    const b = makeEntity("b", { x: 10, y: 80, z: 0 });
    new MovementSystem(identityProfile()).update(makeState([a, b]), 0.016);
    expect(a.getComponent<TransformComponent>("transform")!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(b.getComponent<TransformComponent>("transform")!.position).toEqual({ x: 10, y: 80, z: 0 });
  });

  it("handles exactly-overlapping positions without NaN (arbitrary push direction)", () => {
    const a = makeEntity("a", { x: 0, y: 0, z: 0 });
    const b = makeEntity("b", { x: 0, y: 0, z: 0 });
    new MovementSystem(identityProfile()).update(makeState([a, b]), 0.016);
    const aPos = a.getComponent<TransformComponent>("transform")!.position;
    const bPos = b.getComponent<TransformComponent>("transform")!.position;
    expect(Number.isFinite(aPos.x)).toBe(true);
    expect(Number.isFinite(aPos.z)).toBe(true);
    expect(Number.isFinite(bPos.x)).toBe(true);
    expect(Number.isFinite(bPos.z)).toBe(true);
  });

  it("resolution is order-independent (uses position snapshots)", () => {
    const makeTrio = () => [
      makeEntity("a", { x: 0, y: 0, z: 0 }),
      makeEntity("b", { x: 10, y: 0, z: 0 }),
      makeEntity("c", { x: 20, y: 0, z: 0 }),
    ];

    const forward = makeTrio();
    const reversed = makeTrio().reverse();

    const sysF = new MovementSystem(identityProfile());
    const sysR = new MovementSystem(identityProfile());

    const sF = new GameState();
    for (const e of forward) sF.entities.set(e.id, e);
    const sR = new GameState();
    for (const e of reversed) sR.entities.set(e.id, e);

    sysF.update(sF, 0.016);
    sysR.update(sR, 0.016);

    // a, b, c should end at the same positions regardless of iteration order.
    const fA = forward[0].getComponent<TransformComponent>("transform")!.position;
    const rA = reversed.find((e) => e.id === "a")!.getComponent<TransformComponent>("transform")!.position;
    expect(fA).toEqual(rA);
  });

  it("ignores entities without a transform component during separation", () => {
    const e = new Entity("ghost");
    e.addComponent("velocity", new VelocityComponent());
    const a = makeEntity("a", { x: 0, y: 0, z: 0 });
    const b = makeEntity("b", { x: 100, y: 0, z: 0 });
    // Should not throw.
    expect(() => new MovementSystem(identityProfile()).update(makeState([a, b, e]), 0.016)).not.toThrow();
  });
});

// ── Real-physics smoke test (SimpleMovement ∘ MovementSystem) ──────

describe("MovementSystem — smoke with SimpleMovement", () => {
  it("applies gravity and moves an airborne entity down over time", () => {
    const e = makeEntity("e1", { x: 0, y: 100, z: 0 });
    const sys = new MovementSystem(new SimpleMovement());
    const state = makeState([e]);

    const startY = e.getComponent<TransformComponent>("transform")!.position.y;
    for (let i = 0; i < 10; i++) sys.update(state, 0.016);
    const endY = e.getComponent<TransformComponent>("transform")!.position.y;

    expect(endY).toBeLessThan(startY);
  });

  it("accepts a collision world", () => {
    expect(() => new MovementSystem(new SimpleMovement()).setCollisionWorld(new NullCollisionWorld())).not.toThrow();
  });
});
