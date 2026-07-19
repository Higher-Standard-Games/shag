/**
 * Entity Initialization - Register all entity definitions
 *
 * Call this on startup to populate the EntityRegistry.
 */

// Ammo
import {
  BOLT_AMMO,
  BULLET_AMMO,
  GRENADE_AMMO,
  GUNBLADE_AMMO,
  INSTA_AMMO,
  PLASMA_AMMO,
  ROCKET_AMMO,
  SHELL_AMMO,
  VOLTAIC_AMMO,
} from "./definitions/ammo";
// Armor & health
import { ARMOR_DEFS, HEALTH_DEFS } from "./definitions/items";
// Projectiles
import { BLADE_BLAST, GRENADE, GUNBLADE_BLAST, PLASMA_BOLT, ROCKET } from "./definitions/projectiles";
// Weapons
import {
  BLADE,
  ELECTROBOLT,
  GRENADE_LAUNCHER,
  GUNBLADE,
  INSTAGUN,
  MACHINEGUN,
  PLASMAGUN,
  RIOTGUN,
  ROCKET_LAUNCHER,
  VOLTAIC,
} from "./definitions/weapons";
import { getEntityRegistry } from "./EntityRegistry";

/**
 * Register all entity definitions with the registry.
 * Call this once during engine/game initialization.
 */
export function initializeEntityDefs(): void {
  const registry = getEntityRegistry();

  console.log("[EntityDefs] Registering entity definitions...");

  // Weapons
  registry.register(GUNBLADE);
  registry.register(MACHINEGUN);
  registry.register(RIOTGUN);
  registry.register(GRENADE_LAUNCHER);
  registry.register(ROCKET_LAUNCHER);
  registry.register(PLASMAGUN);
  // weapon_lasergun is a classname alias on the one canonical Voltaic def.
  registry.register(VOLTAIC);
  registry.register(ELECTROBOLT);
  registry.register(INSTAGUN);
  registry.register(BLADE);

  // Projectiles
  registry.register(PLASMA_BOLT);
  registry.register(GUNBLADE_BLAST);
  registry.register(GRENADE);
  registry.register(ROCKET);
  registry.register(BLADE_BLAST);

  // Ammo
  registry.register(PLASMA_AMMO);
  registry.register(GUNBLADE_AMMO);
  registry.register(BULLET_AMMO);
  registry.register(SHELL_AMMO);
  registry.register(GRENADE_AMMO);
  registry.register(ROCKET_AMMO);
  registry.register(VOLTAIC_AMMO);
  registry.register(BOLT_AMMO);
  registry.register(INSTA_AMMO);

  // Armor & health pickups
  for (const def of ARMOR_DEFS) registry.register(def);
  for (const def of HEALTH_DEFS) registry.register(def);

  console.log(`[EntityDefs] Registered ${registry.getCount()} definitions`);
}
