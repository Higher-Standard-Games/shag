import { cross, dot, hullWorldVertices, planeTextureAxes, polygonNormal, subtract } from "./ConvexBrush";
import { type BoxBrush, FACE_KEYS, type FaceKey, type FaceMaterial, type Vec3q } from "./EditorDocument";
import { FACE_AXES, faceNormal, faceTexMatrix, fitFace, matrixToFace, type TexMatrix, wrapFaces } from "./FaceUv";
import { faceCorners } from "./TexturedPreview";

/** Axis names for boxes; zero-based side indices for convex hulls. */
export type BrushFace = FaceKey | number;

export function brushFaceKeys(brush: BoxBrush): BrushFace[] {
  return brush.hull ? brush.hull.sides.map((_, i) => i) : [...FACE_KEYS];
}
export function validBrushFace(brush: BoxBrush, key: BrushFace): boolean {
  return brush.hull
    ? typeof key === "number" && Number.isSafeInteger(key) && key >= 0 && key < brush.hull.sides.length
    : typeof key === "string" && FACE_KEYS.includes(key);
}
export function brushFaceMaterial(brush: BoxBrush, key: BrushFace): FaceMaterial | undefined {
  if (!validBrushFace(brush, key)) throw new Error("Selected brush face no longer exists");
  return typeof key === "number" ? brush.hull!.sides[key].material : brush.faces?.[key];
}
export function setBrushFaceMaterial(brush: BoxBrush, key: BrushFace, face: FaceMaterial): void {
  if (!validBrushFace(brush, key)) throw new Error("Selected brush face no longer exists");
  if (typeof key === "number") brush.hull!.sides[key].material = face;
  else {
    brush.faces ??= {};
    brush.faces[key] = face;
  }
}
export function brushFacePoints(brush: BoxBrush, key: BrushFace): Vec3q[] {
  if (!validBrushFace(brush, key)) throw new Error("Selected brush face no longer exists");
  if (typeof key === "string") return faceCorners(brush, key);
  const vertices = hullWorldVertices(brush);
  return brush.hull!.sides[key].vertices.map((i) => vertices[i]);
}
export function brushFaceNormal(brush: BoxBrush, key: BrushFace): Vec3q {
  return typeof key === "string" ? faceNormal(key) : polygonNormal(brushFacePoints(brush, key));
}
export function brushFaceAxes(brush: BoxBrush, key: BrushFace): { u: Vec3q; v: Vec3q } {
  if (typeof key === "number") return planeTextureAxes(brushFaceNormal(brush, key));
  return { u: FACE_AXES[key].texX, v: FACE_AXES[key].texY };
}
export function brushFaceST(brush: BoxBrush, key: BrushFace, matrix: TexMatrix, point: Vec3q): [number, number] {
  const axes = brushFaceAxes(brush, key),
    u = dot(point, axes.u),
    v = dot(point, axes.v);
  return [matrix[0][0] * u + matrix[0][1] * v + matrix[0][2], matrix[1][0] * u + matrix[1][1] * v + matrix[1][2]];
}

/** Fit covers the polygon's full projected U/V extent with one image repeat. */
export function fitBrushFace(face: FaceMaterial, brush: BoxBrush, key: BrushFace): FaceMaterial {
  if (typeof key === "string") return fitFace(face, brush, key);
  const axes = brushFaceAxes(brush, key),
    points = brushFacePoints(brush, key);
  const us = points.map((p) => dot(p, axes.u)),
    vs = points.map((p) => dot(p, axes.v));
  const u = Math.min(...us),
    v = Math.min(...vs),
    du = Math.max(...us) - u,
    dv = Math.max(...vs) - v;
  return {
    ...face,
    rotation: 0,
    scale: [du / face.size[0], dv / face.size[1]],
    shift: [(-u / du) * face.size[0], (-v / dv) * face.size[1]],
  };
}

/** Continue alignment across shared edges; BFS gives deterministic paths to distant sides. */
export function wrapBrushFaces(
  brush: BoxBrush,
  source: BrushFace,
  targets: readonly BrushFace[],
): Map<BrushFace, FaceMaterial> {
  const material = brushFaceMaterial(brush, source);
  if (!material) throw new Error("Pick a texture for the source face first");
  if (!brush.hull)
    return new Map(
      Object.entries(wrapFaces(brush, source as FaceKey, material, targets as FaceKey[])) as Array<
        [FaceKey, FaceMaterial]
      >,
    );
  const result = new Map<BrushFace, FaceMaterial>([[source, material]]),
    queue = [source];
  const keys = brushFaceKeys(brush).sort((a, b) => Number(targets.includes(b)) - Number(targets.includes(a)));
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head],
      fromSide = brush.hull.sides[from as number];
    for (const to of keys) {
      if (result.has(to)) continue;
      const toSide = brush.hull.sides[to as number];
      const shared = fromSide.vertices.filter((i) => toSide.vertices.includes(i));
      if (shared.length !== 2) continue;
      const vertices = hullWorldVertices(brush),
        origin = vertices[shared[0]],
        edge = subtract(vertices[shared[1]], origin);
      const length = Math.hypot(edge.x, edge.y, edge.z),
        axis = { x: edge.x / length, y: edge.y / length, z: edge.z / length };
      const ns = brushFaceNormal(brush, from),
        nt = brushFaceNormal(brush, to);
      const angle = Math.atan2(dot(axis, cross(nt, ns)), dot(nt, ns)),
        c = Math.cos(angle),
        s = Math.sin(angle);
      const unfold = (p: Vec3q): Vec3q => {
        const v = subtract(p, origin),
          axv = cross(axis, v),
          d = dot(axis, v) * (1 - c);
        return {
          x: origin.x + v.x * c + axv.x * s + axis.x * d,
          y: origin.y + v.y * c + axv.y * s + axis.y * d,
          z: origin.z + v.z * c + axv.z * s + axis.z * d,
        };
      };
      const matrix = faceTexMatrix(result.get(from)!),
        axes = brushFaceAxes(brush, to);
      const st = (p: Vec3q) => brushFaceST(brush, from, matrix, unfold(p));
      const p = brushFacePoints(brush, to)[0],
        a = st(p),
        b = st({ x: p.x + axes.u.x, y: p.y + axes.u.y, z: p.z + axes.u.z }),
        d = st({ x: p.x + axes.v.x, y: p.y + axes.v.y, z: p.z + axes.v.z });
      const u = dot(p, axes.u),
        v = dot(p, axes.v);
      const next: TexMatrix = [
        [b[0] - a[0], d[0] - a[0], a[0] - (b[0] - a[0]) * u - (d[0] - a[0]) * v],
        [b[1] - a[1], d[1] - a[1], a[1] - (b[1] - a[1]) * u - (d[1] - a[1]) * v],
      ];
      const face = matrixToFace(next, material.shader, material.size);
      // A negative determinant is a mirrored texture, carried by signed V scale.
      if (next[0][0] * next[1][1] - next[0][1] * next[1][0] < 0) face.scale[1] *= -1;
      result.set(to, face);
      queue.push(to);
    }
  }
  for (const target of targets)
    if (!result.has(target)) throw new Error("Selected faces do not share a connected surface");
  return result;
}
