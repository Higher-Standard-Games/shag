/** Qfusion's image-space tangent frame: S follows U, T follows negative V. */
export function buildBspTangents(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  uvs: ArrayLike<number>,
  indices: ArrayLike<number>,
): Float32Array {
  const count = positions.length / 3;
  const s = new Float64Array(count * 3),
    t = new Float64Array(count * 3);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i],
      b = indices[i + 1],
      c = indices[i + 2];
    const du1 = uvs[b * 2] - uvs[a * 2],
      dv1 = uvs[b * 2 + 1] - uvs[a * 2 + 1];
    const du2 = uvs[c * 2] - uvs[a * 2],
      dv2 = uvs[c * 2 + 1] - uvs[a * 2 + 1];
    const sign = Math.sign(du1 * dv2 - du2 * dv1);
    if (!sign) continue;
    for (let k = 0; k < 3; k++) {
      const e1 = positions[b * 3 + k] - positions[a * 3 + k],
        e2 = positions[c * 3 + k] - positions[a * 3 + k];
      const sv = sign * (dv2 * e1 - dv1 * e2),
        tv = -sign * (du1 * e2 - du2 * e1);
      s[a * 3 + k] += sv;
      s[b * 3 + k] += sv;
      s[c * 3 + k] += sv;
      t[a * 3 + k] += tv;
      t[b * 3 + k] += tv;
      t[c * 3 + k] += tv;
    }
  }
  const result = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const x = normals[i * 3],
      y = normals[i * 3 + 1],
      z = normals[i * 3 + 2];
    const dot = s[i * 3] * x + s[i * 3 + 1] * y + s[i * 3 + 2] * z;
    let tx = s[i * 3] - dot * x,
      ty = s[i * 3 + 1] - dot * y,
      tz = s[i * 3 + 2] - dot * z;
    let length = Math.hypot(tx, ty, tz);
    if (length < 1e-10) {
      // Degenerate UVs still need a finite frame perpendicular to the normal.
      if (Math.abs(z) < 0.9) {
        tx = -y;
        ty = x;
        tz = 0;
      } else {
        tx = z;
        ty = 0;
        tz = -x;
      }
      length = Math.hypot(tx, ty, tz) || 1;
    }
    tx /= length;
    ty /= length;
    tz /= length;
    const handed = (y * tz - z * ty) * t[i * 3] + (z * tx - x * tz) * t[i * 3 + 1] + (x * ty - y * tx) * t[i * 3 + 2];
    result.set([tx, ty, tz, handed < 0 ? -1 : 1], i * 4);
  }
  return result;
}
