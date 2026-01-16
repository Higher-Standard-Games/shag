/**
 * WeaponDef - Weapon definition interface
 * 
 * Defines all properties of a weapon. These will eventually come from
 * server/weapon.cfg files, but CVars serve as fallback for tuning.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// ==================== CORE INTERFACES ====================

export interface WeaponDef {
    /** Unique weapon identifier */
    id: string;

    /** Display name */
    name: string;

    // === MODEL PATHS ===
    /** Main weapon model (MD3 path in PK3) */
    modelPath: string;
    /** Hand model (optional) */
    handModelPath?: string;
    /** Muzzle flash model (optional) */
    flashModelPath?: string;

    // === POSITIONING ===
    /** Hip-fire position offset */
    hipOffset: Vector3;
    /** Hip-fire rotation */
    hipRotation: Vector3;
    /** ADS position offset */
    adsOffset: Vector3;
    /** ADS rotation */
    adsRotation: Vector3;
    /** Model scale */
    scale: number;

    // === TIMING (future: server-authoritative) ===
    /** Time to ADS (seconds) */
    adsTime: number;
    /** Fire rate (rounds per second) */
    fireRate: number;
    /** Time between shots (computed from fireRate) */
    fireDelay: number;

    // === MUZZLE FLASH ===
    /** Muzzle flash light color (RGB 0-1) */
    flashColor: { r: number; g: number; b: number };
    /** Muzzle flash light intensity */
    flashIntensity: number;
    /** Muzzle flash light range */
    flashRange: number;
    /** Muzzle flash duration (seconds) */
    flashDuration: number;

    // === SOUNDS (paths in PK3) ===
    /** Fire sound */
    fireSound?: string;
    /** Reload sound */
    reloadSound?: string;
    /** Empty click sound */
    emptySound?: string;
}

// ==================== DEFAULT VALUES ====================

/** Default values for weapon properties */
export const WEAPON_DEFAULTS: Partial<WeaponDef> = {
    adsTime: 0.08,
    fireRate: 10,
    fireDelay: 0.1,
    scale: 2.0,
    flashColor: { r: 1.0, g: 0.8, b: 0.3 },  // Orange-yellow
    flashIntensity: 15,
    flashRange: 30,
    flashDuration: 0.05,
};

// ==================== TEST WEAPON ====================

/** Our test plasmagun weapon definition */
export const TEST_WEAPON_DEF: WeaponDef = {
    id: 'plasmagun',
    name: 'Plasma Gun',

    modelPath: 'models/weapons/plasmagun/plasmagun.md3',
    handModelPath: 'models/weapons/plasmagun/plasmagun_hand.md3',
    flashModelPath: 'models/weapons/plasmagun/plasmagun_flash.md3',

    // Positioning (matching current DEFAULT_POSITIONS)
    hipOffset: new Vector3(10, -19, 25),  // right, down, forward
    hipRotation: new Vector3(0, -Math.PI / 2, 0),
    adsOffset: new Vector3(0, -15, 25),
    adsRotation: new Vector3(0, -Math.PI / 2, 0),
    scale: 2.0,

    // Timing
    adsTime: 0.08,
    fireRate: 10,  // 10 shots/sec
    fireDelay: 0.1,

    // Muzzle flash - PLASMA BLUE-GREEN!
    flashColor: { r: 0.2, g: 0.8, b: 1.0 },  // Cyan/plasma color
    flashIntensity: 20,
    flashRange: 40,
    flashDuration: 0.06,

    // Sounds
    fireSound: 'sounds/weapons/plasmagun/fire.wav',
};
