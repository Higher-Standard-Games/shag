# Gametype API - Design Document

**Date:** 2026-01-27  
**Status:** Brainstorming

---

## Overview

The Gametype API defines how game rules are implemented on the server. Each gametype (Deathmatch, CTF, Duel, etc.) implements this interface to control:

- Scoring and win conditions
- Player spawning rules
- Item availability
- Team management
- Match flow (warmup → playing → intermission)

---

## Core Interface

```typescript
interface Gametype {
  // === METADATA ===
  readonly name: string;           // "Deathmatch"
  readonly shortName: string;      // "dm"
  readonly description: string;
  readonly minPlayers: number;     // 2 for duel, 1 for dm
  readonly maxPlayers: number;     // 2 for duel, 16 for dm
  readonly maxTeams: number;       // 0 for FFA, 2 for team games
  
  // === LIFECYCLE HOOKS ===
  
  /**
   * Called when gametype is loaded
   * Initialize state, timers, etc.
   */
  init(context: GametypeContext): void;
  
  /**
   * Called when match starts (after warmup)
   */
  onMatchStart(): void;
  
  /**
   * Called when match ends
   */
  onMatchEnd(winner: Player | Team | null): void;
  
  /**
   * Called when server shuts down
   */
  shutdown(): void;
  
  // === FRAME HOOKS ===
  
  /**
   * Called every server tick (60Hz)
   * @param dt Delta time in seconds
   */
  tick(dt: number): void;
  
  /**
   * Called for game logic (can be lower frequency)
   * Check win conditions, timers, etc.
   */
  thinkRules(): void;
  
  // === PLAYER HOOKS ===
  
  /**
   * Player requesting to connect
   * Return false to reject (server full, banned, etc.)
   */
  onPlayerConnect(player: Player): boolean;
  
  /**
   * Player fully connected and ready
   */
  onPlayerReady(player: Player): void;
  
  /**
   * Player disconnected
   */
  onPlayerDisconnect(player: Player): void;
  
  /**
   * Player needs spawn point
   * Called on initial spawn and respawn
   */
  onPlayerSpawn(player: Player): SpawnConfig;
  
  /**
   * Player killed another player
   */
  onPlayerKill(attacker: Player, victim: Player, inflictor: DamageInfo): void;
  
  /**
   * Player died (any cause)
   */
  onPlayerDeath(player: Player, cause: DeathCause): void;
  
  /**
   * Player requests team change
   * Return false to deny
   */
  onPlayerTeamChange(player: Player, newTeam: Team): boolean;
  
  // === ITEM HOOKS ===
  
  /**
   * Item is attempting to spawn
   * Return false to prevent
   */
  onItemSpawn(item: Item): boolean;
  
  /**
   * Player touched an item
   * Return false to prevent pickup
   */
  onItemPickup(player: Player, item: Item): boolean;
  
  /**
   * Get respawn time for item type
   */
  getItemRespawnTime(item: Item): number;
  
  // === QUERY METHODS ===
  
  /**
   * Current match state
   */
  getMatchState(): MatchState;
  
  /**
   * Get scoreboard data for clients
   */
  getScoreboard(): ScoreboardData;
  
  /**
   * Which items can spawn in this gametype
   */
  getSpawnableItems(): ItemFlags;
}
```

---

## Supporting Types

```typescript
interface GametypeContext {
  server: GameServer;
  entityManager: EntityManager;
  broadcast: (event: GametypeEvent) => void;
  getPlayers: () => Player[];
  getSpawnPoints: () => SpawnPoint[];
  setNextMap: (map: string) => void;
}

type MatchState = 
  | 'warmup'      // Waiting for players, practice time
  | 'countdown'   // Match starting in 3...2...1
  | 'playing'     // Match in progress
  | 'overtime'    // Tie-breaker
  | 'intermission'; // Match ended, showing scoreboard

interface SpawnConfig {
  position: Vec3;
  rotation: number;
  loadout?: Loadout;  // Starting weapons/ammo
  invulnerableTime?: number;
}

interface DamageInfo {
  damage: number;
  weapon: WeaponType;
  isHeadshot: boolean;
  isSelfDamage: boolean;
}

type DeathCause = 
  | { type: 'killed'; attacker: Player; damage: DamageInfo }
  | { type: 'suicide'; weapon: WeaponType }
  | { type: 'world'; hazard: 'lava' | 'slime' | 'fall' | 'crush' }
  | { type: 'disconnect' };

interface ScoreboardData {
  matchTime: number;
  matchTimeLimit: number;
  scoreLimit: number;
  teams?: TeamScore[];
  players: PlayerScore[];
}

interface PlayerScore {
  id: string;
  name: string;
  team?: TeamId;
  score: number;
  kills: number;
  deaths: number;
  ping: number;
}
```

---

## Base Gametype Class

Common functionality shared by all gametypes:

```typescript
abstract class BaseGametype implements Gametype {
  protected context!: GametypeContext;
  protected matchState: MatchState = 'warmup';
  protected matchStartTime: number = 0;
  
  // === MATCH CONFIGURATION (gametype-controlled) ===
  // Server config can override these defaults
  
  protected timelimit: number = 10;       // Match duration in MINUTES (0 = no limit)
  protected scorelimit: number = 30;      // Generic score limit (frags, captures, etc.)
  protected warmupDuration: number = 30;  // Warmup time in seconds
  protected intermissionTime: number = 10; // Scoreboard display time in seconds
  
  // === RESPAWN CONFIGURATION ===
  protected playerRespawnTime: number = 3;    // Seconds before player respawns
  protected itemRespawnTimes: ItemRespawnConfig = {
    health_small: 15,
    health_medium: 25,
    health_large: 25,
    health_mega: 35,
    armor_shard: 15,
    armor_combat: 25,
    armor_body: 25,
    armor_red: 30,
    ammo: 15,
    weapon: 5,
    powerup: 120,  // Quad, haste, etc.
  };
  
  // Override for specific item respawn time
  getItemRespawnTime(item: Item): number {
    // Gametype can override per-item
    return this.itemRespawnTimes[item.type] ?? 15;
  }
  
  init(context: GametypeContext): void {
    this.context = context;
    this.matchState = 'warmup';
  }
  
  thinkRules(): void {
    switch (this.matchState) {
      case 'warmup':
        this.thinkWarmup();
        break;
      case 'countdown':
        this.thinkCountdown();
        break;
      case 'playing':
        this.thinkPlaying();
        break;
      case 'intermission':
        this.thinkIntermission();
        break;
    }
  }
  
  protected thinkWarmup(): void {
    // Check if enough players to start
    const players = this.context.getPlayers();
    if (players.length >= this.minPlayers) {
      this.startCountdown();
    }
  }
  
  protected startCountdown(): void {
    this.matchState = 'countdown';
    this.context.broadcast({ type: 'countdown_start', duration: 5 });
    // After 5 seconds, call onMatchStart()
  }
  
  protected thinkPlaying(): void {
    // Check time limit
    const elapsed = (Date.now() - this.matchStartTime) / 1000;
    if (this.timelimit > 0 && elapsed >= this.timelimit * 60) {
      this.endMatch();
    }
    
    // Check frag limit (subclass overrides)
    this.checkScoreLimit();
  }
  
  protected abstract checkScoreLimit(): void;
  protected abstract determineWinner(): Player | Team | null;
}
```

---

## Example: Deathmatch Gametype

```typescript
class DeathmatchGametype extends BaseGametype {
  readonly name = "Deathmatch";
  readonly shortName = "dm";
  readonly description = "Free-for-all, first to frag limit wins";
  readonly minPlayers = 2;
  readonly maxPlayers = 16;  // Server maxClients can be higher for spectators
  readonly maxTeams = 0; // FFA
  
  private scores: Map<string, number> = new Map();
  
  onMatchStart(): void {
    // Reset all scores
    this.scores.clear();
    for (const player of this.context.getPlayers()) {
      this.scores.set(player.id, 0);
    }
  }
  
  onPlayerKill(attacker: Player, victim: Player, inflictor: DamageInfo): void {
    if (attacker.id === victim.id) {
      // Suicide - lose a point
      const score = this.scores.get(attacker.id) ?? 0;
      this.scores.set(attacker.id, Math.max(0, score - 1));
    } else {
      // Kill - gain a point
      const score = this.scores.get(attacker.id) ?? 0;
      this.scores.set(attacker.id, score + 1);
    }
    
    // Broadcast kill message
    this.context.broadcast({
      type: 'kill',
      attacker: attacker.id,
      victim: victim.id,
      weapon: inflictor.weapon,
      headshot: inflictor.isHeadshot
    });
  }
  
  onPlayerSpawn(player: Player): SpawnConfig {
    // Find spawn furthest from other players
    const spawns = this.context.getSpawnPoints();
    const players = this.context.getPlayers().filter(p => p.id !== player.id);
    
    let bestSpawn = spawns[0];
    let bestDistance = 0;
    
    for (const spawn of spawns) {
      const minDist = Math.min(...players.map(p => 
        distance(spawn.position, p.position)
      ));
      if (minDist > bestDistance) {
        bestDistance = minDist;
        bestSpawn = spawn;
      }
    }
    
    return {
      position: bestSpawn.position,
      rotation: bestSpawn.angle,
      invulnerableTime: 2.0  // 2 seconds spawn protection
    };
  }
  
  protected checkScoreLimit(): void {
    if (this.fraglimit <= 0) return;
    
    for (const [playerId, score] of this.scores) {
      if (score >= this.fraglimit) {
        const winner = this.context.getPlayers().find(p => p.id === playerId);
        this.endMatch(winner);
        return;
      }
    }
  }
  
  protected determineWinner(): Player | null {
    let topScore = -1;
    let winner: Player | null = null;
    
    for (const [playerId, score] of this.scores) {
      if (score > topScore) {
        topScore = score;
        winner = this.context.getPlayers().find(p => p.id === playerId) ?? null;
      }
    }
    
    return winner;
  }
  
  getScoreboard(): ScoreboardData {
    const players = this.context.getPlayers().map(p => ({
      id: p.id,
      name: p.name,
      score: this.scores.get(p.id) ?? 0,
      kills: p.stats.kills,
      deaths: p.stats.deaths,
      ping: p.ping
    }));
    
    // Sort by score descending
    players.sort((a, b) => b.score - a.score);
    
    return {
      matchTime: (Date.now() - this.matchStartTime) / 1000,
      matchTimeLimit: this.timelimit * 60,
      scoreLimit: this.fraglimit,
      players
    };
  }
}
```

---

## Gametype Registry

```typescript
class GametypeRegistry {
  private static gametypes: Map<string, new () => Gametype> = new Map();
  
  static register(shortName: string, gametype: new () => Gametype): void {
    this.gametypes.set(shortName, gametype);
  }
  
  static create(shortName: string): Gametype | null {
    const GametypeClass = this.gametypes.get(shortName);
    if (!GametypeClass) return null;
    return new GametypeClass();
  }
  
  static list(): string[] {
    return Array.from(this.gametypes.keys());
  }
}

// Registration
GametypeRegistry.register('dm', DeathmatchGametype);
GametypeRegistry.register('tdm', TeamDeathmatchGametype);
GametypeRegistry.register('ctf', CTFGametype);
GametypeRegistry.register('duel', DuelGametype);
```

---

## Events Broadcast to Clients

```typescript
type GametypeEvent =
  | { type: 'match_state'; state: MatchState }
  | { type: 'countdown_start'; duration: number }
  | { type: 'countdown_tick'; seconds: number }
  | { type: 'match_start' }
  | { type: 'match_end'; winner: string | null; scoreboard: ScoreboardData }
  | { type: 'kill'; attacker: string; victim: string; weapon: string; headshot: boolean }
  | { type: 'score_update'; playerId: string; score: number }
  | { type: 'team_score_update'; team: TeamId; score: number }
  | { type: 'player_spawn'; playerId: string }
  | { type: 'item_pickup'; playerId: string; item: string }
  | { type: 'flag_taken'; team: TeamId; playerId: string }
  | { type: 'flag_captured'; team: TeamId; playerId: string }
  | { type: 'flag_returned'; team: TeamId };
```

---

## Future: Scripted Gametypes

For modding support, allow loading gametypes from scripts:

```
/gametypes/
  dm.js       # Bundled TypeScript → JS
  instagib.js # Custom gametype
  race.js     # Time trial racing
```

Could use a subset of the Gametype interface callable from JS runtime.

---

## Summary

| Component | Description |
|-----------|-------------|
| `Gametype` interface | All hooks for game rules |
| `BaseGametype` | Common warmup/countdown/intermission logic |
| `GametypeRegistry` | Factory for loading gametypes |
| Built-in types | DM, TDM, CTF, Duel |
| Events | Broadcast to clients for UI/effects |
