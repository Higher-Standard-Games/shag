/**
 * SpawnPointManager - Extract and manage spawn points from BSP entities
 *
 * Provides spawn point data for both client and simulation.
 * Converts Quake coordinates to engine coordinates.
 */

import type { Vec3 } from "../network/components/TransformComponent";

export interface SpawnPoint {
  position: Vec3;
  angle: number; // Yaw in degrees
  classname: string;
}

// BSP entity interface (minimal for spawn points)
interface BspEntity {
  classname: string;
  properties?: {
    origin?: string;
    angle?: string;
  };
}

/**
 * Extract spawn points from BSP entities
 * @param entities BSP entity array
 * @returns Array of spawn points with engine coordinates
 */
export function extractSpawnPoints(entities: BspEntity[]): SpawnPoint[] {
  const spawnClassnames = ["info_player_deathmatch", "info_player_start", "info_player_team1", "info_player_team2"];

  const spawns: SpawnPoint[] = [];

  for (const entity of entities) {
    if (!spawnClassnames.includes(entity.classname)) continue;
    if (!entity.properties?.origin) continue;

    const parts = entity.properties.origin.split(" ").map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) continue;

    // Convert Quake coords (x, y, z where Z is up) to engine coords (x, y, z where Y is up)
    // Quake: X=right, Y=forward, Z=up
    // Engine: X=right, Y=up, Z=forward
    //
    // Also add PLAYER_ORIGIN_HEIGHT (24 units) because:
    // - BSP spawn entities are at FEET level
    // - But player physics uses ORIGIN level (24 units above feet)
    // This matches the server-side spawn point processing in headless-netserver-v2.ts
    const PLAYER_ORIGIN_HEIGHT = 24;
    const position: Vec3 = {
      x: parts[0],
      y: parts[2] + PLAYER_ORIGIN_HEIGHT, // Quake Z -> Engine Y + origin offset
      z: parts[1], // Quake Y -> Engine Z
    };

    const angle = parseFloat(entity.properties.angle || "0") || 0;

    spawns.push({
      position,
      angle,
      classname: entity.classname,
    });
  }

  return spawns;
}

/**
 * Get a random spawn point from the list
 */
export function getRandomSpawn(spawns: SpawnPoint[]): SpawnPoint | null {
  if (spawns.length === 0) return null;
  return spawns[Math.floor(Math.random() * spawns.length)];
}

/**
 * Get spawn point by index (with wrap-around)
 */
export function getSpawnByIndex(spawns: SpawnPoint[], index: number): SpawnPoint | null {
  if (spawns.length === 0) return null;
  return spawns[index % spawns.length];
}
