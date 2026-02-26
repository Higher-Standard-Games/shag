/**
 * Riotgun - Weapon Definition
 * 
 * Shotgun-style hitscan weapon firing 20 pellets per shot.
 * Stats from Warsow gs_weapondefs.c.
 */

import { WeaponDef } from '../../WeaponDef';
import { EntityType } from '../../EntityType';

export const RIOTGUN: WeaponDef = {
    // Identity
    id: 'riotgun',
    name: 'Riotgun',
    type: EntityType.WEAPON,
    classname: 'weapon_riotgun',

    // Model
    modelPath: 'models/weapons/riotgun/riotgun.md3',
    scale: 2.0,

    // Pickup glow (warm orange)
    glowColor: { r: 1.0, g: 0.6, b: 0.2 },

    // Gameplay (server-authoritative)
    // 5 damage per pellet × 20 pellets = 100 max damage
    damage: 5,
    fireRate: 1.875,       // ~533ms between shots (20% faster than Warsow's 640ms)
    clipSize: 20,
    ammoType: 'shells',
    maxAmmo: 20,
    reloadTime: 0.64,
    range: 8192,
    hitscan: true,
    hitscanType: 'pellet',
    spread: 6,            // 6° shotgun cone (halved from 12°)
    adsSpread: 3,         // 3° when ADS (50% of hip-fire)
    fireMode: 'semi',
    burstCount: 20,       // 20 pellets per shot
    pickupBounds: { x: 32, y: 32, z: 32 },
    pelletCount: 20,
    knockbackScale: 2.5,
    pickupAmmo: 10,
    useLagCompensation: true,
    crosshair: { style: 'cross', baseGap: 12, lineLength: 8, lineWidth: 2 },

    // View Model
    viewModel: {
        modelPath: 'models/weapons/riotgun/riotgun.md3',
        handModelPath: 'models/weapons/riotgun/riotgun_hand.md3',
        flashModelPath: 'models/weapons/riotgun/riotgun_flash.md3',

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

    // Muzzle Flash — bright warm
    muzzleFlash: {
        color: { r: 1.0, g: 0.7, b: 0.2 },
        intensity: 25,
        range: 45,
        duration: 0.08,
    },

    // Sounds
    sounds: {
        fire: 'sounds/weapons/riotgun_fire_strong.ogg',
    },
};
