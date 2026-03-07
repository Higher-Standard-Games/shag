/**
 * Voltaic - Weapon Definition
 * 
 * Continuous beam hitscan weapon with custom GLB model.
 * Orange/yellow beam with charge-up mechanic.
 */

import { WeaponDef } from '../../WeaponDef';
import { EntityType } from '../../EntityType';

export const VOLTAIC: WeaponDef = {
    // Identity
    id: 'voltaic',
    name: 'Voltaic',
    type: EntityType.WEAPON,
    classname: 'weapon_voltaic',

    // Model (world/pickup) — GLB
    modelPath: '/data/models/weapons/voltaic/voltaic.glb',
    scale: 30.0,

    // Pickup glow — electric cyan
    glowColor: { r: 0.2, g: 0.8, b: 1.0 },

    // Gameplay (server-authoritative)
    damage: 7,
    fireRate: 20,         // 50ms reload = 20 shots/sec (beam)
    clipSize: 150,
    ammoType: 'cells',
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
    recoilScale: 0.1,  // Energy gun — very stable, minimal recoil

    // View Model — GLB format
    viewModel: {
        modelPath: '/data/models/weapons/voltaic/voltaic.glb',
        viewModelFormat: 'glb',

        // Gun position — zero rotation baseline to find natural model orientation
        hipOffset: { x: 8, y: -20, z: 22 },
        hipRotation: { x: 0, y: 0, z: 0 },

        adsOffset: { x: 0, y: -15, z: -2 },
        adsRotation: { x: 0, y: 0, z: 0 },

        scale: 65.0,
    },

    // ADS
    ads: {
        time: 0.08,
        fovReduction: 15,
        sensitivity: 0.5,
        movementPenalty: 0.5,
    },

    // Muzzle Flash — warm orange (matches beam)
    muzzleFlash: {
        color: { r: 1.0, g: 0.7, b: 0.1 },
        intensity: 12,
        range: 25,
        duration: 0.03,
    },

    // Sounds (reuse lasergun sounds for now)
    sounds: {
        fire: 'sounds/weapons/laser_strong_fire.ogg',
    },
};
