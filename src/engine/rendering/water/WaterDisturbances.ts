/** Cosmetic impulses, shared by the surface renderer and game interactions. */
import type { Scene } from "@babylonjs/core/scene";

export const MAX_WATER_IMPULSES = 12;
export const WATER_IMPULSE_LIFETIME = 2;
export const WATER_IMPULSE_RADIUS = 96;
export interface WaterImpulse {
  x: number;
  y: number;
  z: number;
  strength: number;
  age: number;
  radius: number;
  directionX: number;
  directionZ: number;
}

export class WaterDisturbances {
  resolveSurface?: (position: { x: number; y: number; z: number }) => { x: number; y: number; z: number } | null;
  readonly impulses: WaterImpulse[] = [];
  /** Two vec4s per impulse: position/age, strength/radius/directionXZ (zero = splash). */
  readonly uniforms = new Float32Array(MAX_WATER_IMPULSES * 8);
  /** Monotonic diagnostics: an expired impulse must not erase evidence of delivery. */
  accepted = 0;
  rejected = 0;
  lastResult = "No ripple requested";

  add(
    position: { x: number; y: number; z: number },
    strength: number,
    radius = WATER_IMPULSE_RADIUS,
    direction?: { x: number; z: number },
  ): boolean {
    if (
      ![position.x, position.y, position.z, strength, radius, direction?.x ?? 0, direction?.z ?? 0].every(
        Number.isFinite,
      ) ||
      strength <= 0 ||
      radius <= 0
    ) {
      this.rejected++;
      this.lastResult = "Rejected: invalid ripple parameters";
      return false;
    }
    if (this.resolveSurface) {
      const surface = this.resolveSurface(position);
      if (!surface) {
        this.rejected++;
        this.lastResult = "Rejected: no supported water surface near this position";
        return false;
      }
      position = surface;
    }
    if (this.impulses.length === MAX_WATER_IMPULSES) this.impulses.shift();
    const length = Math.hypot(direction?.x ?? 0, direction?.z ?? 0);
    this.impulses.push({
      ...position,
      strength: Math.min(1, strength),
      radius: Math.min(128, radius),
      age: 0,
      directionX: length > 0.001 ? direction!.x / length : 0,
      directionZ: length > 0.001 ? direction!.z / length : 0,
    });
    this.accepted++;
    this.lastResult = `Accepted at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`;
    return true;
  }

  update(dt: number): void {
    for (let i = this.impulses.length - 1; i >= 0; i--) {
      this.impulses[i].age += Math.max(0, dt);
      if (this.impulses[i].age >= WATER_IMPULSE_LIFETIME) this.impulses.splice(i, 1);
    }
  }

  /** Membership is supplied by the owning surface, not inferred from liquid kind. */
  pack(contains: (x: number, y: number, z: number) => boolean): Float32Array {
    this.uniforms.fill(0);
    let i = 0;
    for (const impulse of this.impulses) {
      if (!contains(impulse.x, impulse.y, impulse.z)) continue;
      const offset = i * 8;
      this.uniforms[offset] = impulse.x;
      this.uniforms[offset + 1] = impulse.y;
      this.uniforms[offset + 2] = impulse.z;
      this.uniforms[offset + 3] = impulse.age;
      this.uniforms[offset + 4] = impulse.strength;
      this.uniforms[offset + 5] = impulse.radius;
      this.uniforms[offset + 6] = impulse.directionX;
      this.uniforms[offset + 7] = impulse.directionZ;
      i++;
    }
    return this.uniforms;
  }
}

const byScene = new WeakMap<Scene, WaterDisturbances>();
export function waterDisturbancesFor(scene: Scene): WaterDisturbances {
  let impulses = byScene.get(scene);
  if (!impulses) {
    impulses = new WaterDisturbances();
    byScene.set(scene, impulses);
  }
  return impulses;
}

export function clearWaterDisturbances(scene: Scene): void {
  byScene.delete(scene);
}
