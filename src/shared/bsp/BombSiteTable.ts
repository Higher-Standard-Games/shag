/**
 * BombSiteTable — single source of truth for Search & Destroy bomb sites.
 *
 * Same contract as PickupTable and TriggerTable: the server and the bots (which
 * run in a separate process) derive their site list from the SAME BSP entity +
 * submodel arrays, so a site id means the same thing on both sides with no
 * handshake. See docs/research/Search_And_Destroy.md §3.
 *
 * Warsow Bomb ground truth, verified against all six shipped `wbomb*` maps:
 *
 *   misc_capture_area_indicator { targetname?, origin }   ← THE site position
 *   trigger_capture_area        { model "*N", target }    ← optional volume,
 *                                 target → indicator targetname
 *
 * Four properties of the real map data shape this extractor, each of which
 * would otherwise be discovered the hard way:
 *
 *  1. Every bomb map has EXACTLY TWO indicators. That is the invariant; site
 *     count is not variable. `wdm4`/`wdm9` also carry capture areas (3 each)
 *     but no team spawns — they are not bomb maps, hence `isBombMap`.
 *  2. HALF the maps (wbomb2/3/4) have no `trigger_capture_area` at all. Warsow
 *     applied a default radius so a mapper could drop a bare indicator and be
 *     done, so the radius fallback is the PRIMARY path, not a safety net.
 *  3. HALF have no `targetname`, and naming differs where present
 *     (`misc_capture_area_indicator1` vs `bombsitea0`). Site identity therefore
 *     cannot depend on it — ids come from BSP order, exactly as pickup ids do.
 *  4. Entity order does NOT match site letter (wbomb6 lists indicator2 first).
 *     Harmless, because the label is cosmetic and both sides read the same
 *     bytes — but it means "first indicator" is not "site A".
 */

/**
 * Default plant radius for a site with no authored volume, in world units.
 *
 * 384 is Warsow's default (a mapper drops a bare indicator and it just works),
 * corroborated by measuring the maps that DID author volumes: circumscribed
 * radii 268 / 307 / 385 / 404 / 424 / 476, mean 377, median 394. It is also
 * 3 × 128 — three squares of the standard mapping grid.
 *
 * Used as a CYLINDER, never a sphere: authored site heights run 56 → 320, so a
 * spherical test would allow planting from far above wbomb1's flat site 1.
 * See `isInsideBombSite`.
 */
export const DEFAULT_BOMBSITE_RADIUS = 384;

/**
 * Vertical half-extent of the fallback cylinder, in world units.
 *
 * Deliberately generous relative to a player (64 units tall): a bare indicator
 * marks a spot on the floor, and a site spans whatever room contains it. Sized
 * from the authored volumes, whose heights run 56 → 320.
 *
 * ⚠ Least-evidenced number here. The volumes tell us how tall a SITE is, not
 * how far above a bare indicator's origin a plant should still count. Wants a
 * playtest (Search_And_Destroy.md §9 Q2).
 */
export const DEFAULT_BOMBSITE_HALF_HEIGHT = 192;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Babylon-space AABB of one authored `trigger_capture_area` submodel. */
export interface BombSiteVolume {
  min: Vec3Like;
  max: Vec3Like;
}

export interface BombSite {
  /**
   * Stable index in BSP order over accepted indicators — the authoritative id
   * on both server and bots. Never derived from `targetname`, which half the
   * maps omit.
   */
  id: number;
  /**
   * Display label ("A", "B"). Parsed from `targetname` when it carries a
   * letter or trailing digit, else assigned from `id`. COSMETIC ONLY — never
   * match on this.
   */
  label: string;
  /** Indicator origin in Babylon space. The navigable objective position. */
  position: Vec3Like;
  /**
   * Authored volumes for this site, in BSP order. Empty on wbomb2/3/4, where
   * containment falls back to the radius cylinder.
   */
  volumes: BombSiteVolume[];
  /** Fallback cylinder radius, used when `volumes` is empty. */
  radius: number;
  /** Fallback cylinder half-height, used when `volumes` is empty. */
  halfHeight: number;
}

/** Minimal BSP entity shape (matches BspLoader.BspEntity). */
interface BspEntityLike {
  classname: string;
  properties: Record<string, string>;
}

/** Minimal BSP submodel shape (matches BspLoader.BspModel). */
interface BspModelLike {
  mins: [number, number, number];
  maxs: [number, number, number];
}

const INDICATOR_CLASSNAME = "misc_capture_area_indicator";
const VOLUME_CLASSNAME = "trigger_capture_area";

/** Attacker/defender spawn classnames. Warsow Bomb reuses the CTF entities. */
export const BOMB_SPAWN_CLASSNAMES = {
  alpha: "team_CTF_alphaspawn",
  beta: "team_CTF_betaspawn",
} as const;

/** Number of sites every shipped bomb map has. Used to validate, not to assume. */
export const EXPECTED_BOMBSITE_COUNT = 2;

/** Parse a Q3 "x y z" origin into Babylon coords (Y↔Z swap), or null. */
function parseOrigin(origin: string | undefined): Vec3Like | null {
  if (!origin) return null;
  const [x, y, z] = origin.split(/\s+/).map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y: z, z: y };
}

/** Parse "*N" brush-model reference; −1 when not a valid submodel ref. */
function parseModelIndex(modelStr: string | undefined): number {
  if (!modelStr || !modelStr.startsWith("*")) return -1;
  const idx = Number.parseInt(modelStr.slice(1), 10);
  return Number.isInteger(idx) && idx > 0 ? idx : -1; // *0 is worldspawn
}

/**
 * Cosmetic label for a site.
 *
 * Tries the two naming styles found in the shipped maps — `bombsitea0` /
 * `bombsiteb0` (wbomb5) and `misc_capture_area_indicator1` / `…2` (wbomb1,
 * wbomb6) — then falls back to position in BSP order. Because wbomb6 lists its
 * indicators out of order, the parsed name is preferred over the index so its
 * sites read A/B the way the mapper intended.
 */
function siteLabel(targetName: string | undefined, id: number): string {
  const fallback = String.fromCharCode(65 + id);
  if (!targetName) return fallback;

  const byLetter = /bombsite([a-z])/i.exec(targetName);
  if (byLetter) return byLetter[1].toUpperCase();

  const byNumber = /(\d+)\s*$/.exec(targetName);
  if (byNumber) {
    const n = Number.parseInt(byNumber[1], 10);
    if (Number.isInteger(n) && n >= 1 && n <= 26) return String.fromCharCode(64 + n);
  }
  return fallback;
}

/**
 * True when this BSP looks like a Warsow Bomb map.
 *
 * Requires BOTH two capture-area indicators and alpha team spawns. Capture
 * areas alone are not sufficient: `wdm4` and `wdm9` carry three of them with no
 * team spawns at all, and must not be detected as bomb maps.
 */
export function isBombMap(entities: BspEntityLike[]): boolean {
  let indicators = 0;
  let hasTeamSpawns = false;
  for (const entity of entities) {
    if (entity.classname === INDICATOR_CLASSNAME) indicators++;
    else if (entity.classname === BOMB_SPAWN_CLASSNAMES.alpha) hasTeamSpawns = true;
  }
  return indicators === EXPECTED_BOMBSITE_COUNT && hasTeamSpawns;
}

/**
 * Extract bomb sites from BSP entities + submodels.
 *
 * Deterministic: identical input → identical output, so the server and every
 * bot agree on ids without exchanging anything. Indicators with an invalid or
 * missing origin are dropped (fail closed, same policy as PickupTable) — but
 * note that dropping one silently changes the ids of those after it, which is
 * why the count is worth validating at load time.
 */
export function extractBombSites(entities: BspEntityLike[], models: BspModelLike[] = []): BombSite[] {
  const sites: BombSite[] = [];
  /** targetname → site index, for attaching volumes. */
  const byTargetName = new Map<string, number>();

  for (const entity of entities) {
    if (entity.classname !== INDICATOR_CLASSNAME) continue;

    const position = parseOrigin(entity.properties.origin);
    if (!position) {
      console.warn(`[BombSiteTable] ${INDICATOR_CLASSNAME} has invalid origin — dropped`);
      continue;
    }

    const targetName = entity.properties.targetname;
    const id = sites.length;
    if (targetName) byTargetName.set(targetName, id);

    sites.push({
      id,
      label: siteLabel(targetName, id),
      position,
      volumes: [],
      radius: DEFAULT_BOMBSITE_RADIUS,
      halfHeight: DEFAULT_BOMBSITE_HALF_HEIGHT,
    });
  }

  // Volumes refine a site; they never define one. Many-to-one: wbomb5 puts four
  // volumes on site A and two on B.
  for (const entity of entities) {
    if (entity.classname !== VOLUME_CLASSNAME) continue;

    const targetName = entity.properties.target;
    const siteIndex = targetName === undefined ? undefined : byTargetName.get(targetName);
    if (siteIndex === undefined) {
      // Expected on maps whose indicators have no targetname — the volume
      // cannot be attributed, so the site keeps its radius fallback.
      continue;
    }

    const modelIndex = parseModelIndex(entity.properties.model);
    if (modelIndex < 0 || modelIndex >= models.length) continue;

    const model = models[modelIndex];
    // Per-axis relabel (x, z_q3→y, y_q3→z) keeps min < max on every axis.
    sites[siteIndex].volumes.push({
      min: { x: model.mins[0], y: model.mins[2], z: model.mins[1] },
      max: { x: model.maxs[0], y: model.maxs[2], z: model.maxs[1] },
    });
  }

  return sites;
}

/** Extract a team's spawn positions in Babylon space, in BSP order. */
export function extractTeamSpawns(entities: BspEntityLike[], classname: string): Vec3Like[] {
  const out: Vec3Like[] = [];
  for (const entity of entities) {
    if (entity.classname !== classname) continue;
    const position = parseOrigin(entity.properties.origin);
    if (position) out.push(position);
  }
  return out;
}

/**
 * Is `point` inside `site`?
 *
 * Authored volumes win where they exist (AABB test, any volume). Otherwise a
 * CYLINDER around the indicator: horizontal radius plus a separate vertical
 * band, the same shape `PickupSystem` uses for pickup proximity. A sphere would
 * let a player plant from well above a flat site.
 */
export function isInsideBombSite(site: BombSite, point: Vec3Like): boolean {
  if (site.volumes.length > 0) {
    for (const volume of site.volumes) {
      if (
        point.x >= volume.min.x &&
        point.x <= volume.max.x &&
        point.y >= volume.min.y &&
        point.y <= volume.max.y &&
        point.z >= volume.min.z &&
        point.z <= volume.max.z
      ) {
        return true;
      }
    }
    return false;
  }

  const dy = point.y - site.position.y;
  if (dy < -site.halfHeight || dy > site.halfHeight) return false;
  const dx = point.x - site.position.x;
  const dz = point.z - site.position.z;
  return dx * dx + dz * dz <= site.radius * site.radius;
}

/** Centroid of a spawn set, for the §4.1 role-vs-geometry validation. */
export function spawnCentroid(spawns: readonly Vec3Like[]): Vec3Like | null {
  if (spawns.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const spawn of spawns) {
    x += spawn.x;
    y += spawn.y;
    z += spawn.z;
  }
  return { x: x / spawns.length, y: y / spawns.length, z: z / spawns.length };
}

export interface BombRoleValidation {
  ok: boolean;
  /** Human-readable reason when `ok` is false. */
  reason?: string;
  attackerNearest: number;
  defenderNearest: number;
}

/**
 * Sanity-check which side defends, from geometry.
 *
 * In every bomb-and-defuse game the sites live in the DEFENDERS' half — that is
 * what makes attacking a push. Measured on the shipped maps, one team's spawns
 * are dramatically nearer both sites (wbomb1: 729 vs 3857 units), so if the
 * roles are assigned the other way round the attackers spawn on top of the
 * objective and plant in about a second.
 *
 * That failure is silent in code review and obvious in play, which is exactly
 * the kind worth asserting at load. Kept even once the convention is settled,
 * because a community map can still get it wrong.
 */
export function validateBombRoles(
  sites: readonly BombSite[],
  attackerSpawns: readonly Vec3Like[],
  defenderSpawns: readonly Vec3Like[],
): BombRoleValidation {
  const attacker = spawnCentroid(attackerSpawns);
  const defender = spawnCentroid(defenderSpawns);
  if (!attacker || !defender || sites.length === 0) {
    return {
      ok: false,
      reason: "missing spawns or sites",
      attackerNearest: Number.NaN,
      defenderNearest: Number.NaN,
    };
  }

  const nearest = (from: Vec3Like) =>
    Math.min(
      ...sites.map((site) => {
        const dx = site.position.x - from.x;
        const dy = site.position.y - from.y;
        const dz = site.position.z - from.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }),
    );

  const attackerNearest = nearest(attacker);
  const defenderNearest = nearest(defender);

  if (attackerNearest < defenderNearest) {
    return {
      ok: false,
      reason:
        `attacker spawns are nearer the objectives than defender spawns ` +
        `(${Math.round(attackerNearest)} vs ${Math.round(defenderNearest)} units) — ` +
        `roles are probably assigned to the wrong teams`,
      attackerNearest,
      defenderNearest,
    };
  }
  return { ok: true, attackerNearest, defenderNearest };
}
