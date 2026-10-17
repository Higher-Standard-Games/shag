import { expect, it } from "vitest";
import type { BspFace, BspFile } from "../loader/bsp/BspLoader";
import { PatchTessellator } from "../physics/PatchTessellator";

it.each([0, 1, 2])("preserves constant patch coordinates and endpoints on Q3 axis %i", (axis) => {
  const vertices = [];
  for (const row of [0, 1, 2]) {
    for (const column of [0, 1, 2]) {
      const position = [0, 0, 0];
      position[axis] = 96;
      position[(axis + 1) % 3] = 8192 + column * 32;
      position[(axis + 2) % 3] = -8192 + row * 32;
      vertices.push({ position });
    }
  }
  const bsp = { vertices } as unknown as BspFile;
  const face = { firstVertex: 0, patchSize: [3, 3] } as BspFace;
  const mesh = PatchTessellator.buildPatch(bsp, face, 5)!;
  const babylonAxis = [0, 2, 1][axis];
  for (const vertex of mesh.vertices) expect(vertex.asArray()[babylonAxis]).toBe(96);
  for (const [index, control] of [
    [0, 0],
    [5, 2],
    [30, 6],
    [35, 8],
  ]) {
    const [x, y, z] = vertices[control].position;
    expect(mesh.vertices[index].asArray()).toEqual([x, z, y]);
  }
});
