/**
 * PowerupComponent - timed powerups held by a player.
 *
 * Only the expiry ticks are stored; every rule (duration, multiplier, packing)
 * lives in shared/items/Powerups.ts so the client HUD and the bots can reuse it.
 */

import type { PowerupExpiry, PowerupKind } from "../../../items/Powerups";
import { grantedExpiryTick } from "../../../items/Powerups";

export interface PowerupComponent {
  /** Absolute server tick each held powerup expires at. Missing key = never held. */
  expiry: PowerupExpiry;
}

/** Create an empty powerup component (no powerups held). */
export function createPowerups(): PowerupComponent {
  return { expiry: {} };
}

/** Clone powerups (for COW) — `expiry` must be copied, not shared. */
export function clonePowerups(p: PowerupComponent): PowerupComponent {
  return { expiry: { ...p.expiry } };
}

/**
 * Grant `kind` at `tick`, extending it if already held.
 * Returns the new expiry tick.
 */
export function grantPowerup(p: PowerupComponent, kind: PowerupKind, tick: number, tickRate: number): number {
  const until = grantedExpiryTick(p.expiry, kind, tick, tickRate);
  p.expiry[kind] = until;
  return until;
}

/** Drop every held powerup (called on death — powerups do not survive dying). */
export function clearPowerups(p: PowerupComponent): void {
  p.expiry = {};
}
