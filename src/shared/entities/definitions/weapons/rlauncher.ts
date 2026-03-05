/**
 * Rocket Launcher - Weapon Definition
 * 
 * Classic splash damage projectile weapon.
 * Stats from Warsow gs_weapondefs.c.
 */

import { WeaponDef } from '../../WeaponDef';
import { EntityType } from '../../EntityType';

export const ROCKET_LAUNCHER: WeaponDef = {
    // Identity
    id: 'rlauncher',
    name: 'Rocket Launcher',
    type: EntityType.WEAPON,
    classname: 'weapon_rocketlauncher',

    // Model
    modelPath: 'models/weapons/rlauncher/rlauncher.md3',
    scale: 2.0,

    // Pickup glow (red-orange)
    glowColor: { r: 1.0, g: 0.4, b: 0.1 },

    // Gameplay (server-authoritative)
    damage: 80,
    fireRate: 1.5625,      // 640ms between shots = 1.5625 shots/sec
    clipSize: 0,
    ammoType: 'rockets',
    maxAmmo: 20,
    reloadTime: 0.64,
    range: 10000,
    hitscan: false,
    fireMode: 'semi',
    pickupBounds: { x: 32, y: 32, z: 32 },
    projectileId: 'rocket',
    projectileSpeed: 2592,
    splashRadius: 125,
    splashDamage: 80,
    minSplashDamage: 15,
    knockbackScale: 10.0,
    pickupAmmo: 10,
    useLagCompensation: false,
    crosshair: { style: 'cross_dot', baseGap: 6, lineLength: 6, lineWidth: 2 },
    speedBonus: -25,           // Heavy weapon: -25 speed (375 run)

    // View Model
    viewModel: {
        modelPath: 'models/weapons/rlauncher/rlauncher.md3',
        handModelPath: 'models/weapons/rlauncher/rlauncher_hand.md3',
        flashModelPath: 'models/weapons/rlauncher/rlauncher_flash.md3',

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

    // Muzzle Flash — fiery orange
    muzzleFlash: {
        color: { r: 1.0, g: 0.5, b: 0.1 },
        intensity: 30,
        range: 50,
        duration: 0.08,
    },

    // Sounds
    sounds: {
        fire: 'sounds/weapons/rlauncher_fire.ogg',
    },
};
