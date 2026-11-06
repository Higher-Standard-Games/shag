/**
 * Player dimensions, view heights and coordinate helpers.
 *
 * The fixed standing box extends 24 units below the tracked origin and
 * 40 units above it, for a total height of 64. Position helpers use Y-up coordinates.
 *
 * ```
 * HEAD    (+40 above origin)  ┌─────────┐
 *                             │         │
 * ORIGIN  (position tracked)  │    *    │  ← This is where position.y points
 *                             │         │
 * FEET    (-24 below origin)  └─────────┘
 * ```
 *
 * Crouching changes the lower vertical extent from -24 to -4, giving a height of 44.
 * The bounds-building functions below scale their extents using a 24:32 ratio.
 */

// =============================================================================
// PLAYER DIMENSIONS
// =============================================================================

/** Horizontal collision radius */
export const PLAYER_RADIUS = 16;

/** How far bounding box extends BELOW origin (to feet) */
export const PLAYER_MINS_Z = -24;

/** How far bounding box extends ABOVE origin (to head) */
export const PLAYER_MAXS_Z = 40;

/** Total player height (64 = 24 + 40) */
export const PLAYER_HEIGHT = PLAYER_MAXS_Z - PLAYER_MINS_Z;

/** Distance from feet to origin (24 units) */
export const PLAYER_ORIGIN_HEIGHT = -PLAYER_MINS_Z;

// =============================================================================
// VIEW HEIGHT
// =============================================================================

/** Eye position relative to origin when standing */
export const DEFAULT_VIEWHEIGHT = 34;

/** Eye position relative to origin when crouching */
export const CROUCH_VIEWHEIGHT = 12;

/** Eye position relative to origin when dead */
export const DEAD_VIEWHEIGHT = -16;

// =============================================================================
// MOVEMENT CONSTANTS
// =============================================================================

/** Maximum step height the player can walk up */
export const STEPSIZE = 18;

/** Crouched height - box extends only 4 units below origin */
export const CROUCH_MINS_Z = -4;

/** Crouched total height (4 + 40 = 44) */
export const CROUCH_HEIGHT = PLAYER_MAXS_Z - CROUCH_MINS_Z;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert feet position to origin position
 * @param feetY The Y coordinate at feet level
 * @returns The Y coordinate at origin level (feetY + 24)
 */
export function feetToOrigin(feetY: number): number {
  return feetY + PLAYER_ORIGIN_HEIGHT;
}

/**
 * Convert origin position to feet position
 * @param originY The Y coordinate at origin level
 * @returns The Y coordinate at feet level (originY - 24)
 */
export function originToFeet(originY: number): number {
  return originY - PLAYER_ORIGIN_HEIGHT;
}

/**
 * Get eye position from origin
 * @param originY The Y coordinate at origin level
 * @param viewheight Optional viewheight override (default: standing)
 * @returns The Y coordinate at eye level
 */
export function originToEyes(originY: number, viewheight: number = DEFAULT_VIEWHEIGHT): number {
  return originY + viewheight;
}

/**
 * Calculate asymmetric box mins/maxs for a given height
 * Scales proportionally to maintain the 24/32 ratio
 * @param height Total height (default: 64)
 * @param radius Horizontal radius (default: 16)
 * @returns Object with mins and maxs arrays [x, y, z] in Babylon coords
 */
export function getPlayerBounds(
  height: number = PLAYER_HEIGHT,
  radius: number = PLAYER_RADIUS,
): {
  mins: [number, number, number];
  maxs: [number, number, number];
} {
  // Scale proportionally: 24/56 of height below origin, 32/56 above
  const minsZ = -(height * (24 / 56));
  const maxsZ = height + minsZ; // = height * (32 / 56)

  return {
    mins: [-radius, minsZ, -radius], // Babylon: X, Y, Z
    maxs: [radius, maxsZ, radius],
  };
}

/**
 * Get bounds in Z-up coordinates, using a 24:32 lower-to-upper extent ratio.
 * @param height Total height (default: 64)
 * @param radius Horizontal radius (default: 16)
 * @returns Object with mins and maxs arrays [x, y, z] in Z-up coordinates
 */
export function getPlayerBoundsQ3(
  height: number = PLAYER_HEIGHT,
  radius: number = PLAYER_RADIUS,
): {
  mins: [number, number, number];
  maxs: [number, number, number];
} {
  const minsZ = -(height * (24 / 56));
  const maxsZ = height + minsZ;

  return {
    mins: [-radius, -radius, minsZ], // X, Y, Z (Z is up)
    maxs: [radius, radius, maxsZ],
  };
}
