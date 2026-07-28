/**
 * ItemGoalPlanner — the Phase 1 entry point the brain calls.
 *
 * Assembles the arbiter with the item considerations and gates, and answers one
 * question: "of everything I could go and get, which one?" It deliberately does
 * NOT decide whether the bot should be getting items at all — that stays with
 * the existing StateMachineBrain ladder for Phase 1, so combat behaviour is
 * provably unchanged (design doc §13 Phase 1).
 *
 * Replaces `BotGameState.getNearestPickup()`, which was `pickups.find(p =>
 * p.distance <= max)` — nearest wins, always, with no notion of value.
 */

import type { PickupEntry } from "../../shared/bsp/PickupTable";
import { type ArmorKind, armorAfterPickup, type HealthKind, healthAfterPickup } from "../../shared/items/ItemGrants";
import type { BotGameState } from "../BotGameState";
import type { BotGoal } from "./BotGoal";
import type { ConsiderationContext } from "./Consideration";
import { Danger } from "./considerations/Danger";
import { ItemDenial } from "./considerations/ItemDenial";
import { ItemValue } from "./considerations/ItemValue";
import { estimateRouteCost, RouteCost } from "./considerations/RouteCost";
import { type ArbitrationResult, GoalArbiter, type GoalGate } from "./GoalArbiter";
import { collectItemGoals } from "./ItemGoalSource";
import { type BotWeightProfile, DEFAULT_WEIGHT_PROFILE } from "./WeightProfile";

/** Considerations in a fixed order — the order is the ML feature schema. */
export const ITEM_CONSIDERATIONS = [ItemValue, ItemDenial, RouteCost, Danger] as const;

/**
 * Hard preconditions. These are 0/1 rejections, not low scores: "the server
 * will refuse this pickup" and "this item is mildly unattractive" must never be
 * the same thing.
 */
function buildGates(blockedPickupIds: ReadonlySet<number>): GoalGate[] {
  return [
    // Bot-local failure cooldown (missed the pickup, path failed).
    (goal) => (goal.pickupId !== undefined && blockedPickupIds.has(goal.pickupId) ? "blocked" : null),

    // The server gates health/armor pickups on `after > before`, so an item that
    // would grant nothing is not merely worthless — it is uncollectable, and a
    // bot that walks to one stands on it forever.
    (goal, ctx) => {
      const { type, kind } = goal.item;
      if (type === "health") {
        return healthAfterPickup(ctx.self.health, kind as HealthKind) > ctx.self.health ? null : "no_gain";
      }
      if (type === "armor") {
        return armorAfterPickup(ctx.self.armor, kind as ArmorKind) > ctx.self.armor ? null : "no_gain";
      }
      return null;
    },

    // No route means no goal (design doc §7.4: unreachable is a gate, not a
    // small score). Phase 1's estimator never returns null; Phase 3's will.
    (_goal, ctx) => (ctx.routeCost === null ? "unreachable" : null),
  ];
}

export interface ItemGoalPlannerOptions {
  /** Static pickup table for the map. */
  pickupPositions: readonly PickupEntry[];
  /** Candidate cutoff (straight-line units). */
  maxDistance: number;
  /** Pickup ids on a local failure cooldown. */
  blockedPickupIds: ReadonlySet<number>;
  /** Phase 2 will select this per gametype; Phase 1 uses the default. */
  weights?: BotWeightProfile;
  /**
   * Restrict candidates to these pickup types.
   *
   * Used by RETREAT, which means "I am about to die, go heal" — a specific
   * intent, not an open shopping trip. Without it the arbiter would correctly
   * but unhelpfully rank Red Armor above a health bubble at 39 HP (armor is
   * worth more effective HP), which is a fine deathmatch judgement and the
   * wrong answer for a bot that is fleeing. Keeping the filter also holds
   * Phase 1 to its promise that only item CHOICE changes, not bot behaviour.
   */
  typeFilter?: ReadonlySet<string>;
}

export class ItemGoalPlanner {
  private readonly arbiter = new GoalArbiter(ITEM_CONSIDERATIONS);
  private lastExplain = "";

  /** Committed goal id, for the brain's replan logic. */
  get committedGoalId(): string | null {
    return this.arbiter.committedGoalId;
  }

  /** Last decision summary, for bot diagnostics. */
  get explain(): string {
    return this.lastExplain;
  }

  /** Drop commitment — on death, respawn, or a completed/failed goal. */
  reset(): void {
    this.arbiter.reset();
    this.lastExplain = "";
  }

  /**
   * Choose the best item goal, or null when nothing is worth going for.
   * Pure with respect to the world: reads state, mutates only commitment.
   */
  select(state: BotGameState, options: ItemGoalPlannerOptions): ArbitrationResult {
    const weights = options.weights ?? DEFAULT_WEIGHT_PROFILE;
    // Gates are per-call because the blocked set changes each tick; the arbiter
    // itself is long-lived because it owns the commitment window.
    const gates = buildGates(options.blockedPickupIds);

    let candidates = collectItemGoals(state, {
      pickupPositions: options.pickupPositions,
      maxDistance: options.maxDistance,
    });
    if (options.typeFilter) {
      const allowed = options.typeFilter;
      candidates = candidates.filter((c) => allowed.has(c.item.type));
    }

    const result = this.arbiter.select(candidates, (goal) => this.makeContext(goal, state, weights), state.tick, gates);
    this.lastExplain = result.explain;
    return result;
  }

  private makeContext(goal: BotGoal, state: BotGameState, weights: BotWeightProfile): ConsiderationContext {
    return {
      goal,
      self: state.self,
      state,
      routeCost: estimateRouteCost(state.self.position, goal.position),
      weights,
    };
  }
}
