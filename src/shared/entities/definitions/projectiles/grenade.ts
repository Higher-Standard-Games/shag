/**
 * Grenade - Projectile Definition
 *
 * Lobbing projectile with gravity, bounces, and splash damage.
 * Stats from Warsow gs_weapondefs.c.
 */

import { EntityType } from "../../EntityType";
import type { ProjectileDef } from "../../ProjectileDef";

export const GRENADE: ProjectileDef = {
  // Identity
  id: "grenade",
  name: "Grenade",
  type: EntityType.PROJECTILE,
  classname: "projectile_grenade",

  // Projectile model
  modelPath: "models/objects/projectile/glauncher/grenadestrong.md3",
  scale: 1.0,

  // Gameplay (server-authoritative)
  speed: 1000,
  damage: 80,
  splashDamage: 15,
  splashRadius: 125,
  lifetime: 1.25, // 1250ms timeout
  gravity: 1, // Full gravity
  bounces: 3, // Bounces before explode

  // Light
  lightColor: { r: 0.3, g: 0.5, b: 1.0 },
  lightIntensity: 6,
  lightRange: 20,

  // Impact
  impactModelPath: "models/weapon_hits/glauncher/hit_glauncher.md3",
  impactScale: 2.5,
  impactDuration: 0.4,

  trailEffect: "grenade_trail",
  impactEffect: "grenade_impact",

  // Sounds
  sounds: {
    bounce: "sounds/weapons/gren_strong_bounce1.ogg",
    impact: "sounds/weapons/grenade_impact.ogg",
  },
};
