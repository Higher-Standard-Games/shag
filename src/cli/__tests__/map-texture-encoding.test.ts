/**
 * Map textures are classified once into an encoding list, and packaging writes
 * each listed TGA/PNG as WebP with its class's settings.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { classify, encodeTexture, webpName } from "../map-texture-encoding";

/** An uncompressed 32-bit TGA, top-down, every pixel `rgba`. */
function tga(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const bytes = Buffer.alloc(18 + width * height * 4);
  bytes[2] = 2;
  bytes.writeUInt16LE(width, 12);
  bytes.writeUInt16LE(height, 14);
  bytes[16] = 32;
  bytes[17] = 0x28;
  for (let i = 0; i < width * height; i++) bytes.set([rgba[2], rgba[1], rgba[0], rgba[3]], 18 + i * 4);
  return bytes;
}

describe("map texture encoding", () => {
  it("classifies normal and gloss maps by name, skies by use, and alpha by its pixels", async () => {
    const opaque = tga(4, 4, [200, 100, 50, 255]);
    const cutout = tga(4, 4, [200, 100, 50, 0]);
    const skies = new Set(["env/test/sky_up"]);
    expect(await classify("textures/a/wall_norm.tga", opaque, skies)).toBe("normal");
    expect(await classify("textures/a/wall_gloss.tga", opaque, skies)).toBe("gloss");
    expect(await classify("env/test/sky_up.tga", opaque, skies)).toBe("sky");
    expect(await classify("textures/a/grate.tga", cutout, skies)).toBe("alpha");
    expect(await classify("textures/a/wall.tga", opaque, skies)).toBe("colour");
  });

  it("writes WebP under the texture's name, keeping alpha only for alpha textures", async () => {
    const source = tga(64, 64, [200, 100, 50, 128]);
    const colour = await encodeTexture("textures/a/wall.tga", source, "colour");
    expect(colour.name).toBe("textures/a/wall.webp");
    expect(colour.bytes.toString("ascii", 8, 12)).toBe("WEBP");
    expect((await sharp(colour.bytes).metadata()).hasAlpha).toBe(false);
    const alpha = await encodeTexture("textures/a/grate.tga", source, "alpha");
    const { data } = await sharp(alpha.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(128);
  });

  it("keeps the source a list marks to keep", async () => {
    const source = tga(64, 64, [1, 2, 3, 255]);
    expect(await encodeTexture("textures/a/keep.tga", source, "keep")).toEqual({
      name: "textures/a/keep.tga",
      bytes: source,
    });
    expect(webpName("textures/a/b.PNG")).toBe("textures/a/b.webp");
  });
});
