/**
 * Gunblade - Weapon Definition
 *
 * Default spawn weapon. Strong fire shoots a blast projectile,
 * weak fire is a melee slash. Stats from Warsow gs_weapondefs.c.
 */

import { EntityType } from "../../EntityType";
import type { WeaponDef } from "../../WeaponDef";

export const GUNBLADE: WeaponDef = {
  // Identity
  id: "gunblade",
  name: "Gunblade",
  type: EntityType.WEAPON,
  classname: "weapon_gunblade",

  // Model
  modelPath: "/data/models/weapons/gunblade/gunblade.glb",
  scale: 2.0,

  // Pickup glow
  glowColor: { r: 1.0, g: 0.8, b: 0.3 },

  // Gameplay (server-authoritative) — strong fire (blast)
  damage: 35,
  fireRate: 1.67, // 600ms reload = ~1.67 shots/sec
  clipSize: 1,
  ammoType: "gunblade",
  maxAmmo: 1,
  reloadTime: 0.6,
  range: 5000,
  hitscan: false,
  fireMode: "semi",
  pickupBounds: { x: 32, y: 32, z: 32 },
  projectileId: "gunblade_blast",
  projectileSpeed: 3000,
  splashRadius: 80,
  splashDamage: 50,
  minSplashDamage: 10,
  knockbackScale: 8.0,
  useLagCompensation: false,
  crosshair: { style: "dot", baseGap: 0, lineLength: 0, lineWidth: 2 },

  // View Model — GLB format
  viewModel: {
    modelPath: "/data/models/weapons/gunblade/gunblade.glb",
    viewModelFormat: "glb",

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

  // Muzzle Flash
  muzzleFlash: {
    color: { r: 1.0, g: 0.8, b: 0.3 },
    intensity: 20,
    range: 35,
    duration: 0.06,
  },

  // Sounds
  sounds: {
    fire: "sounds/weapons/gunblade_fire.ogg",
  },
};
