/**
 * Box-face texture alignment, as MakeBSP reads it from a `brushDef` face.
 *
 * Measured from compiled BSPs (docs/research/SHAGGED.md, WO-T0 results):
 * MakeBSP computes st = M · [p·texX, p·texY, 1], where M is the face's 2×3
 * matrix and (texX, texY) is q3map2's ComputeAxisBase basis for the face
 * normal. ST is normalised (1.0 is one repeat of the image), so the image's
 * pixel size only enters through how a matrix is built from shift/scale.
 * Export and the textured preview both go through this module.
 */

import type { FaceKey, FaceMaterial, Vec3q } from "./EditorDocument";

export type TexMatrix = [[number, number, number], [number, number, number]];

/** The matrix every face got before per-face materials: one repeat per 32 units, whatever the image size. */
export const FIXED_MATRIX: TexMatrix = [
  [0.03125, 0, 0],
  [0, 0.03125, 0],
];

/** The Washoi gamepack's default_scale: 0.5 world units per texel. */
export const NATURAL_SCALE = 0.5;

/** texX/texY per box face, as measured from MakeBSP output. */
export const FACE_AXES: Readonly<Record<FaceKey, { texX: Vec3q; texY: Vec3q }>> = {
  "+X": { texX: { x: 0, y: 1, z: 0 }, texY: { x: 0, y: 0, z: -1 } },
  "-X": { texX: { x: 0, y: -1, z: 0 }, texY: { x: 0, y: 0, z: -1 } },
  "+Y": { texX: { x: -1, y: 0, z: 0 }, texY: { x: 0, y: 0, z: -1 } },
  "-Y": { texX: { x: 1, y: 0, z: 0 }, texY: { x: 0, y: 0, z: -1 } },
  "+Z": { texX: { x: 0, y: 1, z: 0 }, texY: { x: 1, y: 0, z: 0 } },
  "-Z": { texX: { x: 0, y: 1, z: 0 }, texY: { x: -1, y: 0, z: 0 } },
};

/**
 * shift (texels), scale (world units per texel), rotation (degrees) and the
 * image size become the face matrix:
 * [[cosθ/(su·w), sinθ/(su·w), shiftU/w], [−sinθ/(sv·h), cosθ/(sv·h), shiftV/h]].
 */
export function faceTexMatrix(face: FaceMaterial): TexMatrix {
  const [w, h] = face.size;
  const [su, sv] = face.scale;
  const theta = (face.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [
    [cos / (su * w), sin / (su * w), face.shift[0] / w],
    [-sin / (sv * h), cos / (sv * h), face.shift[1] / h],
  ];
}

/** A face with the gamepack's default alignment: natural scale, no shift, no rotation. */
export function naturalFace(shader: string, size: [number, number]): FaceMaterial {
  return { shader, shift: [0, 0], scale: [NATURAL_SCALE, NATURAL_SCALE], rotation: 0, size };
}

const dot = (a: Vec3q, b: Vec3q): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** The normalised texture coordinate MakeBSP will give a point on a face. */
export function faceST(key: FaceKey, matrix: TexMatrix, point: Vec3q): [number, number] {
  const { texX, texY } = FACE_AXES[key];
  const u = dot(point, texX);
  const v = dot(point, texY);
  return [matrix[0][0] * u + matrix[0][1] * v + matrix[0][2], matrix[1][0] * u + matrix[1][1] * v + matrix[1][2]];
}
