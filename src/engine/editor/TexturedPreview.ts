/**
 * Geometry for the textured 3D preview: every brush face as a quad, batched
 * by shader so a map draws in one call per texture. UVs are the ST MakeBSP
 * will give the face (FaceUv.ts), used as-is: the engine draws BSP ST
 * unflipped on textures uploaded top row first, and so does the preview.
 * Positions are Babylon's (Y up); the document is Quake (Z up).
 */

import type { BoxBrush, FaceKey, Vec3q } from "./EditorDocument";
import { FIXED_MATRIX, faceNormal, faceST, faceTexMatrix } from "./FaceUv";

export interface ShaderBatch {
  shader: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

const FACE_ORDER: readonly FaceKey[] = ["+Z", "-Z", "-Y", "+Y", "-X", "+X"];

/** The face's four corners in Quake space, in order around the quad. */
export function faceCorners(brush: { min: Vec3q; max: Vec3q }, key: FaceKey): Vec3q[] {
  const axis = key[1].toLowerCase() as keyof Vec3q;
  const plane = key[0] === "+" ? brush.max[axis] : brush.min[axis];
  const [a, b] = (["x", "y", "z"] as const).filter((item) => item !== axis);
  const corner = (ua: number, ub: number): Vec3q => {
    const point = { x: 0, y: 0, z: 0 };
    point[axis] = plane;
    point[a] = ua;
    point[b] = ub;
    return point;
  };
  return [
    corner(brush.min[a], brush.min[b]),
    corner(brush.max[a], brush.min[b]),
    corner(brush.max[a], brush.max[b]),
    corner(brush.min[a], brush.max[b]),
  ];
}

/** Every face of every brush, grouped by the shader it draws, in first-seen order. */
export function shaderBatches(brushes: readonly BoxBrush[]): ShaderBatch[] {
  const batches = new Map<string, ShaderBatch>();
  for (const brush of brushes) {
    for (const key of FACE_ORDER) {
      const face = brush.faces?.[key];
      const shader = face?.shader ?? brush.shader;
      const matrix = face ? faceTexMatrix(face) : FIXED_MATRIX;
      let batch = batches.get(shader);
      if (!batch) {
        batch = { shader, positions: [], normals: [], uvs: [], indices: [] };
        batches.set(shader, batch);
      }
      const base = batch.positions.length / 3;
      const n = faceNormal(key);
      for (const corner of faceCorners(brush, key)) {
        batch.positions.push(corner.x, corner.z, corner.y);
        batch.normals.push(n.x, n.z, n.y);
        batch.uvs.push(...faceST(key, matrix, corner));
      }
      batch.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return [...batches.values()];
}
