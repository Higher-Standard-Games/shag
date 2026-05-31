/**
 * PickupTable — single source of truth for weapon-pickup identity.
 *
 * Both the server (PickupSystem) and the client (EntityManager) derive their
 * weapon-pickup list from the SAME BSP entity array via `extractWeaponPickups`,
 * so the per-pickup `id` is provably identical on both sides without any network
 * handshake. That id is the authoritative key used by the snapshot active-set
 * (see docs/research/SERVER_AUTHORITATIVE_PICKUPS.md).
 *
 * Previously the two sides assigned ids with separate parallel counters
 * (server: PickupSystem.setPickupItems, client: EntityManager.nextPickupId),
 * a fragile hand-maintained invariant that could drift and cause "ghost weapon"
 * desyncs.
 */

/** BSP weapon classname → game weapon id. Canonical map shared by client + server. */
export const CLASSNAME_TO_WEAPON: Record<string, string> = {
  weapon_gunblade: "gunblade",
  weapon_machinegun: "machinegun",
  weapon_riotgun: "riotgun",
  weapon_grenadelauncher: "glauncher",
  weapon_rocketlauncher: "rlauncher",
  weapon_plasmagun: "plasmagun",
  weapon_voltaic: "voltaic",
  weapon_lasergun: "lasergun", // Legacy Warsow maps → LG
  weapon_electrobolt: "electrobolt",
  weapon_instagun: "instagun",
};

export interface WeaponPickupEntry {
  /** Stable index in BSP order — authoritative pickup id on both client and server. */
  id: number;
  /** BSP classname, e.g. "weapon_rocketlauncher". */
  classname: string;
  /** Game weapon id, e.g. "rlauncher". */
  weaponId: string;
  /** Babylon-space position (Q3 Y↔Z swapped), matching the BSP origin. */
  position: { x: number; y: number; z: number };
}

/**
 * Extract the ordered weapon-pickup list from BSP entities.
 *
 * Iterates entities in BSP order, keeps only classnames in CLASSNAME_TO_WEAPON,
 * and assigns sequential ids. Deterministic: identical input → identical output,
 * so server and client agree on every pickup id.
 */
export function extractWeaponPickups(
  entities: Array<{ classname: string; properties: Record<string, string> }>,
): WeaponPickupEntry[] {
  const out: WeaponPickupEntry[] = [];
  let id = 0;

  for (const entity of entities) {
    const weaponId = CLASSNAME_TO_WEAPON[entity.classname];
    if (!weaponId) continue;

    const origin = entity.properties.origin;
    if (!origin) continue;

    const [x, y, z] = origin.split(" ").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

    out.push({
      id: id++,
      classname: entity.classname,
      weaponId,
      position: { x, y: z, z: y }, // Q3→Babylon coord swap
    });
  }

  return out;
}
