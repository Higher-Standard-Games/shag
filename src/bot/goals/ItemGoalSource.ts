/**
 * ItemGoalSource — turns map knowledge into scorable item goals.
 *
 * This is where the identity the bot has always had but always discarded comes
 * back. `BotVision.mapKnowledge.pickupPositions` is a full `PickupEntry[]` —
 * id, classname, type, kind, amount, position, shared with the server — but the
 * only consumer was `findNearestItem(from, type)`, which threw away everything
 * except the position and matched on a coarse type string. That is why a bot
 * could not tell Red Armor from an armor shard.
 *
 * Candidate generation is bounded (design doc §7.5): the nearest N by straight
 * line, since scoring is cheap but not free and a map can hold ~25 live items.
 * Major items (armors, Mega Health, powerups) are always candidates while they
 * are up, at any distance: they are what an item route is planned around, and
 * the nearest twelve leave them out from most of a map.
 */

import type { PickupEntry } from "../../shared/bsp/PickupTable";
import { type BotGameState, type Vec3, vec3Distance } from "../BotGameState";
import { type BotGoal, droppedItemGoalId, staticItemGoalId } from "./BotGoal";

/** Upper bound on candidates scored per decision, besides major items. */
export const MAX_ITEM_CANDIDATES = 12;

/** Worth crossing the map for: always candidates while up. */
function isMajorItem(entry: PickupEntry): boolean {
  if (entry.type === "powerup") return true;
  if (entry.type === "armor") return entry.kind === "ga" || entry.kind === "ya" || entry.kind === "ra";
  return entry.type === "health" && (entry.kind === "mega" || entry.kind === "ultra");
}

export interface ItemGoalSourceOptions {
  /** Static pickup table for the loaded map (from BotVision.mapKnowledge). */
  pickupPositions: readonly PickupEntry[];
  /** Ignore candidates beyond this straight-line distance. */
  maxDistance: number;
}

/**
 * Build the candidate item goals for this tick.
 *
 * Static pickups are filtered by the authoritative `pickupActiveMask` before
 * scoring — an item the server says is collected is not a candidate at all,
 * rather than a candidate that scores badly.
 */
export function collectItemGoals(state: BotGameState, options: ItemGoalSourceOptions): BotGoal[] {
  const from = state.self.position;
  const goals: Array<{ goal: BotGoal; distance: number }> = [];
  const majors: Array<{ goal: BotGoal; distance: number }> = [];

  for (const entry of options.pickupPositions) {
    // Authoritative availability. An absent mask (older payload) means unknown,
    // and we optimistically allow it — the gate on arrival still applies.
    if (state.pickupActiveMask.length > entry.id && state.pickupActiveMask[entry.id] === false) continue;

    const distance = vec3Distance(from, entry.position);
    const major = isMajorItem(entry);
    if (distance > options.maxDistance && !major) continue;

    (major ? majors : goals).push({
      distance,
      goal: {
        id: staticItemGoalId(entry.id),
        kind: "acquire_item",
        position: entry.position,
        pickupId: entry.id,
        item: { type: entry.type, kind: entry.kind, amount: entry.amount },
      },
    });
  }

  // Dropped weapons are live snapshot entities with no static id. They carry a
  // weaponId in `type` (the weaponMeta component), not a pickup kind.
  for (const dropped of state.pickups) {
    const distance = dropped.distance;
    if (distance > options.maxDistance) continue;
    goals.push({
      distance,
      goal: {
        id: droppedItemGoalId(dropped.entityId),
        kind: "acquire_item",
        position: dropped.position,
        entityId: dropped.entityId,
        item: { type: "weapon", kind: dropped.type },
      },
    });
  }

  goals.sort((a, b) => a.distance - b.distance);
  return [...majors, ...goals.slice(0, MAX_ITEM_CANDIDATES)].map((c) => c.goal);
}

/** Straight-line distance helper shared with the brain's fallbacks. */
export function goalDistance(from: Vec3, goal: BotGoal): number {
  return vec3Distance(from, goal.position);
}
