/**
 * TransformComponent - Position and rotation
 */

import type { Vec3 } from "../types";

export interface TransformComponent {
  /** Position in world space */
  position: Vec3;

  /** Rotation in degrees (pitch, yaw, roll) */
  rotation: Vec3;

  /** Scale (usually 1,1,1) */
  scale: Vec3;
}

/** Create default transform */
export function createTransform(
  position: Vec3 = { x: 0, y: 0, z: 0 },
  rotation: Vec3 = { x: 0, y: 0, z: 0 },
  scale: Vec3 = { x: 1, y: 1, z: 1 },
): TransformComponent {
  return { position, rotation, scale };
}

/** Clone a transform (for COW) */
export function cloneTransform(t: TransformComponent): TransformComponent {
  return {
    position: { ...t.position },
    rotation: { ...t.rotation },
    scale: { ...t.scale },
  };
}
