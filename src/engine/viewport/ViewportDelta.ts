/**
 * ViewportDelta - Output type for viewport effects
 *
 * A camera-agnostic representation of viewport modifications.
 * Effects produce deltas, applicators interpret them for specific camera types.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export interface ViewportDelta {
  /** Camera position adjustment in world units */
  positionOffset: Vector3;
  /** Rotation adjustment in degrees (x=pitch, y=yaw, z=roll) */
  rotationOffset: Vector3;
  /** FOV scale multiplier (1.0 = no change, >1 = wider, <1 = narrower) */
  fovMultiplier: number;
}

/**
 * Create a neutral delta with no modifications
 */
export function createNeutralDelta(): ViewportDelta {
  return {
    positionOffset: Vector3.Zero(),
    rotationOffset: Vector3.Zero(),
    fovMultiplier: 1.0,
  };
}

/**
 * Combine multiple deltas additively
 */
export function combineDelta(base: ViewportDelta, add: ViewportDelta): void {
  base.positionOffset.addInPlace(add.positionOffset);
  base.rotationOffset.addInPlace(add.rotationOffset);
  base.fovMultiplier *= add.fovMultiplier;
}

/**
 * Check if delta has any meaningful effect
 */
export function isDeltaNeutral(delta: ViewportDelta, threshold = 0.0001): boolean {
  return (
    delta.positionOffset.lengthSquared() < threshold &&
    delta.rotationOffset.lengthSquared() < threshold &&
    Math.abs(delta.fovMultiplier - 1.0) < threshold
  );
}
