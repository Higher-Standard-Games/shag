/**
 * Blade Blast - Projectile Definition
 *
 * Charged blade energy projectile with red glow and trail.
 * Fires when player holds attack for 1 second.
 * Double plasma splash radius for area denial.
 */

import { EntityType } from "../../EntityType";
import type { ProjectileDef } from "../../ProjectileDef";

export const BLADE_BLAST: ProjectileDef = {
  // Identity
  id: "blade_blast",
  name: "Blade Blast",
  type: EntityType.PROJECTILE,
  classname: "projectile_blade",

  // Projectile model — reuse gunblade blast model for now (TODO: custom red energy ball)
  modelPath: "models/objects/projectile/gunblade/proj_gunbladeblast.md3",
  scale: 1.5,

  // Gameplay (server-authoritative)
  speed: 2500,
  damage: 50,
  splashDamage: 50,
  splashRadius: 90, // 2x plasma (plasma = 40)
  lifetime: 5.0,
  gravity: 0,
  bounces: 0,

  // Light — deep red energy
  lightColor: { r: 1.0, g: 0.15, b: 0.1 },
  lightIntensity: 12,
  lightRange: 35,

  // Impact — reuse gunblade hit for now
  impactModelPath: "models/weapon_hits/gunblade/hit_blast.md3",
  impactScale: 3.0,
  impactDuration: 0.4,

  trailEffect: "blade_trail",
  impactEffect: "blade_impact",

  // Sounds — reuse gunblade sounds for now
  sounds: {
    impact: "sounds/weapons/gunblade_impact.ogg",
  },
};
