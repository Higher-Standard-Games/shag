import { describe, expect, it } from "vitest";
import { floodFrom } from "../PlayerReach";

type V = { x: number; y: number; z: number };

/**
 * A heightfield world in game space (Y up) with the hull origin 24 above the
 * feet: ground at x 0..400, z -200..200, void outside. `heightAt(x)` gives the
 * floor height along x. Movement steps up at most 18 units; anything taller is
 * a wall.
 */
function makeWorld(heightAt: (x: number) => number) {
  const ground = (x: number, z: number) => (x < 0 || x > 400 || z < -200 || z > 200 ? null : heightAt(x));
  return {
    ground,
    world: {
      trace(start: V, end: V) {
        if (end.y >= start.y) return { fraction: 1, hitPoint: { ...end } };
        const h = ground(start.x, start.z);
        if (h === null) return { fraction: 1 };
        const y = Math.min(start.y, h + 24);
        return { fraction: (start.y - y) / (start.y - end.y), hitPoint: { x: start.x, y, z: start.z } };
      },
      stepSlideMove(start: V, velocity: V, dt: number) {
        let p = { ...start };
        for (let i = 1; i <= 16; i++) {
          const next = { x: p.x + (velocity.x * dt) / 16, y: p.y, z: p.z + (velocity.z * dt) / 16 };
          const h = ground(next.x, next.z);
          const feet = p.y - 24;
          if (h !== null && h - feet > 18.5) break;
          if (h !== null && h > feet) next.y = h + 24;
          p = next;
        }
        return { endPos: p };
      },
    },
  };
}

const standsAt = (positions: V[], x: number, floor: number) =>
  positions.some((p) => Math.abs(p.x - x) < 24 && Math.abs(p.y - (floor + 24)) < 2);

describe("floodFrom", () => {
  it("walks the floor and hops onto a ledge within jump height", () => {
    const { world } = makeWorld((x) => (x >= 200 ? 40 : 0));
    const reached = floodFrom(world, { x: 50, y: 24, z: 0 });
    expect(standsAt(reached, 150, 0)).toBe(true);
    expect(standsAt(reached, 300, 40)).toBe(true);
  });

  it("does not reach a ledge taller than a jump", () => {
    const { world } = makeWorld((x) => (x >= 200 ? 60 : 0));
    const reached = floodFrom(world, { x: 50, y: 24, z: 0 });
    expect(standsAt(reached, 150, 0)).toBe(true);
    expect(standsAt(reached, 300, 60)).toBe(false);
  });

  it("climbs the same height by stairs", () => {
    // 15-unit steps every 32 units from x 100 up to 60.
    const { world } = makeWorld((x) => (x >= 228 ? 60 : x >= 100 ? 15 * (Math.floor((x - 100) / 32) + 1) : 0));
    const reached = floodFrom(world, { x: 50, y: 24, z: 0 });
    expect(standsAt(reached, 300, 60)).toBe(true);
  });

  it("never stands over the void", () => {
    const { world, ground } = makeWorld(() => 0);
    const reached = floodFrom(world, { x: 50, y: 24, z: 0 });
    expect(reached.length).toBeGreaterThan(10);
    expect(reached.every((p) => ground(p.x, p.z) !== null)).toBe(true);
  });
});
