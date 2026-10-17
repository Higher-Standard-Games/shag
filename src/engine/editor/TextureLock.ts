import { asHull, dot, hullWorldVertices, planeTextureAxes, polygonNormal } from "./ConvexBrush";
import type { BoxBrush, FaceKey, FaceMaterial, Vec3q } from "./EditorDocument";
import { FACE_AXES, FIXED_MATRIX, faceTexMatrix, matrixToFace, type TexMatrix } from "./FaceUv";

type Basis = { u: Vec3q; v: Vec3q };
const axes = (points: readonly Vec3q[]): Basis => planeTextureAxes(polygonNormal(points));
const st = (p: Vec3q, basis: Basis, matrix: TexMatrix): [number, number] => {
  const u = dot(p, basis.u),
    v = dot(p, basis.v);
  return [matrix[0][0] * u + matrix[0][1] * v + matrix[0][2], matrix[1][0] * u + matrix[1][1] * v + matrix[1][2]];
};

/** Three stable UV anchors define an affine face mapping; new facets fall back to one anchored mapping. */
export function lockFaceTexture(
  material: FaceMaterial | undefined,
  shader: string,
  oldPlane: readonly Vec3q[],
  oldPoints: readonly Vec3q[],
  newPoints: readonly Vec3q[],
  oldBasis = axes(oldPlane),
  newBasis = axes(newPoints),
): FaceMaterial {
  if (oldPoints.length !== newPoints.length || newPoints.length < 3)
    throw new Error("Texture lock needs corresponding face points");
  const matrix = material ? faceTexMatrix(material) : FIXED_MATRIX;
  const uv = oldPoints.map((p) => st(p, oldBasis, matrix));
  const projected = newPoints.map((p) => ({ u: dot(p, newBasis.u), v: dot(p, newBasis.v) }));
  let chosen: [number, number, number] | null = null,
    area = 0;
  for (let a = 0; a < projected.length; a++)
    for (let b = a + 1; b < projected.length; b++)
      for (let c = b + 1; c < projected.length; c++) {
        const p = projected[a],
          q = projected[b],
          r = projected[c];
        const det = (q.u - p.u) * (r.v - p.v) - (q.v - p.v) * (r.u - p.u);
        const uvDet = (uv[b][0] - uv[a][0]) * (uv[c][1] - uv[a][1]) - (uv[b][1] - uv[a][1]) * (uv[c][0] - uv[a][0]);
        if (Math.abs(det) > area && Math.abs(uvDet) > 1e-12) {
          chosen = [a, b, c];
          area = Math.abs(det);
        }
      }
  let next: TexMatrix;
  if (chosen) {
    const [a, b, c] = chosen,
      p = projected[a],
      q = projected[b],
      r = projected[c];
    const x = q.u - p.u,
      y = q.v - p.v,
      z = r.u - p.u,
      w = r.v - p.v,
      det = x * w - y * z;
    next = [0, 1].map((i) => {
      const bDelta = uv[b][i] - uv[a][i],
        cDelta = uv[c][i] - uv[a][i];
      const u = (bDelta * w - cDelta * y) / det,
        v = (cDelta * x - bDelta * z) / det;
      return [u, v, uv[a][i] - u * p.u - v * p.v];
    }) as TexMatrix;
  } else {
    next = matrix.map((row, i) => [
      row[0],
      row[1],
      uv[0][i] - row[0] * projected[0].u - row[1] * projected[0].v,
    ]) as TexMatrix;
  }
  const result = matrixToFace(next, material?.shader ?? shader, material?.size ?? [64, 64]);
  if (!material || material.sizeKnown === false) result.sizeKnown = false;
  return result;
}

/** Same topology, different vertex positions (rotation or world-axis bounds scaling/translation). */
export function lockBrushCorrespondence(source: BoxBrush, target: BoxBrush): BoxBrush {
  const before = asHull(source),
    after = asHull(target),
    oldVertices = hullWorldVertices(before),
    newVertices = hullWorldVertices(after);
  const boxKeys: FaceKey[] = ["-Z", "+Z", "-Y", "+Y", "-X", "+X"];
  const result = structuredClone(target);
  before.hull!.sides.forEach((side, index) => {
    const oldPoints = side.vertices.map((i) => oldVertices[i]);
    const newPoints = after.hull!.sides[index].vertices.map((i) => newVertices[i]);
    const oldKey = boxKeys[index],
      newKey = boxKeys[index];
    const oldBasis = source.hull ? axes(oldPoints) : { u: FACE_AXES[oldKey].texX, v: FACE_AXES[oldKey].texY };
    const newBasis = target.hull ? axes(newPoints) : { u: FACE_AXES[newKey].texX, v: FACE_AXES[newKey].texY };
    const material = lockFaceTexture(side.material, target.shader, oldPoints, oldPoints, newPoints, oldBasis, newBasis);
    if (result.hull) result.hull.sides[index].material = material;
    else {
      result.faces ??= {};
      result.faces[newKey] = material;
    }
  });
  return result;
}

export function lockBrushBounds(source: BoxBrush, target: BoxBrush): BoxBrush {
  if (
    (["x", "y", "z"] as const).every(
      (axis) => source.min[axis] === target.min[axis] && source.max[axis] === target.max[axis],
    )
  )
    return target;
  return lockBrushCorrespondence(source, target);
}
