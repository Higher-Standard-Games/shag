import { describe, expect, it } from "vitest";
import { flatPatch, movedPatchControl, patchControlHit } from "../PatchGeometry";

const xy = { u: "x", v: "y", hidden: "z" } as const;
const xz = { u: "x", v: "z", hidden: "y" } as const;

describe("patch control dragging geometry", () => {
  it("picks a nearby control and uses the inspector selection to resolve projected overlaps", () => {
    const patch = flatPatch("p", xy, [0, 0], [64, 64], 16, "blx/blx_grid")!;
    expect(patchControlHit(patch, xy, 32, 32, 8)).toBe(4);
    expect(patchControlHit(patch, xy, 32, 0, 32, 4)).toBe(1);
    expect(patchControlHit(patch, xy, 47, 47, 8)).toBeNull();
    // All three rows have the same X/Z projection. The chosen row remains draggable in XZ.
    expect(patchControlHit(patch, xz, 32, 16, 8)).toBe(1);
    expect(patchControlHit(patch, xz, 32, 16, 8, 7)).toBe(7);
  });

  it("moves only two visible axes on a copy, preserving depth, UVs, and the source", () => {
    const patch = flatPatch("p", xy, [0, 0], [64, 64], 16, "blx/blx_grid")!;
    const moved = movedPatchControl(patch, 4, xz, 48, 32);
    expect(moved.controlPoints[1][1]).toEqual({ x: 48, y: 32, z: 32, u: 0.5, v: 0.5 });
    expect(moved.controlPoints[1][0]).toEqual(patch.controlPoints[1][0]);
    expect(patch.controlPoints[1][1]).toEqual({ x: 32, y: 32, z: 16, u: 0.5, v: 0.5 });
  });
});
