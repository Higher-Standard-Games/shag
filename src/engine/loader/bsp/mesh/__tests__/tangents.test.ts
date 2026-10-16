import { describe, expect, it } from "vitest";
import { buildBspTangents } from "../tangents";

describe("Qfusion BSP tangent frame", () => {
  it.each([
    { positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], normal: [0, 1, 0], expected: [1, 0, 0, 1] },
    { positions: [0, 0, 0, 1, 0, 0, 0, -1, 0], normal: [0, 0, 1], expected: [1, 0, 0, 1] },
  ])("keeps U and negative V for floor and wall normals", ({ positions, normal, expected }) => {
    const result = buildBspTangents(positions, [...normal, ...normal, ...normal], [0, 0, 1, 0, 0, 1], [0, 1, 2]);
    for (let i = 0; i < 3; i++)
      Array.from(result.slice(i * 4, i * 4 + 4)).forEach((v, k) => {
        expect(v).toBeCloseTo(expected[k]);
      });
    const reversed = buildBspTangents(positions, [...normal, ...normal, ...normal], [0, 0, 1, 0, 0, 1], [0, 2, 1]);
    expect(Array.from(reversed)).toEqual(Array.from(result));
  });
  it("retains mirrored UV handedness and a finite frame for collapsed UVs", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 0, 1],
      normals = [0, 1, 0, 0, 1, 0, 0, 1, 0];
    const mirrored = buildBspTangents(positions, normals, [0, 0, -1, 0, 0, 1], [0, 1, 2]);
    expect(mirrored[0]).toBeCloseTo(-1);
    expect(mirrored[3]).toBe(-1);
    const degenerate = buildBspTangents(positions, normals, [0, 0, 0, 0, 0, 0], [0, 1, 2]);
    expect(Array.from(degenerate).every(Number.isFinite)).toBe(true);
  });
});
