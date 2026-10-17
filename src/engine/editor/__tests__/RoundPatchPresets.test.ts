import { describe, expect, it } from "vitest";
import { MapParser } from "../../loader/map/MapParser";
import { applyOperations, emptyDocument } from "../api/Operations";
import { cross, dot, subtract } from "../ConvexBrush";
import { EditorDocument, type PatchSurface, validateDocument } from "../EditorDocument";
import { writeMap } from "../MapWriter";
import type { PatchSweep } from "../PatchPresets";
import { type RoundPatchShape, roundPatches } from "../RoundPatchPresets";

const sweep: PatchSweep = { axes: { u: "x", v: "y", hidden: "z" }, start: [-32, -48], end: [32, 48], depth: [0, 96] };
const normal = (patch: PatchSurface) =>
  cross(
    subtract(patch.controlPoints[1][1], patch.controlPoints[1][0]),
    subtract(patch.controlPoints[2][0], patch.controlPoints[0][0]),
  );

describe("round patch presets", () => {
  it("builds capped and uncapped cylinders, tubes and cones with a closed position seam", () => {
    for (const [shape, count] of [
      ["cylinder", 3],
      ["tube", 4],
      ["cone", 2],
      ["cap", 1],
    ] as const) {
      const patches = roundPatches(shape, "common/caulk", sweep, shape)!;
      expect(patches).toHaveLength(count);
      const doc = emptyDocument();
      doc.patches = patches;
      validateDocument(doc);
      for (const patch of patches) {
        expect(patch).toMatchObject({ width: 9, height: 3 });
        for (const row of patch.controlPoints) {
          const { u: au, v: av, ...a } = row[0],
            { u: bu, v: bv, ...b } = row[8];
          expect(a).toEqual(b);
          expect([au, av, bu, bv].every(Number.isFinite)).toBe(true);
        }
      }
      const open = roundPatches(shape, "common/caulk", sweep, shape, { capped: false })!;
      expect(open).toHaveLength(shape === "tube" ? 2 : 1);
    }
    const cone = roundPatches("cone", "common/caulk", sweep, "cone")![0];
    expect(cone.controlPoints[2].every((point) => point.x === 0 && point.y === 0 && point.z === 96)).toBe(true);
  });
  it("uses consistent outward walls, inward tube walls and opposite caps in all orthographic frames", () => {
    for (const axes of [
      { u: "x", v: "y", hidden: "z" },
      { u: "x", v: "z", hidden: "y" },
      { u: "y", v: "z", hidden: "x" },
    ] as const) {
      const patches = roundPatches("tube", "common/caulk", { ...sweep, axes }, "tube")!;
      const radial = { x: 0, y: 0, z: 0 };
      radial[axes.u] = 1;
      const axial = { x: 0, y: 0, z: 0 };
      axial[axes.hidden] = 1;
      expect(dot(normal(patches[0]), radial)).toBeGreaterThan(0);
      expect(dot(normal(patches[1]), radial)).toBeLessThan(0);
      expect(dot(normal(patches[2]), axial)).toBeLessThan(0);
      expect(dot(normal(patches[3]), axial)).toBeGreaterThan(0);
      const reversed = roundPatches("tube", "common/caulk", { ...sweep, axes, reverse: true }, "tube")!;
      expect(dot(normal(reversed[0]), radial)).toBeLessThan(0);
    }
  });
  it("gives planar cap UVs, wall seam UVs and deterministic bounds for reversed drags/depth", () => {
    const patches = roundPatches("c", "common/caulk", sweep, "cylinder")!;
    expect(patches[0].controlPoints[0][0]).toMatchObject({ u: 0, v: 0 });
    expect(patches[0].controlPoints[0][8].u).toBe(1);
    for (const patch of patches.slice(1))
      for (const point of patch.controlPoints.flat()) {
        expect(point.u).toBeCloseTo((point.x + 32) / 64);
        expect(point.v).toBeCloseTo((point.y + 48) / 96);
      }
    expect(
      roundPatches("c", "common/caulk", { ...sweep, start: sweep.end, end: sweep.start, depth: [96, 0] }, "cylinder"),
    ).toEqual(patches);
    const cap = roundPatches("cap", "common/caulk", { ...sweep, depth: [16, 16] }, "cap")![0];
    expect(cap.controlPoints.flat().every((point) => point.z === 16)).toBe(true);
  });
  it("rejects invalid thickness, degenerate footprints and unsafe inputs atomically", () => {
    for (const thickness of [0, -1, 32, 48, NaN, Infinity])
      expect(roundPatches("t", "common/caulk", sweep, "tube", { thickness })).toBeNull();
    expect(roundPatches("t", "common/caulk", { ...sweep, depth: [0, 0] }, "tube")).toBeNull();
    expect(roundPatches("t", "common/caulk", { ...sweep, end: [-32, 48] }, "tube")).toBeNull();
    expect(roundPatches("t", "common/caulk", { ...sweep, end: [1_000_001, 48] }, "tube")).toBeNull();
    const doc = emptyDocument(),
      before = structuredClone(doc);
    expect(() =>
      applyOperations(doc, [
        { op: "patch.round", shape: "tube", min: { x: 0, y: 0, z: 0 }, max: { x: 16, y: 16, z: 32 }, thickness: 8 },
      ]),
    ).toThrow(/Invalid round/);
    expect(doc).toEqual(before);
  });
  it("exposes typed presets, optional assembly groups and deterministic map/parser recovery with undo", () => {
    for (const axis of ["x", "y", "z"] as const)
      for (const shape of ["cylinder", "tube", "cone", "cap"] as RoundPatchShape[]) {
        const doc = applyOperations(emptyDocument(), [
          {
            op: "patch.round",
            id: "round",
            axis,
            shape,
            min: { x: -64, y: -64, z: 0 },
            max: { x: 64, y: 64, z: 96 },
            shader: "common/caulk",
          },
        ]).doc;
        validateDocument(doc);
        expect(MapParser.parse(writeMap(doc))[0].patches).toHaveLength(doc.patches!.length);
        if (doc.patches!.length > 1) expect(doc.editorGroups![0].objectIds).toEqual(doc.patches!.map((p) => p.id));
      }
    const document = new EditorDocument();
    document.transact((draft) =>
      Object.assign(
        draft,
        applyOperations(draft, [
          { op: "patch.round", shape: "tube", min: { x: 0, y: 0, z: 0 }, max: { x: 64, y: 64, z: 64 }, group: false },
        ]).doc,
      ),
    );
    expect(document.snapshot().editorGroups).toBeUndefined();
    document.undo();
    expect(document.snapshot().patches).toEqual([]);
    const collision = emptyDocument();
    collision.entities.push({ id: "tube-inner", classname: "light", origin: { x: 0, y: 0, z: 0 }, keys: {} });
    expect(() =>
      applyOperations(collision, [
        { op: "patch.round", id: "tube", shape: "tube", min: { x: 0, y: 0, z: 0 }, max: { x: 64, y: 64, z: 64 } },
      ]),
    ).toThrow(/already exists/);
    expect(collision.patches).toEqual([]);
  });
});
