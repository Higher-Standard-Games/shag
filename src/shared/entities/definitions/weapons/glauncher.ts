/**
 * Grenade Launcher - Weapon Definition
 * 
 * Lobbing projectile weapon with gravity and bounces.
 * Stats from Warsow gs_weapondefs.c.
 */

import { WeaponDef } from '../../WeaponDef';
import { EntityType } from '../../EntityType';

export const GRENADE_LAUNCHER: WeaponDef = {
    // Identity
    id: 'glauncher',
    name: 'Grenade Launcher',
    type: EntityType.WEAPON,
    classname: 'weapon_grenadelauncher',

    // Model
    modelPath: 'models/weapons/glauncher/glauncher.md3',
    scale: 2.0,

    // Pickup glow (green)
    glowColor: { r: 0.3, g: 0.9, b: 0.2 },

    // Gameplay (server-authoritative)
    damage: 80,
    fireRate: 1.5625,      // 640ms between shots = 1.5625 shots/sec
    clipSize: 0,
    ammoType: 'grenades',
    maxAmmo: 20,
    reloadTime: 0.64,
    range: 10000,
    hitscan: false,
    fireMode: 'semi',
    pickupBounds: { x: 32, y: 32, z: 32 },
    projectileId: 'grenade',
    projectileSpeed: 2434,
    splashRadius: 125,
    splashDamage: 80,
    minSplashDamage: 15,
    knockbackScale: 10.0,
    pickupAmmo: 10,
    useLagCompensation: false,
    crosshair: { style: 'cross_dot', baseGap: 6, lineLength: 6, lineWidth: 2 },

    // View Model
    viewModel: {
        modelPath: 'models/weapons/glauncher/glauncher.md3',
        handModelPath: 'models/weapons/glauncher/glauncher_hand.md3',
        flashModelPath: 'models/weapons/glauncher/glauncher_flash.md3',

        hipOffset: { x: 10, y: -19, z: 25 },
        hipRotation: { x: 0, y: -Math.PI / 2, z: 0 },

        adsOffset: { x: 0, y: -15, z: 25 },
        adsRotation: { x: 0, y: -Math.PI / 2, z: 0 },

        scale: 2.0,
    },

    // ADS
    ads: {
        time: 0.08,
        fovReduction: 15,
        sensitivity: 0.5,
        movementPenalty: 0.5,
    },

    // Muzzle Flash — green tint
    muzzleFlash: {
        color: { r: 0.6, g: 1.0, b: 0.3 },
        intensity: 22,
        range: 40,
        duration: 0.07,
    },

    // Sounds
    sounds: {
        fire: 'sounds/weapons/grenlaunch_strong.ogg',
    },
};
