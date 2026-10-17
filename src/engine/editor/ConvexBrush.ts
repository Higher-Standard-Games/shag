import type { BoxBrush, FaceKey, FaceMaterial, Vec3q } from "./EditorDocument";

export interface HullSide {
  /** Vertex indices counterclockwise as seen from outside the solid. */
  vertices: number[];
  material?: FaceMaterial;
}
export interface BrushHull {
  /** Coordinates normalized to the brush AABB, 0..1 on every axis. */
  vertices: Vec3q[];
  sides: HullSide[];
}
export const subtract = (a: Vec3q, b: Vec3q): Vec3q => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const dot = (a: Vec3q, b: Vec3q): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3q, b: Vec3q): Vec3q => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export function polygonNormal(points: readonly Vec3q[]): Vec3q {
  const n = cross(subtract(points[1], points[0]), subtract(points[2], points[0]));
  const length = Math.hypot(n.x, n.y, n.z);
  if (length < 1e-8) throw new Error("Degenerate convex side");
  return { x: n.x / length, y: n.y / length, z: n.z / length };
}

export function hullWorldVertices(brush: BoxBrush): Vec3q[] {
  if (!brush.hull) throw new Error("Brush has no convex hull");
  return brush.hull.vertices.map((v) => ({
    x: brush.min.x + v.x * (brush.max.x - brush.min.x),
    y: brush.min.y + v.y * (brush.max.y - brush.min.y),
    z: brush.min.z + v.z * (brush.max.z - brush.min.z),
  }));
}

/** Validates a closed, outward, strictly convex solid; coplanar faces must be merged. */
export function validateHull(brush: BoxBrush): void {
  const hull = brush.hull;
  if (hull === undefined) return;
  if (!hull || typeof hull !== "object") throw new Error("Invalid convex hull");
  if (brush.faces !== undefined) throw new Error("Convex brushes use side materials, not axis face overrides");
  if (
    !Array.isArray(hull.vertices) ||
    hull.vertices.length < 4 ||
    hull.vertices.length > 128 ||
    !Array.isArray(hull.sides) ||
    hull.sides.length < 4 ||
    hull.sides.length > 64
  )
    throw new Error("Convex hull needs 4..128 vertices and 4..64 sides");
  for (const p of hull.vertices)
    for (const axis of ["x", "y", "z"] as const)
      if (!Number.isFinite(p?.[axis]) || p[axis] < 0 || p[axis] > 1)
        throw new Error("Hull coordinates must be normalized to 0..1");
  for (const axis of ["x", "y", "z"] as const)
    if (
      Math.min(...hull.vertices.map((v) => v[axis])) > 1e-7 ||
      Math.max(...hull.vertices.map((v) => v[axis])) < 1 - 1e-7
    )
      throw new Error("Hull must reach both bounds on each axis");
  const vertices = hullWorldVertices(brush);
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++)
      if (Math.hypot(...Object.values(subtract(vertices[i], vertices[j]))) < 1e-5)
        throw new Error("Duplicate hull vertices");
  const center = { x: 0, y: 0, z: 0 };
  for (const v of vertices) for (const axis of ["x", "y", "z"] as const) center[axis] += v[axis] / vertices.length;
  const used = new Set<number>();
  const edges = new Map<string, number>();
  const planes: Array<{ n: Vec3q; d: number }> = [];
  let volume = 0;
  const tolerance =
    1e-5 + Math.max(brush.max.x - brush.min.x, brush.max.y - brush.min.y, brush.max.z - brush.min.z) * 1e-8;
  for (const side of hull.sides) {
    if (
      !Array.isArray(side.vertices) ||
      side.vertices.length < 3 ||
      side.vertices.length > 128 ||
      side.vertices.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= vertices.length) ||
      new Set(side.vertices).size !== side.vertices.length
    )
      throw new Error("Invalid convex side indices");
    const points = side.vertices.map((i) => vertices[i]);
    const n = polygonNormal(points);
    const d = dot(n, points[0]);
    if (points.some((p) => Math.abs(dot(n, p) - d) > tolerance)) throw new Error("Convex sides must be planar");
    if (vertices.some((p) => dot(n, p) - d > tolerance)) throw new Error("Hull is concave or has inward side winding");
    if (planes.some((plane) => dot(plane.n, n) > 1 - 1e-8 && Math.abs(plane.d - d) < tolerance))
      throw new Error("Merge coplanar convex sides");
    planes.push({ n, d });
    for (let i = 0; i < side.vertices.length; i++) {
      const a = side.vertices[i];
      const b = side.vertices[(i + 1) % points.length];
      used.add(a);
      const edge = `${a}:${b}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
      if (
        dot(
          cross(
            subtract(points[(i + 1) % points.length], points[i]),
            subtract(points[(i + 2) % points.length], points[(i + 1) % points.length]),
          ),
          n,
        ) <= 1e-8
      )
        throw new Error("Side polygons must be convex without collinear edges");
    }
    for (let i = 1; i + 1 < points.length; i++)
      volume +=
        dot(subtract(points[0], center), cross(subtract(points[i], center), subtract(points[i + 1], center))) / 6;
  }
  for (const [edge, count] of edges) {
    const [a, b] = edge.split(":");
    if (count !== 1 || edges.get(`${b}:${a}`) !== 1)
      throw new Error("Convex hull must be closed with paired opposite edges");
  }
  if (used.size !== vertices.length || volume <= 1e-5) throw new Error("Convex hull has unused vertices or no volume");
}

export function fromWorldHull(
  id: string,
  vertices: readonly Vec3q[],
  sides: readonly HullSide[],
  shader: string,
  detail?: boolean,
): BoxBrush {
  if (
    !Array.isArray(vertices) ||
    vertices.length < 4 ||
    vertices.length > 128 ||
    vertices.some((v) => !v || ![v.x, v.y, v.z].every(Number.isFinite))
  )
    throw new Error("Convex creation needs 4..128 finite world-space vertices");
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of vertices)
    for (const axis of ["x", "y", "z"] as const) {
      min[axis] = Math.min(min[axis], p[axis]);
      max[axis] = Math.max(max[axis], p[axis]);
    }
  if (["x", "y", "z"].some((axis) => min[axis as keyof Vec3q] >= max[axis as keyof Vec3q]))
    throw new Error("Convex hull must have three-dimensional bounds");
  return {
    id,
    min,
    max,
    shader,
    ...(detail !== undefined ? { detail } : {}),
    hull: {
      vertices: vertices.map((v) => ({
        x: (v.x - min.x) / (max.x - min.x),
        y: (v.y - min.y) / (max.y - min.y),
        z: (v.z - min.z) / (max.z - min.z),
      })),
      sides: structuredClone([...sides]),
    },
  };
}

export function asHull(brush: BoxBrush): BoxBrush {
  if (brush.hull) return structuredClone(brush);
  const vertices = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ].map(([x, y, z]) => ({ x, y, z }));
  const faces: Array<[FaceKey, number[]]> = [
    ["-Z", [0, 3, 2, 1]],
    ["+Z", [4, 5, 6, 7]],
    ["-Y", [0, 1, 5, 4]],
    ["+Y", [3, 7, 6, 2]],
    ["-X", [0, 4, 7, 3]],
    ["+X", [1, 2, 6, 5]],
  ];
  const result = structuredClone(brush);
  delete result.faces;
  result.hull = {
    vertices,
    sides: faces.map(([key, indices]) => ({
      vertices: indices,
      ...(brush.faces?.[key] ? { material: structuredClone(brush.faces[key]) } : {}),
    })),
  };
  return result;
}

export function rotateBrush(brush: BoxBrush, axis: keyof Vec3q, degrees: number, pivot?: Vec3q): BoxBrush {
  if (
    !["x", "y", "z"].includes(axis) ||
    !Number.isFinite(degrees) ||
    (pivot && ![pivot.x, pivot.y, pivot.z].every(Number.isFinite))
  )
    throw new Error("Rotation needs a valid axis, finite degrees and pivot");
  if (degrees % 360 === 0) return structuredClone(brush);
  const hull = asHull(brush);
  const center = pivot ?? {
    x: (brush.min.x + brush.max.x) / 2,
    y: (brush.min.y + brush.max.y) / 2,
    z: (brush.min.z + brush.max.z) / 2,
  };
  const [u, v] = axis === "x" ? (["y", "z"] as const) : axis === "y" ? (["z", "x"] as const) : (["x", "y"] as const);
  const radians = ((degrees % 360) * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const vertices = hullWorldVertices(hull).map((p) => {
    const a = p[u] - center[u];
    const b = p[v] - center[v];
    return { ...p, [u]: center[u] + a * c - b * s, [v]: center[v] + a * s + b * c };
  });
  return fromWorldHull(brush.id, vertices, hull.hull!.sides, brush.shader, brush.detail);
}

export function prismBrush(
  id: string,
  footprint: Array<{ x: number; y: number }>,
  bottom: number,
  top: number,
  shader: string,
  detail?: boolean,
): BoxBrush {
  if (
    !Array.isArray(footprint) ||
    footprint.length < 3 ||
    footprint.length > 32 ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(top) ||
    bottom >= top
  )
    throw new Error("Prism needs 3..32 footprint points and bottom < top");
  let points = footprint.map((p) => ({ x: p.x, y: p.y }));
  const area = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  if (area < 0) points = points.reverse();
  const n = points.length;
  const indices = points.map((_, i) => i);
  const sides: HullSide[] = [
    { vertices: [...indices].reverse() },
    { vertices: indices.map((i) => i + n) },
    ...indices.map((i) => ({ vertices: [i, (i + 1) % n, ((i + 1) % n) + n, i + n] })),
  ];
  return fromWorldHull(
    id,
    [...points.map((p) => ({ ...p, z: bottom })), ...points.map((p) => ({ ...p, z: top }))],
    sides,
    shader,
    detail,
  );
}

/** MakeBSP ComputeAxisBase, shared by arbitrary-plane preview UVs. */
export function planeTextureAxes(n: Vec3q): { u: Vec3q; v: Vec3q } {
  // Suppress rotation roundoff at axial normals, where atan2 otherwise picks an arbitrary yaw.
  n = { x: Math.abs(n.x) < 1e-8 ? 0 : n.x, y: Math.abs(n.y) < 1e-8 ? 0 : n.y, z: Math.abs(n.z) < 1e-8 ? 0 : n.z };
  const yaw = Math.atan2(n.y, n.x);
  const pitch = -Math.atan2(n.z, Math.hypot(n.x, n.y));
  return {
    u: { x: -Math.sin(yaw), y: Math.cos(yaw), z: 0 },
    v: { x: -Math.sin(pitch) * Math.cos(yaw), y: -Math.sin(pitch) * Math.sin(yaw), z: -Math.cos(pitch) },
  };
}
