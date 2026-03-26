/**
 * PointLightPool — Global pool of reusable PointLights.
 *
 * Pre-creates a fixed number of PointLights at init time so the scene
 * light count never changes. This prevents Babylon.js shader recompilation
 * when effects (projectiles, explosions, impacts) create/destroy lights.
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
   * Pre-create all pool lights (call once during scene init).
   * Lights start disabled so they don't affect anything.
   */
  init(scene: Scene): void {
    if (this.initialized) return;

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new PointLight(`_pool_light_${i}`, Vector3.Zero(), scene);
      light.intensity = 0;
      light.range = 0;
      light.setEnabled(false);

      this.entries.push({
        light,
        inUse: false,
        acquireTime: 0,
      });
    }

    this.initialized = true;
    console.log(`[PointLightPool] Initialized with ${POOL_SIZE} lights`);
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
    light.setEnabled(true);

    return light;
  }

  /**
   * Release a light back to the pool.
   * The light is disabled and hidden.
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
    light.intensity = 0;
    light.range = 0;
    light.setEnabled(false);
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
