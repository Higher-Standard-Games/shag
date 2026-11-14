/**
 * Place names from a map's `target_location` entities: what team chat says
 * where someone is ("Warehouse A", "Old Town"). Warsow bomb maps carry dozens
 * of them; a point is named by the nearest one, as Warsow's own location lookup
 * does. Shared by the server (team chat `%L`) and the bots (callouts).
 */

export interface MapLocation {
  /** The name as authored, colour codes (^1, ^7, ...) removed. */
  name: string;
  /** Babylon space. */
  position: { x: number; y: number; z: number };
}

/** An entity as either BSP loader gives it: keys flat, or under `properties`. */
interface LocationEntityLike {
  classname?: string;
  origin?: string;
  message?: string;
  properties?: Record<string, string | undefined>;
}

/** Strip Warsow colour codes ("^3Warehouse ^1A" → "Warehouse A"). */
export function plainLocationName(message: string): string {
  return message
    .replace(/\^[0-9a-zA-Z]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every named `target_location`, in Babylon coordinates. */
export function extractLocations(entities: readonly LocationEntityLike[]): MapLocation[] {
  const out: MapLocation[] = [];
  for (const entity of entities) {
    const message = entity.message ?? entity.properties?.message;
    const origin = entity.origin ?? entity.properties?.origin;
    if (entity.classname !== "target_location" || !message || !origin) continue;
    const [x, y, z] = origin.split(/\s+/).map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const name = plainLocationName(message);
    // Quake is Z-up, Babylon Y-up (see BombSiteTable's parseOrigin).
    if (name) out.push({ name, position: { x, y: z, z: y } });
  }
  return out;
}

/** The name of the location nearest `point`, or null on a map without any. */
export function locationName(
  locations: readonly MapLocation[],
  point: { x: number; y: number; z: number },
): string | null {
  let best: MapLocation | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const location of locations) {
    const dx = location.position.x - point.x;
    const dy = location.position.y - point.y;
    const dz = location.position.z - point.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = location;
    }
  }
  return best?.name ?? null;
}
