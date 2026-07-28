/**
 * ChannelledAction — "hold this state for N ticks to make something happen".
 *
 * Arming and defusing a bomb are the first users
 * (docs/research/Search_And_Destroy.md §5.3), but nothing here knows what a
 * bomb is. A channel is: a player, a kind, a target, a duration, and the rule
 * that interrupting it loses the progress.
 *
 * ## Declarative, not imperative
 *
 * There is no `begin()` / `cancel()` pair. Each tick the caller states what the
 * player *could* be channelling right now — or `null` for nothing — and the
 * tracker works out whether that starts, continues, completes or cancels a
 * channel.
 *
 * That matters because the cancel conditions for a real channel are numerous
 * and easy to forget: left the radius, died, the target was destroyed, the
 * round ended, the item was picked up by someone else, the player switched
 * weapons. With an imperative API every one of those is a call site that can be
 * missed, and a missed one leaves a player invisibly arming a bomb they walked
 * away from. Stating the precondition once per tick makes forgetting impossible
 * — if the condition stops holding, the channel stops.
 *
 * Ticks, not seconds: the server runs at a fixed rate and re-simulates for
 * demos, so accumulating float seconds would drift.
 */

/** What a player is trying to channel this tick. */
export interface ChannelRequest {
  /** Action kind, e.g. "arm" / "defuse". Changing it restarts the channel. */
  kind: string;
  /**
   * What is being acted on — a bomb site id, an entity id. Changing it restarts
   * the channel, so walking from site A to site B never carries progress over.
   */
  targetId: number;
  /** Ticks of continuous holding required. */
  durationTicks: number;
}

/** A channel in progress. */
export interface ChannelState {
  kind: string;
  targetId: number;
  durationTicks: number;
  /** Ticks of holding accumulated, starting at 1. Completion clears the channel. */
  elapsedTicks: number;
  /** Tick the channel began, for diagnostics and demo alignment. */
  startedAtTick: number;
}

export type ChannelOutcomeKind =
  /** Nothing was happening and nothing started. */
  | "idle"
  /** A channel began this tick. */
  | "started"
  /** A channel advanced. */
  | "progress"
  /** A channel reached its duration this tick. Fires exactly once. */
  | "completed"
  /** A channel was interrupted and its progress discarded. */
  | "cancelled";

export interface ChannelOutcome {
  kind: ChannelOutcomeKind;
  /** The channel this outcome refers to. Absent for `idle`. */
  channel?: ChannelState;
  /** Why a channel was cancelled — "interrupted" or "retargeted". */
  reason?: string;
}

/** Progress fraction 0..1 for a channel state. */
export function channelProgress(channel: ChannelState | undefined): number {
  if (!channel || channel.durationTicks <= 0) return 0;
  const p = channel.elapsedTicks / channel.durationTicks;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * Per-entity channel bookkeeping.
 *
 * One channel per entity at a time: a player cannot arm and defuse at once, and
 * a second channel would only ever mean the caller's preconditions disagree.
 * Several entities may channel the same target simultaneously (two defenders on
 * one bomb) — each holds their own progress and whoever completes first wins,
 * which falls out rather than needing a rule.
 */
export class ChannelTracker {
  private readonly channels = new Map<number, ChannelState>();

  /** Active channel for an entity, if any. */
  get(entityId: number): ChannelState | undefined {
    return this.channels.get(entityId);
  }

  /** Progress fraction 0..1 for an entity's active channel. */
  progress(entityId: number): number {
    return channelProgress(this.channels.get(entityId));
  }

  /** Every active channel, for replication. */
  entries(): IterableIterator<[number, ChannelState]> {
    return this.channels.entries();
  }

  /**
   * Advance this entity's channel by one tick.
   *
   * @param request what the entity could be channelling now, or `null` for
   *   nothing — which cancels anything in progress.
   */
  update(entityId: number, request: ChannelRequest | null, tick: number): ChannelOutcome {
    const active = this.channels.get(entityId);

    if (!request || request.durationTicks <= 0) {
      if (!active) return { kind: "idle" };
      this.channels.delete(entityId);
      return { kind: "cancelled", channel: active, reason: "interrupted" };
    }

    // Switching kind or target discards progress rather than carrying it over.
    if (active && (active.kind !== request.kind || active.targetId !== request.targetId)) {
      this.channels.delete(entityId);
      return { kind: "cancelled", channel: active, reason: "retargeted" };
    }

    if (!active) {
      // The starting tick COUNTS as holding, so a 5-tick channel completes on
      // the 5th update rather than the 6th. It also makes a 1-tick channel
      // complete immediately without needing a special case.
      const started: ChannelState = {
        kind: request.kind,
        targetId: request.targetId,
        durationTicks: request.durationTicks,
        elapsedTicks: 1,
        startedAtTick: tick,
      };
      if (started.elapsedTicks >= started.durationTicks) {
        return { kind: "completed", channel: started };
      }
      this.channels.set(entityId, started);
      return { kind: "started", channel: started };
    }

    // A duration change mid-channel (config reload, difficulty) takes effect
    // without discarding progress — the player has still done the holding.
    active.durationTicks = request.durationTicks;
    active.elapsedTicks++;

    if (active.elapsedTicks >= active.durationTicks) {
      this.channels.delete(entityId);
      return { kind: "completed", channel: active };
    }
    return { kind: "progress", channel: active };
  }

  /** Drop an entity's channel — on death, disconnect, or round end. */
  clear(entityId: number): void {
    this.channels.delete(entityId);
  }

  /** Drop every channel — round transitions, match reset. */
  clearAll(): void {
    this.channels.clear();
  }
}
