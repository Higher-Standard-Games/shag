import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import { extractLifts, type LiftCrush } from "../../shared/bsp/LiftSystem";
import { SweepCollisionBackend } from "../physics/SweepCollisionBackend";
import { liftBsp } from "./fixtures/liftBsp";

const actor = (x = 0) => ({ position: { x, y: 24.03125, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
async function setup(ceiling = false) {
  const backend = new SweepCollisionBackend();
  await backend.init(liftBsp(ceiling));
  return backend;
}
describe("moving BSP lifts", () => {
  it("moves exact brush collision and point contents, without a ghost at the authored stop", async () => {
    const backend = await setup();
    expect(backend.trace(new Vector3(0, 150, 0), new Vector3(0, -10, 0)).endPos.y).toBeCloseTo(24.03125);
    expect(backend.pointContents(new Vector3(0, -4, 0)) & 1).toBe(1);
    expect(backend.pointContents(new Vector3(0, 96, 0)) & 1).toBe(0);
    const p = actor();
    for (let i = 0; i < 60; i++) backend.lifts!.step(1 / 60, [p]);
    expect(p.position.y).toBeCloseTo(124.03125);
    expect(backend.pointContents(new Vector3(0, 96, 0)) & 1).toBe(1);
    expect(backend.pointContents(new Vector3(0, -4, 0)) & 1).toBe(0);
  });
  it("holds at the top with a rider and returns after they leave", async () => {
    const backend = await setup();
    const p = actor();
    for (let i = 0; i < 180; i++) backend.lifts!.step(1 / 60, [p]);
    expect(backend.lifts!.snapshot()[0].phase).toBe("top");
    for (let i = 0; i < 130; i++) backend.lifts!.step(1 / 60, []);
    expect(backend.lifts!.snapshot()[0].phase).toBe("bottom");
  });
  it("carries multiple riders once and rolls the entire move back beneath a ceiling", async () => {
    const backend = await setup(true);
    const a = actor(-20),
      b = actor(20);
    for (let i = 0; i < 15; i++) backend.lifts!.step(1 / 60, [a, b]);
    expect(a.position.y).toBeCloseTo(49.03125);
    expect(b.position.y).toBeCloseTo(a.position.y);
    const old = backend.lifts!.snapshot()[0].offset;
    backend.lifts!.step(1 / 60, [a, b]);
    expect(backend.lifts!.snapshot()[0].offset).toBe(old);
    expect(backend.lifts!.snapshot()[0].phase).toBe("down");
    expect(a.position.y).toBeCloseTo(49.03125);
  });
  it("does not pull an airborne player down with a departing platform", async () => {
    const backend = await setup();
    const s = backend.lifts!.snapshot()[0];
    backend.lifts!.restore([{ ...s, offset: -50, phase: "down" }]);
    const p = actor();
    p.position.y += 50;
    p.velocity.y = 200;
    backend.lifts!.step(1 / 60, [p]);
    expect(p.position.y).toBeCloseTo(74.03125);
  });
  it("extracts targeted downward door lifts, negative lip, wait=-1 and trigger bounds", () => {
    const bsp = liftBsp();
    bsp.models.push({ ...bsp.models[1], mins: [-10, -10, 0], maxs: [10, 10, 80] });
    bsp.entities = [
      { classname: "func_door", properties: { model: "*1", angle: "-2", targetname: "lift1", lip: "-32", wait: "-1" } },
      { classname: "trigger_multiple", properties: { model: "*2", target: "lift1", wait: "6" } },
    ];
    const [d] = extractLifts(bsp.entities, bsp.models);
    expect(d.start).toBe(0);
    expect(d.end).toBe(-40);
    expect(d.wait).toBe(-1);
    expect(d.automatic).toBe(false);
    expect(d.triggers[0].wait).toBe(6);
    expect(d.triggers[0].max.y).toBe(80);
  });
  it("crushes the body that blocks it, then reverses", async () => {
    const backend = await setup(true); // ceiling just above the plat's travel
    const victim = { ...actor(), id: 7 };
    // Rising freely: nobody is being squashed yet.
    expect(backend.lifts!.step(1 / 60, [victim])).toEqual([]);
    let crushes = backend.lifts!.step(1 / 60, [victim]);
    for (let i = 0; i < 60 && crushes.length === 0; i++) crushes = backend.lifts!.step(1 / 60, [victim]);
    expect(crushes).toHaveLength(1);
    expect(crushes[0].id).toBe(7);
    // Default dmg 2 held at Q3's 20Hz cadence, scaled to this step's length.
    expect(crushes[0].damage).toBeCloseTo(2 * (1 / 60) * 20, 6);
    // Not a crusher, so it backs off rather than grinding the player to death.
    expect(backend.lifts!.snapshot()[0].phase).toBe("down");
  });
  it("a CRUSHER keeps pushing and keeps dealing damage instead of backing off", async () => {
    const bsp = liftBsp(true);
    bsp.entities = [
      // spawnflags 4 = CRUSHER
      { classname: "func_plat", properties: { model: "*1", height: "100", speed: "100", spawnflags: "4" } },
    ];
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    const victim = { ...actor(), id: 9 };
    let crushed = 0;
    for (let i = 0; i < 120; i++) crushed += backend.lifts!.step(1 / 60, [victim]).length;
    // It stayed on the player rather than reversing after the first contact.
    expect(crushed).toBeGreaterThan(20);
    expect(backend.lifts!.snapshot()[0].phase).toBe("up");
  });
  it("does not crush a passive body, and honours dmg 0", async () => {
    const backend = await setup(true);
    const corpse = { ...actor(), id: 3, passive: true };
    const crushes: LiftCrush[] = [];
    // A passive body still blocks the mover, but cannot be hurt by it.
    for (let i = 0; i < 60; i++) crushes.push(...backend.lifts!.step(1 / 60, [corpse]));
    expect(crushes).toEqual([]);

    const bsp = liftBsp(true);
    bsp.entities = [{ classname: "func_plat", properties: { model: "*1", height: "100", speed: "100", dmg: "0" } }];
    const harmless = new SweepCollisionBackend();
    await harmless.init(bsp);
    expect(harmless.lifts!.definitions[0].damage).toBe(0);
    const victim = { ...actor(), id: 4 };
    let any = 0;
    for (let i = 0; i < 120; i++) any += harmless.lifts!.step(1 / 60, [victim]).length;
    expect(any).toBe(0);
  });
  it("rewinds mover geometry for a historical trace and restores it afterwards", async () => {
    const backend = await setup();
    const lifts = backend.lifts!;
    const floorUnderShaft = () => backend.trace(new Vector3(0, 150, 0), new Vector3(0, -10, 0)).endPos.y;
    const whenTheShotWasFired = lifts.offsets();
    expect(floorUnderShaft()).toBeCloseTo(24.03125);
    const p = actor();
    for (let i = 0; i < 60; i++) lifts.step(1 / 60, [p]);
    expect(floorUnderShaft()).toBeCloseTo(124.03125);
    // A shot taken before the plat rose must be traced against the old floor...
    expect(lifts.rewind(whenTheShotWasFired, floorUnderShaft)).toBeCloseTo(24.03125);
    // ...and the live world must be exactly where it was once the query ends.
    expect(floorUnderShaft()).toBeCloseTo(124.03125);
    expect(lifts.offsets()).toEqual([0]);
  });
  it("carries a passive body without letting it call or hold the lift", async () => {
    const backend = await setup();
    const item = { ...actor(), passive: true };
    // A dropped item alone must never call an automatic plat.
    for (let i = 0; i < 60; i++) backend.lifts!.step(1 / 60, [item]);
    expect(backend.lifts!.snapshot()[0].phase).toBe("bottom");
    expect(item.position.y).toBeCloseTo(24.03125);
    // It still rides when a player calls the plat.
    const player = actor(20);
    for (let i = 0; i < 60; i++) backend.lifts!.step(1 / 60, [item, player]);
    expect(item.position.y).toBeCloseTo(124.03125);
    // And once the player steps off, the item cannot hold the plat at the top.
    for (let i = 0; i < 130; i++) backend.lifts!.step(1 / 60, [item]);
    expect(backend.lifts!.snapshot()[0].phase).toBe("bottom");
    expect(item.position.y).toBeCloseTo(24.03125);
  });
  it("accepts a func_button caller and offsets trigger bounds by the caller's origin", () => {
    const bsp = liftBsp();
    bsp.models.push({ ...bsp.models[1], mins: [-10, -10, 0], maxs: [10, 10, 80] });
    bsp.entities = [
      { classname: "func_door", properties: { model: "*1", angle: "-1", targetname: "lift1", lip: "-92" } },
      { classname: "func_button", properties: { model: "*2", target: "lift1", origin: "200 40 8" } },
    ];
    const [d] = extractLifts(bsp.entities, bsp.models);
    expect(d.triggers).toHaveLength(1);
    // Authored Q3 (x, y, z-up) lands as engine (x, y-up, z), shifted by the button's origin.
    expect(d.triggers[0].min).toEqual({ x: 190, y: 8, z: 30 });
    expect(d.triggers[0].max).toEqual({ x: 210, y: 88, z: 50 });
    expect(d.triggers[0].wait).toBe(1);
  });
  it("drives a lift from a button the player walks into, and never rearms a fire-once caller", async () => {
    const bsp = liftBsp();
    bsp.models.push({ ...bsp.models[1], mins: [120, -8, 0], maxs: [140, 8, 80] });
    bsp.entities = [
      { classname: "func_door", properties: { model: "*1", angle: "-2", targetname: "lift", lip: "-92" } },
      { classname: "func_button", properties: { model: "*2", target: "lift", wait: "-1" } },
    ];
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    expect(backend.lifts!.definitions[0].triggers).toHaveLength(1);
    const presser = actor(130);
    backend.lifts!.step(1 / 60, [presser]);
    expect(backend.lifts!.snapshot()[0].phase).toBe("up");
    // wait -1 means the caller is spent: its cooldown must still be running much later.
    for (let i = 0; i < 600; i++) backend.lifts!.step(1 / 60, [presser]);
    expect(backend.lifts!.snapshot()[0].cooldowns[0]).toBeGreaterThan(1e8);
  });
  it("clears mover state on disposal and reinitialization", async () => {
    const backend = await setup();
    backend.dispose();
    expect(backend.lifts).toBeUndefined();
    const bsp = liftBsp();
    bsp.entities = [];
    await backend.init(bsp);
    expect(backend.lifts!.definitions).toHaveLength(0);
  });
  it("a toggle lift waits at both ends and reverses on a fresh targeted trigger", async () => {
    const bsp = liftBsp();
    bsp.models.push({ ...bsp.models[1], mins: [120, -8, 0], maxs: [140, 8, 80] });
    bsp.entities = [
      {
        classname: "func_door",
        properties: {
          model: "*1",
          angle: "-2",
          targetname: "lift",
          lip: "-92",
          speed: "100",
          spawnflags: "32",
          wait: "1",
        },
      },
      { classname: "trigger_multiple", properties: { model: "*2", target: "lift", wait: "0.5" } },
    ];
    const backend = new SweepCollisionBackend();
    await backend.init(bsp);
    const caller = actor(130);
    backend.lifts!.step(1 / 60, [caller]);
    for (let i = 0; i < 240; i++) backend.lifts!.step(1 / 60, []);
    expect(backend.lifts!.snapshot()[0].offset).toBe(-100);
    expect(backend.lifts!.snapshot()[0].phase).toBe("top");
    backend.lifts!.step(1 / 60, [caller]);
    for (let i = 0; i < 240; i++) backend.lifts!.step(1 / 60, []);
    expect(backend.lifts!.snapshot()[0].offset).toBe(0);
    expect(backend.lifts!.snapshot()[0].phase).toBe("bottom");
  });
});
