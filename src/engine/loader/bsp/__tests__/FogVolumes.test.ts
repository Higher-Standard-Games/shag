import { describe, expect, it } from "vitest";
import { parseShaderFile } from "../../shader/Q3ShaderParser";
import { brushHull, type FogPlane } from "../FogVolumes";

/** An axis-aligned box as six outward planes. */
const box = (min: number[], max: number[]): FogPlane[] => [
  [1, 0, 0, max[0]],
  [-1, 0, 0, -min[0]],
  [0, 1, 0, max[1]],
  [0, -1, 0, -min[1]],
  [0, 0, 1, max[2]],
  [0, 0, -1, -min[2]],
];

describe("brushHull", () => {
  it("closes a box with two triangles per side, wound outward", () => {
    const hull = brushHull(box([0, 0, 0], [64, 32, 16]))!;
    expect(hull.indices.length).toBe(6 * 2 * 3);
    const p = (i: number) => hull.positions.slice(i * 3, i * 3 + 3);
    for (let t = 0; t < hull.indices.length; t += 3) {
      const [a, b, c] = [p(hull.indices[t]), p(hull.indices[t + 1]), p(hull.indices[t + 2])];
      const e1 = b.map((v, i) => v - a[i]);
      const e2 = c.map((v, i) => v - a[i]);
      const normal = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const centre = [a, b, c].reduce((s, v) => s.map((x, i) => x + v[i] / 3), [0, 0, 0]);
      const outward = centre.map((x, i) => x - [32, 16, 8][i]);
      expect(normal.reduce((s, v, i) => s + v * outward[i], 0)).toBeGreaterThan(0);
    }
    const xs = hull.positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(64);
  });

  it("ignores a plane that cuts nothing off", () => {
    const planes = [...box([0, 0, 0], [16, 16, 16]), [1, 1, 0, 100] as FogPlane];
    expect(brushHull(planes)!.indices.length).toBe(6 * 2 * 3);
  });
});

describe("fogparms", () => {
  const fog = (line: string) => parseShaderFile(`textures/t/fog\n{\n surfaceparm fog\n ${line}\n}\n`)[0].fogParms;

  it("reads qfusion's clear distance", () => {
    expect(fog("fogparms ( .04 0.36 .04 ) 500 5")).toEqual({
      color: [0.04, 0.36, 0.04],
      depthForOpaque: 500,
      clearDist: 5,
    });
  });

  it("has no clear distance without one, and keeps it 128 short of opaque", () => {
    expect(fog("fogparms ( 1 1 1 ) 300")?.clearDist).toBe(0);
    expect(fog("fogparms ( 1 1 1 ) 300 250")?.clearDist).toBe(172);
    expect(fog("fogparms ( 1 1 1 ) 100 50")?.clearDist).toBe(0);
  });
});
