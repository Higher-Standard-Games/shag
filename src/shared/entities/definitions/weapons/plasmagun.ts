/**
 * Plasmagun - Weapon Definition
 * 
 * Fast-firing energy weapon with plasma cyan muzzle flash.
 */

import { WeaponDef } from '../../WeaponDef';
import { EntityType } from '../../EntityType';

export const PLASMAGUN: WeaponDef = {
    // Identity
    id: 'plasmagun',
    name: 'Plasma Gun',
    type: EntityType.WEAPON,
    classname: 'weapon_plasmagun',  // BSP entity classname

    // Model
    modelPath: 'models/weapons/plasmagun/plasmagun.md3',
    scale: 2.0,

    // Pickup glow light (cyan plasma color)
    glowColor: { r: 0.2, g: 0.8, b: 1.0 },

    // Gameplay (server-authoritative)
    damage: 15,
    fireRate: 10,      // 10 shots per second
    clipSize: 50,
    ammoType: 'cells',
    maxAmmo: 200,
    reloadTime: 2.5,
    range: 1500,
    hitscan: false,
    fireMode: 'auto',
    pickupBounds: { x: 32, y: 32, z: 32 },
    projectileId: 'plasma_bolt',

    // View Model
    viewModel: {
        modelPath: 'models/weapons/plasmagun/plasmagun.md3',
        handModelPath: 'models/weapons/plasmagun/plasmagun_hand.md3',
        flashModelPath: 'models/weapons/plasmagun/plasmagun_flash.md3',

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

    // Muzzle Flash - PLASMA CYAN!
    muzzleFlash: {
        color: { r: 0.2, g: 0.8, b: 1.0 },
        intensity: 20,
        range: 40,
        duration: 0.06,
    },

    // Sounds
    sounds: {
        fire: 'sounds/weapons/plasmagun/fire.wav',
        reload: 'sounds/weapons/plasmagun/reload.wav',
    },
};
