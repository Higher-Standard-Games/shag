/**
 * Shared Entities - Barrel export
 * 
 * Export all entity-related types and utilities from one place.
 */

export { EntityType } from './EntityType';
export type { EntityDef } from './EntityDef';
export { ENTITY_DEFAULTS } from './EntityDef';
export { EntityRegistry, getEntityRegistry } from './EntityRegistry';
export type { WeaponDef, ViewModelDef, ADSDef, MuzzleFlashDef } from './WeaponDef';
export { WEAPON_DEFAULTS } from './WeaponDef';
export type { ProjectileDef } from './ProjectileDef';
export { PROJECTILE_DEFAULTS } from './ProjectileDef';
export { initializeEntityDefs } from './initEntityDefs';

// Concrete definitions
export * from './definitions';
