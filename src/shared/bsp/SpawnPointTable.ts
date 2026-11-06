/**
 * Shared BSP spawn classification, positions and facings.
 * Generic and team-tagged spawns retain BSP entity order. Z-up map origins are
 * converted to Y-up game positions, then raised to the player's origin height.
 */

import type { TeamId } from "../server/gametype";
import { q3AngleToGameYaw } from "./TriggerTable";

/** BSP spawn entities sit at feet level; player origin is 24 units above. */
export const PLAYER_ORIGIN_HEIGHT = 24;

export interface SpawnVec3 {
  x: number;
  y: number;
  z: number;
}

/** Minimal BSP entity shape (matches BspLoader.BspEntity). */
interface BspEntityLike {
  classname: string;
  properties: Record<string, string>;
}

/**
 * Untagged spawn classnames, usable by any player in any gametype.
 */
export const SPAWN_CLASSNAMES: readonly string[] = [
  "info_player_deathmatch",
  "info_player_start",
  "info_player_team1",
  "info_player_team2",
];

/**
 * Team-tagged map classnames mapped to engine team ids.
 * A null prototype excludes inherited object names from classname lookups.
 */
export const TEAM_SPAWN_CLASSNAMES: Readonly<Record<string, TeamId>> = Object.assign(
  Object.create(null) as Record<string, TeamId>,
  {
    team_CTF_alphaspawn: "udon",
    team_CTF_betaspawn: "soba",
  } satisfies Record<string, TeamId>,
);

/** Parse a Z-up BSP origin to game coordinates at player-origin height. */
function parseSpawnOrigin(origin: string | undefined): SpawnVec3 | null {
  if (!origin) return null;
  const parts = origin.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[2] + PLAYER_ORIGIN_HEIGHT, z: parts[1] };
}

/**
 * Every generic or team-tagged spawn point, in BSP order.
 */
export function extractSpawnPoints(entities: BspEntityLike[]): SpawnVec3[] {
  const out: SpawnVec3[] = [];
  for (const entity of entities) {
    const isGeneric = SPAWN_CLASSNAMES.includes(entity.classname);
    const isTeam = entity.classname in TEAM_SPAWN_CLASSNAMES;
    if (!isGeneric && !isTeam) continue;
    const position = parseSpawnOrigin(entity.properties?.origin);
    if (position) out.push(position);
  }
  return out;
}

/**
 * Team-tagged spawn points, keyed by engine team id, in BSP order.
 * Empty map on a BSP with no team spawns — callers fall back to the untagged set.
 */
export function extractTeamSpawnPoints(entities: BspEntityLike[]): Map<TeamId, SpawnVec3[]> {
  const byTeam = new Map<TeamId, SpawnVec3[]>();
  for (const entity of entities) {
    const team = TEAM_SPAWN_CLASSNAMES[entity.classname];
    if (!team) continue;
    const position = parseSpawnOrigin(entity.properties?.origin);
    if (!position) continue;
    const list = byTeam.get(team);
    if (list) list.push(position);
    else byTeam.set(team, [position]);
  }
  return byTeam;
}

/** A spawn point's position and the yaw a player spawned there faces. */
export interface SpawnFacing {
  position: SpawnVec3;
  /** Game yaw in radians, as `q3AngleToGameYaw` returns it. */
  yaw: number;
}

/** Q3 yaw in degrees from "angles" ("pitch yaw roll") or "angle"; 0 when absent. */
function spawnAngleDegrees(properties: Record<string, string> | undefined): number {
  const angles = properties?.angles?.trim().split(/\s+/).map(Number);
  if (angles && angles.length >= 2 && Number.isFinite(angles[1])) return angles[1];
  const angle = Number(properties?.angle);
  return Number.isFinite(angle) ? angle : 0;
}

/** Every spawn point with its authored facing, generic and team-tagged alike. */
export function extractSpawnFacings(entities: BspEntityLike[]): SpawnFacing[] {
  const out: SpawnFacing[] = [];
  for (const entity of entities) {
    if (!SPAWN_CLASSNAMES.includes(entity.classname) && !(entity.classname in TEAM_SPAWN_CLASSNAMES)) continue;
    const position = parseSpawnOrigin(entity.properties?.origin);
    if (position) out.push({ position, yaw: q3AngleToGameYaw(spawnAngleDegrees(entity.properties)) });
  }
  return out;
}

/**
 * Horizontal reach of a spawn's facing. The server moves a player up to 24
 * units along each axis off the spawn point (collision jitter), about 34
 * diagonally.
 */
export const SPAWN_FACING_RADIUS = 40;

/** The facing of the spawn point nearest `position`, or null when none is within reach. */
export function spawnFacingNear(facings: readonly SpawnFacing[], position: SpawnVec3): number | null {
  let best: SpawnFacing | null = null;
  let bestDistance = SPAWN_FACING_RADIUS * SPAWN_FACING_RADIUS;
  for (const facing of facings) {
    const dx = facing.position.x - position.x;
    const dz = facing.position.z - position.z;
    const distance = dx * dx + dz * dz;
    if (distance <= bestDistance && Math.abs(facing.position.y - position.y) <= 32) {
      best = facing;
      bestDistance = distance;
    }
  }
  return best ? best.yaw : null;
}

/** True when this BSP carries usable team spawns for both teams. */
export function hasTeamSpawns(entities: BspEntityLike[]): boolean {
  const byTeam = extractTeamSpawnPoints(entities);
  return (byTeam.get("udon")?.length ?? 0) > 0 && (byTeam.get("soba")?.length ?? 0) > 0;
}
