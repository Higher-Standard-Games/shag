/**
 * Plasmagun - Weapon Definition
 *
 * Fast-firing energy weapon with plasma cyan muzzle flash.
 */

import { EntityType } from "../../EntityType";
import type { WeaponDef } from "../../WeaponDef";

export const PLASMAGUN: WeaponDef = {
  // Identity
  id: "plasmagun",
  name: "Plasma Gun",
  type: EntityType.WEAPON,
  classname: "weapon_plasmagun", // BSP entity classname

  // Model
  modelPath: "/data/models/weapons/plasmagun/plasmagun.glb",
  scale: 2.0,

  // Pickup glow light (green plasma color)
  glowColor: { r: 0.3, g: 1.0, b: 0.3 },

  // Gameplay (server-authoritative)
  damage: 15,
  fireRate: 12.5, // 12.5 shots per second (25% faster)
  clipSize: 50,
  ammoType: "cells",
  maxAmmo: 200,
  reloadTime: 1.3, // Reload animation duration (1.0 seconds)
  range: 1500,
  hitscan: false,
  fireMode: "auto",
  hipfireBlocked: true,
  spread: 3, // 3° random spread when hip-firing
  adsSpread: 0, // Perfectly accurate when ADS
  pickupBounds: { x: 32, y: 32, z: 32 },
  projectileId: "plasma_bolt",
  projectileSpeed: 1750,
  splashRadius: 45,
  splashDamage: 15,
  minSplashDamage: 5,
  knockbackScale: 4.5,
  recoilScale: 0.4, // Fast-firing energy gun — visible kick, fast recovery
  useLagCompensation: false,
  crosshair: { style: "cross_dot", baseGap: 4, lineLength: 5, lineWidth: 2 },

  // View Model — GLB format
  viewModel: {
    modelPath: "/data/models/weapons/plasmagun/plasmagun.glb",
    viewModelFormat: "glb",

    hipOffset: { x: 0, y: -25, z: -1 },
    hipRotation: { x: 0, y: 0, z: 0 },

    adsOffset: { x: 0, y: -22, z: -5 },
    adsRotation: { x: 0, y: 0, z: 0 },

    scale: 2.0,
  },

  // Barrel sub-models (dual counter-rotating chambers)
  // cfg: barrel 850 0.5 0.5 / barrel 850 0.5 -0.5
  // Barrels side by side, Z axis = left/right in weapon space
  barrels: [
    {
      modelPath: "/data/models/weapons/plasmagun/plasmagun_barrel.glb",
      spinSpeed: 4.0,
      spinDirection: 1,
      offset: { x: 0, y: 0, z: -4 },
    },
    {
      modelPath: "/data/models/weapons/plasmagun/plasmagun_barrel.glb",
      spinSpeed: 4.0,
      spinDirection: -1,
      offset: { x: 0, y: 0, z: 0 },
    },
  ],

  // ADS
  ads: {
    time: 0.08,
    fovReduction: 15,
    sensitivity: 0.5,
    movementPenalty: 0.5,
  },

  // Muzzle Flash - PLASMA CYAN!
  muzzleFlash: {
    color: { r: 0.3, g: 1.0, b: 0.3 },
    intensity: 20,
    range: 40,
    duration: 0.06,
  },

  // Sounds
  sounds: {
    fire: "sounds/weapons/plasmagun/fire.wav",
    reload: "sounds/weapons/plasmagun/reload.wav",
  },
};
