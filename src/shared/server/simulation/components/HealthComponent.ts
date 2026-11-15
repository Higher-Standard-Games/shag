/**
 * HealthComponent - Player health and armor
 */

import { MAX_ARMOR, MAX_HEALTH } from "../physics/constants";

export interface HealthComponent {
  /** Current health (0 = dead) */
  health: number;

  /** Current armor */
  armor: number;

  /** Max health (can be overhealed) */
  maxHealth: number;

  /** Max armor */
  maxArmor: number;

  /** Whether currently dead */
  dead: boolean;

  /** Time of death (tick number) for respawn */
  deathTick: number;
}

/** Create default health */
export function createHealth(): HealthComponent {
  return {
    health: MAX_HEALTH,
    armor: 0,
    maxHealth: MAX_HEALTH,
    maxArmor: MAX_ARMOR,
    dead: false,
    deathTick: 0,
  };
}

/** Clone health (for COW) */
export function cloneHealth(h: HealthComponent): HealthComponent {
  return { ...h };
}

/**
 * Apply damage considering armor
 * Returns actual damage dealt to health
 *
 * Armor soaks whole points, its share rounded up (as Quake 3 does), so a
 * whole-number hit leaves whole-number health and armor. A fraction of a point
 * left over would keep a player alive on what shows as 0, so less than one
 * point of health is death.
 */
export function applyDamage(health: HealthComponent, damage: number, armorAbsorption: number = 0.66): number {
  if (health.dead) return 0;

  // Calculate armor absorption
  let armorDamage = 0;
  let healthDamage = damage;

  if (health.armor > 0) {
    armorDamage = Math.min(health.armor, Math.ceil(damage * armorAbsorption));
    healthDamage = damage - armorDamage;
    health.armor -= armorDamage;
  }

  health.health -= healthDamage;

  if (health.health < 1) {
    health.health = 0;
    health.dead = true;
  }

  return healthDamage;
}
