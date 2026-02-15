/**
 * Gunblade Blast - Projectile Definition
 * 
 * Gunblade strong fire projectile with splash damage.
 * Stats from Warsow gs_weapondefs.c.
 */

import { ProjectileDef } from '../../ProjectileDef';
import { EntityType } from '../../EntityType';

export const GUNBLADE_BLAST: ProjectileDef = {
    // Identity
    id: 'gunblade_blast',
    name: 'Gunblade Blast',
    type: EntityType.PROJECTILE,
    classname: 'projectile_gunblade',

    // Projectile model
    modelPath: 'models/objects/projectile/gunblade/proj_gunbladeblast.md3',
    scale: 1.0,

    // Gameplay (server-authoritative)
    speed: 3000,
    damage: 35,
    splashDamage: 8,
    splashRadius: 80,
    lifetime: 5.0,
    gravity: 0,
    bounces: 0,

    // Light
    lightColor: { r: 1.0, g: 0.8, b: 0.3 },
    lightIntensity: 8,
    lightRange: 25,

    // Impact
    impactModelPath: 'models/weapon_hits/gunblade/hit_blast.md3',
    impactScale: 2.0,
    impactDuration: 0.3,

    trailEffect: 'gunblade_trail',
    impactEffect: 'gunblade_impact',

    // Sounds
    sounds: {
        impact: 'sounds/weapons/gunblade_impact.ogg',
    },
};
