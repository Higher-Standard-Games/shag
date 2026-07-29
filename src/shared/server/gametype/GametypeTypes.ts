/**
 * Gametype Types — Shared between server and client
 *
 * These types define the contract for gametype configuration,
 * match lifecycle, weapon loadouts, and item spawn rules.
 * Game logic stays server-only; these are just data shapes.
 */

// ============================================================================
// Match Lifecycle
// ============================================================================

/**
 * Match phases following Quake/Warsow convention:
 * Warmup → Countdown → Active → PostGame → restart
 */
export enum MatchPhase {
  /** Players joining, free-fight, no scoring. Press F4 to ready. */
  Warmup = 0,
  /** 3-2-1 countdown before match starts */
  Countdown = 1,
  /** Match is live — scoring, pickups, win conditions active */
  Active = 2,
  /** Match ended — scoreboard display, then restart/rotate */
  PostGame = 3,
}

export type TeamId = "udon" | "soba" | "spectator";

/**
 * Match configuration — gametype defines these values
 */
export interface MatchConfig {
  /** Warmup timeout in seconds (0 = wait forever for ready) */
  warmupTimeout: number;
  /** Countdown duration in seconds (3-2-1) */
  countdownDuration: number;
  /** Score limit to win (0 = no limit) */
  scoreLimit: number;
  /** Time limit in seconds (0 = no limit) */
  timeLimit: number;
  /** Post-game scoreboard display duration in seconds */
  postGameDuration: number;
  /** Minimum respawn delay in seconds (player CAN respawn after this) */
  respawnDelay: number;
  /** Maximum respawn delay in seconds (auto-respawn deadline). Default: respawnDelay * 2 */
  maxRespawnDelay?: number;
  /** Self-damage multiplier (1.0 = full, 0.0 = none). Default: 1.0 (Warsow DM-style) */
  selfDamage: number;
  /** If true, a tie at the time limit extends the match instead of ending it
   *  (duel: there is no draw — sudden extra minute until someone leads). */
  overtimeOnDraw?: boolean;
  /** Overtime extension in seconds (default 60). */
  overtimeDuration?: number;

  // ── Round-based modes (Search & Destroy) ──────────────────────────────
  /**
   * Play in rounds: `Active` returns to `Countdown` when a round ends instead
   * of ending the match, and players do not respawn until the next round.
   *
   * A round IS the existing phase cycle — `Countdown` is the round freeze and
   * `Active` is the live round — so `timeLimit` becomes ROUND length and
   * `scoreLimit` becomes rounds-to-win. Everything else keeps today's meaning.
   * See docs/research/Search_And_Destroy.md §5.1.
   */
  roundBased?: boolean;
  /**
   * Rounds one side attacks before the sides swap. Round-based only.
   *
   * Deliberately a whole half rather than alternating: attacking is the
   * stronger side, so alternating every round would mostly measure who drew the odd
   * rounds. Set below `scoreLimit` so the limit cannot be reached before the
   * swap — no team should be able to win without playing both sides.
   */
  roundsPerHalf?: number;
  /**
   * Score lead required to win, on top of reaching `scoreLimit` (tennis rule).
   * 1 = no requirement (default). Warsow Bomb uses 2, so 10-9 does not win.
   */
  leadRequired?: number;
}

// ============================================================================
// Weapon Loadout
// ============================================================================

/**
 * Weapon loadout given to a player on spawn.
 * Gametype defines what weapons and ammo players start with.
 */
export interface WeaponLoadout {
  /** Weapon IDs the player receives (first = default) */
  weapons: string[];
  /** Ammo amounts per weapon ID */
  ammo: Record<string, number>;
  /** Starting health */
  health: number;
  /** Starting armor */
  armor: number;
}

// ============================================================================
// Item Spawn Rules
// ============================================================================

/**
 * Controls how items (weapons, ammo, health, armor) spawn on the map.
 * Gametype defines these rules — different modes have very different behavior:
 * - Deathmatch: spawn everything from BSP, 30s weapon respawn
 * - Clan Arena: no pickups, all weapons given on spawn
 * - Instagib: no pickups, instagun only
 */
/**
 * When a consumed item comes back.
 *
 * - `timed` — after its own respawn timer. Continuous modes; the item clock is
 *   the skill.
 * - `round` — not until the next round. There is one Red Armor per round and
 *   whoever takes it has it; timing it is meaningless when the round is shorter
 *   than the timer anyway.
 * - `alternating` — not until the round AFTER next. An item taken in round 1 is
 *   absent in round 2 and back in round 3, so taking it is also a denial play
 *   that reaches into the next round. Experimental: it makes rounds
 *   alternately rich and poor, and it breaks the mirror-halves property the
 *   side swap relies on, since the second half inherits the first half's
 *   depleted map.
 */
export type ItemRespawnMode = "timed" | "round" | "alternating";

export interface ItemSpawnRules {
  /** Whether to parse and spawn items from BSP entities */
  spawnFromBsp: boolean;
  /** When consumed items return. Defaults to `timed`. */
  respawnMode?: ItemRespawnMode;
  /**
   * Pickup classnames this mode does not spawn at all.
   *
   * A denial at pickup time would still leave the item glowing on the map for
   * players to walk to; not spawning it is the honest version.
   */
  excludeClassnames?: readonly string[];
  /** Weapon respawn time in seconds */
  weaponRespawnTime: number;
  /** Ammo respawn time in seconds */
  ammoRespawnTime: number;
  /** Armor respawn time in seconds */
  armorRespawnTime: number;
  /** Health respawn time in seconds */
  healthRespawnTime: number;
  /** Mega health respawn time in seconds */
  megaHealthRespawnTime: number;
}

// ============================================================================
// Spawn Strategy
// ============================================================================

/**
 * Spawn point selection strategy, chosen by gametype:
 * - random: pick any valid spawn point
 * - furthest: Warsow-style, pick from 2 furthest from enemies
 * - team: pick from team-specific spawn points
 */
export type SpawnStrategyType = "random" | "furthest" | "team";

// ============================================================================
// Match State Snapshot (sent to client)
// ============================================================================

/**
 * Authoritative match result, computed by the server when the match enters
 * PostGame. `kind` disambiguates: a team win (TDM), a player win (FFA/duel),
 * or a draw (tied at the limit). Cleared when the next warmup begins.
 */
export interface MatchWinner {
  kind: "player" | "team" | "draw";
  /** PlayerId (as string) or TeamId, absent for a draw. */
  id?: string;
  /** Display name for the banner ("Wraith", "Team Udon"). */
  name?: string;
}

/**
 * The bomb, as the client needs to draw it.
 *
 * Positions are world space so the HUD can point at them and the world can put
 * a model there. No rules travel — the client is told what is true, never how
 * it was decided.
 */
export interface BombObjectiveSnapshot {
  kind: "bomb";
  /** See `BombPhase`. Sent as a string so the client needs no enum. */
  phase: string;
  x: number;
  y: number;
  z: number;
  /** Site the bomb is planted at, or null. */
  siteId: number | null;
  /** Client entity key of the carrier, or null when nobody holds it. */
  carrier: string | null;
  /** Arm/defuse progress, 0..1. */
  progress: number;
  /** True while progress is rising — the HUD draws a falling bar differently. */
  advancing: boolean;
  /** Seconds to detonation, or null when not armed. */
  fuse: number | null;
  /** Seconds between beeps at the current fuse length, or null. */
  beepInterval: number | null;
  /**
   * The sites, for site markers. Static per map, and re-sent every snapshot
   * because `match_state` is the variable-shape JSON channel — two entries, so
   * cheaper than a separate delivery path would be to maintain.
   */
  sites: Array<{ id: number; label: string; x: number; y: number; z: number }>;
}

/**
 * Whatever a mode's objective currently is. A union so CTF can join later
 * without another optional field on the snapshot.
 */
export type ObjectiveSnapshot = BombObjectiveSnapshot;

/**
 * Lightweight match state sent to clients for HUD display.
 * Keeps game rules server-side; client only knows what to display.
 */
export interface MatchStateSnapshot {
  phase: MatchPhase;
  timeRemaining: number;
  readyCount: number;
  totalPlayers: number;
  gametypeName: string;
  scoreLimit: number;
  teamScores?: Record<TeamId, number>;
  playerTeams?: Record<string, TeamId>;
  teamNames?: Record<TeamId, string>;
  /** Spectator roster (no sim entity) — for the scoreboard. Populated by
   *  SnapshotBuilder; client-consumed. */
  spectators?: Array<{ playerId: string; name: string; ping: number }>;
  /** Set only during PostGame — who won the match that just ended. */
  winner?: MatchWinner;
  /** Number of overtime extensions this match (0 = regulation). */
  overtime?: number;
  /** Match flow mode: "single" = per-match server, post-game is terminal
   *  (players return to the lobby); "continuous" = classic warmup loop. */
  flow?: "single" | "continuous";
  /** Current round, 1-based. Round-based gametypes only. */
  round?: number;
  /** Per-team round role ("attacker"/"defender"). Round-based gametypes only. */
  teamRoles?: Record<string, string>;
  /** Round lifecycle for objective modes ("pre_plant"/"post_plant"). */
  roundState?: string;
  /** The mode's objective, for modes that have one. */
  objective?: ObjectiveSnapshot;
}
