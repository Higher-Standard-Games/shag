import { describe, expect, it } from "vitest";
import { applyOperations, emptyDocument } from "../api/Operations";
import { brushVertices, editBrushVertices, vertexHit } from "../BrushVertexTools";
import { dot, polygonNormal, prismBrush, rotateBrush, validateHull } from "../ConvexBrush";
import { type BoxBrush, EditorDocument } from "../EditorDocument";
import { naturalFace } from "../FaceUv";

const box: BoxBrush = {
  id: "box",
  min: { x: 0, y: 0, z: 0 },
  max: { x: 64, y: 64, z: 64 },
  shader: "common/caulk",
  detail: true,
  faces: { "+Z": naturalFace("metal/top", [128, 128]) },
};
describe("brush vertex editing", () => {
  it("moves one box corner, splitting warped faces and keeping the top material", () => {
    const result = editBrushVertices(box, [{ index: 6, position: { x: 80, y: 80, z: 80 } }]);
    validateHull(result.brush);
    expect(result.brush.hull!.sides.length).toBeGreaterThan(6);
    expect(result.brush.max).toEqual({ x: 80, y: 80, z: 80 });
    expect(result.brush.detail).toBe(true);
    const points = brushVertices(result.brush);
    expect(
      result.brush.hull!.sides.filter((side) => side.material?.shader === "metal/top").length,
    ).toBeGreaterThanOrEqual(1);
    for (const side of result.brush.hull!.sides) {
      const n = polygonNormal(side.vertices.map((i) => points[i]));
      expect(points.every((p) => dot(n, p) - dot(n, points[side.vertices[0]]) < 1e-4)).toBe(true);
    }
    expect(brushVertices(box)[6]).toEqual({ x: 64, y: 64, z: 64 });
  });
  it("groups projected corners, preserves a planar extrusion and removes merged vertices", () => {
    expect(vertexHit(box, "x", "z", 64, 64, 2)).toEqual([5, 6]);
    const result = editBrushVertices(box, [
      { index: 5, position: { x: 32, y: 0, z: 64 } },
      { index: 6, position: { x: 32, y: 64, z: 64 } },
    ]);
    expect(result.brush.hull!.sides.length).toBe(6);
    validateHull(result.brush);
    const merged = editBrushVertices(box, [{ index: 0, position: { x: 64, y: 0, z: 0 } }]);
    expect(merged.brush.hull!.vertices.length).toBe(7);
    expect(merged.remap.filter((i) => i < 0)).toHaveLength(1);
  });
  it("rejects collapsed geometry and malformed edits atomically with ownership and undo preserved", () => {
    const doc = emptyDocument("vertexqa");
    doc.brushes = [structuredClone(box)];
    doc.brushEntities = [{ id: "group", classname: "func_group", keys: {}, brushIds: ["box"] }];
    const edits = brushVertices(box).map((p, index) => ({ index, position: { ...p, z: 0 } }));
    expect(() => applyOperations(doc, [{ op: "brush.vertices", id: "box", edits }])).toThrow(/plane/);
    expect(doc.brushes[0].hull).toBeUndefined();
    expect(() => editBrushVertices(box, [{ index: 99, position: { x: 0, y: 0, z: 0 } }])).toThrow(/index/);
    expect(() => editBrushVertices(box, [{ index: 0, position: { x: NaN, y: 0, z: 0 } }])).toThrow(/finite/);
    const document = new EditorDocument(doc);
    document.transact((draft) =>
      Object.assign(
        draft,
        applyOperations(draft, [
          { op: "brush.vertices", id: "box", edits: [{ index: 6, position: { x: 80, y: 80, z: 80 } }] },
        ]).doc,
      ),
    );
    expect(document.snapshot().brushEntities![0].brushIds).toEqual(["box"]);
    expect(document.snapshot().brushes[0].hull).toBeDefined();
    document.undo();
    expect(document.snapshot().brushes[0].hull).toBeUndefined();
    document.redo();
    expect(document.snapshot().brushes[0].hull).toBeDefined();
  });
  it("keeps rotated and repeatedly edited solids closed", () => {
    let current = rotateBrush(box, "z", 31);
    for (let step = 0; step < 20; step++) {
      const points = brushVertices(current),
        index = step % points.length;
      current = editBrushVertices(current, [
        {
          index,
          position: {
            x: points[index].x + Math.sin(step) * 8,
            y: points[index].y + Math.cos(step) * 8,
            z: points[index].z + 4,
          },
        },
      ]).brush;
      validateHull(current);
    }
  });
  it("reshapes a many-sided prism and preserves its translated planar faces", () => {
    const prism = prismBrush(
      "many",
      Array.from({ length: 32 }, (_, i) => ({
        x: 128 * Math.cos((i * Math.PI) / 16),
        y: 128 * Math.sin((i * Math.PI) / 16),
      })),
      0,
      64,
      "common/caulk",
    );
    const points = brushVertices(prism);
    const translated = editBrushVertices(
      prism,
      points.map((p, index) => ({ index, position: { x: p.x + 16, y: p.y - 8, z: p.z + 32 } })),
    ).brush;
    expect(translated.hull!.sides.length).toBe(34);
    validateHull(translated);
    const edited = editBrushVertices(translated, [
      { index: 40, position: { ...brushVertices(translated)[40], z: 80 } },
    ]).brush;
    validateHull(edited);
  });
});
