/**
 * The normal map water moves by, generated rather than shipped.
 *
 * Procedural for a practical reason: `public/games/` is gitignored, so a
 * shipped noise texture would live outside version control, need a KTX2 pass,
 * and need a manifest entry — three ways for water to silently render wrong on
 * a fresh checkout. Generating it costs a few milliseconds once per scene and
 * cannot go missing.
 *
 * Tileable by construction. The surface scrolls two samples of this across
 * itself forever, and a seam in the source would draw a visible grid on every
 * pool in the game.
 */

/** Side length of the generated map. 128 is plenty for a surface this soft. */
export const WATER_NOISE_SIZE = 128;

/**
 * Deterministic value noise on a wrapped integer lattice.
 *
 * Wrapping the lattice coordinates by `period` is what makes the result
 * tileable: opposite edges sample the same lattice points, so they agree
 * exactly rather than nearly.
 */
function latticeValue(x: number, y: number, period: number, seed: number): number {
  const xi = ((x % period) + period) % period;
  const yi = ((y % period) + period) % period;

  // Integer hash in explicit 32-bit arithmetic. `Math.imul` rather than `*`
  // because the products overflow the safe-integer range immediately, and a
  // float that has silently lost its low bits is not a hash — neighbouring
  // lattice points would start colliding and the noise would flatten.
  let h = Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);

  const v00 = latticeValue(x0, y0, period, seed);
  const v10 = latticeValue(x0 + 1, y0, period, seed);
  const v01 = latticeValue(x0, y0 + 1, period, seed);
  const v11 = latticeValue(x0 + 1, y0 + 1, period, seed);

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Multi-octave height at a normalized position.
 *
 * Four octaves: the first two carry the swell, the last two the ripple. Each
 * octave's period doubles and stays an integer divisor of the map, which is
 * what keeps every octave individually tileable.
 */
export function waterHeightAt(u: number, v: number, octaves = 4): number {
  let amplitude = 1;
  let period = 4;
  let sum = 0;
  let total = 0;

  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u * period, v * period, period, o + 1) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    period *= 2;
  }

  return sum / total;
}

/**
 * Build an RGBA normal map, tangent space, as a plain byte array.
 *
 * Returned as data rather than a texture so this stays testable without a
 * renderer — the caller wraps it in a `RawTexture`, which also means it builds
 * under the headless NullEngine where a `DynamicTexture` would not.
 */
export function generateWaterNormalMap(size: number = WATER_NOISE_SIZE, strength = 2.0): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const step = 1 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      // Central differences on the height field. Sampling with wrap-around
      // coordinates keeps the derivative continuous across the seam.
      const hL = waterHeightAt(u - step, v);
      const hR = waterHeightAt(u + step, v);
      const hD = waterHeightAt(u, v - step);
      const hU = waterHeightAt(u, v + step);

      let nx = (hL - hR) * strength;
      let ny = (hD - hU) * strength;
      const nz = 1;

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      const nzn = nz / len;

      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nzn * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  return data;
}
