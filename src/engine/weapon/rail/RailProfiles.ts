/**
 * Electrobolt rail presentation constants.
 *
 * The rail is an *instantaneous* one-shot effect (a hitscan sniper shot), unlike
 * the Voltaic beam which is a held continuous stream. That difference is why the
 * rail needs none of Voltaic's hero-anchoring machinery: every shot — local or
 * remote — is a single transient spawned at fire time and faded over ~0.5 s, so
 * one thin-instanced batch of one-shot slots serves the whole scene.
 *
 * It reuses the Voltaic *grammar* (billboarded quad-strip templates, the
 * per-instance iStartSeed/iEndImpact/iColorLife/iParams buffer layout, and the
 * impact nucleus/ring template) with a new analytic-helix beam shader — cold
 * blue-white core, twin helix wrap, muzzle crack + terminal nucleus.
 */

// Reuse the Voltaic seed hash + impact-kind encoding so the two effects share
// one presentation vocabulary (and one place to change it).
export {
  impactKindToFloat,
  makeVoltaicSeed as makeRailSeed,
  type VoltaicEffectSample as RailEffectSample,
  type VoltaicImpactKind as RailImpactKind,
} from "../voltaic/VoltaicProfiles";

/** Presentation-part ids carried in the strip templates' `position.z`. */
export const RAIL_PART = {
  GLOW: 0, // wide, soft outer sheath (straight)
  CORE: 1, // thin white-blue hot core (straight)
  HELIX_A: 2, // helical wrap
  HELIX_B: 3, // helical wrap, opposite phase
} as const;

/** One-shot lifetime, seconds. Holds full for the first ~35% then fades out. */
export const RAIL_DURATION = 0.55;

/** How many times the helix wraps the core over the beam length. */
export const RAIL_HELIX_TURNS = 7.0;

/** Helix radius in world units (also passed as the `amplitude` instance param). */
export const RAIL_HELIX_RADIUS = 4.0;
