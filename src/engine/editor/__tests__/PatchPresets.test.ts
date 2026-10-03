import { describe, expect, it } from "vitest";
import { MapParser } from "../../loader/map/MapParser";
import { EditorDocument } from "../EditorDocument";
import { writeMap } from "../MapWriter";
import { archPatch, bevelPatch, type PatchSweep } from "../PatchPresets";

const xy: PatchSweep = {
  axes: { u: "x", v: "y", hidden: "z" },
  start: [64, 32],
  end: [0, 0],
  depth: [48, 16],
};

describe("SHAGGED patch presets", () => {
  it("makes outer and inner quarter turns with the same boundary and opposite bulges", () => {
    const outer = bevelPatch("bevel", "blx/blx_grid", xy)!;
    const inner = bevelPatch("bevel", "blx/blx_grid", xy, "inner")!;
    expect(outer).toMatchObject({ width: 3, height: 3 });
    expect(outer.controlPoints[0][0]).toEqual({ x: 0, y: 0, z: 16, u: 0, v: 0 });
    expect(outer.controlPoints[2][2]).toEqual({ x: 64, y: 32, z: 48, u: 1, v: 1 });
    expect(outer.controlPoints[1][1]).toMatchObject({ x: 64, y: 0, z: 32 });
    expect(inner.controlPoints[1][1]).toMatchObject({ x: 0, y: 32, z: 32 });
    expect(inner.controlPoints[1][0]).toEqual(outer.controlPoints[1][0]);
    expect(inner.controlPoints[1][2]).toEqual(outer.controlPoints[1][2]);
    expect(bevelPatch("bevel", "blx/blx_grid", { ...xy, start: xy.end, end: xy.start })).toEqual(outer);
  });

  it("makes a two-span arch along another orthographic plane and reverses winding", () => {
    const xz: PatchSweep = {
      axes: { u: "x", v: "z", hidden: "y" },
      start: [-64, 0],
      end: [64, 96],
      depth: [-16, 16],
    };
    const arch = archPatch("arch", "blx/blx_grid", xz)!;
    expect(arch).toMatchObject({ width: 5, height: 3 });
    expect(arch.controlPoints[0].map(({ x, y, z }) => [x, y, z])).toEqual([
      [-64, -16, 0],
      [-64, -16, 96],
      [0, -16, 96],
      [64, -16, 96],
      [64, -16, 0],
    ]);
    expect(arch.controlPoints[1][2]).toEqual({ x: 0, y: 0, z: 96, u: 0.5, v: 0.5 });
    const reversed = archPatch("arch", "blx/blx_grid", { ...xz, reverse: true })!;
    expect(reversed.controlPoints[0]).toEqual(arch.controlPoints[2]);
    expect(reversed.controlPoints[2]).toEqual(arch.controlPoints[0]);
  });

  it("rejects degenerate or unsafe bounds before they enter the document", () => {
    expect(bevelPatch("b", "blx/blx_grid", { ...xy, depth: [0, 0] })).toBeNull();
    expect(archPatch("a", "blx/blx_grid", { ...xy, end: [0, 32] })).toBeNull();
    expect(archPatch("a", "blx/blx_grid", { ...xy, depth: [Number.NaN, 16] })).toBeNull();
    expect(archPatch("a", "blx/blx_grid", { ...xy, end: [1_000_001, 32] })).toBeNull();
    expect(archPatch("a", "blx/blx_grid", { ...xy, axes: { u: "x", v: "x", hidden: "z" } })).toBeNull();
  });

  it("produces valid deterministic map source and preserves both grids through parser readback", () => {
    const document = new EditorDocument();
    document.transact((data) => {
      data.patches!.push(archPatch("arch", "blx/blx_grid", xy)!, bevelPatch("bevel", "blx/blx_grid", xy)!);
    });
    const source = writeMap(document.snapshot());
    expect(source).toBe(writeMap({ ...document.snapshot(), patches: [...document.snapshot().patches!].reverse() }));
    const parsed = MapParser.parse(source);
    expect(parsed[0].patches).toHaveLength(2);
    expect(parsed[0].patches[0].controlPoints).toEqual(archPatch("arch", "blx/blx_grid", xy)!.controlPoints);
    expect(parsed[0].patches[1].controlPoints).toEqual(bevelPatch("bevel", "blx/blx_grid", xy)!.controlPoints);
    document.undo();
    expect(document.snapshot().patches).toEqual([]);
  });
});
