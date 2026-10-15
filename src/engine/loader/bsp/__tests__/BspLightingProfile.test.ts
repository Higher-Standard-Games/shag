import { describe, expect, it } from "vitest";
import { bspLightingProfile } from "../BspLightingProfile";
import type { BspFile } from "../BspLoader";

function map(properties: Record<string, string> = {}, indices = [0, 2]): BspFile {
  return {
    header: { isFBSP: true },
    entities: [{ classname: "worldspawn", properties }],
    faces: indices.map((lightmapIndex) => ({ lightmapIndex })),
    lightmaps: Array.from({ length: 4 }, () => new Uint8Array(3)),
  } as BspFile;
}
describe("authored BSP lighting", () => {
  it("matches wfdm11's runtime gain and ambient, ignoring unrelated compiler keys", () => {
    const profile = bspLightingProfile(
      map({
        _lightingIntensity: "3",
        ambient: "6",
        _color: ".882353 .490196 .164706",
        saturation: "2",
        shading: "halflambert",
      }),
    );
    expect(profile.gain).toBe(3);
    expect(profile.ambient[0]).toBeCloseTo((0.882353 * 6 * 3) / 255);
    expect(profile.deluxe).toBe(true);
  });
  it("uses case-insensitive underscored overrides, including explicit zero ambient", () => {
    const profile = bspLightingProfile(
      map({ _LIGHTINGINTENSITY: "4", ambient: "9", _ambient: "0", color: "1 0 0", _color: "0 0 0" }),
    );
    expect(profile.gain).toBe(4);
    expect(profile.ambient).toEqual([0, 0, 0]);
  });
  it("does not leak previous-map values or mistake _lightintensity for _lightingIntensity", () => {
    bspLightingProfile(map({ _lightingIntensity: "3", ambient: "6" }));
    expect(bspLightingProfile(map({ _lightintensity: "1.75" })).gain).toBe(2);
    expect(bspLightingProfile(map({ _lightingIntensity: "NaN" })).ambient).toEqual([0, 0, 0]);
  });
  it("requires exclusively paired pages before decoding directions", () => {
    expect(bspLightingProfile(map({}, [0, 1])).deluxe).toBe(false);
    expect(bspLightingProfile(map({}, [0, 4])).deluxe).toBe(false);
  });
});
