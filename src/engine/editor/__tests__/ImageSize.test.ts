import { describe, expect, it } from "vitest";
import { imageSize } from "../ImageSize";

const bytes = (length: number, set: Record<number, number>) => {
  const b = new Uint8Array(length);
  for (const [i, v] of Object.entries(set)) b[Number(i)] = v;
  return b;
};

describe("imageSize", () => {
  it("reads TGA by extension", () => {
    expect(imageSize(bytes(18, { 12: 0x00, 13: 0x01, 14: 0x80, 15: 0x00 }), "textures/a.tga")).toEqual([256, 128]);
    expect(imageSize(bytes(18, { 12: 1 }), "textures/a.dat")).toBeNull();
  });

  it("reads PNG from IHDR", () => {
    const png = bytes(24, { 0: 0x89, 1: 0x50, 2: 0x4e, 3: 0x47, 18: 0x02, 19: 0x00, 22: 0x00, 23: 0x40 });
    expect(imageSize(png, "a.png")).toEqual([512, 64]);
  });

  it("walks JPEG segments to the start of frame", () => {
    // SOI, an APP0 segment of length 4, then SOF0 with height 300 and width 200.
    const jpg = bytes(32, {
      0: 0xff,
      1: 0xd8,
      2: 0xff,
      3: 0xe0,
      4: 0x00,
      5: 0x04,
      8: 0xff,
      9: 0xc0,
      10: 0x00,
      11: 0x11,
      12: 0x08,
      13: 0x01,
      14: 0x2c,
      15: 0x00,
      16: 0xc8,
    });
    expect(imageSize(jpg, "a.jpg")).toEqual([200, 300]);
  });

  it("reads KTX 1 and KTX 2 headers", () => {
    const ktx1 = bytes(64, {
      0: 0xab,
      1: 0x4b,
      5: 0x31,
      6: 0x31,
      12: 0x01,
      13: 0x02,
      14: 0x03,
      15: 0x04,
      36: 0x00,
      37: 0x02,
      40: 0x00,
      41: 0x01,
    });
    expect(imageSize(ktx1, "a.ktx")).toEqual([512, 256]);
    const ktx2 = bytes(64, { 0: 0xab, 1: 0x4b, 5: 0x32, 6: 0x30, 20: 0x80, 24: 0x40 });
    expect(imageSize(ktx2, "a.ktx2")).toEqual([128, 64]);
  });

  it("returns null for zero sizes and unknown data", () => {
    expect(imageSize(bytes(18, {}), "a.tga")).toBeNull();
    expect(imageSize(new Uint8Array(4), "a.webp")).toBeNull();
  });
});
