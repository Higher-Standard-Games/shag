import { describe, expect, it } from "vitest";
import { applyOperations, emptyDocument } from "../api/Operations";
import { type brushFaceKeys, brushFaceMaterial, brushFaceST } from "../BrushFaces";
import { brushVertices, editBrushVertices } from "../BrushVertexTools";
import { asHull, rotateBrush } from "../ConvexBrush";
import { resizeBox } from "../EditorBoxTools";
import { type BoxBrush, EditorDocument, FACE_KEYS, validateDocument } from "../EditorDocument";
import { moveBox } from "../EditorGesture";
import { FIXED_MATRIX, faceTexMatrix, matrixToFace, naturalFace } from "../FaceUv";
import { writeMap } from "../MapWriter";
import { shaderBatches } from "../TexturedPreview";
import { lockBrushBounds } from "../TextureLock";

const box: BoxBrush = {
  id: "locked",
  min: { x: -64, y: -32, z: 16 },
  max: { x: 64, y: 32, z: 80 },
  shader: "base",
  faces: Object.fromEntries(
    FACE_KEYS.map((key) => [
      key,
      {
        ...naturalFace(`side/${key.replace("+", "p").replace("-", "n")}`, [256, 128]),
        rotation: 23,
        scale: [-0.5, 0.75],
        shift: [13, 29],
      },
    ]),
  ),
};
const close = (a: number[], b: number[]) =>
  a.forEach((value, i) => {
    const d = value - b[i];
    expect(Math.abs(d - Math.round(d))).toBeLessThan(2e-7);
  });
const uv = (brush: BoxBrush, key: ReturnType<typeof brushFaceKeys>[number], p: { x: number; y: number; z: number }) =>
  brushFaceST(
    brush,
    key,
    brushFaceMaterial(brush, key) ? faceTexMatrix(brushFaceMaterial(brush, key)!) : FIXED_MATRIX,
    p,
  );
function corresponding(before: BoxBrush, after: BoxBrush) {
  const old = asHull(before),
    next = asHull(after),
    oldPoints = brushVertices(old),
    newPoints = brushVertices(next);
  old.hull!.sides.forEach((side, i) => {
    side.vertices.forEach((index) => {
      const oldKey = before.hull ? i : (["-Z", "+Z", "-Y", "+Y", "-X", "+X"][i] as (typeof FACE_KEYS)[number]);
      const newKey = after.hull ? i : oldKey;
      close(uv(before, oldKey, oldPoints[index]), uv(after, newKey, newPoints[index]));
    });
  });
}
describe("brush texture locking", () => {
  it.each([
    "x",
    "y",
    "z",
  ] as const)("locks mirrored textures through rotation about %s with an off-center pivot", (axis) => {
    const after = rotateBrush(box, axis, 37, { x: 17, y: -11, z: 123 });
    corresponding(box, after);
    const restored = rotateBrush(after, axis, -37, { x: 17, y: -11, z: 123 });
    corresponding(box, restored);
    expect(restored.hull!.sides.every((s) => s.material?.sizeKnown !== false)).toBe(true);
  });
  it("locks move/resize previews and nonuniform hull bounds with shear", () => {
    corresponding(box, moveBox(box, { u: "x", v: "z", hidden: "y" }, 31, -19));
    corresponding(box, resizeBox(box, { faces: [{ axis: "x", side: "max" }] }, { x: 192 }, 8));
    const rotated = rotateBrush(box, "z", 31),
      after = structuredClone(rotated);
    after.max.x += 123;
    after.min.z -= 37;
    const locked = lockBrushBounds(rotated, after);
    corresponding(rotated, locked);
    expect(locked.hull!.sides.some((side) => Math.abs(side.material?.skew ?? 0) > 1)).toBe(true);
    const doc = emptyDocument();
    doc.brushes = [locked];
    validateDocument(doc);
    expect(shaderBatches([locked]).every((b) => b.uvs.every(Number.isFinite))).toBe(true);
    expect(writeMap(doc)).toContain("brushDef");
  });
  it("preserves legacy fixed UVs without inventing known image dimensions", () => {
    const legacy = { ...box, faces: undefined };
    const rotated = rotateBrush(legacy, "y", 19);
    corresponding(legacy, rotated);
    expect(rotated.hull!.sides.every((side) => side.material?.sizeKnown === false)).toBe(true);
    corresponding(legacy, moveBox(legacy, { u: "x", v: "y", hidden: "z" }, 17, 23));
  });
  it("keeps old corner UVs on triangles split by a free vertex edit", () => {
    const before = asHull(box),
      points = brushVertices(before);
    const result = editBrushVertices(before, [{ index: 6, position: { ...points[6], z: 112 } }]);
    const after = result.brush,
      newPoints = brushVertices(after);
    after.hull!.sides.forEach((side, sideIndex) => {
      if (side.material?.shader !== box.faces!["+Z"]!.shader) return;
      for (const newIndex of side.vertices) {
        const original = result.remap.indexOf(newIndex);
        if ([4, 5, 6, 7].includes(original))
          close(uv(before, 1, points[original]), uv(after, sideIndex, newPoints[newIndex]));
      }
    });
    expect(after.hull!.sides.filter((s) => s.material?.shader === box.faces!["+Z"]!.shader).length).toBeGreaterThan(1);
  });
  it("locks API moves, bounds updates and owned brush duplication with undo", () => {
    const doc = emptyDocument();
    doc.brushes = [structuredClone(box)];
    doc.brushEntities = [{ id: "g", classname: "func_group", keys: {}, brushIds: [box.id] }];
    const moved = applyOperations(doc, [{ op: "object.move", ids: ["g"], delta: { x: 9, y: 13, z: 5 } }]).doc;
    corresponding(box, moved.brushes[0]);
    const copied = applyOperations(moved, [{ op: "object.duplicate", ids: ["g"], delta: { x: 19, y: 23, z: 31 } }]).doc;
    corresponding(moved.brushes[0], copied.brushes.find((b) => b.id !== box.id)!);
    const updated = applyOperations(doc, [{ op: "box.update", id: box.id, max: { x: 192, y: 96, z: 144 } }]).doc;
    corresponding(box, updated.brushes[0]);
    const document = new EditorDocument(doc);
    document.transact((draft) => Object.assign(draft, updated));
    document.undo();
    expect(document.snapshot().brushes[0]).toEqual(box);
  });
  it("round-trips a mirrored sheared matrix and rejects singular skew", () => {
    const face = {
      ...naturalFace("test/tex", [256, 128]),
      skew: 24,
      rotation: 38,
      scale: [-0.3, 0.7] as [number, number],
    };
    const matrix = faceTexMatrix(face),
      roundTrip = faceTexMatrix(matrixToFace(matrix, face.shader, face.size));
    matrix.forEach((row, i) => {
      row.forEach((v, j) => {
        expect(roundTrip[i][j]).toBeCloseTo(v, 11);
      });
    });
    const doc = emptyDocument();
    doc.brushes = [{ ...box, faces: { "+Z": { ...face, skew: 90 } } }];
    expect(() => validateDocument(doc)).toThrow(/skew/);
  });
});
