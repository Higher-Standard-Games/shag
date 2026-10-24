/**
 * ExplosionEffect - Procedural cartoon explosion
 *
 * Layers, all procedural:
 * 1. Spiky fireball (deformed icosphere)
 * 2. Radial rays (stretched cones shooting outward)
 * 3. Sparks
 * 4. Flash light
 *
 * The first three are instances in `ExplosionBatchRenderer`, animated on the
 * GPU, so every live explosion draws in three calls and spawning one allocates
 * no meshes or materials. This class keeps the presets, the flash light and
 * the camera shake.
 */

import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../core/DevLog";
import { EXPLOSION_FIRE_TIME } from "./explosion/ExplosionBatchMaterial";
import { EXPLOSION_LIFETIME, ExplosionBatchRenderer } from "./explosion/ExplosionBatchRenderer";
import { getPointLightPool } from "./PointLightPool";

// Flash gain is independent of the procedural fireball's world-unit size.
const FLASH_LIGHT_GAIN = 0.1;

const DEFAULT_RAYS = { min: 8, max: 12 };

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ExplosionConfig {
  /** Overall scale multiplier (1.0 = rocket-sized) */
  scale: number;
  /** Time multiplier: an explosion plays out over 0.6 / speed seconds */
  speed: number;
  /** Core color (inner fireball) */
  coreColor: Color3;
  /** Outer color (flame edges) */
  outerColor: Color3;
  /** Smoke color */
  smokeColor: Color3;
  /** Camera shake intensity multiplier (default: 1.0, 0 = no shake) */
  shakeIntensity?: number;
  /** Max distance for camera shake in game units (default: 720) */
  shakeMaxRange?: number;
  /** Rays per explosion, drawn evenly from [min, max] (default 8 to 12) */
  rays?: { min: number; max: number };
}

/** Preset for rocket explosions */
export const ROCKET_EXPLOSION: ExplosionConfig = {
  scale: 13.0,
  speed: 0.85,
  coreColor: new Color3(1.0, 0.95, 0.6), // white-hot center
  outerColor: new Color3(1.0, 0.4, 0.05), // deep orange flames
  smokeColor: new Color3(0.3, 0.25, 0.2), // dark smoke
  shakeMaxRange: 540, // 25% reduced from 720
};

/** Preset for grenade explosions */
export const GRENADE_EXPLOSION: ExplosionConfig = {
  scale: 9.0,
  speed: 0.95,
  coreColor: new Color3(1.0, 0.9, 0.5), // warm white-yellow core
  outerColor: new Color3(1.0, 0.5, 0.1), // orange flames
  smokeColor: new Color3(0.3, 0.25, 0.2), // dark smoke
  shakeMaxRange: 540, // 25% reduced from 720
};

/** Preset for plasma explosions — small, fast, green */
export const PLASMA_EXPLOSION: ExplosionConfig = {
  scale: 3.0,
  speed: 1.5, // fast pop
  coreColor: new Color3(0.8, 1.0, 0.6), // bright white-green core
  outerColor: new Color3(0.1, 0.9, 0.2), // vivid green outer
  smokeColor: new Color3(0.1, 0.2, 0.1), // green-tinted smoke
  rays: { min: 4, max: 6 }, // a small pop; plasma fights spawn many
  shakeIntensity: 0.15, // minimal camera shake
  shakeMaxRange: 360, // half of default (close range only)
};

/** Preset for blade blast explosions — 50% of rocket, teal-themed */
export const BLADE_EXPLOSION: ExplosionConfig = {
  scale: 6.5, // 50% of rocket (13)
  speed: 1.1, // slightly faster than rocket
  coreColor: new Color3(0.7, 1.0, 0.95),
  outerColor: new Color3(0.05, 1.0, 0.9),
  smokeColor: new Color3(0.08, 0.2, 0.18),
  shakeIntensity: 0.5, // 50% of rocket shake
  shakeMaxRange: 270, // 50% of rocket range (540)
};

interface ActiveExplosion {
  config: ExplosionConfig;
  spawnTime: number;
  light: PointLight | null;
}

// ═══════════════════════════════════════════════════════════════════
// EXPLOSION EFFECT MANAGER
// ═══════════════════════════════════════════════════════════════════

export class ExplosionEffect {
  private static instance: ExplosionEffect;
  private scene: Scene | null = null;
  private renderer: ExplosionBatchRenderer | null = null;
  private explosions: ActiveExplosion[] = [];
  private readonly clock = () => performance.now() / 1000;

  private constructor() {}

  static getInstance(): ExplosionEffect {
    if (!ExplosionEffect.instance) {
      ExplosionEffect.instance = new ExplosionEffect();
    }
    return ExplosionEffect.instance;
  }

  init(scene: Scene): void {
    this.clear();
    this.scene = scene;
    this.rendererFor(scene);
    devLog("[ExplosionEffect] Initialized");
  }

  /** The batch for `scene`, rebuilt for a new scene or after a scene clear took its meshes. */
  private rendererFor(scene: Scene): ExplosionBatchRenderer {
    if (this.renderer && this.renderer.scene === scene && !this.renderer.isDisposed()) return this.renderer;
    this.renderer?.dispose();
    this.renderer = new ExplosionBatchRenderer(scene, this.clock);
    this.renderer.prewarm().catch((error) => {
      console.warn("[ExplosionEffect] Explosion shader prewarm failed; first use will retry compilation", error);
    });
    return this.renderer;
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Spawn an explosion at the given position
   * @param normal - surface hit normal: the fireball spreads across it
   */
  spawn(position: Vector3, config: ExplosionConfig = ROCKET_EXPLOSION, normal: Vector3 = Vector3.Up()): void {
    if (!this.scene || this.scene.isDisposed) return;

    this.rendererFor(this.scene).spawn(position, { ...config, rays: config.rays ?? DEFAULT_RAYS }, normal);
    const s = config.scale;
    const explosion: ActiveExplosion = { config, spawnTime: this.clock(), light: null };
    // The explosion owns its light, so the pool can take it back when it runs out
    explosion.light = getPointLightPool().acquire(
      position.clone(),
      config.outerColor.clone(),
      FLASH_LIGHT_GAIN * s,
      40 * s,
      explosion,
    );
    this.explosions.push(explosion);

    this.triggerCameraShake(position, config);
  }

  /**
   * Trigger distance-based camera shake from an explosion
   * Uses the splash radius to determine falloff range
   */
  private triggerCameraShake(explosionPos: Vector3, config: ExplosionConfig): void {
    // Use CameraSystem to get the active FPS controller's position (authoritative)
    import("../camera/CameraSystem")
      .then(({ CameraSystem }) => {
        const controller = CameraSystem.getInstance().getController("fps");
        if (!controller?.shakeCamera || !controller.getPlayerPosition) return;

        const playerPos = controller.getPlayerPosition();
        const distance = Vector3.Distance(explosionPos, playerPos);

        // Shake range: tuned for Q3/Warsow game unit distances
        const maxShakeRange = config.shakeMaxRange ?? 720;
        const fullShakeRange = maxShakeRange * 0.42; // ~42% of max = full intensity zone

        if (distance >= maxShakeRange) return;

        // Intensity: full within fullShakeRange, then smooth falloff to maxShakeRange
        let intensity: number;
        if (distance <= fullShakeRange) {
          intensity = 1.0;
        } else {
          const t = (distance - fullShakeRange) / (maxShakeRange - fullShakeRange);
          intensity = (1.0 - t) ** 2; // Quadratic falloff
        }

        // Scale by explosion size (rockets shake more than grenades)
        const sizeMultiplier = Math.min(config.scale / 10, 1.5);
        const shakeScale = config.shakeIntensity ?? 1.0;
        const finalIntensity = intensity * sizeMultiplier * shakeScale;

        if (finalIntensity < 0.01) return;

        controller.shakeCamera(finalIntensity);
      })
      .catch(() => {
        /* CameraSystem unavailable */
      });
  }

  /**
   * Update all active explosions (call each frame)
   */
  update(_deltaTime: number): void {
    const now = this.clock();
    this.renderer?.update();
    let kept = 0;
    for (const exp of this.explosions) {
      const age = (now - exp.spawnTime) * exp.config.speed;
      if (age >= EXPLOSION_LIFETIME) {
        getPointLightPool().release(exp.light);
        continue;
      }
      // The flash fades with the fire, over the first 0.6 of explosion time
      const t = Math.min(age / EXPLOSION_FIRE_TIME, 1.0);
      if (exp.light) {
        exp.light.intensity = FLASH_LIGHT_GAIN * exp.config.scale * (1.0 - t * t);
        exp.light.range = 40 * exp.config.scale * (1.0 - t * 0.5);
      }
      this.explosions[kept++] = exp;
    }
    this.explosions.length = kept;
  }

  /**
   * Clear all active explosions
   */
  clear(): void {
    for (const exp of this.explosions) getPointLightPool().release(exp.light);
    this.explosions = [];
    this.renderer?.clear();
  }

  /** Live explosions and their instances, for tests and diagnostics. */
  getDebugCounts(): { explosions: number } & ReturnType<ExplosionBatchRenderer["getDebugCounts"]> {
    const layers = this.renderer?.getDebugCounts() ?? { fireball: 0, ray: 0, spark: 0 };
    return { explosions: this.explosions.length, ...layers };
  }
}

export function getExplosionEffect(): ExplosionEffect {
  return ExplosionEffect.getInstance();
}
