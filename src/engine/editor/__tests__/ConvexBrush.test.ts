import { describe, expect, it } from "vitest";
import { applyOperations, type EditOp, emptyDocument } from "../api/Operations";
import {
  asHull,
  fromWorldHull,
  hullWorldVertices,
  planeTextureAxes,
  prismBrush,
  rotateBrush,
  validateHull,
} from "../ConvexBrush";
import { type BoxBrush, EditorDocument, validateDocument } from "../EditorDocument";
import { FACE_AXES, faceNormal, naturalFace } from "../FaceUv";
import { writeMap } from "../MapWriter";
import { queryDocument } from "../server/DocumentInspection";

const box: BoxBrush = {
  id: "bridge",
  min: { x: -128, y: -16, z: 0 },
  max: { x: 128, y: 16, z: 16 },
  shader: "common/fullclip",
  detail: true,
  faces: { "+Z": naturalFace("metal/top", [256, 128]) },
};
const square = [
  { x: 0, y: 0 },
  { x: 64, y: 0 },
  { x: 64, y: 64 },
  { x: 0, y: 64 },
];
const prism = () => prismBrush("prism", square, 0, 64, "common/caulk");

describe("convex brush geometry", () => {
  it("rotates solid geometry around a chosen pivot, preserves materials and resizes through bounds", () => {
    const rotated = rotateBrush(box, "z", 45, { x: 0, y: 0, z: 0 });
    validateHull(rotated);
    expect(rotated.min.x).toBeCloseTo(-144 / Math.sqrt(2));
    expect(rotated.hull?.sides[1].material).toMatchObject({ shader: "metal/top", size: [256, 128], scale: [0.5, 0.5] });
    expect(box.hull).toBeUndefined();
    expect(rotated.detail).toBe(true);
    const resized = structuredClone(rotated);
    resized.max.z = 32;
    validateHull(resized);
    expect(Math.max(...hullWorldVertices(resized).map((p) => p.z))).toBe(32);
    for (const axis of ["x", "y", "z"] as const) validateHull(rotateBrush(box, axis, 27));
  });
  it("accepts either footprint winding and produces an octagonal prism", () => {
    expect(() => validateHull(prismBrush("cw", [...square].reverse(), 0, 64, "common/caulk"))).not.toThrow();
    const points = Array.from({ length: 8 }, (_, i) => ({
      x: 128 * Math.cos((i * Math.PI) / 4),
      y: 128 * Math.sin((i * Math.PI) / 4),
    }));
    const shape = prismBrush("octagon", points, 0, 16, "common/caulk");
    validateHull(shape);
    expect(shape.hull?.sides.length).toBe(10);
  });
  it("rejects open, inward, concave, nonplanar, duplicate and unused geometry", () => {
    const bad = [
      (b: BoxBrush) => {
        b.hull!.sides.pop();
      },
      (b: BoxBrush) => {
        b.hull!.sides[0].vertices.reverse();
      },
      (b: BoxBrush) => {
        b.hull!.vertices[0].z = 0.25;
      },
      (b: BoxBrush) => {
        b.hull!.vertices.push({ ...b.hull!.vertices[0] });
      },
      (b: BoxBrush) => {
        b.hull!.vertices.push({ x: 0.5, y: 0.5, z: 0.5 });
      },
      (b: BoxBrush) => {
        b.hull!.sides.push(structuredClone(b.hull!.sides[0]));
      },
      (b: BoxBrush) => {
        b.hull!.sides[0].vertices[0] = 999;
      },
    ];
    for (const edit of bad) {
      const b = prism();
      edit(b);
      expect(() => validateHull(b)).toThrow();
    }
    const concave = [
      { x: 0, y: 0 },
      { x: 64, y: 0 },
      { x: 32, y: 32 },
      { x: 64, y: 64 },
      { x: 0, y: 64 },
    ];
    expect(() => validateHull(prismBrush("bad", concave, 0, 64, "common/caulk"))).toThrow(/concave|convex/);
  });
  it("matches existing axis texture bases for all box normals", () => {
    for (const key of Object.keys(FACE_AXES) as Array<keyof typeof FACE_AXES>) {
      const axes = planeTextureAxes(faceNormal(key));
      for (const axis of ["x", "y", "z"] as const) {
        expect(axes.u[axis]).toBeCloseTo(FACE_AXES[key].texX[axis]);
        expect(axes.v[axis]).toBeCloseTo(FACE_AXES[key].texY[axis]);
      }
    }
  });
});

describe("convex authoring transactions", () => {
  it("round trips create, rotate, per-side materials, move, duplicate, ownership, queries and undo", () => {
    const hull = asHull(box);
    const vertices = hullWorldVertices(hull);
    const ops: EditOp[] = [
      { op: "convex.create", id: "solid", vertices, sides: hull.hull!.sides, shader: box.shader, detail: true },
      { op: "brush.rotate", id: "solid", axis: "z", degrees: 45 },
      { op: "face.material", id: "solid", faces: [0, 1], shader: "common/fullclip" },
      { op: "brushEntity.assign", id: "group", classname: "func_group", brushIds: ["solid"] },
      { op: "object.move", ids: ["group"], delta: { x: 300, y: 0, z: 0 } },
      { op: "object.duplicate", ids: ["solid"], delta: { x: 0, y: 300, z: 0 } },
    ];
    const initial = emptyDocument("convex_test");
    const result = applyOperations(initial, ops).doc;
    validateDocument(JSON.parse(JSON.stringify(result)));
    expect(result.brushes.length).toBe(2);
    expect(result.brushEntities![0].brushIds).toEqual(["solid"]);
    const query = queryDocument(result, { ids: ["solid"] });
    expect(query.objects[0].ownerId).toBe("group");
    expect(query.objects[0].bounds?.min.x).toBeCloseTo(300 - 144 / Math.sqrt(2));
    const editor = new EditorDocument(initial);
    editor.transact((draft) => Object.assign(draft, result));
    editor.undo();
    expect(editor.snapshot().brushes).toEqual([]);
    editor.redo();
    expect(writeMap(editor.snapshot())).toBe(writeMap(result));
    const deleted = applyOperations(result, [{ op: "object.delete", ids: ["solid", "solid-copy"] }]).doc;
    expect(deleted.brushes).toEqual([]);
    expect(deleted.brushEntities).toEqual([]);
  });
  it("rejects carving through a hull atomically while allowing a disjoint cut", () => {
    const doc = applyOperations(emptyDocument(), [
      { op: "gen.prism", id: "p", footprint: square, bottom: 0, top: 64, shader: "common/caulk" },
    ]).doc;
    const source = writeMap(doc);
    expect(() =>
      applyOperations(doc, [{ op: "brush.carve", min: { x: 8, y: 8, z: 0 }, max: { x: 32, y: 32, z: 64 } }]),
    ).toThrow(/Cannot carve convex/);
    expect(writeMap(doc)).toBe(source);
    expect(() =>
      applyOperations(doc, [{ op: "brush.carve", min: { x: 100, y: 100, z: 0 }, max: { x: 200, y: 200, z: 64 } }]),
    ).not.toThrow();
  });
  it("retains caller data isolation and rejects malformed batches", () => {
    const p = prism();
    const vertices = hullWorldVertices(p);
    const sides = p.hull!.sides;
    const result = applyOperations(emptyDocument(), [
      { op: "convex.create", vertices, sides, shader: "common/caulk" },
    ]).doc;
    vertices[0].x = 999;
    sides[0].vertices.reverse();
    expect(() => validateDocument(result)).not.toThrow();
    expect(() => fromWorldHull("bad", [{ x: 0, y: 0, z: 0 }], [], "common/caulk")).toThrow();
    const before = emptyDocument();
    expect(() =>
      applyOperations(before, [
        { op: "gen.prism", id: "ok", footprint: square, bottom: 0, top: 16 },
        { op: "brush.rotate", id: "ok", axis: "z", degrees: NaN },
      ]),
    ).toThrow();
    expect(before.brushes).toEqual([]);
  });
});
