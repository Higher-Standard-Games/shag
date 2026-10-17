import {
  asHull,
  cross,
  dot,
  fromWorldHull,
  type HullSide,
  hullWorldVertices,
  polygonNormal,
  subtract,
  validateHull,
} from "./ConvexBrush";
import type { BoxBrush, Vec3q } from "./EditorDocument";

export interface VertexEdit {
  index: number;
  position: Vec3q;
}

/** Box corners use asHull's stable ordering until the first geometry edit. */
export function brushVertices(brush: BoxBrush): Vec3q[] {
  return hullWorldVertices(asHull(brush));
}

/** All vertices under a 2D handle move together, including hidden-axis overlaps. */
export function vertexHit(
  brush: BoxBrush,
  u: keyof Vec3q,
  v: keyof Vec3q,
  x: number,
  y: number,
  radius: number,
): number[] {
  const points = brushVertices(brush);
  let nearest = -1,
    distance = radius;
  points.forEach((point, i) => {
    const d = Math.hypot(point[u] - x, point[v] - y);
    if (d <= distance) {
      nearest = i;
      distance = d;
    }
  });
  if (nearest < 0) return [];
  return points.flatMap((p, i) => (Math.hypot(p[u] - points[nearest][u], p[v] - points[nearest][v]) < 1e-6 ? [i] : []));
}

type Triangle = [number, number, number];

/** Rebuilds the convex envelope; warped faces split, coplanar faces merge. */
export function editBrushVertices(brush: BoxBrush, edits: readonly VertexEdit[]): { brush: BoxBrush; remap: number[] } {
  const source = asHull(brush);
  const points = brushVertices(source);
  if (!Array.isArray(edits) || !edits.length) throw new Error("Select at least one vertex");
  const seen = new Set<number>();
  for (const edit of edits) {
    if (
      !edit ||
      !Number.isSafeInteger(edit.index) ||
      edit.index < 0 ||
      edit.index >= points.length ||
      seen.has(edit.index)
    )
      throw new Error("Invalid or duplicate vertex index");
    if (
      !edit.position ||
      ![edit.position.x, edit.position.y, edit.position.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 1_000_000)
    )
      throw new Error("Vertex position must be finite and inside map bounds");
    seen.add(edit.index);
    points[edit.index] = { ...edit.position };
  }
  const extent = Math.max(
    ...["x", "y", "z"].map((axis) => {
      const values = points.map((p) => p[axis as keyof Vec3q]);
      return Math.max(...values) - Math.min(...values);
    }),
  );
  const epsilon = 1e-5 + extent * 1e-8;
  // Start with a nondegenerate tetrahedron, using distances to avoid skinny seeds.
  let a = 0,
    b = 0,
    distance = 0;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(...Object.values(subtract(points[i], points[j])));
      if (d > distance) {
        a = i;
        b = j;
        distance = d;
      }
    }
  if (distance <= epsilon) throw new Error("Vertex edit collapses the brush");
  let c = -1,
    lineDistance = 0;
  const line = subtract(points[b], points[a]);
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(...Object.values(cross(line, subtract(points[i], points[a])))) / distance;
    if (d > lineDistance) {
      c = i;
      lineDistance = d;
    }
  }
  if (c < 0 || lineDistance <= epsilon) throw new Error("Vertex edit collapses the brush to a line");
  const normal = polygonNormal([points[a], points[b], points[c]]);
  let d = -1,
    planeDistance = 0;
  for (let i = 0; i < points.length; i++) {
    const delta = Math.abs(dot(normal, subtract(points[i], points[a])));
    if (delta > planeDistance) {
      d = i;
      planeDistance = delta;
    }
  }
  if (d < 0 || planeDistance <= epsilon) throw new Error("Vertex edit collapses the brush to a plane");
  const inside = { x: 0, y: 0, z: 0 };
  for (const index of [a, b, c, d])
    for (const axis of ["x", "y", "z"] as const) inside[axis] += points[index][axis] / 4;
  const outward = (tri: Triangle): Triangle =>
    dot(polygonNormal(tri.map((i) => points[i])), subtract(inside, points[tri[0]])) > 0
      ? [tri[0], tri[2], tri[1]]
      : tri;
  let triangles = [
    [a, b, c],
    [a, d, b],
    [b, d, c],
    [c, d, a],
  ].map((tri) => outward(tri as Triangle));
  const seed = new Set([a, b, c, d]);
  for (let index = 0; index < points.length; index++) {
    if (seed.has(index)) continue;
    const visible = triangles.filter(
      (tri) => dot(polygonNormal(tri.map((i) => points[i])), subtract(points[index], points[tri[0]])) > epsilon,
    );
    if (!visible.length) continue;
    const horizon = new Map<string, [number, number]>();
    for (const tri of visible)
      for (let i = 0; i < 3; i++) {
        const u = tri[i],
          v = tri[(i + 1) % 3],
          key = `${Math.min(u, v)}:${Math.max(u, v)}`;
        if (horizon.has(key)) horizon.delete(key);
        else horizon.set(key, [u, v]);
      }
    const removed = new Set(visible);
    triangles = triangles.filter((tri) => !removed.has(tri));
    for (const [u, v] of horizon.values()) triangles.push(outward([u, v, index]));
  }
  const groups: Array<{ normal: Vec3q; distance: number; vertices: Set<number> }> = [];
  for (const tri of triangles) {
    const n = polygonNormal(tri.map((i) => points[i])),
      distance = dot(n, points[tri[0]]);
    let group = groups.find((g) => dot(g.normal, n) > 1 - 1e-8 && Math.abs(g.distance - distance) <= epsilon);
    if (!group) {
      group = { normal: n, distance, vertices: new Set() };
      groups.push(group);
    }
    for (const i of tri) group.vertices.add(i);
  }
  // A planar convex hull removes points along straight edges and inside the face.
  const polygon = (indices: number[], n: Vec3q): number[] => {
    const hidden =
      Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? "x" : Math.abs(n.y) > Math.abs(n.z) ? "y" : "z";
    const [u, v] = (["x", "y", "z"] as const).filter((axis) => axis !== hidden);
    const sorted = indices.sort((a, b) => points[a][u] - points[b][u] || points[a][v] - points[b][v]);
    const turn = (a: number, b: number, c: number) =>
      (points[b][u] - points[a][u]) * (points[c][v] - points[a][v]) -
      (points[b][v] - points[a][v]) * (points[c][u] - points[a][u]);
    const chain = (ids: number[]) => {
      const out: number[] = [];
      for (const i of ids) {
        while (out.length > 1 && turn(out[out.length - 2], out[out.length - 1], i) <= epsilon * epsilon) out.pop();
        out.push(i);
      }
      return out;
    };
    const lower = chain(sorted),
      upper = chain([...sorted].reverse());
    const result = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    if (dot(polygonNormal(result.map((i) => points[i])), n) < 0) result.reverse();
    return result;
  };
  const sourcePoints = brushVertices(source);
  const original = source.hull!.sides.map((side) => ({
    side,
    normal: polygonNormal(side.vertices.map((i) => sourcePoints[i])),
  }));
  const sides: HullSide[] = groups.map((group) => {
    const vertices = polygon([...group.vertices], group.normal);
    const ranked = original
      .map(({ side, normal }) => ({
        side,
        score: side.vertices.filter((i) => vertices.includes(i)).length * 4 + dot(normal, group.normal),
      }))
      .sort((a, b) => b.score - a.score);
    const material = ranked[0]?.side.material;
    return { vertices, ...(material ? { material: structuredClone(material) } : {}) };
  });
  const used = [...new Set(sides.flatMap((side) => side.vertices))].sort((a, b) => a - b);
  const remap = points.map((_, i) => used.indexOf(i));
  const result = fromWorldHull(
    brush.id,
    used.map((i) => points[i]),
    sides.map((side) => ({ ...side, vertices: side.vertices.map((i) => remap[i]) })),
    brush.shader,
    brush.detail,
  );
  validateHull(result);
  return { brush: result, remap };
}
