/**
 * WeaponDef - Weapon entity definition
 *
 * Extends EntityDef with weapon-specific properties for firing,
 * aiming, muzzle flash, and other weapon behaviors.
 */

import type { EntityDef } from "./EntityDef";
import type { EntityType } from "./EntityType";

// ==================== SUB-INTERFACES ====================

/**
 * View model (first-person) positioning
 */
export interface ViewModelDef {
  /** Main weapon model path */
  modelPath: string;
  /** Optional hand model path */
  handModelPath?: string;
  /** Flash model path */
  flashModelPath?: string;

  /** Hip-fire position offset (x, y, z) */
  hipOffset: { x: number; y: number; z: number };
  /** Hip-fire rotation (pitch, yaw, roll in radians) */
  hipRotation: { x: number; y: number; z: number };

  /** ADS position offset */
  adsOffset: { x: number; y: number; z: number };
  /** ADS rotation */
  adsRotation: { x: number; y: number; z: number };

  /** Model scale */
  scale: number;

  /** Model format: 'md3' (default) or 'glb' */
  viewModelFormat?: "md3" | "glb";

  /**
   * Optional additive self-lit glow map (e.g. an energy coil). A glow texture is
   * black except the glowing regions, so it is applied as the material emissive:
   * only the bright regions light up, the body stays lit normally. Path is
   * resolved as a Babylon texture URL (supports .tga). Presentation-only.
   */
  glowTexture?: string;
}

/**
 * Aim Down Sights configuration
 */
export interface ADSDef {
  /** Time to reach full ADS (seconds) */
  time: number;
  /** FOV reduction when ADS (percentage, e.g., 15 = 15% reduction) */
  fovReduction: number;
  /** Sensitivity multiplier when ADS (0.5 = half normal) */
  sensitivity: number;
  /** Movement speed penalty (0.5 = half speed) */
  movementPenalty: number;
}

/**
 * Muzzle flash effect configuration
 */
export interface MuzzleFlashDef {
  /** Light color (RGB 0-1) */
  color: { r: number; g: number; b: number };
  /** Light intensity */
  intensity: number;
  /** Light range in game units */
  range: number;
  /** Flash duration in seconds */
  duration: number;
}

// ==================== CROSSHAIR CONFIG ====================

/** Crosshair visual config per weapon */
export interface CrosshairConfig {
  /** Draw style */
  style: "cross" | "dot" | "circle" | "cross_dot";
  /** Center gap in pixels (hip-fire spread) */
  baseGap: number;
  /** Arm length in pixels */
  lineLength: number;
  /** Arm thickness in pixels */
  lineWidth: number;
  /** Override color (hex without #). Falls back to cg_crosshairColor cvar */
  color?: string;
}

export type WeaponReloadModel = "clip" | "pool" | "none";

// ==================== WEAPON DEF ====================

/**
 * Full weapon definition
 */
export interface WeaponDef extends EntityDef {
  type: EntityType.WEAPON;

  // === SERVER-AUTHORITATIVE (gameplay) ===
  /** Damage per shot */
  damage: number;
  /** Fire rate (rounds per second) */
  fireRate: number;
  /**
   * Explicit refire interval in server ticks (125 Hz), overriding the value
   * derived from `fireRate`. Fire cadence is tick-quantized (8 ms/tick at 125 Hz),
   * so a `fireRate` that doesn't divide 125 cannot be hit exactly — set this to
   * pin the intended tick count. When unset, the interval is `round(125/fireRate)`.
   */
  fireIntervalTicks?: number;
  /** Ammo per clip */
  clipSize: number;
  /**
   * Ammo/reload behavior:
   * - clip: magazine + reserve, reload moves reserve into clip
   * - pool: one ammo pool, no reload
   * - none: infinite/no ammo consumption
   */
  reloadModel?: WeaponReloadModel;
  /** Ammo Type (string identifier) */
  ammoType?: string;
  /** Max reserve ammo */
  maxAmmo: number;
  /** Time to reload (seconds) */
  reloadTime: number;
  /** Max effective range */
  range: number;
  /** Projectile ID (if projectile weapon) */
  projectileId?: string;
  /** Is hitscan (instant hit)? */
  hitscan?: boolean;
  /** Hitscan visual effect type (only relevant when hitscan=true) */
  hitscanType?: "tracer" | "pellet" | "beam" | "bolt";

  /** Hip-fire spread angle in degrees (0 = perfect accuracy) */
  spread?: number;
  /** ADS spread angle in degrees (typically tighter than hip spread) */
  adsSpread?: number;

  /** Firing mode */
  fireMode: "auto" | "semi" | "burst";
  /** When true, firing from hip forces ADS transition before shot.
   *  Server delays fire by ads.time; client auto-enters ADS on fire press. */
  hipfireBlocked?: boolean;
  /** Shots per burst (if fireMode is 'burst') */
  burstCount?: number;

  /** Pickup collision box dimensions (default 32x32x32) */
  pickupBounds?: { x: number; y: number; z: number };

  // === SERVER-AUTHORITATIVE (combat) ===
  /** Number of pellets per shot (for shotguns) */
  pelletCount?: number;
  /** Splash damage radius */
  splashRadius?: number;
  /** Max splash damage (at center) */
  splashDamage?: number;
  /** Min splash damage (at outer edge of radius, Warsow-style floor) */
  minSplashDamage?: number;
  /** Knockback scale (multiplied by damage to get impulse force) */
  knockbackScale?: number;
  /** For projectile: speed in units/sec */
  projectileSpeed?: number;
  /**
   * Projectile gravity multiplier (× base 800 u/s²). 0 = flies perfectly straight
   * along the crosshair (rockets, plasma, blasts); >0 = arcs downward (grenades).
   * Default 0 when unset.
   */
  projectileGravity?: number;
  /** Whether to use lag compensation for hitscan */
  useLagCompensation?: boolean;
  /** Ammo given on pickup (defaults to maxAmmo if unset) */
  pickupAmmo?: number;

  // === CHAIN LIGHTNING (voltaic) ===
  /** Number of extra enemies the beam arcs to after the primary hit (0 = none) */
  chainCount?: number;
  /** Max distance (units) between chain links */
  chainRadius?: number;
  /** Damage multiplier applied per hop (e.g. 0.5 → 100% / 50% / 25%) */
  chainFalloff?: number;
  /**
   * Unstable-beam hipfire wander (degrees). The beam's aim sweeps in a smooth
   * deterministic arc when firing from the hip, so it bends and drifts off distant
   * targets; holding ADS zeroes it (pinpoint). 0/unset = stable beam.
   */
  beamWanderDeg?: number;

  // === MELEE ===
  /** Melee hit detection radius (wider than hitscan ray) */
  meleeRadius?: number;
  /** Delay before melee damage check (seconds) — gives dodge window */
  meleeDamageDelay?: number;
  /** Server-authoritative forward lunge distance on accepted melee primary fire. */
  meleeDashDistance?: number;

  // === CHARGED ATTACK ===
  /** Time to hold fire for max charged attack (seconds) */
  chargeTime?: number;
  /** Minimum charge time before projectile can fire (seconds) */
  chargeMinTime?: number;
  /** Projectile launched on charged release */
  chargedProjectileId?: string;
  /** Damage at minimum charge */
  chargedDamageMin?: number;
  /** Damage at full charge */
  chargedDamageMax?: number;
  /** @deprecated Use chargedDamageMax instead */
  chargedDamage?: number;

  // === MOVEMENT ===
  /** Bonus movement speed while this weapon is equipped (e.g., +25 for blade) */
  speedBonus?: number;

  /** Recoil scale (1.0 = normal, 0.1 = minimal for energy weapons) */
  recoilScale?: number;

  /** Crosshair visual config */
  crosshair?: CrosshairConfig;

  // === CLIENT-SIDE (visuals) ===
  /** First-person view model */
  viewModel: ViewModelDef;
  /** Third-person/world model path */
  worldModelPath?: string;

  /** Muzzle flash configuration */
  muzzleFlash: MuzzleFlashDef;

  /** ADS configuration */
  ads: ADSDef;

  /** Barrel sub-model attachments (spinning chambers, rolling clips) */
  barrels?: {
    /** Path to barrel GLB model (relative to public/) */
    modelPath: string;
    /** Continuous spin speed (radians per second, 0 = no spin) */
    spinSpeed: number;
    /** Spin direction multiplier (1 or -1 for counter-rotation) */
    spinDirection?: number;
    /** Offset from weapon origin (x, y, z in model space) */
    offset?: { x: number; y: number; z: number };
    /** Spin axis: 'x' (default), 'y', or 'z' */
    spinAxis?: "x" | "y" | "z";
  }[];

  // === SOUNDS ===
  sounds: {
    fire: string;
    reload?: string;
    empty?: string;
    switchTo?: string;
    switchAway?: string;
  };
}

// ==================== DEFAULTS ====================

export const WEAPON_DEFAULTS: Partial<WeaponDef> = {
  damage: 10,
  fireRate: 5,
  clipSize: 30,
  reloadModel: "pool",
  maxAmmo: 120,
  reloadTime: 2.0,
  range: 1000,
  hitscan: false,
  spread: 0,
  adsSpread: 0,
  fireMode: "auto",
  pickupBounds: { x: 32, y: 32, z: 32 },
  ads: {
    time: 0.08,
    fovReduction: 15,
    sensitivity: 0.5,
    movementPenalty: 0.5,
  },
  muzzleFlash: {
    color: { r: 1.0, g: 0.8, b: 0.3 }, // Orange-yellow
    intensity: 15,
    range: 30,
    duration: 0.05,
  },
};
