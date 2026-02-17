/**
 * Machinegun - Weapon Definition
 * 
 * Fast-firing hitscan weapon with small spread.
 * Stats from Warsow gs_weapondefs.c.
 */

import { WeaponDef } from '../../WeaponDef';
import { EntityType } from '../../EntityType';

export const MACHINEGUN: WeaponDef = {
    // Identity
    id: 'machinegun',
    name: 'Machinegun',
    type: EntityType.WEAPON,
    classname: 'weapon_machinegun',

    // Model
    modelPath: 'models/weapons/machinegun/machinegun.md3',
    scale: 2.0,

    // Pickup glow (yellow-orange)
    glowColor: { r: 1.0, g: 0.9, b: 0.3 },

    // Gameplay (server-authoritative)
    damage: 10,
    fireRate: 10,         // 100ms reload = 10 shots/sec
    clipSize: 100,
    ammoType: 'bullets',
    maxAmmo: 100,
    reloadTime: 0.1,
    range: 6000,
    hitscan: true,
    hitscanType: 'tracer',
    spread: 1.5,          // 1.5° hip-fire cone
    adsSpread: 0.3,       // 0.3° when ADS
    fireMode: 'auto',
    pickupBounds: { x: 32, y: 32, z: 32 },

    // View Model
    viewModel: {
        modelPath: 'models/weapons/machinegun/machinegun.md3',
        handModelPath: 'models/weapons/machinegun/machinegun_hand.md3',
        flashModelPath: 'models/weapons/machinegun/machinegun_flash.md3',

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

    // Muzzle Flash — bright yellow
    muzzleFlash: {
        color: { r: 1.0, g: 0.9, b: 0.3 },
        intensity: 18,
        range: 30,
        duration: 0.04,
    },

    // Sounds
    sounds: {
        fire: 'sounds/weapons/machinegun_fire.ogg',
    },
};
