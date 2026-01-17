/**
 * EntityDef - Base interface for all entity definitions
 * 
 * This is the foundation that all specialized entity definitions extend.
 * Contains common properties shared by weapons, projectiles, pickups, etc.
 */

import { EntityType } from './EntityType';

/**
 * Base entity definition - everything shares this
 */
export interface EntityDef {
    // === IDENTITY ===
    /** Unique identifier (e.g., "plasmagun", "health_large") */
    id: string;

    /** Display name */
    name: string;

    /** Entity type for categorization */
    type: EntityType;

    // === VISUALS ===
    /** Primary 3D model path (MD3/GLB in PK3) */
    modelPath?: string;

    /** Texture path overrides */
    texturePaths?: string[];

    /** Model scale multiplier */
    scale?: number;

    // === SOUNDS ===
    /** Named sounds (e.g., { "spawn": "sounds/spawn.wav" }) */
    sounds?: Record<string, string>;

    // === EFFECTS ===
    /** Named effects (e.g., { "trail": "effects/plasma_trail" }) */
    effects?: Record<string, string>;
}

/**
 * Default values for common entity properties
 */
export const ENTITY_DEFAULTS = {
    scale: 1.0,
};
