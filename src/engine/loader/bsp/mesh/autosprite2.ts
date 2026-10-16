/** Authored quad frames for Qfusion's axis-constrained billboard deform. */
export interface Autosprite2Geometry {
  original: number[];
  quads: {
    center: number[];
    axis: number[];
    right: number[];
    vertices: number[];
  }[];
}

export function createAutosprite2Geometry(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): Autosprite2Geometry {
  const original = Array.from(positions);
  const elements = Array.from(indices);
  const quads: Autosprite2Geometry["quads"] = [];
  const point = (index: number) => original.slice(index * 3, index * 3 + 3);
  for (let i = 0; i + 5 < indices.length; i += 6) {
    // Restore the source triangle order, reversed at the Q3-to-Babylon boundary.
    const triangle = [indices[i], indices[i + 2], indices[i + 1]];
    const edges = [
      [1, 0],
      [2, 0],
      [2, 1],
    ]
      .map(([a, b]) => {
        const from = point(triangle[b]),
          to = point(triangle[a]);
        const vector = to.map((value, j) => value - from[j]);
        return { from, to, vector, length: Math.hypot(...vector) };
      })
      .sort((a, b) => b.length - a.length);
    const [diagonal, long, short] = edges;
    if (!Number.isFinite(diagonal.length) || short.length < 0.0001) continue;
    const axis = long.vector.map((value) => value / long.length);
    const right = short.vector.map((value) => value / short.length);
    if (Math.abs(axis.reduce((sum, value, j) => sum + value * right[j], 0)) > 0.9999) continue;
    quads.push({
      center: diagonal.from.map((value, j) => (value + diagonal.to[j]) * 0.5),
      axis,
      right,
      vertices: [...new Set(elements.slice(i, i + 6))],
    });
  }
  return { original, quads };
}

/** Rotate only the transverse coordinate; retain the authored long-axis anchor. */
export function updateAutosprite2Geometry(
  geometry: Autosprite2Geometry,
  positions: { [index: number]: number },
  normals: { [index: number]: number } | null,
  eye: { x: number; y: number; z: number },
): boolean {
  let changed = false;
  for (const { center: c, axis: up, right, vertices } of geometry.quads) {
    let x = eye.x - c[0],
      y = eye.y - c[1],
      z = eye.z - c[2];
    const along = x * up[0] + y * up[1] + z * up[2];
    x -= up[0] * along;
    y -= up[1] * along;
    z -= up[2] * along;
    const length = Math.hypot(x, y, z);
    // On the rotation axis there is no facing direction; retain the last frame.
    if (length < 0.0001) continue;
    x /= length;
    y /= length;
    z /= length;
    // Q3-to-Babylon changes handedness, hence the negative cross product.
    const newRight = [up[2] * y - up[1] * z, up[0] * z - up[2] * x, up[1] * x - up[0] * y];
    for (const v of vertices) {
      const offset = v * 3;
      const t = right.reduce((sum, value, j) => sum + value * (geometry.original[offset + j] - c[j]), 0);
      for (let j = 0; j < 3; j++) positions[offset + j] = geometry.original[offset + j] + t * (newRight[j] - right[j]);
      if (normals) {
        normals[offset] = x;
        normals[offset + 1] = y;
        normals[offset + 2] = z;
      }
    }
    changed = true;
  }
  return changed;
}
