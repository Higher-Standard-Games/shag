import { describe, expect, it } from "vitest";
import { lightmapIntensityFor } from "../loader/map/MapLoader";

/**
 * Baked lighting is per-BSP-format, not one number for every map.
 *
 * The two toolchains bake to different targets, so a single gain tuned on
 * Warsow maps renders Quake 3 maps visibly dim. `r_lightmapscale` sits on top
 * for the cases the format default does not cover.
 */
describe("lightmap intensity", () => {
  it("uses the Warsow gain for an FBSP map", () => {
    expect(lightmapIntensityFor(true, 1)).toBe(2);
  });

  it("lifts a Quake 3 map, which bakes darker", () => {
    expect(lightmapIntensityFor(false, 1)).toBe(3);
  });

  it("scales on top of the format default", () => {
    expect(lightmapIntensityFor(true, 1.5)).toBe(3);
    expect(lightmapIntensityFor(false, 0.5)).toBe(1.5);
  });

  it("ignores a missing scale rather than going black", () => {
    // The cvar may not be registered yet on the first load of a session.
    expect(lightmapIntensityFor(false, undefined)).toBe(3);
  });

  it("ignores a nonsensical scale", () => {
    // Zero would render the map unlit and look like a load failure.
    expect(lightmapIntensityFor(true, 0)).toBe(2);
    expect(lightmapIntensityFor(true, Number.NaN)).toBe(2);
    expect(lightmapIntensityFor(true, -1)).toBe(2);
  });
});
