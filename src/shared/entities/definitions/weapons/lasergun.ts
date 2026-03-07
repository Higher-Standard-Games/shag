/**
 * Lasergun - Weapon Definition
 * 
 * Continuous beam hitscan weapon with very fast fire rate.
 * Stats from Warsow gs_weapondefs.c.
 */

import { WeaponDef } from '../../WeaponDef';
import { EntityType } from '../../EntityType';

export const LASERGUN: WeaponDef = {
    // Identity
    id: 'lasergun',
    name: 'Lasergun',
    type: EntityType.WEAPON,
    classname: 'weapon_lasergun',

    // Model
    modelPath: '/data/models/weapons/lasergun/lasergun.glb',
    scale: 2.0,

    // Pickup glow (red laser)
    glowColor: { r: 1.0, g: 0.2, b: 0.2 },

    // Gameplay (server-authoritative)
    damage: 7,
    fireRate: 20,         // 50ms reload = 20 shots/sec (beam)
    clipSize: 150,
    ammoType: 'lasers',
    maxAmmo: 150,
    reloadTime: 0.05,
    range: 850,           // Short range beam
    hitscan: true,
    hitscanType: 'beam',
    fireMode: 'auto',
    pickupBounds: { x: 32, y: 32, z: 32 },
    knockbackScale: 1.5,
    useLagCompensation: true,
    crosshair: { style: 'dot', baseGap: 0, lineLength: 0, lineWidth: 3 },

    // View Model — GLB format
    viewModel: {
        modelPath: '/data/models/weapons/lasergun/lasergun.glb',
        viewModelFormat: 'glb',

        hipOffset: { x: 0, y: -25, z: -1 },
        hipRotation: { x: 0, y: 0, z: 0 },

        adsOffset: { x: 0, y: -20, z: -5 },
        adsRotation: { x: 0, y: 0, z: 0 },

        scale: 2.0,
    },

    // ADS
    ads: {
        time: 0.08,
        fovReduction: 15,
        sensitivity: 0.5,
        movementPenalty: 0.5,
    },

    // Muzzle Flash — red beam glow
    muzzleFlash: {
        color: { r: 1.0, g: 0.2, b: 0.1 },
        intensity: 12,
        range: 25,
        duration: 0.03,
    },

    // Sounds
    sounds: {
        fire: 'sounds/weapons/laser_strong_fire.ogg',
    },
};
