/**
 * Entity Initialization - Register all entity definitions
 * 
 * Call this on startup to populate the EntityRegistry.
 */

import { getEntityRegistry } from './EntityRegistry';
import { PLASMAGUN } from './definitions/weapons';

/**
 * Register all entity definitions with the registry.
 * Call this once during engine/game initialization.
 */
export function initializeEntityDefs(): void {
    const registry = getEntityRegistry();

    console.log('[EntityDefs] Registering entity definitions...');

    // Weapons
    registry.register(PLASMAGUN);

    // TODO: Add more weapons here as they're created
    // registry.register(ROCKET_LAUNCHER);
    // registry.register(RAILGUN);

    // TODO: Add projectiles
    // registry.register(PLASMA_BOLT);

    // TODO: Add pickups
    // registry.register(HEALTH_SMALL);

    console.log(`[EntityDefs] Registered ${registry.getCount()} definitions`);
}
