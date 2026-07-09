/**
 * PointLightPool — Global pool of reusable PointLights.
 *
 * Pre-creates a fixed number of PointLights at init time and keeps them
 * PERMANENTLY ENABLED (parked at intensity 0) so the scene's enabled-light
 * set never changes. Babylon derives material shader defines from the set of
 * enabled lights — toggling `setEnabled()` (or creating lights mid-game)
 * changes the defines and forces shader recompilation, which caused the
 * v0.9.16 first-shot hitch + transparent-wall flicker. An enabled light at
 * intensity 0 contributes nothing visually but keeps the defines stable.
 *
 * Usage:
 *   const pool = getPointLightPool();
 *   pool.init(scene);
 *   const light = pool.acquire(position, color, intensity, range);
 *   // ... use light ...
 *   pool.release(light);
 */

import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

const POOL_SIZE = 4;

interface PoolEntry {
  light: PointLight;
  inUse: boolean;
  acquireTime: number; // for recycling oldest
}

export class PointLightPool {
  private static instance: PointLightPool;
  private entries: PoolEntry[] = [];
  private initialized = false;

  private constructor() {}

  static getInstance(): PointLightPool {
    if (!PointLightPool.instance) {
      PointLightPool.instance = new PointLightPool();
    }
    return PointLightPool.instance;
  }

  /**
   * Pre-create all pool lights (call during scene init / map load, BEFORE
   * EffectPreloader force-compiles materials so the compiled shader variants
   * include these lights).
   *
   * Lights stay permanently ENABLED at intensity 0 — never toggled — so
   * material defines (and thus compiled shaders) are identical whether a
   * pool light is "in use" or parked.
   */
  init(scene: Scene): void {
    if (this.initialized) {
      // Same scene: nothing to do. New scene (map change): rebuild the pool
      // so the lights live in the active scene from load time.
      if (this.entries.length > 0 && this.entries[0].light.getScene() === scene) return;
      this.dispose();
    }

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new PointLight(`_pool_light_${i}`, Vector3.Zero(), scene);
      light.intensity = 0;
      light.range = 1;

      this.entries.push({
        light,
        inUse: false,
        acquireTime: 0,
      });
    }

    this.initialized = true;
    console.log(`[PointLightPool] Initialized with ${POOL_SIZE} always-enabled lights (intensity-parked)`);
  }

  /**
   * Acquire a light from the pool.
   * Returns null only if pool is exhausted AND forceRecycle is false.
   * With forceRecycle=true (default), steals the oldest active light.
   */
  acquire(position: Vector3, color: Color3, intensity: number, range: number, forceRecycle = true): PointLight | null {
    // Find a free entry
    let entry = this.entries.find((e) => !e.inUse);

    if (!entry) {
      if (!forceRecycle) return null;
      // Steal the oldest
      entry = this.entries.reduce((oldest, e) => (e.acquireTime < oldest.acquireTime ? e : oldest));
    }

    entry.inUse = true;
    entry.acquireTime = performance.now();

    const light = entry.light;
    light.position.copyFrom(position);
    light.diffuse = color;
    light.specular = color.scale(0.3);
    light.intensity = intensity;
    light.range = range;
    // NOTE: no setEnabled() — pool lights are permanently enabled. Toggling
    // enabled-state changes material defines → shader recompiles → flicker.

    return light;
  }

  /**
   * Release a light back to the pool.
   * The light is parked at intensity 0 (kept enabled — see class doc).
   */
  release(light: PointLight | null): void {
    if (!light) return;

    const entry = this.entries.find((e) => e.light === light);
    if (!entry) {
      // Not a pooled light — dispose it normally (safety valve)
      light.dispose();
      return;
    }

    entry.inUse = false;
    entry.acquireTime = 0;
    // Detach from any effect node BEFORE that node is disposed — a parented
    // light is a child Node and node.dispose() recurses into children, which
    // would destroy the pooled light and silently break the pool.
    light.parent = null;
    light.intensity = 0;
    light.range = 1;
  }

  /**
   * Check if a light belongs to this pool.
   */
  isPooled(light: PointLight): boolean {
    return this.entries.some((e) => e.light === light);
  }

  /**
   * Dispose all pool lights (scene teardown).
   */
  dispose(): void {
    for (const entry of this.entries) {
      entry.light.dispose();
    }
    this.entries = [];
    this.initialized = false;
  }
}

/** Convenience accessor */
export function getPointLightPool(): PointLightPool {
  return PointLightPool.getInstance();
}
