/**
 * The textured preview's geometry. faceST is checked against compiled BSPs
 * in FaceUv.test.ts (the WO-T0 measurements), so preview UVs that equal
 * faceST at every corner are the ST the game will draw on that face.
 */

import { describe, expect, it } from "vitest";
import type { BoxBrush, FaceKey } from "../EditorDocument";
import { FIXED_MATRIX, faceNormal, faceST, faceTexMatrix } from "../FaceUv";
import { faceCorners, shaderBatches } from "../TexturedPreview";

const brush = (id: string, patch: Partial<BoxBrush> = {}): BoxBrush => ({
  id,
  min: { x: -40, y: 16, z: 8 },
  max: { x: 88, y: 208, z: 72 },
  shader: "blx/blx_grid",
  ...patch,
});

describe("textured preview geometry", () => {
  it("puts a face's corners on its plane, spanning the brush", () => {
    const corners = faceCorners(brush("a"), "+Y");
    expect(corners.every((corner) => corner.y === 208)).toBe(true);
    expect(new Set(corners.map((corner) => `${corner.x},${corner.z}`))).toEqual(
      new Set(["-40,8", "88,8", "88,72", "-40,72"]),
    );
  });

  it("gives each corner the ST MakeBSP gives it, for overridden and fixed faces", () => {
    const rotated = {
      shader: "boqu/floor",
      shift: [5, 9] as [number, number],
      scale: [0.75, 0.25] as [number, number],
      rotation: 30,
      size: [256, 128] as [number, number],
    };
    const box = brush("a", { faces: { "+Z": rotated, "-X": { ...rotated, rotation: 0 } } });
    const batches = shaderBatches([box]);
    expect(batches.map((batch) => batch.shader)).toEqual(["boqu/floor", "blx/blx_grid"]);
    const expected = (keys: FaceKey[]) =>
      keys.flatMap((key) => {
        const face = box.faces?.[key];
        const matrix = face ? faceTexMatrix(face) : FIXED_MATRIX;
        return faceCorners(box, key).flatMap((corner) => faceST(key, matrix, corner));
      });
    expect(batches[0].uvs).toEqual(expected(["+Z", "-X"]));
    expect(batches[1].uvs).toEqual(expected(["-Z", "-Y", "+Y", "+X"]));
  });

  it("swaps Quake Z-up into Babylon Y-up for positions and normals", () => {
    const [batch] = shaderBatches([brush("a")]);
    // first face is +Z: its plane is Quake z = 72, Babylon y = 72, normal up
    const [x, y, z] = batch.positions;
    expect(y).toBe(72);
    expect([-40, 88]).toContain(x);
    expect([16, 208]).toContain(z);
    const up = faceNormal("+Z");
    expect(batch.normals.slice(0, 3)).toEqual([up.x, up.z, up.y]);
  });

  it("batches faces of many brushes by shader, two triangles per face", () => {
    const batches = shaderBatches([
      brush("a"),
      brush("b", { shader: "boqu/floor" }),
      brush("c", { min: { x: 0, y: 0, z: 0 }, max: { x: 16, y: 16, z: 16 } }),
    ]);
    expect(batches.map((batch) => [batch.shader, batch.positions.length / 12, batch.indices.length / 6])).toEqual([
      ["blx/blx_grid", 12, 12],
      ["boqu/floor", 6, 6],
    ]);
    const grid = batches[0];
    expect(Math.max(...grid.indices)).toBe(grid.positions.length / 3 - 1);
  });
});
