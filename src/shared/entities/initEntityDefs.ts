/**
 * Entity Initialization - Register all entity definitions
 * 
 * Call this on startup to populate the EntityRegistry.
 */

import { getEntityRegistry } from './EntityRegistry';

// Weapons
import {
    GUNBLADE, MACHINEGUN, RIOTGUN, GRENADE_LAUNCHER,
    ROCKET_LAUNCHER, PLASMAGUN, ELECTROBOLT, INSTAGUN,
    BLADE, VOLTAIC,
} from './definitions/weapons';

// Projectiles
import {
    PLASMA_BOLT, GUNBLADE_BLAST, GRENADE, ROCKET,
    BLADE_BLAST,
} from './definitions/projectiles';

// Ammo
import {
    PLASMA_AMMO, GUNBLADE_AMMO, BULLET_AMMO, SHELL_AMMO,
    GRENADE_AMMO, ROCKET_AMMO, LASER_AMMO, BOLT_AMMO, INSTA_AMMO,
    VOLTAIC_AMMO,
} from './definitions/ammo';

/**
 * Register all entity definitions with the registry.
 * Call this once during engine/game initialization.
 */
export function initializeEntityDefs(): void {
    const registry = getEntityRegistry();

    console.log('[EntityDefs] Registering entity definitions...');

    // Weapons
    registry.register(GUNBLADE);
    registry.register(MACHINEGUN);
    registry.register(RIOTGUN);
    registry.register(GRENADE_LAUNCHER);
    registry.register(ROCKET_LAUNCHER);
    registry.register(PLASMAGUN);
    registry.register(VOLTAIC);         // Replaces lasergun (aliases: weapon_lasergun)
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
    registry.register(LASER_AMMO);
    registry.register(VOLTAIC_AMMO);    // Replaces laser ammo (aliases: ammo_lasers)
    registry.register(BOLT_AMMO);
    registry.register(INSTA_AMMO);

    console.log(`[EntityDefs] Registered ${registry.getCount()} definitions`);
}
