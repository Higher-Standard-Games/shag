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
  /**
   * A round has been decided; the match has not.
   *
   * Its own phase rather than a flag on `Active` because everything about it
   * differs: nobody may move or shoot, nothing scores, the camera leaves the
   * player to watch the bomb, and the result banner is up. Round modes only.
   */
  RoundEnd = 4,
}

/**
 * What a player has actually done, accumulated over a match.
 *
 * Kept separately from `score` because some modes DERIVE score from these
 * rather than counting frags — Warsow Bomb scores mostly on damage dealt, so
 * the player who softened three enemies is credited even though a teammate
 * finished them. A derived score is also a pure function of these numbers,
 * which means it cannot drift the way an incremented counter can.
 */
export interface PlayerStats {
  frags: number;
  /** Teammates killed. Counted separately so it can be penalised, not just netted. */
  teamFrags: number;
  deaths: number;
  /** Damage dealt to enemies, before their armor. */
  damageGiven: number;
  /** Damage dealt to teammates. */
  teamDamageGiven: number;
  /** Bombs armed (or flags taken, in a future mode). */
  plants: number;
  /** Bombs defused. */
  defuses: number;
}

/** A fresh stat line. */
export function emptyPlayerStats(): PlayerStats {
  return { frags: 0, teamFrags: 0, deaths: 0, damageGiven: 0, teamDamageGiven: 0, plants: 0, defuses: 0 };
}

/** How a round was won, for the banner. Server-authored, client-displayed. */
export interface RoundResult {
  /** Winning team id, or null for a draw. */
  winner: string | null;
  /** Display name of the winning team. */
  winnerName: string;
  /**
   * Why, as a stable key rather than prose: the client owns the wording, and a
   * key survives translation and rephrasing where a sentence does not.
   */
  reason: "detonated" | "defused" | "eliminated" | "timeout";
  /** Round this decided. */
  round: number;
  /** Where to point the camera — the bomb, for a detonation worth watching. */
  focus?: { x: number; y: number; z: number };
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
   * Seconds after spawning during which teammates cannot hurt you.
   *
   * Friendly fire is on in S&D, and with team spawns and no respawns a
   * mis-timed rocket at the start of a round can end a teammate's whole round
   * before they have moved. Enemy damage is never blocked — the protection is
   * against your own side, not against the game.
   */
  teamSpawnProtection?: number;
  /**
   * Seconds between a round being decided and the next freeze starting.
   *
   * Long enough to watch a detonation finish and read who won. Round-based
   * only; defaults to 5.
   */
  roundEndDuration?: number;
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
 * The detonation, as a schedule the client plays out.
 *
 * Sent once, in full, rather than one blast per tick: the whole sequence is
 * known the moment the bomb goes off, and a client that has it can render the
 * chain reaction without thirty more packets arriving during the one moment
 * the frame budget is under pressure.
 */
export interface BombExplosionEvent {
  /** Blasts, each with its own delay in seconds from the detonation. */
  points: Array<{ x: number; y: number; z: number; radius: number; delay: number }>;
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
  /** Set only during RoundEnd — how the round that just ended was won. */
  roundResult?: RoundResult;
  /**
   * Sent for a few snapshots after a detonation. Repeated deliberately: it is
   * fire-and-forget, and the alternative to repeating is a client that misses
   * the whole explosion because one packet dropped.
   */
  explosion?: BombExplosionEvent;
}
