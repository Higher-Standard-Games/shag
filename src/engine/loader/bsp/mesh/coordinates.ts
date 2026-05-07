import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Convert Q3 coordinates (Z-up, right-handed) to Babylon (Y-up, left-handed)
 *
 * Q3: X=right, Y=forward, Z=up
 * Babylon: X=right, Y=up, Z=forward
 *
 * Transform: (x, y, z) -> (x, z, y)
 *
 * NOTE: This changes handedness! Triangle winding must be reversed.
 */
export function q3ToBabylon(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

/** Convert Q3 position array to Babylon Vector3 (exported for future use) */
export function q3ToBabylonVec3(pos: [number, number, number]): Vector3 {
  return new Vector3(pos[0], pos[2], pos[1]);
}

/**
 * Reverse triangle winding order to fix handedness change
 * Input: [i0, i1, i2, i3, i4, i5, ...]
 * Output: [i0, i2, i1, i3, i5, i4, ...]
 */
export function reverseTriangleWinding(indices: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    result.push(indices[i], indices[i + 2], indices[i + 1]);
  }
  return result;
}
