/**
 * Shared Entities - Barrel export
 *
 * Export all entity-related types and utilities from one place.
 */

// Concrete definitions
export * from "./definitions";
export type { EntityDef } from "./EntityDef";
export { ENTITY_DEFAULTS } from "./EntityDef";
export { EntityRegistry, getEntityRegistry } from "./EntityRegistry";
export { EntityType } from "./EntityType";
export { initializeEntityDefs } from "./initEntityDefs";
export type { ProjectileDef } from "./ProjectileDef";
export { PROJECTILE_DEFAULTS } from "./ProjectileDef";
export type { ADSDef, MuzzleFlashDef, ViewModelDef, WeaponDef } from "./WeaponDef";
export { WEAPON_DEFAULTS } from "./WeaponDef";
