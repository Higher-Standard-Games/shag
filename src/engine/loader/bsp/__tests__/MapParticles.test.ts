import { describe, expect, it } from "vitest";
import { particlePlan, spriteLook } from "../MapParticles";

const entity = (properties: Record<string, string>) => ({ classname: "misc_particles", properties });

describe("misc_particles", () => {
  it("reads wda2's smoke: spherical, expanding, 6 a second for 3 s", () => {
    const plan = particlePlan(
      entity({
        origin: "-450 -644 190",
        shaderName: "gfx/misc/smokepuff",
        speed: "8",
        delay: "3",
        count: "6",
        size: "9",
        spawnflags: "17",
        angles: "-90 0 0",
      }),
    )!;
    expect(plan.shader).toBe("gfx/misc/smokepuff");
    expect(plan.origin).toEqual({ x: -450, y: 190, z: -644 });
    expect(plan).toMatchObject({ spherical: true, expand: true, shrink: false, rate: 6, life: 3, size: 9, speed: 8 });
  });

  it("truncates wdm17's bubble speed to nothing, as the game does, and points up", () => {
    const plan = particlePlan(
      entity({
        origin: "0 0 0",
        shaderName: "gfx/misc/toxicbubble",
        speed: "0.25",
        delay: "10",
        count: "1",
        size: "24",
        spawnflags: "32",
        angles: "-90 0 0",
      }),
    )!;
    expect(plan.speed).toBe(0);
    expect(plan.shrink).toBe(true);
    expect(plan.forward.y).toBeCloseTo(1);
  });

  it("leaves a START_OFF emitter and an empty one alone", () => {
    expect(particlePlan(entity({ origin: "0 0 0", count: "4", spawnflags: "64" }))).toBeNull();
    expect(particlePlan(entity({ origin: "0 0 0" }))).toBeNull();
  });

  it("fades in quickly, out over its life, and grows up to five times", () => {
    const plan = { life: 3, expand: true, shrink: false };
    expect(spriteLook(plan, 0)!.alpha).toBe(0);
    expect(spriteLook(plan, 0.2)!.alpha).toBeCloseTo(1 - 2 / 29);
    expect(spriteLook(plan, 0)!.scale).toBe(2);
    expect(spriteLook(plan, 2.85)!.scale).toBe(5);
    expect(spriteLook(plan, 2.95)).toBeNull();
    const shrink = spriteLook({ life: 10, expand: false, shrink: true }, 9.5)!;
    expect(shrink.scale).toBeCloseTo(0.1 + 1 - 95 / 99);
  });
});
