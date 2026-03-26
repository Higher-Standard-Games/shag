/**
 * SpreadUtils - Deterministic pellet spread for client/server sync
 *
 * Provides a seeded PRNG (mulberry32) and spread direction generator
 * so that both client and server produce identical pellet patterns
 * from the same seed.
 */

/**
 * Mulberry32 — fast 32-bit seeded PRNG.
 * Returns a function that yields deterministic floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute a deterministic seed from fire event context.
 * Both client and server can compute this independently.
 */
export function computeSpreadSeed(tick: number, entityId: number, shotCount: number): number {
  return (tick * 1013 + entityId * 7 + shotCount * 31) | 0;
}

/**
 * Direction vector (plain object for server compatibility — no Babylon dependency).
 */
export interface SpreadDir {
  x: number;
  y: number;
  z: number;
}

/**
 * Generate N spread directions within a cone around a look direction.
 *
 * @param seed        PRNG seed (from computeSpreadSeed)
 * @param count       Number of pellets
 * @param spreadDeg   Cone half-angle in degrees
 * @param yaw         Look yaw (radians)
 * @param pitch       Look pitch (radians, Babylon convention: negative = looking up)
 * @returns           Array of normalized direction vectors
 */
export function generateSpreadDirections(
  seed: number,
  count: number,
  spreadDeg: number,
  yaw: number,
  pitch: number,
): SpreadDir[] {
  const rng = mulberry32(seed);
  const spreadRad = (spreadDeg * Math.PI) / 180;

  // Base forward direction (negate pitch for Babylon convention)
  const p = -pitch;
  const forward: SpreadDir = {
    x: Math.sin(yaw) * Math.cos(p),
    y: Math.sin(p),
    z: Math.cos(yaw) * Math.cos(p),
  };

  // Build orthonormal basis around forward
  let right: SpreadDir;
  if (Math.abs(forward.y) < 0.999) {
    // Cross(Up, forward) → right
    right = {
      x: forward.z, // simplified cross product with (0,1,0)
      y: 0,
      z: -forward.x,
    };
  } else {
    // Forward is nearly vertical — use (1,0,0) as reference
    right = {
      x: 0,
      y: -forward.z,
      z: forward.y,
    };
  }
  // Normalize right
  const rLen = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
  right.x /= rLen;
  right.y /= rLen;
  right.z /= rLen;

  // up = cross(forward, right)
  const up: SpreadDir = {
    x: forward.y * right.z - forward.z * right.y,
    y: forward.z * right.x - forward.x * right.z,
    z: forward.x * right.y - forward.y * right.x,
  };

  const directions: SpreadDir[] = [];

  for (let i = 0; i < count; i++) {
    // Random point in unit disk, then scale by spread cone
    const r = Math.sqrt(rng()) * Math.tan(spreadRad);
    const theta = rng() * Math.PI * 2;
    const offsetX = r * Math.cos(theta);
    const offsetY = r * Math.sin(theta);

    // Offset direction = forward + right * offsetX + up * offsetY
    const dx = forward.x + right.x * offsetX + up.x * offsetY;
    const dy = forward.y + right.y * offsetX + up.y * offsetY;
    const dz = forward.z + right.z * offsetX + up.z * offsetY;

    // Normalize
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    directions.push({
      x: dx / len,
      y: dy / len,
      z: dz / len,
    });
  }

  return directions;
}
