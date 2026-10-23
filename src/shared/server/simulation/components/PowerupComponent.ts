/**
 * PowerupComponent - timed powerups held by a player.
 *
 * Stores absolute expiry ticks keyed by the game-defined powerup ID.
 * The game owns duration, grants, effects and snapshot bit assignments.
 */
export interface PowerupComponent {
  /** Absolute server tick each held powerup expires at. Missing key = never held. */
  expiry: Partial<Record<string, number>>;
}

/** Create an empty powerup component (no powerups held). */
export function createPowerups(): PowerupComponent {
  return { expiry: {} };
}

/** Clone powerups (for COW) — `expiry` must be copied, not shared. */
export function clonePowerups(p: PowerupComponent): PowerupComponent {
  return { expiry: { ...p.expiry } };
}

/** Drop every held powerup (called on death — powerups do not survive dying). */
export function clearPowerups(p: PowerupComponent): void {
  p.expiry = {};
}
