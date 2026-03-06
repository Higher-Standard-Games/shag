/**
 * Voltaic - Weapon Definition
 * 
 * Continuous beam hitscan weapon. Replaces lasergun with new GLB model.
 * Electric blue/cyan beam with fast fire rate.
 * Responds to both 'weapon_voltaic' and legacy 'weapon_lasergun' classnames.
 */

import { WeaponDef } from '../../WeaponDef';
import { EntityType } from '../../EntityType';

export const VOLTAIC: WeaponDef = {
    // Identity
    id: 'voltaic',
    name: 'Voltaic',
    type: EntityType.WEAPON,
    classname: 'weapon_voltaic',
    classnameAliases: ['weapon_lasergun'],  // Backward compat with Q3/Warsow maps

    // Model (world/pickup) — GLB
    modelPath: '/data/models/weapons/voltaic/voltaic.glb',
    scale: 1.0,

    // Pickup glow — electric cyan
    glowColor: { r: 0.2, g: 0.8, b: 1.0 },

    // Gameplay (server-authoritative) — same beam stats as old lasergun
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

    // View Model — GLB format
    viewModel: {
        modelPath: '/data/models/weapons/voltaic/voltaic.glb',
        viewModelFormat: 'glb',

        hipOffset: { x: 10, y: -22, z: 25 },
        hipRotation: { x: 0, y: -Math.PI / 2, z: 0 },

        adsOffset: { x: 0, y: -17, z: 25 },
        adsRotation: { x: 0, y: -Math.PI / 2, z: 0 },

        scale: 8.0,
    },

    // ADS
    ads: {
        time: 0.08,
        fovReduction: 15,
        sensitivity: 0.5,
        movementPenalty: 0.5,
    },

    // Muzzle Flash — electric cyan
    muzzleFlash: {
        color: { r: 0.2, g: 0.7, b: 1.0 },
        intensity: 12,
        range: 25,
        duration: 0.03,
    },

    // Sounds (reuse lasergun sounds for now)
    sounds: {
        fire: 'sounds/weapons/laser_strong_fire.ogg',
    },
};
