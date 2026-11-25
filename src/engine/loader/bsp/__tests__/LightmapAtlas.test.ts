/**
 * The lightmap atlas holds every page in a bordered cell, in the Q3
 * lightmap encoding, and moves a page's UVs onto its cell so that bilinear
 * sampling reads what clamped sampling of the page alone would.
 */

import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { describe, expect, it, vi } from "vitest";
import { atlasLightmapUVs, lightmapAtlasLayout, packLightmapAtlas } from "../LightmapAtlas";
import { createBspLightmapTexture, Q3_LIGHTMAP_CURVE } from "../mesh/lightmaps";

/** The per-byte Q3 lightmap curve as `pow`, stored in a byte. */
const shagCurve = (v: number) => {
  const out = new Uint8Array(1);
  out[0] = Math.min(255, (v / 255) ** 0.7 * 255 * 2);
  return out[0];
};

/** A page of `size` x `size` texels whose red is its x, green its y and blue the page number. */
const page = (size: number, n: number) => {
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgb.set([x, y, n], (y * size + x) * 3);
  return rgb;
};

describe("lightmapAtlasLayout", () => {
  it("fits the pages in a square of bordered cells", () => {
    expect(lightmapAtlasLayout(130, 128)).toEqual({ pageSize: 128, pages: 130, columns: 12, cell: 130, size: 1560 });
    expect(lightmapAtlasLayout(1, 128)?.size).toBe(130);
  });

  it("refuses what would not fit a texture", () => {
    expect(lightmapAtlasLayout(0, 128)).toBeNull();
    expect(lightmapAtlasLayout(5000, 128)).toBeNull();
  });
});

describe("packLightmapAtlas", () => {
  const size = 4;
  const layout = lightmapAtlasLayout(3, size)!;
  const atlas = packLightmapAtlas([page(size, 10), page(size, 20), page(size, 30)], layout);
  const at = (x: number, y: number) =>
    Array.from(atlas.subarray((y * layout.size + x) * 4, (y * layout.size + x) * 4 + 4));

  it("encodes every byte as a Q3 page is encoded", () => {
    // Page 1 sits in the second cell of the first row; its texel (2, 3) one in from the border
    const x = layout.cell + 1 + 2;
    const y = 1 + 3;
    expect(at(x, y)).toEqual([shagCurve(2), shagCurve(3), shagCurve(20), 255]);
    for (let v = 0; v < 256; v++) {
      const single = packLightmapAtlas([new Uint8Array([v, v, v])], lightmapAtlasLayout(1, 1)!);
      expect(single[(1 * 3 + 1) * 4]).toBe(shagCurve(v));
    }
  });

  it("repeats each page's edge texels in its border", () => {
    const x0 = 0;
    const y0 = layout.cell; // page 2: first cell of the second row
    // Corner border texel copies the page's corner texel
    expect(at(x0, y0)).toEqual(at(x0 + 1, y0 + 1));
    // Right border copies the last column, bottom border the last row
    expect(at(x0 + size + 1, y0 + 2)).toEqual(at(x0 + size, y0 + 2));
    expect(at(x0 + 2, y0 + size + 1)).toEqual(at(x0 + 2, y0 + size));
    expect(at(x0 + 1, y0 + 1)[2]).toBe(shagCurve(30));
  });
});

describe("atlasLightmapUVs", () => {
  it("maps a page's [0, 1] square onto its cell inside the border", () => {
    const layout = lightmapAtlasLayout(5, 128)!;
    const uvs = new Float32Array([0, 0, 1, 1, 0.5, 0.25]);
    atlasLightmapUVs(uvs, 4, layout);
    // Page 4 is the middle cell of a 3 x 3 grid
    const x0 = layout.cell + 1;
    const y0 = layout.cell + 1;
    expect(uvs[0] * layout.size).toBeCloseTo(x0);
    expect(uvs[1] * layout.size).toBeCloseTo(y0);
    expect(uvs[2] * layout.size).toBeCloseTo(x0 + 128);
    expect(uvs[3] * layout.size).toBeCloseTo(y0 + 128);
    expect(uvs[4] * layout.size).toBeCloseTo(x0 + 64);
    expect(uvs[5] * layout.size).toBeCloseTo(y0 + 32);
  });
});

describe("Q3_LIGHTMAP_CURVE", () => {
  it("is the pow curve for every byte", () => {
    for (let v = 0; v < 256; v++) expect(Q3_LIGHTMAP_CURVE[v]).toBe(shagCurve(v));
  });

  it("encodes a page as the pow curve did", () => {
    const size = 16;
    const rgb = new Uint8Array(size * size * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = i % 256;
    let written: Uint8Array | null = null;
    const scene = {} as Parameters<typeof createBspLightmapTexture>[2];
    vi.spyOn(RawTexture, "CreateRGBATexture").mockImplementation((data) => {
      written = data as Uint8Array;
      return {} as RawTexture;
    });
    createBspLightmapTexture(rgb, size, scene, "page");
    expect(written).not.toBeNull();
    for (let i = 0; i < size * size; i++) {
      for (let c = 0; c < 3; c++) expect(written![i * 4 + c]).toBe(shagCurve(rgb[i * 3 + c]));
      expect(written![i * 4 + 3]).toBe(255);
    }
  });
});
