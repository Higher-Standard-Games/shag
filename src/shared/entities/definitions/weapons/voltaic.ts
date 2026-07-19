/**
 * Voltaic - Weapon Definition
 *
 * Continuous beam hitscan weapon using the modern Lasergun model set.
 * Orange/yellow beam with charge-up mechanic.
 */

import { EntityType } from "../../EntityType";
import type { WeaponDef } from "../../WeaponDef";

export const VOLTAIC: WeaponDef = {
  // Identity
  id: "voltaic",
  name: "Voltaic",
  type: EntityType.WEAPON,
  classname: "weapon_voltaic",
  classnameAliases: ["weapon_lasergun"],

  // Runtime conversion of the modern Lasergun IQM supplied by z_weapons.pk3.
  modelPath: "/data/models/weapons/lasergun/lasergun.glb",
  scale: 2.0,

  // Pickup glow — electric cyan
  glowColor: { r: 0.2, g: 0.8, b: 1.0 },

  // Gameplay (server-authoritative)
  damage: 7,
  fireRate: 20, // 50ms reload = 20 shots/sec (beam)
  clipSize: 60,
  reloadModel: "clip",
  ammoType: "cells",
  maxAmmo: 120,
  // Uses the shared Plasmagun-style downshift reload. Fire cadence comes from
  // fireRate; the old 0.065 value compressed the entire clip reload animation.
  reloadTime: 1.3,
  range: 850, // Short range beam
  hitscan: true,
  hitscanType: "beam",
  fireMode: "auto",
  pickupBounds: { x: 32, y: 32, z: 32 },
  knockbackScale: 1.5,
  useLagCompensation: true,
  crosshair: { style: "dot", baseGap: 0, lineLength: 0, lineWidth: 3 },
  recoilScale: 0.1, // Energy gun — very stable, minimal recoil

  // Canonical Voltaic chain behavior. Warsow `lasergun` compatibility input is
  // normalized to this same definition before combat runs.
  chainCount: 2, // arc to up to 2 extra enemies
  chainRadius: 280, // links up to 280u apart
  chainFalloff: 0.5, // 100% → 50% → 25% per hop

  // Hipfire downside: the beam is unstable and bends/drifts from the hip, so it's
  // imprecise at range unless you ADS (which locks it straight). Warsow-LG feel.
  beamWanderDeg: 4,

  // View model — runtime conversion of the modern z_weapons IQM.
  viewModel: {
    modelPath: "/data/models/weapons/lasergun/lasergun.glb",
    viewModelFormat: "glb",

    hipOffset: { x: 0, y: -25, z: -1 },
    hipRotation: { x: 0, y: 0, z: 0 },

    // Y is viewmodel height; one unit lower keeps the rear housing off the sightline.
    adsOffset: { x: 0, y: -21, z: -5 },
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

  // Muzzle Flash — warm orange (matches beam)
  muzzleFlash: {
    color: { r: 1.0, g: 0.7, b: 0.1 },
    intensity: 12,
    range: 25,
    duration: 0.03,
  },

  // Sounds (reuse lasergun sounds for now)
  sounds: {
    fire: "sounds/weapons/laser_strong_fire.ogg",
  },
};
