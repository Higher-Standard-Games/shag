/**
 * Worldspawn world fog, read as Warfork reads it: Jal's wdm11 line, the
 * optional height band, sun and sky keys with their defaults, and the move
 * from Quake's Z-up axes to the engine's Y-up ones.
 */

import { describe, expect, it } from "vitest";
import { leadingNumbers, parseWorldFog, worldFogToEngine } from "../WorldFog";

describe("parseWorldFog", () => {
  it("reads Warfork wdm11's fog: 95% at 10000, amber, starting at 700", () => {
    const fog = parseWorldFog({ fog: "10000 0.843137 0.576471 0.25098 700" });
    expect(fog?.color).toEqual([0.843137, 0.576471, 0.25098]);
    expect(fog?.density).toBeCloseTo(3 / 10000);
    expect(fog?.minDist).toBe(700);
    expect(1 - Math.exp(-(10000 - 0) * (fog?.density ?? 0))).toBeCloseTo(0.95, 2);
  });

  it("takes the underscore key and any capitals, and starts at 0 without a mindist", () => {
    expect(parseWorldFog({ _FOG: "6000 0.5 0.5 0.5" })?.minDist).toBe(0);
  });

  it("has no fog without a key or with fewer than four numbers", () => {
    expect(parseWorldFog({ message: "Warehouse: C" })).toBeNull();
    expect(parseWorldFog({ fog: "6000 0.5 0.5" })).toBeNull();
    expect(parseWorldFog({ fog: "" })).toBeNull();
  });

  it("clamps a negative start and has no density at fog_dist 0", () => {
    const fog = parseWorldFog({ fog: "0 1 1 1 -50" });
    expect(fog?.density).toBe(0);
    expect(fog?.minDist).toBe(0);
  });

  it("reads a height band in either direction, and ignores one with equal heights", () => {
    expect(parseWorldFog({ fog: "8000 1 1 1", fog_height: "0 256" })?.height).toEqual({ clear: 0, full: 256 });
    expect(parseWorldFog({ fog: "8000 1 1 1", _fog_height: "256 0" })?.height).toEqual({ clear: 256, full: 0 });
    expect(parseWorldFog({ fog: "8000 1 1 1", fog_height: "128 128" })?.height).toBeNull();
    expect(parseWorldFog({ fog: "8000 1 1 1", fog_height: "128" })?.height).toBeNull();
  });

  it("normalises the sun and fills in intensity 1.5 and exponent 16", () => {
    const sun = parseWorldFog({ fog: "8000 1 1 1", fog_sun: "0 0 2 1 0.9 0.7" })?.sun;
    expect(sun).toEqual({ dir: [0, 0, 1], color: [1, 0.9, 0.7], intensity: 1.5, exponent: 16 });
    expect(parseWorldFog({ fog: "8000 1 1 1", fog_sun: "1 0 0 1 1 1 2 0.5" })?.sun?.exponent).toBe(1);
    expect(parseWorldFog({ fog: "8000 1 1 1", fog_sun: "1 0 0 1 1" })?.sun).toBeNull();
  });

  it("reads the sky tint with defaults after the first number", () => {
    expect(parseWorldFog({ fog: "8000 1 1 1", fog_sky: "0.1" })?.sky).toEqual({
      horizonBias: 0.1,
      horizonScale: 2,
      zenithFalloff: 3,
    });
  });
});

describe("leadingNumbers", () => {
  it("stops at the first non-number, as sscanf does", () => {
    expect(leadingNumbers("1 2 x 3", 5)).toEqual([1, 2]);
    expect(leadingNumbers("1 2 3 4 5 6", 3)).toEqual([1, 2, 3]);
  });
});

describe("worldFogToEngine", () => {
  it("moves the sun's Quake Z to engine Y and keeps heights and distances", () => {
    const fog = parseWorldFog({ fog: "8000 1 1 1 100", fog_sun: "0.6 0 0.8 1 1 1", fog_height: "0 256" });
    const engine = worldFogToEngine(fog!);
    expect(engine.sun?.dir).toEqual([0.6, 0.8, 0]);
    expect(engine.height).toEqual({ clear: 0, full: 256 });
    expect(engine.minDist).toBe(100);
  });
});
