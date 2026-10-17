import {
  asHull,
  cross,
  dot,
  fromWorldHull,
  hullWorldVertices,
  polygonNormal,
  subtract,
  validateHull,
} from "./ConvexBrush";
import type { BoxBrush, EditorDocumentData, FaceMaterial, Vec3q } from "./EditorDocument";

export interface ClipPlane {
  normal: Vec3q;
  /** dot(normal, point) = distance; normal and distance are normalized together. */
  distance: number;
}

export function normalizedPlane(plane: ClipPlane): ClipPlane {
  const n = plane?.normal;
  if (!n || ![n.x, n.y, n.z, plane.distance].every(Number.isFinite))
    throw new Error("Clip plane needs a finite normal and distance");
  const length = Math.hypot(n.x, n.y, n.z);
  if (length < 1e-12 || !Number.isFinite(length)) throw new Error("Clip plane normal must be nonzero");
  return { normal: { x: n.x / length, y: n.y / length, z: n.z / length }, distance: plane.distance / length };
}

export function reversePlane(plane: ClipPlane): ClipPlane {
  return { normal: { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z }, distance: -plane.distance };
}

/** Keep the back half-space. Uncut inputs retain their representation and mappings. */
export function clipBrush(brush: BoxBrush, input: ClipPlane, capMaterial?: FaceMaterial): BoxBrush | null {
  const plane = normalizedPlane(input),
    n = plane.normal;
  const hull = asHull(brush),
    points = hullWorldVertices(hull);
  const epsilon =
    1e-7 + Math.max(brush.max.x - brush.min.x, brush.max.y - brush.min.y, brush.max.z - brush.min.z) * 1e-9;
  const distance = (p: Vec3q) => dot(n, p) - plane.distance;
  const distances = points.map(distance);
  if (Math.max(...distances) <= epsilon) return structuredClone(brush);
  if (Math.min(...distances) >= -epsilon) return null;
  const polygons: Array<{ points: Vec3q[]; material?: FaceMaterial }> = [];
  const cap: Vec3q[] = [];
  for (const side of hull.hull!.sides) {
    const polygon = side.vertices.map((i) => points[i]),
      output: Vec3q[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      const da = Math.abs(distance(a)) <= epsilon ? 0 : distance(a),
        db = Math.abs(distance(b)) <= epsilon ? 0 : distance(b);
      if (da <= 0) output.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    for (const p of output) if (Math.abs(distance(p)) <= epsilon) cap.push(p);
    if (output.length >= 3) polygons.push({ points: output, material: side.material });
  }
  const vertices: Vec3q[] = [];
  const index = (p: Vec3q) => {
    const found = vertices.findIndex((v) => Math.hypot(v.x - p.x, v.y - p.y, v.z - p.z) <= epsilon);
    if (found >= 0) return found;
    vertices.push({ ...p });
    return vertices.length - 1;
  };
  const capIds = [...new Set(cap.map(index))];
  if (capIds.length < 3) throw new Error("Clip produced a degenerate cap");
  const center = { x: 0, y: 0, z: 0 };
  for (const i of capIds)
    for (const axis of ["x", "y", "z"] as const) center[axis] += vertices[i][axis] / capIds.length;
  const ref = Math.abs(n.x) < 0.7 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const tangent = cross(ref, n),
    length = Math.hypot(tangent.x, tangent.y, tangent.z);
  const u = { x: tangent.x / length, y: tangent.y / length, z: tangent.z / length },
    v = cross(n, u);
  capIds.sort((a, b) => {
    const pa = subtract(vertices[a], center),
      pb = subtract(vertices[b], center);
    return Math.atan2(dot(pa, v), dot(pa, u)) - Math.atan2(dot(pb, v), dot(pb, u));
  });
  polygons.push({ points: capIds.map((i) => vertices[i]), material: capMaterial });
  const sides = polygons.flatMap((polygon) => {
    const ids = [...new Set(polygon.points.map(index))];
    let changed = true;
    while (changed && ids.length >= 3) {
      changed = false;
      for (let i = 0; i < ids.length; i++) {
        const a = vertices[ids[(i + ids.length - 1) % ids.length]],
          b = vertices[ids[i]],
          c = vertices[ids[(i + 1) % ids.length]];
        const ab = subtract(b, a),
          bc = subtract(c, b),
          turn = cross(ab, bc);
        if (
          Math.hypot(turn.x, turn.y, turn.z) <=
          epsilon * (Math.hypot(ab.x, ab.y, ab.z) + Math.hypot(bc.x, bc.y, bc.z))
        ) {
          ids.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    return ids.length < 3
      ? []
      : [{ vertices: ids, ...(polygon.material ? { material: structuredClone(polygon.material) } : {}) }];
  });
  const used = [...new Set(sides.flatMap((side) => side.vertices))],
    remap = new Map(used.map((id, i) => [id, i]));
  const result = fromWorldHull(
    brush.id,
    used.map((i) => vertices[i]),
    sides.map((side) => ({ ...side, vertices: side.vertices.map((i) => remap.get(i)!) })),
    brush.shader,
    brush.detail,
  );
  validateHull(result);
  return result;
}

export function brushPlanes(brush: BoxBrush): ClipPlane[] {
  const hull = asHull(brush),
    points = hullWorldVertices(hull);
  return hull.hull!.sides.map((side) => {
    const polygon = side.vertices.map((i) => points[i]),
      normal = polygonNormal(polygon);
    return { normal, distance: dot(normal, polygon[0]) };
  });
}

/** Disjoint convex fragments; the cutter's interior is removed, never its AABB. */
export function subtractBrush(brush: BoxBrush, cutter: BoxBrush, capMaterial?: FaceMaterial): BoxBrush[] {
  if (
    ["x", "y", "z"].some(
      (axis) =>
        brush.min[axis as keyof Vec3q] >= cutter.max[axis as keyof Vec3q] ||
        cutter.min[axis as keyof Vec3q] >= brush.max[axis as keyof Vec3q],
    )
  )
    return [structuredClone(brush)];
  const planes = brushPlanes(cutter);
  let intersection: BoxBrush | null = brush;
  for (const plane of planes) {
    intersection = clipBrush(intersection, plane, capMaterial);
    if (!intersection) return [structuredClone(brush)];
  }
  const pieces: BoxBrush[] = [];
  let remaining: BoxBrush | null = brush;
  for (const plane of planes) {
    const outside = clipBrush(remaining, reversePlane(plane), capMaterial);
    if (outside) pieces.push(outside);
    remaining = clipBrush(remaining, plane, capMaterial);
    if (!remaining) break;
  }
  return pieces;
}

/** Replace one leaf and propagate its fragments through both kinds of membership. */
export function replaceBrushPieces(doc: EditorDocumentData, id: string, pieces: BoxBrush[]): string[] {
  const existing = new Set(
    [
      ...doc.brushes,
      ...doc.entities,
      ...(doc.patches ?? []),
      ...(doc.brushEntities ?? []),
      ...(doc.editorGroups ?? []),
    ].map((item) => item.id),
  );
  const replacements = pieces.map((piece, i) => {
    let next = id;
    if (i) {
      let suffix = i + 1;
      while (existing.has(`${id}-${suffix}`)) suffix++;
      next = `${id}-${suffix}`;
      existing.add(next);
    }
    return { ...piece, id: next };
  });
  const ids = replacements.map((piece) => piece.id);
  doc.brushes = doc.brushes.flatMap((brush) => (brush.id === id ? replacements : [brush]));
  for (const owner of doc.brushEntities ?? [])
    owner.brushIds = owner.brushIds.flatMap((member) => (member === id ? ids : [member]));
  for (const group of doc.editorGroups ?? [])
    group.objectIds = group.objectIds.flatMap((member) => (member === id ? ids : [member]));
  return ids;
}
