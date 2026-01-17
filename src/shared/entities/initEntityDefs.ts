/**
 * Entity Initialization - Register all entity definitions
 * 
 * Call this on startup to populate the EntityRegistry.
 */

import { getEntityRegistry } from './EntityRegistry';
import { PLASMAGUN } from './definitions/weapons';
import { PLASMA_BOLT } from './definitions/projectiles';

/**
 * Register all entity definitions with the registry.
 * Call this once during engine/game initialization.
 */
export function initializeEntityDefs(): void {
    const registry = getEntityRegistry();

    console.log('[EntityDefs] Registering entity definitions...');

    // Weapons
    registry.register(PLASMAGUN);
    // TODO: registry.register(ROCKET_LAUNCHER);
    // TODO: registry.register(RAILGUN);

    // Projectiles
    registry.register(PLASMA_BOLT);
    // TODO: registry.register(ROCKET);

    // TODO: Pickups
    // registry.register(HEALTH_SMALL);

    console.log(`[EntityDefs] Registered ${registry.getCount()} definitions`);
}
