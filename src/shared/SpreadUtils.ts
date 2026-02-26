/**
 * SpreadUtils — deterministic pellet spread for shotgun-style weapons
 * 
 * Uses seeded pseudo-random spread so server and client produce
 * identical pellet patterns for the same shot.
 */

/**
 * Compute a deterministic seed from tick, entity ID, and shot count.
 * Ensures each shot from each player at each tick is unique.
 */
export function computeSpreadSeed(tick: number, entityId: number, shotCount: number): number {
    // Simple hash combining all three values
    let seed = tick * 73856093 ^ entityId * 19349663 ^ shotCount * 83492791;
    seed = ((seed >> 16) ^ seed) * 0x45d9f3b;
    seed = ((seed >> 16) ^ seed) * 0x45d9f3b;
    seed = (seed >> 16) ^ seed;
    return Math.abs(seed);
}

/**
 * Generate N spread directions within a cone of the given half-angle (degrees).
 * Uses seeded random for deterministic patterns.
 * 
 * @param seed - Deterministic seed from computeSpreadSeed
 * @param count - Number of pellets
 * @param spreadDeg - Half-angle of the spread cone in degrees
 * @param yaw - View yaw in radians
 * @param pitch - View pitch in radians (Babylon convention: negative = looking up)
 * @returns Array of direction vectors { x, y, z }
 */
export function generateSpreadDirections(
    seed: number,
    count: number,
    spreadDeg: number,
    yaw: number,
    pitch: number
): Array<{ x: number; y: number; z: number }> {
    const spreadRad = (spreadDeg * Math.PI) / 180;
    const directions: Array<{ x: number; y: number; z: number }> = [];

    // Seeded PRNG (simple LCG)
    let s = seed;
    const nextRand = (): number => {
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
        return (s >>> 0) / 0xFFFFFFFF;
    };

    // Negate pitch for Babylon convention
    const p = -pitch;

    for (let i = 0; i < count; i++) {
        // Random offset within cone
        const angle = nextRand() * Math.PI * 2;
        const radius = Math.sqrt(nextRand()) * spreadRad;

        const offsetYaw = yaw + Math.cos(angle) * radius;
        const offsetPitch = p + Math.sin(angle) * radius;

        directions.push({
            x: Math.sin(offsetYaw) * Math.cos(offsetPitch),
            y: Math.sin(offsetPitch),
            z: Math.cos(offsetYaw) * Math.cos(offsetPitch),
        });
    }

    return directions;
}
