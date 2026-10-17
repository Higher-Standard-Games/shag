import { describe, expect, it } from "vitest";
import { applyOperations, emptyDocument } from "../api/Operations";
import { brushFaceKeys, brushFaceMaterial, brushFaceNormal, brushFacePoints, brushFaceST } from "../BrushFaces";
import { asHull, cross, dot, hullWorldVertices, rotateBrush, subtract, validateHull } from "../ConvexBrush";
import { brushPlanes, clipBrush, reversePlane, subtractBrush } from "../ConvexCsg";
import { type BoxBrush, EditorDocument, validateDocument } from "../EditorDocument";
import { faceTexMatrix, naturalFace } from "../FaceUv";
import { writeMap } from "../MapWriter";

const box: BoxBrush = {
  id: "target",
  min: { x: -64, y: -64, z: -64 },
  max: { x: 64, y: 64, z: 64 },
  shader: "common/caulk",
  detail: true,
};
function volume(brush: BoxBrush) {
  const hull = asHull(brush),
    points = hullWorldVertices(hull),
    center = {
      x: (brush.min.x + brush.max.x) / 2,
      y: (brush.min.y + brush.max.y) / 2,
      z: (brush.min.z + brush.max.z) / 2,
    };
  let total = 0;
  for (const side of hull.hull!.sides)
    for (let i = 1; i + 1 < side.vertices.length; i++)
      total +=
        dot(
          subtract(points[side.vertices[0]], center),
          cross(subtract(points[side.vertices[i]], center), subtract(points[side.vertices[i + 1]], center)),
        ) / 6;
  return total;
}

describe("convex clipping and subtraction", () => {
  it("conserves volume for cutters rotated around all three axes", () => {
    for (let i = 1; i <= 24; i++) {
      let cutter: BoxBrush = { ...box, id: "cut", min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } };
      for (const [axis, factor] of [
        ["x", 7],
        ["y", 13],
        ["z", 19],
      ] as const)
        cutter = rotateBrush(cutter, axis, i * factor);
      const pieces = subtractBrush(box, cutter);
      pieces.forEach(validateHull);
      expect(pieces.reduce((sum, piece) => sum + volume(piece), 0)).toBeCloseTo(volume(box) - 32 ** 3, 4);
    }
  });
  it("splits oblique planes through vertices and edges into closed volume-conserving solids", () => {
    for (const normal of [
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 0.32, y: -0.71, z: 0.5 },
    ])
      for (const distance of [0, 32, -32]) {
        const plane = { normal, distance },
          back = clipBrush(box, plane)!,
          front = clipBrush(box, reversePlane(plane))!;
        validateHull(back);
        validateHull(front);
        expect(volume(back) + volume(front)).toBeCloseTo(volume(box), 5);
        for (const p of hullWorldVertices(asHull(back))) expect(dot(normal, p) - distance).toBeLessThan(1e-5);
        expect(back.detail).toBe(true);
      }
    expect(clipBrush(box, { normal: { x: 2, y: 0, z: 0 }, distance: 32 })!.max.x).toBeCloseTo(16);
  });
  it("preserves disjoint and tangent inputs, removes fully clipped brushes and rejects invalid planes", () => {
    expect(clipBrush(box, { normal: { x: 1, y: 0, z: 0 }, distance: 64 })).toEqual(box);
    expect(clipBrush(box, { normal: { x: 1, y: 0, z: 0 }, distance: -64 })).toBeNull();
    expect(() => clipBrush(box, { normal: { x: 0, y: 0, z: 0 }, distance: 0 })).toThrow(/nonzero/);
    expect(() => clipBrush(box, { normal: { x: 1, y: 0, z: 0 }, distance: NaN })).toThrow(/finite/);
  });
  it("keeps surviving world-space UVs and assigns an explicit cap material", () => {
    const source = rotateBrush(
      { ...box, faces: { "+Z": { ...naturalFace("metal/top", [256, 128]), rotation: 37, skew: 12, shift: [7, 19] } } },
      "y",
      27,
    );
    const cap = naturalFace("metal/cut", [128, 128]),
      result = clipBrush(source, { normal: { x: 1, y: 0, z: 0 }, distance: 0 }, cap)!;
    const sourceSide = brushFaceKeys(source).find((key) => brushFaceMaterial(source, key)?.shader === "metal/top")!;
    const resultSide = brushFaceKeys(result).find((key) => brushFaceMaterial(result, key)?.shader === "metal/top")!;
    const sourceNormal = brushFaceNormal(source, sourceSide),
      resultNormal = brushFaceNormal(result, resultSide);
    expect(dot(sourceNormal, resultNormal)).toBeCloseTo(1, 8);
    for (const point of brushFacePoints(result, resultSide)) {
      const before = brushFaceST(source, sourceSide, faceTexMatrix(brushFaceMaterial(source, sourceSide)!), point);
      const after = brushFaceST(result, resultSide, faceTexMatrix(brushFaceMaterial(result, resultSide)!), point);
      expect(after[0]).toBeCloseTo(before[0], 8);
      expect(after[1]).toBeCloseTo(before[1], 8);
    }
    expect(result.hull!.sides.some((side) => side.material?.shader === "metal/cut")).toBe(true);
  });
  it("subtracts actual rotated cutter geometry with disjoint fragments and conserved volume", () => {
    const cutter = rotateBrush(
      { ...box, id: "cutter", min: { x: -24, y: -16, z: -80 }, max: { x: 24, y: 16, z: 80 } },
      "z",
      33,
    );
    const pieces = subtractBrush(box, cutter);
    expect(pieces.length).toBeGreaterThan(2);
    pieces.forEach(validateHull);
    expect(pieces.reduce((sum, p) => sum + volume(p), 0)).toBeCloseTo(volume(box) - 48 * 32 * 128, 5);
    for (let x = -60; x <= 60; x += 12)
      for (let y = -60; y <= 60; y += 12) {
        const p = { x: x + 0.123, y: y + 0.321, z: 0 },
          inside = (b: BoxBrush) => brushPlanes(b).every((plane) => dot(plane.normal, p) < plane.distance - 1e-6);
        const count = pieces.filter(inside).length;
        expect(count).toBe(inside(cutter) ? 0 : 1);
      }
    expect(
      subtractBrush(box, { ...box, id: "full", min: { x: -80, y: -80, z: -80 }, max: { x: 80, y: 80, z: 80 } }),
    ).toEqual([]);
    expect(subtractBrush(box, { ...box, min: { x: 64, y: -64, z: -64 }, max: { x: 128, y: 64, z: 64 } })).toEqual([
      box,
    ]);
  });
  it("leaves overlapping AABBs alone when their convex interiors are disjoint", () => {
    const a = rotateBrush({ ...box, min: { x: -40, y: -2, z: 0 }, max: { x: 40, y: 2, z: 16 } }, "z", 45);
    const b = { ...a, id: "other", min: { ...a.min, y: a.min.y + 10 }, max: { ...a.max, y: a.max.y + 10 } };
    expect(subtractBrush(a, b)).toEqual([a]);
  });
  it("keeps deterministic fragment IDs, owners and editor groups, with atomic rejection and undo", () => {
    const data = emptyDocument();
    data.brushes = [box, { ...box, id: "other", min: { x: 100, y: 100, z: 0 }, max: { x: 128, y: 128, z: 16 } }];
    data.brushEntities = [{ id: "door", classname: "func_door", keys: {}, brushIds: ["target"] }];
    data.editorGroups = [{ id: "g", name: "Assembly", objectIds: ["target", "other"] }];
    const before = structuredClone(data),
      document = new EditorDocument(data);
    document.transact((draft) =>
      Object.assign(
        draft,
        applyOperations(draft, [
          { op: "brush.clip", id: "target", plane: { normal: { x: 1, y: 1, z: 0 }, distance: 0 }, keep: "both" },
        ]).doc,
      ),
    );
    const split = document.snapshot();
    validateDocument(split);
    expect(split.brushEntities![0].brushIds).toEqual(["target", "target-2"]);
    expect(split.editorGroups![0].objectIds).toEqual(["target", "target-2", "other"]);
    expect(writeMap(split)).toContain("brushDef");
    document.undo();
    expect(document.snapshot().brushes).toEqual(before.brushes);
    expect(() =>
      applyOperations(data, [{ op: "brush.clip", id: "target", plane: { normal: { x: 0, y: 0, z: 0 }, distance: 0 } }]),
    ).toThrow();
    expect(data).toEqual(before);
    const removed = applyOperations(data, [
      { op: "brush.clip", id: "target", plane: { normal: { x: 1, y: 0, z: 0 }, distance: -80 } },
    ]).doc;
    expect(removed.brushEntities).toEqual([]);
    expect(removed.editorGroups).toEqual([]);
  });
  it("carves convex brushes and uses brush.subtract targets without cutting unrelated objects", () => {
    const doc = emptyDocument();
    doc.brushes = [
      rotateBrush(box, "z", 20),
      { ...box, id: "cutter", min: { x: -8, y: -8, z: -80 }, max: { x: 8, y: 8, z: 80 } },
      { ...box, id: "unrelated" },
    ];
    const carved = applyOperations(doc, [
      { op: "brush.carve", min: { x: -8, y: -8, z: -80 }, max: { x: 8, y: 8, z: 80 } },
    ]).doc;
    validateDocument(carved);
    expect(carved.brushes.some((b) => b.id === "target-2")).toBe(true);
    const cut = applyOperations(doc, [
      { op: "brush.subtract", ids: ["target", "target"], cutterId: "cutter", removeCutter: true },
    ]).doc;
    validateDocument(cut);
    expect(cut.brushes.find((b) => b.id === "unrelated")).toEqual(doc.brushes[2]);
    expect(cut.brushes.some((b) => b.id === "cutter")).toBe(false);
    expect(() => applyOperations(doc, [{ op: "brush.subtract", ids: ["cutter"], cutterId: "cutter" }])).toThrow(
      /excluding/,
    );
  });
});
