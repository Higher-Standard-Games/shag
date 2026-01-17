/**
 * ProjectileDef - Projectile entity definition
 * 
 * Defines projectile properties for both server (damage, speed)
 * and client (model, trail, impact effects).
 */

import { EntityDef } from './EntityDef';
import { EntityType } from './EntityType';

/**
 * Full projectile definition
 */
export interface ProjectileDef extends EntityDef {
    type: EntityType.PROJECTILE;

    // === SERVER-AUTHORITATIVE (gameplay) ===
    /** Projectile speed (units per second) */
    speed: number;
    /** Direct hit damage */
    damage: number;
    /** Splash damage (optional) */
    splashDamage?: number;
    /** Splash radius (optional) */
    splashRadius?: number;
    /** Max lifetime before despawn (seconds) */
    lifetime: number;
    /** Gravity multiplier (0 = no gravity, 1 = normal) */
    gravity?: number;
    /** Number of bounces before explode (0 = explode on first hit) */
    bounces?: number;

    // === CLIENT-SIDE (visuals) ===
    /** Projectile light color */
    lightColor?: { r: number; g: number; b: number };
    /** Projectile light intensity */
    lightIntensity?: number;
    /** Projectile light range */
    lightRange?: number;

    /** Trail effect ID */
    trailEffect?: string;
    /** Impact effect ID */
    impactEffect?: string;

    // === SOUNDS ===
    sounds?: {
        /** Looping fly sound */
        fly?: string;
        /** Impact sound */
        impact?: string;
        /** Bounce sound */
        bounce?: string;
    };
}

// ==================== DEFAULTS ====================

export const PROJECTILE_DEFAULTS: Partial<ProjectileDef> = {
    speed: 2000,
    damage: 15,
    lifetime: 5.0,
    gravity: 0,
    bounces: 0,
    lightIntensity: 5,
    lightRange: 20,
};
