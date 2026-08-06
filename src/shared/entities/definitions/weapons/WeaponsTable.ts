/**
 * WEAPONS — the weapon lookup map keyed by weapon id (and projectile-id alias).
 *
 * Lives in shared (QA-14): both the server (ballistics: WeaponSystem /
 * ProjectileSystem damage+splash lookup) and the client (display: HUD ammo,
 * crosshair, impact/model selection) key off ONE table. It previously sat under
 * server/weapons and the client imported UP into server — a layering violation.
 * All stats come from the shared weapon definitions; this is just the map.
 */

import type { WeaponDef } from "../../WeaponDef";
import {
  BLADE,
  ELECTROBOLT,
  GRENADE_LAUNCHER,
  INSTAGUN,
  MACHINEGUN,
  PLASMAGUN,
  RIOTGUN,
  ROCKET_LAUNCHER,
  VOLTAIC,
} from "./index";

/**
 * WEAPONS lookup map keyed by weapon ID.
 * All stats come from shared definitions — single source of truth.
 */
export const WEAPONS: Record<string, WeaponDef> = {
  [MACHINEGUN.id]: MACHINEGUN,
  [RIOTGUN.id]: RIOTGUN,
  [GRENADE_LAUNCHER.id]: GRENADE_LAUNCHER,
  [ROCKET_LAUNCHER.id]: ROCKET_LAUNCHER,
  [PLASMAGUN.id]: PLASMAGUN,
  [VOLTAIC.id]: VOLTAIC,
  // Warsow compatibility ID. This is the same object and gameplay definition,
  // not a parallel Lasergun implementation.
  lasergun: VOLTAIC,
  [ELECTROBOLT.id]: ELECTROBOLT,
  [INSTAGUN.id]: INSTAGUN,
  [BLADE.id]: BLADE,
  // ── Projectile aliases (F8) ──
  // Projectiles register under their own `projectileId` (not the firing weapon's id),
  // so ProjectileSystem's WEAPONS[defId] damage/splash lookup and the client's
  // impact/model selection key off a single, stable projectile identity. Each alias
  // carries the owning weapon's stats (a projectile inherits its weapon's damage/splash).
  rocket: ROCKET_LAUNCHER,
  grenade: GRENADE_LAUNCHER,
  plasma_bolt: PLASMAGUN,
  // Blade's charged blast gets RL-equal knockback (KB = damage × scale: 50×20 = 1000).
  blade_blast: { ...BLADE, knockbackScale: 20.0 },
};

/** Normalize compatibility names before they enter inventories or snapshots. */
export function canonicalWeaponId(weaponId: string): string {
  return weaponId === "lasergun" ? VOLTAIC.id : weaponId;
}
