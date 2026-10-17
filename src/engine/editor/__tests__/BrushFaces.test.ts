import { describe, expect, it } from "vitest";
import {
  brushFaceAxes,
  brushFaceKeys,
  brushFaceMaterial,
  brushFacePoints,
  brushFaceST,
  fitBrushFace,
  setBrushFaceMaterial,
  wrapBrushFaces,
} from "../BrushFaces";
import { asHull, prismBrush, rotateBrush } from "../ConvexBrush";
import type { BoxBrush } from "../EditorDocument";
import { faceTexMatrix, naturalFace } from "../FaceUv";

const box: BoxBrush = { id: "diagonal", min: { x: -64, y: -16, z: 0 }, max: { x: 64, y: 16, z: 64 }, shader: "base" };
const texture = naturalFace("metal", [128, 64]);
const closeST = (a: number[], b: number[]) =>
  a.forEach((value, i) => {
    expect(Math.abs(value - b[i] - Math.round(value - b[i]))).toBeLessThan(2e-5);
  });
describe("convex face alignment", () => {
  it("uses side indices and fits the actual diagonal polygon, with unchanged neighboring materials", () => {
    const brush = rotateBrush(box, "z", 37);
    expect(brushFaceKeys(brush)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(() => brushFaceMaterial(brush, "+X")).toThrow(/no longer/);
    const fitted = fitBrushFace(texture, brush, 2);
    setBrushFaceMaterial(brush, 2, fitted);
    expect(brushFaceMaterial(brush, 0)).toBeUndefined();
    const uv = brushFacePoints(brush, 2).map((p) => brushFaceST(brush, 2, faceTexMatrix(fitted), p));
    for (const axis of [0, 1]) {
      expect(Math.min(...uv.map((p) => p[axis]))).toBeCloseTo(0, 6);
      expect(Math.max(...uv.map((p) => p[axis]))).toBeCloseTo(1, 6);
    }
    expect(fitted.scale).not.toEqual([(brush.max.y - brush.min.y) / 128, (brush.max.x - brush.min.x) / 64]);
  });
  it.each([1, -1])("wraps rotated and mirrored textures continuously over adjacent edges (%s)", (sign) => {
    const brush = rotateBrush(box, "z", 31);
    setBrushFaceMaterial(brush, 1, { ...texture, scale: [0.5, 0.75 * sign], rotation: 27, shift: [11, 7] });
    const wrapped = wrapBrushFaces(brush, 1, [2, 3, 4, 5, 0]);
    expect(wrapped.size).toBe(6);
    const vertices = brush.hull!.sides[1].vertices;
    for (const side of [2, 3, 4, 5]) {
      const shared = vertices.filter((i) => brush.hull!.sides[side].vertices.includes(i));
      const points = brushFacePoints(brush, 1);
      for (const index of shared) {
        const p = points[vertices.indexOf(index)];
        closeST(
          brushFaceST(brush, 1, faceTexMatrix(brushFaceMaterial(brush, 1)!), p),
          brushFaceST(brush, side, faceTexMatrix(wrapped.get(side)!), p),
        );
      }
      expect(wrapped.get(side)!.scale[0]).toBeCloseTo(0.5, 5);
      expect(wrapped.get(side)!.scale[1]).toBeCloseTo(0.75 * sign, 5);
    }
  });
  it("unfolds arbitrary octagonal side angles with continuity on every BFS edge", () => {
    const brush = prismBrush(
      "octagon",
      Array.from({ length: 8 }, (_, i) => ({
        x: 64 * Math.cos((i * Math.PI) / 4),
        y: 64 * Math.sin((i * Math.PI) / 4),
      })),
      0,
      64,
      "base",
    );
    setBrushFaceMaterial(brush, 2, { ...texture, rotation: 18 });
    const result = wrapBrushFaces(brush, 2, [3, 4, 5, 6]);
    for (const [from, to] of [
      [2, 3],
      [3, 4],
    ]) {
      const side = brush.hull!.sides[from],
        shared = side.vertices.filter((i) => brush.hull!.sides[to].vertices.includes(i));
      const points = brushFacePoints(brush, from);
      for (const index of shared) {
        const point = points[side.vertices.indexOf(index)];
        closeST(
          brushFaceST(brush, from, faceTexMatrix(result.get(from)!), point),
          brushFaceST(brush, to, faceTexMatrix(result.get(to)!), point),
        );
      }
    }
    expect(brushFaceAxes(brush, 2)).toBeDefined();
  });
  it("retains the existing box alignment path", () => {
    const brush = structuredClone(box);
    setBrushFaceMaterial(brush, "+X", texture);
    expect(wrapBrushFaces(brush, "+X", ["+Y"]).get("+Y")?.shader).toBe("metal");
    expect(() => setBrushFaceMaterial(brush, 0, texture)).toThrow(/no longer/);
    expect(asHull(brush).hull!.sides.some((side) => side.material?.shader === "metal")).toBe(true);
  });
});
