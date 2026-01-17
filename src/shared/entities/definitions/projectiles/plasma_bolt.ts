/**
 * Plasma Bolt - Projectile Definition
 * 
 * Fast-moving plasma projectile with cyan glow and trail.
 */

import { ProjectileDef } from '../../ProjectileDef';
import { EntityType } from '../../EntityType';

export const PLASMA_BOLT: ProjectileDef = {
    // Identity
    id: 'plasma_bolt',
    name: 'Plasma Bolt',
    type: EntityType.PROJECTILE,
    classname: 'projectile_plasma',

    // Model - none, uses glowing sphere
    // modelPath: undefined,
    scale: 0.8,

    // Gameplay (server-authoritative)
    speed: 2500,       // Units per second - fast!
    damage: 15,
    splashDamage: 5,
    splashRadius: 40,
    lifetime: 5.0,     // Despawn after 5 seconds
    gravity: 0,        // No drop
    bounces: 0,        // Explode on first hit

    // Visuals
    lightColor: { r: 0.2, g: 0.8, b: 1.0 },  // Plasma cyan
    lightIntensity: 8,
    lightRange: 25,

    trailEffect: 'plasma_trail',
    impactEffect: 'plasma_impact',

    // Sounds
    sounds: {
        fly: 'sounds/weapons/plasmagun/fly.wav',
        impact: 'sounds/weapons/plasmagun/impact.wav',
    },
};
