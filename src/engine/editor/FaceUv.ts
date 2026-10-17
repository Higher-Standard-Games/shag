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

import { FACE_KEYS, type FaceKey, type FaceMaterial, type Vec3q } from "./EditorDocument";

export type TexMatrix = [[number, number, number], [number, number, number]];
type Box = { min: Vec3q; max: Vec3q };

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
 * shift (texels), scale (world units per texel), rotation/skew (degrees) and the
 * image size become the face matrix:
 * U uses angle θ; V uses θ + skew. Without skew the texture axes are orthogonal.
 */
export function faceTexMatrix(face: FaceMaterial): TexMatrix {
  const [w, h] = face.size;
  const [su, sv] = face.scale;
  const theta = (face.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const vTheta = theta + ((face.skew ?? 0) * Math.PI) / 180;
  return [
    [cos / (su * w), sin / (su * w), face.shift[0] / w],
    [-Math.sin(vTheta) / (sv * h), Math.cos(vTheta) / (sv * h), face.shift[1] / h],
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

/** Outward normal of a box face. */
export function faceNormal(key: FaceKey): Vec3q {
  const normal = { x: 0, y: 0, z: 0 };
  normal[key[1].toLowerCase() as keyof Vec3q] = key[0] === "+" ? 1 : -1;
  return normal;
}

/** The face's corners projected on its texture axes: the u and v ranges a texture has to cover. */
export function faceExtents(box: Box, key: FaceKey): { u: [number, number]; v: [number, number] } {
  const { texX, texY } = FACE_AXES[key];
  const us: number[] = [];
  const vs: number[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        us.push(dot({ x, y, z }, texX));
        vs.push(dot({ x, y, z }, texY));
      }
    }
  }
  return { u: [Math.min(...us), Math.max(...us)], v: [Math.min(...vs), Math.max(...vs)] };
}

const tidy = (value: number): number => Math.round(value * 1e6) / 1e6 || 0;
const wrap = (value: number, period: number): number => tidy(((value % period) + period) % period);

/**
 * The shift/scale/rotation that produce a face matrix, for an image of the
 * given size. Skew represents nonorthogonal axes and signed V scale carries
 * mirroring, so a general nonsingular affine matrix survives the conversion.
 * Shift is reduced to one image repeat and rotation to [0, 360).
 */
export function matrixToFace(matrix: TexMatrix, shader: string, size: [number, number]): FaceMaterial {
  const [w, h] = size;
  const [[a, b, c], [d, e, f]] = matrix;
  const precise = (value: number) => Number(value.toFixed(12)) || 0;
  const periodic = (value: number, period: number) => {
    const result = precise(((value % period) + period) % period);
    return result === period ? 0 : result;
  };
  const sign = a * e - b * d < 0 ? -1 : 1;
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  const vRotation = (Math.atan2(-d * sign, e * sign) * 180) / Math.PI;
  const skew = precise(((vRotation - rotation + 540) % 360) - 180);
  return {
    shader,
    shift: [periodic(c * w, w), periodic(f * h, h)],
    scale: [
      Number((1 / (w * Math.hypot(a, b))).toPrecision(13)),
      Number((sign / (h * Math.hypot(d, e))).toPrecision(13)),
    ],
    rotation: periodic(rotation, 360),
    ...(Math.abs(skew) > 1e-10 ? { skew } : {}),
    size,
  };
}

/** One repeat of the image across the face, unrotated, starting at its corner. */
export function fitFace(face: FaceMaterial, box: Box, key: FaceKey): FaceMaterial {
  const { u, v } = faceExtents(box, key);
  const [w, h] = face.size;
  const scale: [number, number] = [tidy((u[1] - u[0]) / w), tidy((v[1] - v[0]) / h)];
  return { ...face, rotation: 0, skew: 0, scale, shift: [wrap(-u[0] / scale[0], w), wrap(-v[0] / scale[1], h)] };
}

/**
 * The target face's alignment that continues the source face's texture over
 * their shared edge, as if the target were folded flat into the source's
 * plane around that edge. The faces must be adjacent (perpendicular) faces
 * of the same box; the result keeps the source's shader, size and scale.
 */
export function matchFace(box: Box, sourceKey: FaceKey, source: FaceMaterial, targetKey: FaceKey): FaceMaterial {
  if (sourceKey[1] === targetKey[1]) throw new Error(`Faces ${sourceKey} and ${targetKey} do not share an edge`);
  const ns = faceNormal(sourceKey);
  const nt = faceNormal(targetKey);
  const sourcePlane = dot(sourceKey[0] === "+" ? box.max : box.min, ns);
  const matrix = faceTexMatrix(source);
  // A target point d units from the source plane unfolds to d units past the edge, in the target's normal direction.
  const unfoldedST = (p: Vec3q): [number, number] => {
    const d = sourcePlane - dot(p, ns);
    return faceST(sourceKey, matrix, {
      x: p.x + d * (ns.x + nt.x),
      y: p.y + d * (ns.y + nt.y),
      z: p.z + d * (ns.z + nt.z),
    });
  };
  const { texX, texY } = FACE_AXES[targetKey];
  const p0 = targetKey[0] === "+" ? box.max : box.min;
  const st0 = unfoldedST(p0);
  const stU = unfoldedST({ x: p0.x + texX.x, y: p0.y + texX.y, z: p0.z + texX.z });
  const stV = unfoldedST({ x: p0.x + texY.x, y: p0.y + texY.y, z: p0.z + texY.z });
  const u0 = dot(p0, texX);
  const v0 = dot(p0, texY);
  const du: [number, number] = [stU[0] - st0[0], stU[1] - st0[1]];
  const dv: [number, number] = [stV[0] - st0[0], stV[1] - st0[1]];
  return matrixToFace(
    [
      [du[0], dv[0], st0[0] - du[0] * u0 - dv[0] * v0],
      [du[1], dv[1], st0[1] - du[1] * u0 - dv[1] * v0],
    ],
    source.shader,
    source.size,
  );
}

/**
 * Continues the source face's texture onto each target face, around as many
 * corners as it takes: an adjacent target is matched directly, the opposite
 * face through a face between them (a selected one first, so the texture
 * runs the way the mapper chose).
 */
export function wrapFaces(
  box: Box,
  sourceKey: FaceKey,
  source: FaceMaterial,
  targets: readonly FaceKey[],
): Partial<Record<FaceKey, FaceMaterial>> {
  const result: Partial<Record<FaceKey, FaceMaterial>> = {};
  for (const target of targets) {
    if (target === sourceKey) continue;
    if (target[1] !== sourceKey[1]) {
      result[target] = matchFace(box, sourceKey, source, target);
      continue;
    }
    const between = FACE_KEYS.filter((key) => key[1] !== sourceKey[1]).sort(
      (a, b) => Number(targets.includes(b)) - Number(targets.includes(a)),
    )[0];
    result[target] = matchFace(box, between, matchFace(box, sourceKey, source, between), target);
  }
  return result;
}

/** The box face a Quake-space normal points out of: its dominant axis and sign. */
export function faceKeyFromNormal(normal: Vec3q): FaceKey {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ax >= ay && ax >= az) return normal.x >= 0 ? "+X" : "-X";
  if (ay >= az) return normal.y >= 0 ? "+Y" : "-Y";
  return normal.z >= 0 ? "+Z" : "-Z";
}
