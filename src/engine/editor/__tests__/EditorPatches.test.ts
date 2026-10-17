import { describe, expect, it } from "vitest";
import { MapParser } from "../../loader/map/MapParser";
import { EditorDocument, type PatchSurface } from "../EditorDocument";
import { writeMap } from "../MapWriter";

const patch = (): PatchSurface => ({
  id: "patch-a",
  shader: "blx/blx_grid",
  width: 3,
  height: 3,
  controlPoints: [
    [
      { x: 1, y: 2, z: 3, u: 0.125, v: 0.25 },
      { x: 4, y: 5, z: 6, u: 0.5, v: 0.25 },
      { x: 7, y: 8, z: 9, u: 0.875, v: 0.25 },
    ],
    [
      { x: 10, y: 11, z: 14, u: 0.125, v: 0.5 },
      { x: 13, y: 15, z: 20, u: 0.5, v: 0.5 },
      { x: 17, y: 19, z: 21, u: 0.875, v: 0.5 },
    ],
    [
      { x: 22, y: 23, z: 24, u: 0.125, v: 0.75 },
      { x: 25, y: 26, z: 27, u: 0.5, v: 0.75 },
      { x: 28, y: 29, z: 30, u: 0.875, v: 0.75 },
    ],
  ],
});

describe("SHAGGED patch document and export", () => {
  it("preserves old v2 documents and exports native columns with row-major parser readback", () => {
    const old = new EditorDocument().snapshot();
    delete old.patches;
    const document = new EditorDocument(old);
    expect(document.snapshot().patches).toEqual([]);
    const oldSource = writeMap(old);
    expect(oldSource).toBe('{\n"classname" "worldspawn"\n}\n');
    expect(writeMap(document.snapshot())).toBe(oldSource);

    document.transact((draft) => draft.patches!.push(patch()));
    const source = writeMap(document.snapshot());
    expect(source).toContain("patchDef2\n{\nblx/blx_grid\n( 3 3 0 0 0 )");
    expect(source).toContain("( ( 1 2 3 0.125 0.25 ) ( 10 11 14 0.125 0.5 ) ( 22 23 24 0.125 0.75 ) )");
    expect(source).toContain("( ( 4 5 6 0.5 0.25 ) ( 13 15 20 0.5 0.5 ) ( 25 26 27 0.5 0.75 ) )");
    expect(source).toBe(writeMap({ ...document.snapshot(), patches: [patch()], revision: 99 }));
    const parsed = MapParser.parse(source);
    expect(parsed[0].patches).toHaveLength(1);
    expect(parsed[0].patches[0].controlPoints).toEqual(patch().controlPoints);

    document.undo();
    expect(document.snapshot().patches).toEqual([]);
    document.redo();
    expect(document.snapshot().patches).toEqual([patch()]);
  });

  it("orders mixed world geometry by ID regardless of insertion order", () => {
    const document = new EditorDocument();
    document.transact((draft) => {
      draft.brushes.push({
        id: "middle",
        min: { x: 0, y: 0, z: 0 },
        max: { x: 32, y: 32, z: 32 },
        shader: "blx/blx_grid",
      });
      draft.patches!.push({ ...patch(), id: "z-patch" }, { ...patch(), id: "a-patch" });
    });
    const source = writeMap(document.snapshot());
    expect(source.indexOf("patchDef2")).toBeLessThan(source.indexOf("brushDef"));
    expect(source.lastIndexOf("patchDef2")).toBeGreaterThan(source.indexOf("brushDef"));
    expect(source).toBe(writeMap({ ...document.snapshot(), patches: [...document.snapshot().patches!].reverse() }));
  });

  it("rejects malformed grids, duplicate IDs, and unsafe shaders without committing", () => {
    const document = new EditorDocument();
    for (const invalid of [
      { ...patch(), width: 4 },
      { ...patch(), controlPoints: [patch().controlPoints[0]] },
      { ...patch(), controlPoints: [[...patch().controlPoints[0].slice(0, 2)], ...patch().controlPoints.slice(1)] },
      {
        ...patch(),
        controlPoints: [
          [{ ...patch().controlPoints[0][0], x: Number.NaN }, ...patch().controlPoints[0].slice(1)],
          ...patch().controlPoints.slice(1),
        ],
      },
      { ...patch(), shader: "textures/blx/blx_grid" },
    ]) {
      expect(() => document.transact((draft) => draft.patches!.push(invalid))).toThrow();
      expect(document.snapshot().patches).toEqual([]);
    }
    expect(() => document.transact((draft) => draft.patches!.push(patch(), patch()))).toThrow(/Duplicate/);
    expect(document.snapshot().revision).toBe(0);
  });
});
