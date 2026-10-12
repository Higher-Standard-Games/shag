/**
 * World fog for the engine's own shaders: the values they are fed, nothing
 * without fog or for a `nofog` surface, and the fog amount the CPU uses to fade
 * a burst of additive particles, which must match the shaders' maths.
 */

import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it } from "vitest";
import { parseWorldFog } from "../../loader/bsp/WorldFog";
import { atmFogFactorAt, atmFogUniformValues } from "../AtmosphericFogShader";
import { WorldFogController } from "../WorldFogController";

const controller = WorldFogController.getInstance();
afterEach(() => controller.setMap(null, null));

describe("atmFogUniformValues", () => {
  it("is all zero weight without fog, or for a surface that opts out", () => {
    expect(atmFogUniformValues(controller)[0][3]).toBe(0);
    controller.setMap(new Scene(new NullEngine()), parseWorldFog({ fog: "10000 1 0.5 0 700" }));
    expect(atmFogUniformValues(null)[0][3]).toBe(0);
  });

  it("carries colour, start, sky height and density when fog is drawn", () => {
    controller.setMap(new Scene(new NullEngine()), parseWorldFog({ fog: "10000 1 0.5 0 700" }), 1500);
    const [color, dist] = atmFogUniformValues(controller);
    expect(color).toEqual([1, 0.5, 0, 1]);
    expect(dist[0]).toBe(700);
    expect(dist[1]).toBe(1500);
    expect(dist[3]).toBeCloseTo(3 / 10000);
  });
});

describe("atmFogFactorAt", () => {
  it("is clear inside the start distance and Beer-Lambert past it", () => {
    controller.setMap(new Scene(new NullEngine()), parseWorldFog({ fog: "3000 1 1 1 700" }));
    const eye = { x: 0, y: 0, z: 0 };
    expect(atmFogFactorAt({ x: 600, y: 0, z: 0 }, eye, controller)).toBe(0);
    expect(atmFogFactorAt({ x: 3700, y: 0, z: 0 }, eye, controller)).toBeCloseTo(1 - Math.exp(-3), 5);
  });

  it("follows the height band on engine Y", () => {
    controller.setMap(new Scene(new NullEngine()), parseWorldFog({ fog: "3000 1 1 1", fog_height: "256 0" }));
    const eye = { x: 0, y: 0, z: 0 };
    expect(atmFogFactorAt({ x: 3000, y: 300, z: 0 }, eye, controller)).toBe(0);
    expect(atmFogFactorAt({ x: 3000, y: 0, z: 0 }, eye, controller)).toBeCloseTo(1 - Math.exp(-3), 5);
  });

  it("is 0 without fog or a camera", () => {
    expect(atmFogFactorAt({ x: 1e6, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, controller)).toBe(0);
    controller.setMap(new Scene(new NullEngine()), parseWorldFog({ fog: "3000 1 1 1" }));
    expect(atmFogFactorAt({ x: 1e6, y: 0, z: 0 }, null, controller)).toBe(0);
  });
});
