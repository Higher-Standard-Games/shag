# Networked Gametype Scripts — Architecture Research

> **Status:** Research / Brainstorm  
> **Date:** 2026-02-15  
> **Goal:** Define how gametype scripts drive item spawning, match lifecycle, weapon loadouts, and client sync.

---

## 1. Current State Audit

### 1.1 Server Tick Flow (What Actually Runs)

```
NextGenServer.tick()     ← headless-netserver-v2.ts (CLI file, 800+ lines)
└── simulation.tick()
    ├── FPSMovementSubsystem (priority 10)  — physics/collision
    ├── ProjectileSystem     (priority 20)  — projectile flight
    ├── WeaponSystem         (priority 25)  — fire/reload
    └── CombatSystem         (priority 30)  — damage/kills/respawn
```

**What does NOT run:** `FPSServerGame`, `Deathmatch`, `BaseGametype` — completely disconnected.  
**`toGameState()`** converts only player entities (hardcoded `player_N` IDs) — no items, no match state.  
**`GameState.events`** already supports `damage`/`death`/`chat` events with JSON fallback — extensible for new events.

### 1.2 Identified Duplications

| Responsibility | Location A (active) | Location B (dead code) | Resolution |
| --- | --- | --- | --- |
| Spawn point selection | `NextGenServer.getSpawnPoint()` — random | `Deathmatch.chooseSpawnPoint()` — TODO stub | → Move to `SpawnPointStrategy` |
| Player creation | `handleDatagram` inline in CLI file | — | → Move to `GametypeController.onPlayerJoin()` |
| Weapon loadout on spawn | `WeaponSystem.initializeWeapon()` — hardcoded ammo map | `Deathmatch.onSpawn()` — TODO stub | → Loadout from gametype |
| Respawn after death | `CombatSystem.respawnPlayer()` — random pos, full HP | `Deathmatch.onDeath()` — score only | → `CombatSystem` emits events, gametype handles respawn |
| Score tracking | Not tracked anywhere | `Deathmatch.onDeath()` — increments score | → Wire gametype into kill events |
| Win condition | Never checked | `Deathmatch.checkWinCondition()` — checks scoreLimit | → Wire into post-tick check |

### 1.3 Protocol Messages (Current)

| Type | Direction | Purpose |
| --- | --- | --- |
| `Welcome` | S→C | Map name, server info |
| `JoinAccept` | S→C | Player/entity IDs |
| `Input` | C→S | Movement + buttons |
| `Snapshot` | S→C | World state (entities, players, events) |
| `Ack` | C→S | Tick acknowledgment |
| `Join` | C→S | Player name |

**Existing extensibility:** `GameState.events[]` can carry custom event types via JSON serialization.

---

## 2. Architecture Decisions

### 2.1 Server Entry Point — Extract `GameServer` from CLI

**Decision:** Extract game logic from `headless-netserver-v2.ts` into a proper `GameServer` class.

| Approach | Pros | Cons |
| --- | --- | --- |
| Keep in CLI file | No refactor needed | 800+ lines mixing transport/game/CLI; untestable |
| Extract `GameServer` class | Clean separation; testable; reusable | One-time refactor |

```
BEFORE:
  headless-netserver-v2.ts (800 lines) = CLI + Transport + Game Logic all mixed

AFTER:
  headless-netserver-v2.ts (thin CLI)
  └── GameServer (engine/server/ or games/fps/server/)
      ├── simulation (Subsystems)
      ├── gametypeController
      ├── transport
      └── toGameState() conversion
```

### 2.2 Item Entities — Event-Based (Not Full Snapshot Entities)

**Decision:** Items use a lightweight event-based approach, NOT full ECS entities in snapshots.

**Rationale:** Items are mostly static (fixed position, only state = active/respawning). Sending them in every 125Hz snapshot wastes bandwidth. Instead:

- Server maintains `ItemSubsystem` with item states
- On join: send `configstring` style entity list (one-time, reliable)
- During play: send pickup/respawn as events via `GameState.events[]`
- Client creates `Pickup` objects from config data, shows/hides based on events

This matches how Quake 3 and Warsow handle items — configstrings define what exists, events toggle visibility.

### 2.3 Warmup Behavior — Simple, No Special Loadout

**Decision:** Warmup = normal gameplay rules, just no scoring.

- Pickups work normally (spawn from BSP, respawn after pickup)
- Player gets normal gametype loadout on spawn
- No scoring during warmup
- When match starts: all items reset, all scores reset, all players respawn
- Client shows "Press F4 to ready up" + ready count

### 2.4 Gametype Code Location — Server-Only + Shared Config Types

**Decision:** Gametype logic stays server-only. Client receives a lightweight config via protocol.

| What | Where | Why |
| --- | --- | --- |
| Gametype logic | `games/fps/server/gametypes/` | Server-authoritative, can't be hacked |
| `MatchConfig` type | `shared/` or via protocol | Client needs: phase, timer, ready state |
| `WeaponLoadout` type | `shared/` | Both sides need to understand loadout format |
| `ItemSpawnRules` | `server/` only | Client doesn't decide what spawns |
| Entity definitions | `shared/entities/` (already there) | Client needs model paths for rendering |

**Security:** Client never decides game rules. It only receives:

1. Match phase (warmup/countdown/active/postgame) + timer — to display HUD
2. Entity list with classnames + positions — to render pickups
3. Pickup/respawn events — to toggle visibility

All game rule decisions (can I pick this up? how much ammo? respawn time?) stay server-side in the gametype script.

---

## 3. Gametype as Orchestrator

### 3.1 Why Not a Subsystem

Subsystems run at 125Hz and process physics/combat deterministically. The gametype is an **event-driven orchestrator** that reacts to lifecycle events. It runs **after** the simulation tick, not inside it.

```
Server tick:
1. simulation.tick()                    ← 125Hz subsystems (physics, combat, weapons)
2. gametypeController.postTick(state)   ← process events from subsystems
   ├── for each kill: gametype.onDeath(victim, killer)
   ├── for each pickup: gametype.onPickup(player, item)
   ├── matchState.update(dt)            ← warmup timer, countdown
   └── gametype.checkWinCondition()
3. broadcastSnapshot()                  ← send state + events to clients
```

### 3.2 GametypeController Class

```typescript
class GametypeController {
    private gametype: BaseGametype;
    private matchState: MatchState;
    private spawnStrategy: SpawnPointStrategy;
    private itemManager: ItemManager;

    // Called after simulation.tick()
    postTick(state: WorldState, dt: number): void {
        // Process kill events from CombatSystem
        for (const kill of this.combatSystem.drainKills()) {
            this.gametype.onDeath(kill.victim, kill.killer, state);
            this.queueRespawn(kill.victim, this.gametype.getRespawnDelay());
        }

        // Process pickup collisions from ItemManager
        for (const pickup of this.itemManager.drainPickups()) {
            if (this.gametype.onPickup(pickup.player, pickup.item, state)) {
                this.giveItem(pickup.player, pickup.item);
            }
        }

        // Update match state
        this.matchState.update(dt);
        if (this.matchState.phase === MatchPhase.Active) {
            const result = this.gametype.checkWinCondition(state);
            if (result) this.matchState.transition(MatchPhase.PostGame);
        }

        // Process respawn queue
        this.processRespawnQueue(state);
    }

    // Player join flow
    onPlayerJoin(client: ClientInfo): Entity {
        const spawn = this.spawnStrategy.choose(state);
        const entity = createPlayerEntity(id, pid, spawn);
        const loadout = this.gametype.getSpawnLoadout();
        this.weaponSystem.initializeWeapon(entity.id, loadout);
        return entity;
    }
}
```

### 3.3 BaseGametype Interface (Refined)

```typescript
abstract class BaseGametype {
    abstract readonly name: string;
    abstract readonly teamBased: boolean;

    // === Match Config ===
    abstract getMatchConfig(): MatchConfig;

    // === Spawn Rules ===
    abstract getSpawnLoadout(): WeaponLoadout;
    abstract getSpawnStrategy(): SpawnStrategyType; // 'random' | 'furthest' | 'team'

    // === Item Rules ===
    abstract getItemSpawnRules(): ItemSpawnRules;

    // === Events ===
    abstract onSpawn(player: Entity, state: WorldState): void;
    abstract onDeath(victim: Entity, killer: Entity | null, state: WorldState): void;
    abstract onPickup(player: Entity, item: ItemState, state: WorldState): boolean;
    abstract checkWinCondition(state: WorldState): GameResult | null;
    abstract chooseSpawnPoint(player: Entity, points: Vec3[], state: WorldState): Vec3;

    // === Match Lifecycle ===
    abstract onMatchPhaseChange(phase: MatchPhase, state: WorldState): void;

    // === Scoring ===
    abstract getScore(playerId: PlayerId): number;
}
```

### 3.4 Gametype Controls Item Respawn Times

The gametype defines how items (weapons, ammo, health, armor) behave:

```typescript
interface ItemSpawnRules {
    spawnFromBsp: boolean;              // Parse BSP entities?
    weaponRespawnTime: number;          // seconds (e.g. 30 for DM)
    ammoRespawnTime: number;            // seconds (e.g. 15)
    armorRespawnTime: number;           // seconds (e.g. 25)
    healthRespawnTime: number;          // seconds (e.g. 20)
    megaHealthRespawnTime: number;      // seconds (e.g. 60)
}

// Deathmatch: spawn everything from BSP
class Deathmatch {
    getItemSpawnRules() {
        return { spawnFromBsp: true, weaponRespawnTime: 30, ... };
    }
    getSpawnLoadout() {
        return { weapons: ['gunblade'], ammo: { gunblade: 1 } };
    }
    getSpawnStrategy() { return 'furthest'; }  // Warsow-style
}

// Clan Arena: no pickups, all weapons on spawn
class ClanArena {
    getItemSpawnRules() {
        return { spawnFromBsp: false };        // NO items on map
    }
    getSpawnLoadout() {
        return { weapons: ['gunblade','machinegun','riotgun',...], ammo: { ... } };
    }
}

// Instagib: no pickups, instagun only
class Instagib {
    getItemSpawnRules() { return { spawnFromBsp: false }; }
    getSpawnLoadout() {
        return { weapons: ['instagun'], ammo: { instagun: Infinity } };
    }
}
```

---

## 4. Spawn Point Strategy

### 4.1 Strategy Pattern

Different gametypes need different spawn selection algorithms. The gametype selects which strategy to use.

```typescript
type SpawnStrategyType = 'random' | 'furthest' | 'team';

// Random: pick any spawn point
class RandomSpawnStrategy {
    choose(points, state): Vec3 {
        return points[Math.floor(Math.random() * points.length)];
    }
}

// Furthest (Warsow DM/Duel): pick 2 spawns furthest from all enemies, randomize between them
class FurthestSpawnStrategy {
    choose(points, state): Vec3 {
        const enemies = getEnemyPositions(state);
        if (enemies.length === 0) return randomChoice(points);

        // Score each spawn by minimum distance to nearest enemy
        const scored = points.map(p => ({
            point: p,
            minDist: Math.min(...enemies.map(e => distance(p, e)))
        }));
        scored.sort((a, b) => b.minDist - a.minDist);  // furthest first

        // Pick from top 2
        const candidates = scored.slice(0, 2);
        return randomChoice(candidates).point;
    }
}

// Team: pick from team-specific spawn points (team1/team2 classnames)
class TeamSpawnStrategy {
    choose(points, state, player): Vec3 {
        const teamPoints = points.filter(p => p.team === player.team);
        return randomChoice(teamPoints.length > 0 ? teamPoints : points);
    }
}
```

---

## 5. Match State Machine

```
  WARMUP ──→ COUNTDOWN ──→ ACTIVE ──→ POSTGAME ──→ (restart)
    │                                      │
    │ F4 ready / timeout(120s)             │ win condition met
    │ free fight, no scoring               │ scoreboard for 10s
    │ normal pickups                       │
```

### 5.1 Server Side

```typescript
enum MatchPhase {
    Warmup    = 0,
    Countdown = 1,
    Active    = 2,
    PostGame  = 3,
}

class MatchState {
    phase: MatchPhase = MatchPhase.Warmup;
    timeRemaining: number;       // seconds
    readyPlayers: Set<PlayerId> = new Set();
    totalPlayers: number = 0;
    scores: Map<PlayerId, number> = new Map();

    update(dt: number): void {
        switch (this.phase) {
            case MatchPhase.Warmup:
                this.timeRemaining -= dt;
                if (this.allReady() || this.timeRemaining <= 0) {
                    this.transition(MatchPhase.Countdown);
                }
                break;
            case MatchPhase.Countdown:
                this.timeRemaining -= dt;
                if (this.timeRemaining <= 0) this.transition(MatchPhase.Active);
                break;
            case MatchPhase.Active:
                this.timeRemaining -= dt;
                // Win condition checked externally by gametype
                break;
            case MatchPhase.PostGame:
                this.timeRemaining -= dt;
                if (this.timeRemaining <= 0) this.restart();
                break;
        }
    }

    playerReady(playerId: PlayerId): void {
        this.readyPlayers.add(playerId);
    }

    allReady(): boolean {
        return this.totalPlayers >= 2 && this.readyPlayers.size >= this.totalPlayers;
    }
}
```

### 5.2 Client Side

Client receives match state via `GameState.events[]` and displays:

| Phase | Client Display |
| --- | --- |
| Warmup | Center: "Waiting for players — Press F4 to ready up" + "3/8 ready" |
| Countdown | Center: "3... 2... 1... FIGHT!" |
| Active | Normal HUD (timer, score, ammo) |
| PostGame | Scoreboard overlay for 10s |

---

## 6. Client-Server Entity Sync

### 6.1 Flow

```
Server startup:
  1. Parse BSP → extract item entities (weapon_*, ammo_*, item_*)
  2. gametype.getItemSpawnRules() → filter & configure respawn times
  3. ItemManager stores: { id, classname, position, active, respawnTimer }

Player connects:
  4. Server sends MatchState event (phase, timer, ready count)
  5. Server sends ItemList event (array of {id, classname, position})
  6. Client looks up each classname in EntityRegistry → gets model/glow
  7. Client creates Pickup objects from ItemList
  8. AssetPreloader handles model/texture loading

During gameplay:
  9. Player touches item → ItemManager detects collision (server)
 10. gametype.onPickup(player, item) → returns true/false
 11. If accepted: give weapon/ammo/health to player
 12. Emit GameEvent { type: 'item_pickup', entityId, playerId }
 13. Client receives event → Pickup.hide()
 14. After respawnTime: emit { type: 'item_respawn', entityId }
 15. Client receives event → Pickup.show()
```

### 6.2 New Event Types (via GameState.events)

No new `MessageType` constants needed — we extend `GameState.events[]`:

| Event type | Payload | When |
| --- | --- | --- |
| `match_state` | phase, timeRemaining, readyCount, totalPlayers | Phase changes, tick updates |
| `item_list` | array of {id, classname, x, y, z} | Player joins |
| `item_pickup` | entityId, playerId | Item collected |
| `item_respawn` | entityId | Item respawned |
| `score_update` | playerId, score | Kill / point scored |
| `print` | text, position (center/chat/console) | Server messages |

### 6.3 New Client→Server Messages

| Message | Payload | When |
| --- | --- | --- |
| `Ready` | — | Player presses F4 |
| `WeaponSwitch` | slot number | Player switches weapon |

These need new `MessageType` constants since they're client→server (not events in snapshot).

---

## 7. Implementation Phases

### Phase 1: Core Architecture Refactor

- [ ] Extract `GameServer` class from `headless-netserver-v2.ts`
- [ ] Create `GametypeController` with `postTick()` hook
- [ ] Create `MatchState` state machine
- [ ] Wire `CombatSystem` → emit kill events (not auto-respawn)
- [ ] Move weapon loadout from hardcoded → gametype-driven
- [ ] Create `SpawnPointStrategy` (random + furthest)

### Phase 2: Match Lifecycle + Client Integration

- [ ] Add `match_state` event → client HUD
- [ ] Add `Ready` message type (C→S)
- [ ] Client: display warmup/countdown/active/postgame
- [ ] Warmup timer + all-ready detection
- [ ] Countdown → match start → score reset + respawn all

### Phase 3: Item Spawning

- [ ] Server: parse BSP entities for `weapon_*`, `ammo_*`, `item_*`
- [ ] Create `ItemManager` (tracks item states, respawn timers)
- [ ] Gametype `getItemSpawnRules()` filters + configures
- [ ] `item_list` event on join
- [ ] Client creates `Pickup` objects from event data
- [ ] `item_pickup` / `item_respawn` events

### Phase 4: Scoring + Polish

- [ ] Score tracking via gametype
- [ ] `score_update` events → client scoreboard
- [ ] `WeaponSwitch` message (C→S)
- [ ] `print` event for server announcements
- [ ] Additional gametypes (TDM, Duel, Instagib, ClanArena)

---

## 8. Open Questions (Resolved)

| Question | Decision | Rationale |
| --- | --- | --- |
| Server entry point? | Extract `GameServer` from CLI | Clean architecture, testable |
| Items in snapshot or events? | Event-based (lightweight) | Items are mostly static, no need for 125Hz updates |
| Warmup loadout? | Same as normal | Keep it simple, pickups work normally |
| Gametype code location? | Server-only + shared config types | Security: client can't hack rules |
| Spawn selection? | Strategy pattern per gametype | DM uses "furthest", teams use team spawns |
