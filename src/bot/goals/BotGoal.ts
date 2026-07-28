/**
 * BotGoal — what a bot is currently trying to accomplish.
 *
 * Phase 1 of docs/research/BOT_WEIGHTS_AND_GOALS.md: item goals only. The
 * existing StateMachineBrain ladder still decides FIGHT/DODGE/RETREAT vs
 * "go get something"; the arbiter only chooses WHICH thing, replacing the old
 * `getNearestPickup()` (nearest-wins, no notion of value).
 *
 * The record is plain data so it can be logged, asserted in fixtures, and later
 * carried across the process boundary as a gametype directive without change.
 */

import type { PickupType } from "../../shared/bsp/PickupTable";
import type { Vec3 } from "../BotGameState";

/** Goal kinds. Phase 1 implements only `acquire_item`. */
export type BotGoalKind = "acquire_item";

/** What the goal is about, for considerations to score. */
export interface GoalItem {
  /** weapon | ammo | armor | health | powerup */
  type: PickupType;
  /** Tier/identity within the type: "ra", "mega", "quad", "rockets", … */
  kind: string;
  /** Ammo amount granted, when type === "ammo". */
  amount?: number;
}

export interface BotGoal {
  /**
   * Stable identity, derived from the TARGET and never from the ranking.
   *
   * This matters more than it looks: hysteresis and failure cooldowns are keyed
   * on this string, so an id meaning "whatever is nearest right now" would make
   * a bot appear committed while the underlying target silently swapped every
   * tick. See §6.4 of the design doc.
   */
  id: string;
  kind: BotGoalKind;
  position: Vec3;
  item: GoalItem;
  /** Static map pickup id (PickupEntry.id) — shared with the server. */
  pickupId?: number;
  /** Snapshot entity id, for dropped weapons (which have no static id). */
  entityId?: string;
}

/** Stable id for a static map pickup. */
export function staticItemGoalId(pickupId: number): string {
  return `item:pickup:${pickupId}`;
}

/** Stable id for a dropped weapon lying in the world. */
export function droppedItemGoalId(entityId: string): string {
  return `item:dropped:${entityId}`;
}
