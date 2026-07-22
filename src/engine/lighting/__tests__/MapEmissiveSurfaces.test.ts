/**
 * MapEmissiveSurfaces — extract area-light candidates from a BSP's fullbright
 * world surfaces. Locks the fullbright filter, the Quake→Babylon centroid/normal
 * swap, the size (two largest AABB extents), the min-area cull, and area ranking.
 */

import { describe, expect, it } from "vitest";
import type { BspFile } from "../../loader/bsp/BspLoader";
import { extractEmissiveSurfaces } from "../MapEmissiveSurfaces";

// Minimal synthetic BSP with the fields extractEmissiveSurfaces reads.
function makeBsp(
  faces: Array<{ tex: number; first: number; n: number; normal: [number, number, number] }>,
  vertsQuake: Array<[number, number, number]>,
  texNames: string[],
): BspFile {
  return {
    models: [{ firstFace: 0, numFaces: faces.length }],
    faces: faces.map((f) => ({
      textureIndex: f.tex,
      firstVertex: f.first,
      numVertices: f.n,
      normal: f.normal,
    })),
    vertices: vertsQuake.map((p) => ({ position: p })),
    textures: texNames.map((name) => ({ name })),
    // biome-ignore lint/suspicious/noExplicitAny: minimal partial BSP for the fields under test
  } as any as BspFile;
}

// A 64×64 wall quad in the Quake XZ plane → Babylon centroid (32,32,0), 64×64.
const WALL_QUAD: Array<[number, number, number]> = [
  [0, 0, 0],
  [64, 0, 0],
  [64, 0, 64],
  [0, 0, 64],
];

describe("extractEmissiveSurfaces", () => {
  it("keeps only fullbright faces and swaps coords Quake→Babylon", () => {
    const bsp = makeBsp(
      [
        { tex: 0, first: 0, n: 4, normal: [0, -1, 0] }, // sign (fullbright)
        { tex: 1, first: 4, n: 4, normal: [1, 0, 0] }, // wall (not)
      ],
      [...WALL_QUAD, [200, 0, 0], [264, 0, 0], [264, 0, 64], [200, 0, 64]],
      ["sign", "wall"],
    );

    const out = extractEmissiveSurfaces(bsp, (name) => name === "sign");
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(s.textureName).toBe("sign");
    expect(s.position.asArray()).toEqual([32, 32, 0]); // Quake (32,0,32) → Babylon (32,32,0)
    expect(s.width).toBe(64);
    expect(s.height).toBe(64);
    expect(s.area).toBe(4096);
    // Quake normal (0,-1,0) → Babylon (0,0,-1).
    expect(s.normal.asArray()).toEqual([0, 0, -1]);
  });

  it("culls tiny fullbright specks below the min area", () => {
    const bsp = makeBsp(
      [{ tex: 0, first: 0, n: 4, normal: [0, -1, 0] }],
      [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 4],
        [0, 0, 4],
      ], // 4×4 = 16 area, below MIN
      ["glow"],
    );
    expect(extractEmissiveSurfaces(bsp, () => true)).toHaveLength(0);
  });

  it("ranks surfaces largest-first", () => {
    const bsp = makeBsp(
      [
        { tex: 0, first: 0, n: 4, normal: [0, -1, 0] }, // small 32×32
        { tex: 1, first: 4, n: 4, normal: [0, -1, 0] }, // big 128×128
      ],
      [
        [0, 0, 0],
        [32, 0, 0],
        [32, 0, 32],
        [0, 0, 32],
        [0, 0, 0],
        [128, 0, 0],
        [128, 0, 128],
        [0, 0, 128],
      ],
      ["small", "big"],
    );
    const out = extractEmissiveSurfaces(bsp, () => true);
    expect(out.map((s) => s.textureName)).toEqual(["big", "small"]);
  });
});
