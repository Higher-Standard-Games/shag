/**
 * Electrobolt - Weapon Definition
 * 
 * High-damage hitscan sniper weapon with slow fire rate.
 * Stats from Warsow gs_weapondefs.c.
 */

import { WeaponDef } from '../../WeaponDef';
import { EntityType } from '../../EntityType';

export const ELECTROBOLT: WeaponDef = {
    // Identity
    id: 'electrobolt',
    name: 'Electrobolt',
    type: EntityType.WEAPON,
    classname: 'weapon_electrobolt',

    // Model
    modelPath: 'models/weapons/electrobolt/electrobolt.md3',
    scale: 2.0,

    // Pickup glow (electric blue)
    glowColor: { r: 0.3, g: 0.5, b: 1.0 },

    // Gameplay (server-authoritative)
    damage: 75,
    fireRate: 0.8,        // 1250ms reload = 0.8 shots/sec
    clipSize: 10,
    ammoType: 'bolts',
    maxAmmo: 10,
    reloadTime: 1.25,
    range: 10000,
    hitscan: true,
    hitscanType: 'bolt',
    fireMode: 'semi',
    pickupBounds: { x: 32, y: 32, z: 32 },

    // View Model
    viewModel: {
        modelPath: 'models/weapons/electrobolt/electrobolt.md3',
        handModelPath: 'models/weapons/electrobolt/electrobolt_hand.md3',
        flashModelPath: 'models/weapons/electrobolt/electrobolt_flash.md3',

        hipOffset: { x: 10, y: -19, z: 25 },
        hipRotation: { x: 0, y: -Math.PI / 2, z: 0 },

        adsOffset: { x: 0, y: -15, z: 25 },
        adsRotation: { x: 0, y: -Math.PI / 2, z: 0 },

        scale: 2.0,
    },

    // ADS
    ads: {
        time: 0.08,
        fovReduction: 25,     // More zoom for sniper
        sensitivity: 0.3,
        movementPenalty: 0.7,
    },

    // Muzzle Flash — electric blue
    muzzleFlash: {
        color: { r: 0.3, g: 0.5, b: 1.0 },
        intensity: 35,
        range: 60,
        duration: 0.1,
    },

    // Sounds
    sounds: {
        fire: 'sounds/weapons/electrobolt_strong.ogg',
    },
};
