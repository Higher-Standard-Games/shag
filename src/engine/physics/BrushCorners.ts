/** How far outside a plane a corner may lie and still count as on the brush (units). */
const ON_PLANE = 0.01;
/** Corners closer than this are one corner (units). */
const SAME_CORNER = 0.01;

/**
 * The corners of a convex brush, from its planes in Q3 space ([nx, ny, nz,
 * dist] each, solid behind), returned in Babylon space (Y up) as flattened x,
 * y, z. Every three planes that meet in a point inside all the others give a
 * corner. Null for a brush with fewer than four corners or no volume.
 */
export function brushCorners(planes: ArrayLike<number>): Float32Array | null {
  const count = planes.length / 4;
  const corners: number[] = [];
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      for (let c = b + 1; c < count; c++) {
        const point = meet(planes, a, b, c);
        if (!point || !inside(planes, count, point) || known(corners, point)) continue;
        corners.push(point[0], point[1], point[2]);
      }
    }
  }
  if (corners.length < 12 || flat(corners)) return null;
  const out = new Float32Array(corners.length);
  for (let i = 0; i < corners.length; i += 3) {
    // Q3 -> Babylon: Y and Z swap
    out[i] = corners[i];
    out[i + 1] = corners[i + 2];
    out[i + 2] = corners[i + 1];
  }
  return out;
}

/** Where planes a, b and c meet, or null when two of them are parallel. */
function meet(p: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] | null {
  const [ax, ay, az, ad] = [p[a * 4], p[a * 4 + 1], p[a * 4 + 2], p[a * 4 + 3]];
  const [bx, by, bz, bd] = [p[b * 4], p[b * 4 + 1], p[b * 4 + 2], p[b * 4 + 3]];
  const [cx, cy, cz, cd] = [p[c * 4], p[c * 4 + 1], p[c * 4 + 2], p[c * 4 + 3]];
  // b x c, c x a, a x b
  const bcx = by * cz - bz * cy,
    bcy = bz * cx - bx * cz,
    bcz = bx * cy - by * cx;
  const det = ax * bcx + ay * bcy + az * bcz;
  if (Math.abs(det) < 1e-9) return null;
  const cax = cy * az - cz * ay,
    cay = cz * ax - cx * az,
    caz = cx * ay - cy * ax;
  const abx = ay * bz - az * by,
    aby = az * bx - ax * bz,
    abz = ax * by - ay * bx;
  return [
    (ad * bcx + bd * cax + cd * abx) / det,
    (ad * bcy + bd * cay + cd * aby) / det,
    (ad * bcz + bd * caz + cd * abz) / det,
  ];
}

function inside(p: ArrayLike<number>, count: number, point: [number, number, number]): boolean {
  for (let i = 0; i < count; i++) {
    if (p[i * 4] * point[0] + p[i * 4 + 1] * point[1] + p[i * 4 + 2] * point[2] - p[i * 4 + 3] > ON_PLANE) return false;
  }
  return true;
}

function known(corners: number[], point: [number, number, number]): boolean {
  for (let i = 0; i < corners.length; i += 3) {
    if (
      Math.abs(corners[i] - point[0]) < SAME_CORNER &&
      Math.abs(corners[i + 1] - point[1]) < SAME_CORNER &&
      Math.abs(corners[i + 2] - point[2]) < SAME_CORNER
    )
      return true;
  }
  return false;
}

/** Whether every corner lies on one plane: a brush with no volume. */
function flat(corners: number[]): boolean {
  const n = corners.length / 3;
  const at = (i: number): [number, number, number] => [corners[i * 3], corners[i * 3 + 1], corners[i * 3 + 2]];
  const o = at(0);
  for (let i = 1; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const u = at(i),
        v = at(j);
      const ux = u[0] - o[0],
        uy = u[1] - o[1],
        uz = u[2] - o[2];
      const vx = v[0] - o[0],
        vy = v[1] - o[1],
        vz = v[2] - o[2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-6) continue;
      for (let k = 1; k < n; k++) {
        const w = at(k);
        if (Math.abs(((w[0] - o[0]) * nx + (w[1] - o[1]) * ny + (w[2] - o[2]) * nz) / len) > ON_PLANE) return false;
      }
      return true;
    }
  }
  return true;
}
