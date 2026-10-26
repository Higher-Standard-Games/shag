/**
 * SpawnPointTable — single source of truth for BSP spawn points.
 *
 * Same contract as PickupTable / TriggerTable / BombSiteTable: one extractor,
 * used everywhere, so the server, the headless CLIs and the client all agree.
 *
 * Before this, the spawn classname list was duplicated verbatim in
 * `HeadlessMapLoader`, `SpawnPointManager` and `SpawnCommand` — and all three
 * listed only the Quake conventions. Warsow's team maps tag their spawns
 * `team_CTF_alphaspawn` / `team_CTF_betaspawn`, which appeared in **no** source
 * file, so every team spawn on every CTF and bomb map was invisible: 4-16 points
 * per team across six bomb maps, silently unused.
 *
 * Coordinates: Q3 (X right, Y forward, Z up) → engine (X right, Y up, Z forward),
 * plus PLAYER_ORIGIN_HEIGHT because BSP spawn entities sit at FEET level while
 * player physics uses the origin 24 units above.
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
 * Untagged spawn classnames — usable by any player in any gametype.
 * `info_player_team1/2` are the Quake team conventions; no shipped Warsow map
 * uses them, but they cost nothing to accept.
 */
export const SPAWN_CLASSNAMES: readonly string[] = [
  "info_player_deathmatch",
  "info_player_start",
  "info_player_team1",
  "info_player_team2",
];

/**
 * Warsow team spawn classnames → engine team id.
 *
 * Warsow names its teams alpha/beta; this engine names them udon/soba. The
 * mapping is positional (alpha = first team = udon) and is the only place the
 * two vocabularies meet.
 *
 * NOTE: which team ATTACKS in a bomb mode is a gametype decision, not a
 * property of the spawn set — see Search_And_Destroy.md §4.1, where the map
 * geometry says alpha's base holds the objectives and alpha therefore defends.
 */
export const TEAM_SPAWN_CLASSNAMES: Readonly<Record<string, TeamId>> = {
  team_CTF_alphaspawn: "udon",
  team_CTF_betaspawn: "soba",
};

/** Parse a Q3 "x y z" origin to engine coords at player-origin height. */
function parseSpawnOrigin(origin: string | undefined): SpawnVec3 | null {
  if (!origin) return null;
  const parts = origin.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[2] + PLAYER_ORIGIN_HEIGHT, z: parts[1] };
}

/**
 * Every spawn point a player could use, in BSP order.
 *
 * Includes team-tagged spawns: a team map's `team_CTF_*spawn` points are real
 * spawn locations, and a gametype that ignores teams should still be able to
 * use them rather than falling back to three hardcoded defaults.
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
