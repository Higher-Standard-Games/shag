/**
 * The generated water normal map (water Phase 3).
 *
 * Procedural rather than shipped because `public/games/` is gitignored: an
 * asset would live outside version control, need a KTX2 pass and a manifest
 * entry, and each of those is a way for water to silently render wrong on a
 * fresh checkout.
 *
 * The property that actually matters is tileability. The surface scrolls two
 * samples of this across itself forever, so a seam in the source draws a
 * visible grid on every pool in the game.
 */

import { describe, expect, it } from "vitest";
import { generateWaterNormalMap, WATER_NOISE_SIZE, waterHeightAt } from "../rendering/water/WaterNoise";

describe("waterHeightAt", () => {
  it("is deterministic", () => {
    expect(waterHeightAt(0.37, 0.62)).toBe(waterHeightAt(0.37, 0.62));
  });

  it("wraps seamlessly in both axes", () => {
    // The lattice wraps by period, so 0 and 1 are the same point rather than
    // two independent samples that happen to be adjacent.
    for (const v of [0, 0.13, 0.5, 0.77]) {
      expect(waterHeightAt(0, v)).toBeCloseTo(waterHeightAt(1, v), 10);
      expect(waterHeightAt(v, 0)).toBeCloseTo(waterHeightAt(v, 1), 10);
    }
  });

  it("stays within the unit range", () => {
    for (let i = 0; i < 200; i++) {
      const h = waterHeightAt((i * 0.017) % 1, (i * 0.031) % 1);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it("actually varies rather than returning a constant", () => {
    // A hash that collapses would produce a flat, perfectly smooth surface —
    // which would look like a bug in the shader rather than in the noise.
    const samples = new Set<number>();
    for (let i = 0; i < 64; i++) samples.add(Math.round(waterHeightAt(i / 64, 0.25) * 1000));

    expect(samples.size).toBeGreaterThan(10);
  });

  it("is smooth — neighbours do not jump", () => {
    // Value noise with a smoothstep fade; a discontinuity here becomes a
    // visible crease once it is turned into a normal.
    const step = 1 / 512;
    let maxDelta = 0;
    for (let i = 0; i < 512; i++) {
      const a = waterHeightAt(i * step, 0.4);
      const b = waterHeightAt((i + 1) * step, 0.4);
      maxDelta = Math.max(maxDelta, Math.abs(a - b));
    }

    expect(maxDelta).toBeLessThan(0.1);
  });
});

describe("generateWaterNormalMap", () => {
  it("produces an RGBA buffer of the right size", () => {
    const data = generateWaterNormalMap(32);

    expect(data.length).toBe(32 * 32 * 4);
  });

  it("defaults to the shared size", () => {
    expect(generateWaterNormalMap().length).toBe(WATER_NOISE_SIZE * WATER_NOISE_SIZE * 4);
  });

  it("encodes unit normals", () => {
    const size = 32;
    const data = generateWaterNormalMap(size);

    for (let i = 0; i < data.length; i += 4) {
      const x = (data[i] / 255) * 2 - 1;
      const y = (data[i + 1] / 255) * 2 - 1;
      const z = (data[i + 2] / 255) * 2 - 1;
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(1, 1);
    }
  });

  it("points mostly up, as a normal map should", () => {
    // Tangent-space Z is the surface normal. A map whose blue channel wandered
    // would light the water as though it were crumpled foil.
    const data = generateWaterNormalMap(32);

    for (let i = 2; i < data.length; i += 4) {
      expect(data[i]).toBeGreaterThan(160);
    }
  });

  it("is opaque throughout", () => {
    const data = generateWaterNormalMap(16);

    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it("tiles: the seam is no worse than any interior neighbour", () => {
    // The whole reason for the wrapped lattice. Sampled as a repeating texture,
    // a mismatch here draws a grid across every pool in the game.
    //
    // Column 0 and the last column are NEIGHBOURS once wrapped, not duplicates,
    // so they should differ about as much as any other adjacent pair — which is
    // the assertion, rather than a magic tolerance that has to be retuned every
    // time the noise changes.
    const size = 64;
    const data = generateWaterNormalMap(size);
    const at = (x: number, y: number) => {
      const i = (y * size + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const diff = (ax: number, ay: number, bx: number, by: number) => {
      const a = at(ax, ay);
      const b = at(bx, by);
      return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    };

    let interior = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size - 1; x++) {
        interior = Math.max(interior, diff(x, y, x + 1, y), diff(y, x, y, x + 1));
      }
    }

    let seam = 0;
    for (let i = 0; i < size; i++) {
      seam = Math.max(seam, diff(size - 1, i, 0, i), diff(i, size - 1, i, 0));
    }

    expect(seam).toBeLessThanOrEqual(interior);
  });

  it("is stable across calls, so two scenes get the same water", () => {
    const a = generateWaterNormalMap(16);
    const b = generateWaterNormalMap(16);

    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("scales its bumpiness with strength", () => {
    const soft = generateWaterNormalMap(32, 0.5);
    const harsh = generateWaterNormalMap(32, 4);

    // A stronger height gradient tilts normals further from straight up, so
    // the blue channel averages lower.
    const meanBlue = (d: Uint8Array) => {
      let sum = 0;
      for (let i = 2; i < d.length; i += 4) sum += d[i];
      return sum / (d.length / 4);
    };

    expect(meanBlue(harsh)).toBeLessThan(meanBlue(soft));
  });
});
