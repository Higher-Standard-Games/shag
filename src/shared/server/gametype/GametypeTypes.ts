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
    /** Respawn delay in seconds after death */
    respawnDelay: number;
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
export interface ItemSpawnRules {
    /** Whether to parse and spawn items from BSP entities */
    spawnFromBsp: boolean;
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
export type SpawnStrategyType = 'random' | 'furthest' | 'team';

// ============================================================================
// Match State Snapshot (sent to client)
// ============================================================================

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
}
