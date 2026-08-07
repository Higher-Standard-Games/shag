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
  it("gives every liquid a sky colour brighter than its deep body", () => {
    // The sky term is what Fresnel varies toward, and it is the reason ripples
    // are visible at all. A sky darker than the water would make waves read as
    // dirt rather than as light.
    //
    // Compared against DEEP rather than shallow: Fresnel only matters at
    // grazing angles, and a grazing ray passes through a lot of liquid, so the
    // body it is reflecting off is the deep colour. Shallow is now the
    // near-clear shoreline tint and is naturally lighter than any reflection.
    for (const kind of KINDS) {
      const p = WATER_PROFILES[kind];
      const luma = (c: { r: number; g: number; b: number }) => c.r * 0.3 + c.g * 0.6 + c.b * 0.1;
      expect(luma(p.sky)).toBeGreaterThan(luma(p.deep));
    }
  });

  it("keeps deep darker than shallow", () => {
    for (const kind of KINDS) {
      const p = WATER_PROFILES[kind];
      expect(p.deep.r + p.deep.g + p.deep.b).toBeLessThan(p.shallow.r + p.shallow.g + p.shallow.b);
    }
  });

  it("makes a shoreline nearly invisible", () => {
    // The number that separates water from a sheet of coloured film. Opacity
    // now follows THICKNESS, so the edge of a pool has to almost vanish even
    // though its middle is opaque — lowering the single flat alpha, which is
    // what the earlier tuning did, only ever made the whole surface hazier.
    expect(WATER_PROFILES.water.minAlpha).toBeLessThan(0.1);
  });

  it("hides the floor of a deep pool", () => {
    // The other end of the same axis: thick water is not a window.
    expect(WATER_PROFILES.water.alpha).toBeGreaterThan(0.6);
  });

  it("gives lava no transparency at any thickness", () => {
    expect(WATER_PROFILES.lava.alpha).toBe(1);
    expect(WATER_PROFILES.lava.minAlpha).toBe(1);
  });

  it("foams at a water shoreline but not at a lava one", () => {
    // Water laps at an edge; lava crusts. A white band on lava would read as
    // steam it is not producing.
    expect(WATER_PROFILES.water.foam).toBeGreaterThan(0);
    expect(WATER_PROFILES.lava.foam).toBe(0);
  });

  it("keeps the foam band inside the absorption curve's early range", () => {
    // Foam fades out over this many units of RAY LENGTH — the same measure
    // absorption uses, not vertical depth. The first version used 20, which is
    // a couple of pixels at any angle worth standing at, and the foam was
    // invisible.
    //
    // The bound that matters is relative: foam should live where the water is
    // still mostly clear, so it reads as an edge rather than a wash over the
    // whole shallow end. Past ~40% absorbed it has stopped being an edge.
    for (const kind of KINDS) {
      const p = WATER_PROFILES[kind];
      if (p.foam === 0) continue;
      const absorbedAtFoamEdge = 1 - Math.exp(-p.absorb * p.foamWidth);
      expect(absorbedAtFoamEdge).toBeLessThan(0.4);
    }
  });

  it("makes thicker liquids absorb faster", () => {
    // Slime and lava swallow their own floor over a much shorter distance than
    // water does; if this ever inverts, lava reads as red water.
    expect(WATER_PROFILES.slime.absorb).toBeGreaterThan(WATER_PROFILES.water.absorb);
    expect(WATER_PROFILES.lava.absorb).toBeGreaterThan(WATER_PROFILES.slime.absorb);
  });

  it("absorbs water over a plausible RAY LENGTH, not a pool depth", () => {
    // 1 - exp(-absorb * thickness), where thickness is the distance the view
    // ray travels through liquid — not how deep the pool is.
    //
    // Those are very different numbers. Standing at a poolside looking across,
    // a ray enters the surface and travels a long way before it reaches the
    // floor, so a pool 200 units deep routinely presents 600+ units of water
    // to the eye. Tuning against vertical depth is what made the middle of
    // every pool saturate from any angle worth standing at.
    const absorb = WATER_PROFILES.water.absorb;
    const at = (t: number) => 1 - Math.exp(-absorb * t);

    // A shoreline: a few units of water, essentially clear.
    expect(at(10)).toBeLessThan(0.05);
    // Looking straight down into a deep pool: tinted, floor still visible.
    expect(at(200)).toBeGreaterThan(0.3);
    expect(at(200)).toBeLessThan(0.75);
    // A long grazing ray across the pool: the floor is gone.
    expect(at(900)).toBeGreaterThan(0.9);
  });

  it("caps reflection well below a mirror", () => {
    // Uncapped Fresnel turned the far half of a pool into a sheet of white,
    // because the surface reflects one constant bright colour rather than the
    // scene. Physical accuracy is the wrong target until there is a real
    // capture to reflect.
    for (const kind of KINDS) {
      expect(WATER_PROFILES[kind].reflectivity).toBeGreaterThan(0);
      expect(WATER_PROFILES[kind].reflectivity).toBeLessThanOrEqual(0.5);
    }
  });

  it("never lets a thin grazing view go fully opaque", () => {
    // alpha = minAlpha + fresnel * reflectivity * (1 - minAlpha) where the
    // water is thin. Looking across a shallow edge must still show what is
    // under it.
    const p = WATER_PROFILES.water;
    const grazing = p.minAlpha + p.reflectivity * (1 - p.minAlpha);

    expect(grazing).toBeLessThan(0.8);
  });

  it("makes lava its own light source and water none", () => {
    expect(WATER_PROFILES.water.emissive).toBe(0);
    expect(WATER_PROFILES.lava.emissive).toBeGreaterThan(0.5);
  });
});
