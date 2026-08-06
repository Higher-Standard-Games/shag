/**
 * Water tuning (water Phase 3).
 *
 * These exist because the first version shipped a surface that rendered
 * correctly and looked like a photograph of water. Two numbers were wrong and
 * neither was catchable by a shader that compiles: the scroll rate was
 * 0.013 UV/sec at a scale where one tile spanned 182 world units, so waves
 * crossed a pool in about 160 seconds; and Fresnel drove only opacity, so the
 * per-pixel wave normals produced almost no brightness variation to watch.
 *
 * The first is now expressible as a world speed and asserted here. The second
 * is a shader change these cannot see — noted so the next person knows this
 * file does not cover it.
 */

import { describe, expect, it } from "vitest";
import { scrollRateFor, WATER_PROFILES, type WaterKind } from "../rendering/water/UnifiedWaterMaterial";

const KINDS: WaterKind[] = ["water", "slime", "lava"];

describe("wave motion", () => {
  it("moves fast enough to be seen", () => {
    // A player standing at a pool should see the surface travel a body length
    // in a couple of seconds. Below roughly 5 units/sec it reads as a still
    // image, which is exactly what shipped first.
    for (const kind of KINDS) {
      expect(WATER_PROFILES[kind].waveSpeed).toBeGreaterThanOrEqual(5);
    }
  });

  it("does not move so fast it reads as a flowing river", () => {
    // Standing water should drift, not stream. The upper bound is what stops a
    // tuning pass from over-correcting the bug this file exists for.
    for (const kind of KINDS) {
      expect(WATER_PROFILES[kind].waveSpeed).toBeLessThanOrEqual(60);
    }
  });

  it("crosses a typical pool in a few seconds, not minutes", () => {
    // acidwdm2's pool is 384 units across. The original tuning took 160
    // seconds to traverse it; this pins the order of magnitude rather than a
    // specific number.
    const poolWidth = 384;
    const seconds = poolWidth / WATER_PROFILES.water.waveSpeed;

    expect(seconds).toBeLessThan(30);
  });

  it("makes thicker liquids move more slowly", () => {
    // Slime rolls and lava crawls. If these ever invert, lava will read as
    // water with a red filter over it.
    expect(WATER_PROFILES.slime.waveSpeed).toBeLessThan(WATER_PROFILES.water.waveSpeed);
    expect(WATER_PROFILES.lava.waveSpeed).toBeLessThan(WATER_PROFILES.slime.waveSpeed);
  });
});

describe("wave scale", () => {
  it("fits several waves across a pool rather than one smear", () => {
    // One tile per `1 / scale` world units. A 384-unit pool wants a handful of
    // wave periods across it; one tile spanning half the pool is the "broad
    // smear" look.
    for (const kind of KINDS) {
      const tileSize = 1 / WATER_PROFILES[kind].scale;
      expect(tileSize).toBeLessThan(250);
      expect(tileSize).toBeGreaterThan(40);
    }
  });
});

describe("scrollRateFor", () => {
  it("converts world speed to a UV rate", () => {
    const profile = WATER_PROFILES.water;

    expect(scrollRateFor(profile)).toBeCloseTo(profile.waveSpeed * profile.scale, 10);
  });

  it("keeps the UV rate sane at every profile", () => {
    // Far above 1 UV/sec and consecutive frames sample uncorrelated noise,
    // which stops looking like motion and starts looking like static.
    for (const kind of KINDS) {
      const rate = scrollRateFor(WATER_PROFILES[kind]);
      expect(rate).toBeGreaterThan(0.01);
      expect(rate).toBeLessThan(1);
    }
  });
});

describe("liquid appearance", () => {
  it("gives every liquid a sky colour brighter than its body", () => {
    // The sky term is what Fresnel varies toward, and it is the reason ripples
    // are visible at all. A sky darker than the water would make waves read as
    // dirt rather than as light.
    for (const kind of KINDS) {
      const p = WATER_PROFILES[kind];
      const luma = (c: { r: number; g: number; b: number }) => c.r * 0.3 + c.g * 0.6 + c.b * 0.1;
      expect(luma(p.sky)).toBeGreaterThan(luma(p.shallow));
    }
  });

  it("keeps deep darker than shallow", () => {
    for (const kind of KINDS) {
      const p = WATER_PROFILES[kind];
      expect(p.deep.r + p.deep.g + p.deep.b).toBeLessThan(p.shallow.r + p.shallow.g + p.shallow.b);
    }
  });

  it("lets you see into water and not into lava", () => {
    expect(WATER_PROFILES.water.alpha).toBeLessThan(0.85);
    expect(WATER_PROFILES.lava.alpha).toBe(1);
  });

  it("makes lava its own light source and water none", () => {
    expect(WATER_PROFILES.water.emissive).toBe(0);
    expect(WATER_PROFILES.lava.emissive).toBeGreaterThan(0.5);
  });
});
