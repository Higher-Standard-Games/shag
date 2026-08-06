/**
 * AgentDirective — a gametype's orders to one agent, as DATA.
 *
 * The contract that lets gametype code steer bots without either side importing
 * the other (docs/research/BOT_WEIGHTS_AND_GOALS.md §1, BOT_IMPROVEMENT §4.2).
 * Bots run in a separate OS process and connect as ordinary network clients, so
 * "go plant at site A" has to be a fact on the wire, not a function call.
 *
 * Being plain data also means a directive can be recorded into a demo, asserted
 * in a fixture, and safely ignored by a human client — none of which a callback
 * could offer.
 *
 * A directive describes INTENT. It never dictates inputs: the bot still decides
 * whether the objective is worth more than staying alive, still has to find a
 * route, and is still subject to fire safety. A gametype cannot make a bot shoot
 * a teammate or walk off a ledge.
 */

export type AgentDirectiveKind =
  /** Get to a place. */
  | "move_to"
  /** Stay in and around a place. */
  | "hold_area"
  /** Stay near a place and deny it to enemies. */
  | "defend"
  /** Stay near a specific player (flag/bomb carrier). */
  | "escort"
  /**
   * Seek out and kill a specific player.
   *
   * Distinct from ordinary target selection, which the bot does on its own from
   * what it can see: this says a named enemy is worth going to FIND. Objective
   * modes need it because killing the carrier is itself an objective — in S&D
   * it drops the bomb, in CTF it drops the flag.
   */
  | "hunt";

export type AgentDirectiveTarget =
  | { type: "position"; position: { x: number; y: number; z: number }; radius: number }
  /** Client entity id (the `toClientKey` form the snapshot uses). */
  | { type: "player"; entityId: string };

/**
 * When a directive may be dropped for something else.
 * `never` still yields to hard invariants (death, fire safety) — it means "do
 * not abandon this for an ordinary opportunity", not "ignore self-preservation".
 */
export type AgentDirectiveInterrupt = "never" | "danger" | "enemy_visible" | "higher_priority";

export interface AgentDirective {
  /**
   * Stable per objective, NOT per issue.
   *
   * Goal hysteresis and failure cooldowns key on this, so an id that changes
   * every snapshot would leave a bot re-committing forever while appearing
   * committed. Use the objective's identity ("snd_plant_a"), never a counter.
   */
  id: string;
  kind: AgentDirectiveKind;
  target: AgentDirectiveTarget;
  /** Gametype's own weighting, 0..1. Scaled further by the bot's weight profile. */
  priority: number;
  /** Server tick after which the bot must discard this. */
  expiresAtTick: number;
  interrupt: AgentDirectiveInterrupt;
  /**
   * Time pressure, 0..1. Distinct from `priority`: planting is always important
   * (high priority), but only urgent once the round clock is short.
   */
  urgency?: number;
}

/**
 * Per-player context handed to the gametype when it is asked for directives.
 *
 * Unlike `AgentDirective` this is NOT serialized — it is a server-side call
 * argument — so it may carry resolvers.
 */
export interface AgentDirectiveContext {
  tick: number;
  playerId: number;
  /** Client entity id, matching what the snapshot uses. */
  entityId: string;
  teamId: string;
  position: { x: number; y: number; z: number };
  alive: boolean;
  /**
   * Team of any player, from the match's authoritative assignment.
   *
   * Needed because team membership lives in MatchState, not on the entity — a
   * team-based mode reasoning about "my teammates" cannot get there from
   * `WorldState` alone. Returns "" for unknown players.
   */
  teamOf(playerId: number): string;
}

/** Snapshot event payload. Only sent to the addressed client. */
export interface AgentDirectivesPayload {
  /** Client entity id of the addressed player. */
  entityId: string;
  directives: AgentDirective[];
}

/** True while `directive` is still valid at `tick`. */
export function isDirectiveActive(directive: AgentDirective, tick: number): boolean {
  return tick < directive.expiresAtTick;
}
