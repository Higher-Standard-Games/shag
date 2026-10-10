import { describe, expect, it } from "vitest";
import { walkFlood } from "../WalkFlood";

type V = { x: number; y: number; z: number };

/**
 * A heightfield in game space (Y up), hull origin 24 above the feet: ground at
 * x 0..400, z -200..200, void outside. Movement steps up at most 18 units.
 */
function world(heightAt: (x: number) => number) {
  const ground = (x: number, z: number) => (x < 0 || x > 400 || z < -200 || z > 200 ? null : heightAt(x));
  return {
    trace(start: V, end: V) {
      if (end.y >= start.y) return { fraction: 1, hitPoint: { ...end } };
      const h = ground(start.x, start.z);
      if (h === null || h + 24 < end.y) return { fraction: 1 };
      const y = Math.min(start.y, h + 24);
      return { fraction: (start.y - y) / (start.y - end.y), hitPoint: { x: start.x, y, z: start.z } };
    },
    stepSlideMove(start: V, velocity: V, dt: number) {
      let p = { ...start };
      for (let i = 1; i <= 16; i++) {
        const next = { x: p.x + (velocity.x * dt) / 16, y: p.y, z: p.z + (velocity.z * dt) / 16 };
        const h = ground(next.x, next.z);
        if (h !== null && h - (p.y - 24) > 18.5) break;
        if (h !== null && h > p.y - 24) next.y = h + 24;
        p = next;
      }
      return { endPos: p };
    },
  };
}

const at = (positions: V[], x: number, floor: number) =>
  positions.some((p) => Math.abs(p.x - x) < 24 && Math.abs(p.y - (floor + 24)) < 2);

describe("walkFlood", () => {
  it("steps off a ledge only as far as maxDrop allows", () => {
    // A 100-unit drop at x 200.
    const w = world((x) => (x >= 200 ? -100 : 0));
    expect(at(walkFlood(w, { x: 50, y: 24, z: 0 }, { maxDrop: 128 }), 300, -100)).toBe(true);
    expect(at(walkFlood(w, { x: 50, y: 24, z: 0 }, { maxDrop: 64 }), 300, -100)).toBe(false);
  });

  it("stays within its radius and reports the distance walked", () => {
    const w = world(() => 0);
    const reached = walkFlood(w, { x: 50, y: 24, z: 0 }, { radius: 100 });
    expect(reached.every((p) => Math.hypot(p.x - 50, p.z) <= 100)).toBe(true);
    const far = reached.reduce((a, b) => (b.distance > a.distance ? b : a));
    expect(far.distance).toBeGreaterThanOrEqual(Math.hypot(far.x - 50, far.z) - 1);
  });

  it("does not climb a ledge without hops", () => {
    const w = world((x) => (x >= 200 ? 40 : 0));
    expect(at(walkFlood(w, { x: 50, y: 24, z: 0 }), 300, 40)).toBe(false);
    expect(at(walkFlood(w, { x: 50, y: 24, z: 0 }, { hop: 45 }), 300, 40)).toBe(true);
  });
});
