/**
 * World (atmospheric) fog as Warfork maps set it in worldspawn, read the way
 * Warfork reads it (r_q3bsp.c, commit 815e344). Values stay in Quake units and
 * axes (Z up); `worldFogToEngine` turns them into engine space.
 *
 *   fog        "fog_dist r g b [mindist]"            fog on: ~95% opaque at fog_dist
 *   fog_height "z_clear z_full"                       height band
 *   fog_sun    "dx dy dz r g b [intensity] [exponent]" sun glow through the fog
 *   fog_sky    "[horizon_bias] [horizon_scale] [zenith_falloff]" sky horizon tint
 *
 * Each key may also start with an underscore. Density is Beer-Lambert's
 * extinction coefficient, 3 / fog_dist, so 1 - e^-3 ≈ 95% at fog_dist.
 */

export interface WorldFogConfig {
  color: [number, number, number];
  /** Extinction per unit: 3 / fog_dist. */
  density: number;
  /** Distance at which the fog starts. */
  minDist: number;
  /** Height band in Quake Z: clear at `clear`, full at `full`. */
  height: { clear: number; full: number } | null;
  /** Sun glow; `dir` normalised, Quake axes. */
  sun: { dir: [number, number, number]; color: [number, number, number]; intensity: number; exponent: number } | null;
  sky: { horizonBias: number; horizonScale: number; zenithFalloff: number } | null;
}

/** Leading numbers of a value, as C's sscanf("%f %f …") reads them: stops at the first non-number. */
export function leadingNumbers(value: string | undefined, max: number): number[] {
  const out: number[] = [];
  for (const token of (value ?? "").trim().split(/\s+/)) {
    if (out.length >= max || token === "") break;
    const n = Number.parseFloat(token);
    if (!Number.isFinite(n)) break;
    out.push(n);
  }
  return out;
}

function key(properties: Record<string, string>, name: string): string | undefined {
  // Warfork compares keys with Q_stricmp and accepts a leading underscore
  for (const [k, v] of Object.entries(properties)) {
    const lower = k.toLowerCase();
    if (lower === name || lower === `_${name}`) return v;
  }
  return undefined;
}

/** The map's world fog from its worldspawn keys, or null when it sets none. */
export function parseWorldFog(properties: Record<string, string>): WorldFogConfig | null {
  const fog = leadingNumbers(key(properties, "fog"), 5);
  if (fog.length < 4) return null;
  const [fogDist, r, g, b, minDist] = fog;
  const config: WorldFogConfig = {
    color: [r, g, b],
    density: fogDist > 0 ? 3 / fogDist : 0,
    minDist: fog.length >= 5 ? Math.max(0, minDist) : 0,
    height: null,
    sun: null,
    sky: null,
  };

  const height = leadingNumbers(key(properties, "fog_height"), 2);
  if (height.length >= 2 && height[0] !== height[1]) config.height = { clear: height[0], full: height[1] };

  const sun = leadingNumbers(key(properties, "fog_sun"), 8);
  if (sun.length >= 6) {
    let [dx, dy, dz] = sun;
    const length = Math.hypot(dx, dy, dz);
    if (length > 0.0001) {
      dx /= length;
      dy /= length;
      dz /= length;
    }
    config.sun = {
      dir: [dx, dy, dz],
      color: [sun[3], sun[4], sun[5]],
      intensity: sun[6] ?? 1.5,
      exponent: Math.max(1, sun[7] ?? 16),
    };
  }

  const sky = leadingNumbers(key(properties, "fog_sky"), 3);
  if (sky.length >= 1) {
    config.sky = { horizonBias: sky[0], horizonScale: sky[1] ?? 2, zenithFalloff: sky[2] ?? 3 };
  }
  return config;
}

/** World fog in engine space: Quake Z (height, sun Z) becomes engine Y. */
export interface EngineWorldFog extends Omit<WorldFogConfig, "sun"> {
  sun: { dir: [number, number, number]; color: [number, number, number]; intensity: number; exponent: number } | null;
}

export function worldFogToEngine(fog: WorldFogConfig): EngineWorldFog {
  return {
    ...fog,
    // Heights are Quake Z, which is engine Y; the values themselves carry over
    height: fog.height ? { ...fog.height } : null,
    sun: fog.sun ? { ...fog.sun, dir: [fog.sun.dir[0], fog.sun.dir[2], fog.sun.dir[1]] } : null,
  };
}
