/**
 * Facet bevel planes for triangle collision.
 *
 * A swept box against a triangle is not a plane test — it is the Minkowski sum
 * of the box and the triangle, and that solid has three kinds of face: the
 * triangle's own plane, one plane per (triangle edge × box axis), and the six
 * axial planes. Testing only the triangle's plane, as a naive triangle sweep
 * does, leaves the box unblocked near every edge: it slips in, and then reports
 * a contact normal belonging to the facet's flat side, which points the wrong
 * way to push out of an edge contact and welds the body in place.
 *
 * So each triangle is expanded here into a closed convex plane set with
 * outward normals, which the ordinary brush trace can sweep correctly. This is
 * Quake 3's `CM_AddFacetBevels` (cm_patch.c), with the same reasoning: a bevel
 * is kept when every point of the facet lies behind it, which is exactly the
 * condition for it to be a supporting plane of the convex hull.
 *
 * Bezier patches are where this matters most. Tessellation makes them almost
 * entirely edge, so a patch handrail is the worst case for the naive test and
 * the first thing to stop trapping players once bevels exist.
 *
 * All vectors are Q3 space (z up), matching `BspPlane`, so the planes produced
 * here can go straight through the brush sweep without conversion.
 */

export interface FacetPlane {
  normal: [number, number, number];
  dist: number;
}

type Vec = readonly [number, number, number];

/**
 * How thick a triangle is made before sweeping it.
 *
 * A triangle has no volume, and the brush sweep needs one to report an exit as
 * well as an entry. Deliberately small: the back face is collision that sits
 * behind the visible surface, so a generous value would make thin geometry —
 * a handrail is about 4 units through — solid from the far side as well.
 */
const FACET_THICKNESS = 0.5;

/** Planes closer than this in orientation are treated as the same plane. */
const PARALLEL_EPSILON = 0.999;

/** A facet point this far in front of a candidate plane disqualifies it. */
const FRONT_EPSILON = 0.1;

function cross(a: Vec, b: Vec): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a: Vec, b: Vec): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Normalize in place, returning the original length. */
function normalize(v: [number, number, number]): number {
  const length = Math.sqrt(dot(v, v));
  if (length < 1e-6) return 0;
  v[0] /= length;
  v[1] /= length;
  v[2] /= length;
  return length;
}

/** Already present, up to orientation and offset? */
function isDuplicate(planes: FacetPlane[], normal: Vec, dist: number): boolean {
  for (const plane of planes) {
    if (dot(plane.normal, normal) > PARALLEL_EPSILON && Math.abs(plane.dist - dist) < 0.01) return true;
  }
  return false;
}

/** Do all three points lie behind this plane? Then it supports the facet. */
function supportsFacet(points: readonly Vec[], normal: Vec, dist: number): boolean {
  for (const point of points) {
    if (dot(point, normal) - dist > FRONT_EPSILON) return false;
  }
  return true;
}

/**
 * The convex plane set for one collision triangle, outward normals.
 *
 * Returns an empty array for a degenerate triangle, which the caller should
 * skip rather than sweep.
 */
export function buildFacetPlanes(v1: Vec, v2: Vec, v3: Vec): FacetPlane[] {
  const normal = cross(sub(v2, v1), sub(v3, v1));
  if (normalize(normal) === 0) return [];

  const dist = dot(normal, v1);
  const points: Vec[] = [v1, v2, v3];
  const supportDistance = (direction: Vec): number =>
    Math.max(...points.map((point) => dot(direction, point))) + Math.max(0, -FACET_THICKNESS * dot(direction, normal));

  // Front and back: the triangle's own plane, and a floor under it to give the
  // sweep something to exit through.
  const planes: FacetPlane[] = [
    { normal: [...normal] as [number, number, number], dist },
    { normal: [-normal[0], -normal[1], -normal[2]], dist: -(dist - FACET_THICKNESS) },
  ];

  // Border planes: one per edge, perpendicular to the face, oriented so the
  // opposite vertex is inside. These bound the triangle within its own plane.
  const edges: [Vec, Vec, Vec][] = [
    [v1, v2, v3],
    [v2, v3, v1],
    [v3, v1, v2],
  ];
  for (const [a, b, opposite] of edges) {
    const border = cross(sub(b, a), normal);
    if (normalize(border) === 0) continue;

    let borderDist = dot(border, a);
    if (dot(border, opposite) - borderDist > 0) {
      border[0] = -border[0];
      border[1] = -border[1];
      border[2] = -border[2];
      borderDist = -borderDist;
    }
    if (!isDuplicate(planes, border, borderDist)) planes.push({ normal: border, dist: borderDist });
  }

  // Axial bevels: the box is axis-aligned, so its sum with the facet has a face
  // in each axial direction. Without these a box clips the facet's bounding
  // corners.
  for (let axis = 0; axis < 3; axis++) {
    for (const dir of [1, -1]) {
      const axial: [number, number, number] = [0, 0, 0];
      axial[axis] = dir;
      // Bevels enclose the whole extruded facet, including its back vertices.
      // Bounding only the front triangle collapses an axial facet to zero depth.
      const axialDist = supportDistance(axial);
      if (!isDuplicate(planes, axial, axialDist)) planes.push({ normal: axial, dist: axialDist });
    }
  }

  // Edge bevels: one per (edge × axis), kept only where every facet point lies
  // behind it. This is the set the naive triangle sweep is missing, and the
  // reason a hull can enter a patch at all.
  for (const [a, b] of edges) {
    const edge = sub(b, a);
    if (normalize(edge) === 0) continue;

    for (let axis = 0; axis < 3; axis++) {
      const axial: [number, number, number] = [0, 0, 0];
      axial[axis] = 1;

      const bevel = cross(edge, axial);
      if (normalize(bevel) === 0) continue;

      for (const dir of [1, -1]) {
        const candidate: [number, number, number] = [bevel[0] * dir, bevel[1] * dir, bevel[2] * dir];
        const candidateDist = dot(candidate, a);
        if (!supportsFacet(points, candidate, candidateDist)) continue;
        const supportDist = supportDistance(candidate);
        if (isDuplicate(planes, candidate, supportDist)) continue;
        planes.push({ normal: candidate, dist: supportDist });
      }
    }
  }

  return planes;
}
