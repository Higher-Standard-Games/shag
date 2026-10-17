import { describe, expect, it } from "vitest";
import { reducedTextureSize, reduceTexturePixels } from "../TextureReduction";

describe("map texture reduction", () => {
  it("averages the whole rectangular texture for flat color", () => {
    const image = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    ]);
    const reduced = reduceTexturePixels(image, 3, 2, 8);
    expect(reduced).toEqual({ width: 1, height: 1, pixels: new Uint8Array([85, 85, 85, 255]) });
    expect(reduceTexturePixels(image, 3, 2, 0).pixels).toBe(image);
  });
  it("halves dimensions without dropping below one or stretching a narrow axis", () => {
    expect(reducedTextureSize(1024, 256, 1)).toEqual({ width: 512, height: 128 });
    expect(reducedTextureSize(1, 9, 2)).toEqual({ width: 1, height: 2 });
    expect(reducedTextureSize(4096, 2048, 8)).toEqual({ width: 1, height: 1 });
  });
});
