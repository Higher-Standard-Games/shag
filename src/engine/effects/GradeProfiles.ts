/**
 * Colour-grade profiles ("mood"): named looks that blend, so a map or the
 * game can tint the picture towards ember red near a fire, cold blue on a
 * mountain, or sepia for a memory, and crossfade as the camera moves.
 *
 * A profile is data: a channel-mixing matrix, lift / gamma / gain (shadows,
 * midtones, highlights), saturation, contrast, exposure, a tint, a shaped
 * vignette, and an optional lookup table (a 16x16x16 colour cube laid out as
 * a 256x16 strip, the usual LUT image). Every field is optional; a missing
 * field is neutral.
 *
 * `GradeMixer` turns weighted profiles into one set of numbers per frame:
 * each profile pulls the result away from neutral by its weight
 * (`neutral + sum(weight * (profile - neutral))`), so two half-weighted
 * profiles mix and one fully weighted profile is exact. Weights come from
 * layers the game pushes and pops with fades, and from zones (a point, a
 * radius and a falloff) that weigh themselves by distance to a point the
 * caller passes in (the camera's target). Up to two lookup tables blend at
 * once; the two heaviest win.
 *
 * This file only does the numbers; `DioramaPostProcess` applies them.
 */

export type Rgb = [number, number, number];
/** Row-major 3x3, applied as `out = M * rgb`. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface GradeProfile {
  matrix?: Mat3;
  /** Added to the shadows (0 = none). */
  lift?: Rgb;
  /** Midtone power (1 = none; above 1 brightens). */
  gamma?: Rgb;
  /** Multiplies the highlights (1 = none). */
  gain?: Rgb;
  /** Multiplies everything (1 = none). */
  tint?: Rgb;
  saturation?: number;
  /** Around mid grey (1 = none). */
  contrast?: number;
  /** In stops (0 = none). */
  exposure?: number;
  /** Extra vignette darkness (0 = none) and its colour. */
  vignette?: number;
  vignetteColor?: Rgb;
  /** A LUT strip image (URL or PK3 path) and how much of it to apply (default 1). */
  lut?: string;
  lutAmount?: number;
}

/** The blended numbers, ready for a shader. */
export interface GradeState {
  matrix: Mat3;
  lift: Rgb;
  gamma: Rgb;
  gain: Rgb;
  tint: Rgb;
  saturation: number;
  contrast: number;
  exposure: number;
  vignette: number;
  vignetteColor: Rgb;
  /** Up to two lookup tables with their amounts. */
  luts: { lut: string; amount: number }[];
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function neutralGrade(): GradeState {
  return {
    matrix: [...IDENTITY],
    lift: [0, 0, 0],
    gamma: [1, 1, 1],
    gain: [1, 1, 1],
    tint: [1, 1, 1],
    saturation: 1,
    contrast: 1,
    exposure: 0,
    vignette: 0,
    vignetteColor: [0, 0, 0],
    luts: [],
  };
}

/** A few starting looks; games register their own with `GradeMixer.define`. */
export const BUILT_IN_GRADES: Record<string, GradeProfile> = {
  neutral: {},
  /** Late afternoon: warm highlights, slightly lifted amber shadows. */
  golden: { gain: [1.08, 1.0, 0.86], lift: [0.012, 0.006, 0], saturation: 1.08, contrast: 1.05 },
  /** Fire nearby: red-orange, deep shadows, heavy vignette. */
  burning: {
    matrix: [1.12, 0.08, 0, 0.06, 0.88, 0, 0.02, 0.04, 0.7],
    gain: [1.15, 0.92, 0.72],
    lift: [0.02, 0.0, -0.005],
    saturation: 1.15,
    contrast: 1.18,
    vignette: 0.45,
    vignetteColor: [0.18, 0.02, 0],
  },
  /** Night: blue, darker, less colour; warm lights still read against it. */
  night: {
    gain: [0.62, 0.72, 0.95],
    gamma: [0.9, 0.92, 1.0],
    saturation: 0.7,
    exposure: -0.6,
    vignette: 0.35,
    vignetteColor: [0, 0.01, 0.04],
  },
  /** Cold, high ground: teal shadows, pale highlights. */
  cold: { lift: [-0.01, 0.012, 0.035], gain: [0.88, 0.98, 1.12], saturation: 0.78, contrast: 1.05 },
  /** A memory or a dream: sepia, soft, faded blacks. */
  memory: {
    matrix: [0.48, 0.66, 0.16, 0.42, 0.62, 0.14, 0.33, 0.5, 0.12],
    lift: [0.03, 0.025, 0.015],
    contrast: 0.9,
    vignette: 0.5,
    vignetteColor: [0.08, 0.05, 0.02],
  },
};

interface Layer {
  name: string;
  weight: number;
  target: number;
  /** Weight change per second. */
  rate: number;
}

export interface GradeZone {
  profile: string;
  /** Centre, in whatever space the caller's `update(point)` uses. */
  x: number;
  y: number;
  z: number;
  /** Full weight inside this radius. */
  radius: number;
  /** Fades to zero over this distance past the radius. */
  falloff: number;
  /** Most weight the zone gives (default 1). */
  strength?: number;
}

export class GradeMixer {
  private readonly profiles = new Map<string, GradeProfile>(Object.entries(BUILT_IN_GRADES));
  private readonly layers: Layer[] = [];
  private zones: GradeZone[] = [];
  private readonly state = neutralGrade();

  /** Add or replace a named profile. */
  define(name: string, profile: GradeProfile): void {
    this.profiles.set(name, profile);
  }

  has(name: string): boolean {
    return this.profiles.has(name);
  }

  get names(): string[] {
    return [...this.profiles.keys()];
  }

  /** Fade a profile in as a layer on top (seconds; 0 = at once). */
  push(name: string, options: { fade?: number; weight?: number } = {}): void {
    const target = options.weight ?? 1;
    const fade = options.fade ?? 1;
    let layer = this.layers.find((l) => l.name === name);
    if (!layer) {
      layer = { name, weight: fade > 0 ? 0 : target, target, rate: 0 };
      this.layers.push(layer);
    }
    layer.target = target;
    layer.rate = fade > 0 ? 1 / fade : Infinity;
  }

  /** Fade a layer out and drop it (the last pushed when no name is given). */
  pop(name?: string, options: { fade?: number } = {}): void {
    const layer = name ? this.layers.find((l) => l.name === name) : this.layers[this.layers.length - 1];
    if (!layer) return;
    const fade = options.fade ?? 1;
    layer.target = 0;
    layer.rate = fade > 0 ? 1 / fade : Infinity;
  }

  /** Drop every layer at once. */
  clear(): void {
    this.layers.length = 0;
  }

  setZones(zones: GradeZone[]): void {
    this.zones = zones;
  }

  /** Current weight of each active source, for debugging. */
  get weights(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const layer of this.layers) out[`layer:${layer.name}`] = layer.weight;
    return out;
  }

  /**
   * Advance fades and blend. `base` is the always-on profile (a map's or the
   * console's), `point` weighs the zones.
   */
  update(dt: number, base: string, point: { x: number; y: number; z: number } | null): GradeState {
    for (const layer of this.layers) {
      const step = layer.rate * dt;
      layer.weight =
        layer.weight < layer.target
          ? Math.min(layer.target, layer.weight + step)
          : Math.max(layer.target, layer.weight - step);
    }
    for (let i = this.layers.length - 1; i >= 0; i--) {
      if (this.layers[i].target === 0 && this.layers[i].weight === 0) this.layers.splice(i, 1);
    }

    const sources: { profile: GradeProfile; weight: number }[] = [];
    const add = (name: string, weight: number) => {
      const profile = this.profiles.get(name);
      if (profile && weight > 0) sources.push({ profile, weight: Math.min(1, weight) });
    };
    add(base, 1);
    if (point) {
      for (const zone of this.zones) {
        const d = Math.hypot(point.x - zone.x, point.y - zone.y, point.z - zone.z);
        const w = d <= zone.radius ? 1 : 1 - (d - zone.radius) / Math.max(1, zone.falloff);
        add(zone.profile, Math.max(0, w) * (zone.strength ?? 1));
      }
    }
    for (const layer of this.layers) add(layer.name, layer.weight);
    return blend(sources, this.state);
  }
}

/** Blend weighted profiles into `out` (neutral plus each profile's weighted difference). */
export function blend(sources: { profile: GradeProfile; weight: number }[], out = neutralGrade()): GradeState {
  const n = neutralGrade();
  Object.assign(out, { ...n, matrix: [...n.matrix], luts: [] as GradeState["luts"] });
  const mixRgb = (target: Rgb, value: Rgb | undefined, neutral: Rgb, w: number) => {
    if (!value) return;
    for (let i = 0; i < 3; i++) target[i] += (value[i] - neutral[i]) * w;
  };
  const luts: { lut: string; amount: number }[] = [];
  let vignetteWeight = 0;
  const vignetteColor: Rgb = [0, 0, 0];
  for (const { profile: p, weight: w } of sources) {
    if (p.matrix) for (let i = 0; i < 9; i++) out.matrix[i] += (p.matrix[i] - IDENTITY[i]) * w;
    mixRgb(out.lift, p.lift, n.lift, w);
    mixRgb(out.gamma, p.gamma, n.gamma, w);
    mixRgb(out.gain, p.gain, n.gain, w);
    mixRgb(out.tint, p.tint, n.tint, w);
    if (p.saturation !== undefined) out.saturation += (p.saturation - 1) * w;
    if (p.contrast !== undefined) out.contrast += (p.contrast - 1) * w;
    if (p.exposure !== undefined) out.exposure += p.exposure * w;
    if (p.vignette !== undefined) {
      out.vignette += p.vignette * w;
      const c = p.vignetteColor ?? [0, 0, 0];
      for (let i = 0; i < 3; i++) vignetteColor[i] += c[i] * p.vignette * w;
      vignetteWeight += p.vignette * w;
    }
    if (p.lut) luts.push({ lut: p.lut, amount: (p.lutAmount ?? 1) * w });
  }
  if (vignetteWeight > 0) out.vignetteColor = vignetteColor.map((c) => c / vignetteWeight) as Rgb;
  luts.sort((a, b) => b.amount - a.amount);
  out.luts = luts.slice(0, 2).map((l) => ({ lut: l.lut, amount: Math.min(1, l.amount) }));
  return out;
}

/**
 * A lookup-table strip (256x16, RGBA bytes) for a colour transform, for
 * making LUT images in code. Slice b runs left to right; within a slice, red
 * runs left to right and green top to bottom (row 0, the top of the image, is
 * green 0). Load it without flipping (`invertY: false`).
 */
export function lutStrip(transform: (rgb: Rgb) => Rgb): Uint8Array {
  const size = 16;
  const bytes = new Uint8Array(size * size * size * 4);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = transform([r / (size - 1), g / (size - 1), b / (size - 1)]);
        const x = b * size + r;
        const y = g;
        const i = (y * size * size + x) * 4;
        for (let c = 0; c < 3; c++) bytes[i + c] = Math.round(Math.max(0, Math.min(1, out[c])) * 255);
        bytes[i + 3] = 255;
      }
    }
  }
  return bytes;
}
