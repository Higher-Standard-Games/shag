# Dedicated Server Architecture - Research & Design

**Branch:** `feature/dedicated-server`  
**Date:** 2026-01-27  
**Status:** Brainstorming

---

## Goal

Create a Quake/Warsow-style dedicated server system where:
- Servers run headless from command line
- Servers define gameplay (map, gametype, scores, teams)
- Clients connect via `connect <server>:<port>` command
- Multiple servers can run from same codebase (separate processes)
- Gametype API allows defining custom game rules

---

## Reference: How Quake/Warsow Does It

### Server Launch (Quake)
```bash
# Launch dedicated server
./warsow_server +set sv_hostname "My Server" +set map wdm2 +set g_gametype dm

# With config file
./warsow_server +exec server.cfg
```

### Client Connect
```
/connect 192.168.1.100:27015
/connect myserver.example.com
```

### Gametype Script (Warsow)
Warsow uses AngelScript for gametypes:
```angelscript
void GT_InitGametype() {
    gametype.title = "Deathmatch";
    gametype.spawnableItemsMask = IT_ALL;
    gametype.respawnableItemsMask = IT_ALL;
}

void GT_ThinkRules() {
    // Called each server frame
    // Handle scores, time limits, etc.
}

void GT_PlayerRespawn( Entity @ent, int oldTeam, int newTeam ) {
    // Player spawned
}
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        SERVER PROCESS                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │ ServerConfig   │  │ GameServer     │  │ GametypeManager  │  │
│  │ - hostname     │  │ - tick loop    │  │ - load gametype  │  │
│  │ - port         │  │ - clients[]    │  │ - call hooks     │  │
│  │ - map          │  │ - simulation   │  │ - rules/scores   │  │
│  │ - gametype     │  │ - broadcaster  │  │                  │  │
│  └────────────────┘  └───────┬────────┘  └──────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐  │
│  │                    SimulationWorld                         │  │
│  │  - Entity/Component System                                 │  │
│  │  - MovementSystem, ProjectileSystem, DamageSystem          │  │
│  │  - BSPCollisionWorld                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                       NETWORK LAYER                              │
│  - WebSocket / UDP transport                                     │
│  - State broadcast to clients                                   │
│  - Input commands from clients                                  │
└─────────────────────────────────────────────────────────────────┘

                              ↕ Network

┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT PROCESS                             │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐   │
│  │ NetworkClient  │  │ Prediction     │  │ Renderer         │   │
│  │ - connect()    │  │ - local sim    │  │ - Babylon.js     │   │
│  │ - sendInput()  │  │ - reconcile    │  │ - interpolation  │   │
│  └────────────────┘  └────────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Components Needed

### 1. Server Config System

**File:** `server.json` or `server.cfg`

```json
{
  "hostname": "My SHAG Server",
  "port": 27015,
  "maxClients": 16,
  "map": "wdm2",
  "gametype": "deathmatch",
  "password": "",
  "rconPassword": "secret",
  "settings": {
    "g_timelimit": 10,
    "g_fraglimit": 30,
    "g_warmup": true,
    "g_warmupTime": 30
  }
}
```

### 2. Command Line Interface

```bash
# Basic launch
npx shag-server --config server.json

# Override specific settings
npx shag-server --port 27016 --map wdm5 --gametype ctf

# Multiple servers (separate processes)
npx shag-server --config server1.json &
npx shag-server --config server2.json &
```

**Implementation:** New entry point `src/cli/server.ts`

### 3. GameServer Class

```typescript
class GameServer {
  private config: ServerConfig;
  private simulation: FPSSimulation;
  private gametype: Gametype;
  private clients: Map<string, ConnectedClient>;
  private transport: ServerTransport;
  
  async start(): Promise<void>;
  async stop(): Promise<void>;
  
  private tick(): void;
  private broadcastState(): void;
  private handleClientInput(client: ConnectedClient, input: InputCommand): void;
}
```

### 4. Gametype API

Define hooks that gametypes implement:

```typescript
interface Gametype {
  // Metadata
  name: string;
  description: string;
  
  // Lifecycle
  onInit(server: GameServer): void;
  onShutdown(): void;
  
  // Frame hooks
  onTick(dt: number): void;
  onThinkRules(): void;  // Called each server frame for game logic
  
  // Player events
  onPlayerConnect(player: Player): boolean;  // return false to reject
  onPlayerDisconnect(player: Player): void;
  onPlayerSpawn(player: Player): SpawnPoint;
  onPlayerKill(attacker: Player, victim: Player, weapon: Weapon): void;
  onPlayerDeath(player: Player): void;
  
  // Item events
  onItemPickup(player: Player, item: Item): boolean;
  onItemSpawn(item: Item): void;
  
  // Game state
  getScoreboard(): ScoreboardData;
  getGameState(): 'warmup' | 'playing' | 'intermission';
  
  // Configuration
  getSpawnableItems(): ItemMask;
  getRespawnTime(item: Item): number;
}
```

### 5. Built-in Gametypes

#### Deathmatch (dm)
```typescript
class DeathmatchGametype implements Gametype {
  name = "Deathmatch";
  
  // Config
  fraglimit: number = 30;
  timelimit: number = 10; // minutes
  warmupTime: number = 30; // seconds
  
  // State
  gameState: 'warmup' | 'playing' | 'intermission' = 'warmup';
  scores: Map<string, number> = new Map();
  
  onThinkRules(): void {
    // Check frag limit
    for (const [playerId, score] of this.scores) {
      if (score >= this.fraglimit) {
        this.endMatch(playerId);
      }
    }
    
    // Check time limit
    if (this.elapsedTime >= this.timelimit * 60) {
      this.endMatch(this.getLeader());
    }
  }
  
  onPlayerKill(attacker, victim, weapon): void {
    const score = this.scores.get(attacker.id) ?? 0;
    this.scores.set(attacker.id, score + 1);
    this.broadcastKillMessage(attacker, victim, weapon);
  }
}
```

#### Team Deathmatch (tdm)
- Two teams (ALPHA/BETA)
- Team scores instead of individual
- Team spawns

#### Capture The Flag (ctf)
- Flag entities
- Flag capture scoring
- Return flag on touch

#### Duel (duel)
- 1v1 only
- Alternating rounds

---

## Client-Side: Connect Command

### Console Command
```
/connect 192.168.1.100:27015
/connect myserver.example.com
/connect localhost:27015  # For local testing
/disconnect
```

### Implementation
```typescript
// src/engine/console/commands/ConnectCommand.ts
class ConnectCommand implements ConsoleCommand {
  name = 'connect';
  
  execute(args: string[]): void {
    const [address] = args;
    if (!address) {
      console.error('Usage: connect <host>:<port>');
      return;
    }
    
    const [host, port] = address.split(':');
    NetworkManager.getInstance().connect(host, parseInt(port) || 27015);
  }
}
```

---

## Network Protocol

### Client → Server
```typescript
type ClientMessage =
  | { type: 'connect'; playerName: string; }
  | { type: 'input'; input: InputCommand; tick: number; }
  | { type: 'disconnect'; }
  | { type: 'chat'; message: string; }
  | { type: 'rcon'; password: string; command: string; };
```

### Server → Client
```typescript
type ServerMessage =
  | { type: 'welcome'; playerId: string; serverInfo: ServerInfo; }
  | { type: 'state'; state: GameState; tick: number; }
  | { type: 'player_join'; player: PlayerInfo; }
  | { type: 'player_leave'; playerId: string; }
  | { type: 'chat'; from: string; message: string; }
  | { type: 'kill'; attacker: string; victim: string; weapon: string; }
  | { type: 'map_change'; map: string; }
  | { type: 'gametype_event'; event: GametypeEvent; };
```

---

## File Structure

```
src/
├── server/
│   ├── GameServer.ts           # Main server class
│   ├── ServerConfig.ts         # Config loading
│   ├── ConnectedClient.ts      # Client connection handler
│   └── ServerTransport.ts      # Network transport abstraction
│
├── gametypes/
│   ├── Gametype.ts             # Interface definition
│   ├── BaseGametype.ts         # Common functionality
│   ├── dm/                     # Deathmatch
│   │   └── DeathmatchGametype.ts
│   ├── tdm/                    # Team Deathmatch
│   │   └── TeamDeathmatchGametype.ts
│   ├── ctf/                    # Capture The Flag
│   │   └── CTFGametype.ts
│   └── duel/                   # Duel
│       └── DuelGametype.ts
│
├── cli/
│   └── server.ts               # CLI entry point
│
└── engine/
    └── console/
        └── commands/
            └── ConnectCommand.ts
```

---

## Launch Process

### Server Startup Sequence
```
1. Parse command line args
2. Load server.json config
3. Initialize GameServer
4. Load map (BSP) in headless mode
5. Initialize gametype
6. Start network transport (WebSocket/UDP)
7. Enter tick loop (60 ticks/sec)
8. Wait for client connections
```

### Client Connect Sequence
```
1. User types: /connect myserver:27015
2. NetworkClient establishes WebSocket/UDP connection
3. Client sends: { type: 'connect', playerName: 'Player1' }
4. Server validates, creates player entity
5. Server sends: { type: 'welcome', playerId: 'xyz', serverInfo: {...} }
6. Client downloads map if needed (or uses cached)
7. Client spawns, starts sending input
8. Server broadcasts state each tick
```

---

## Questions to Resolve

### 1. Transport Protocol
- **WebSocket**: Easy, works everywhere, higher latency
- **UDP (WebRTC DataChannel)**: Low latency, more complex
- **Hybrid**: WebSocket for reliable, UDP for state

**Recommendation:** Start with WebSocket, add UDP later

### 2. Prediction vs Authority
- Client prediction for responsive feel
- Server is authoritative for anti-cheat
- Reconciliation when prediction mismatches

**Already have:** LocalGameHost does this - need RemoteGameHost

### 3. Map Distribution
- Server has map, client needs it
- Options:
  - Require client to have map (Quake-style)
  - Download from server (slow)  
  - CDN for map downloads

**Recommendation:** Require client to have map, error if missing

### 4. Headless BSP Loading
- Server needs collision but not rendering
- Need to load BSP without Babylon.js
- Already have: `BSPCollisionWorld` uses `CollisionManager`

### 5. Process Model
- Single process with multiple servers? (complex)
- Separate process per server? (simpler, Quake-style)

**Recommendation:** One process per server, simple and reliable

---

## Implementation Phases

### Phase 1: Basic Server
- [ ] `GameServer` class with tick loop
- [ ] `ServerConfig` JSON loading
- [ ] CLI entry point (`npx shag-server`)
- [ ] WebSocket transport
- [ ] Single client can connect and move

### Phase 2: Gametype API
- [ ] `Gametype` interface
- [ ] `DeathmatchGametype` with scoring
- [ ] Warmup state
- [ ] Kill messages
- [ ] Scoreboard data

### Phase 3: Client Integration
- [ ] `connect` console command
- [ ] `RemoteGameHost` (connects to real server)
- [ ] Server list/browser UI (optional)

### Phase 4: Polish
- [ ] Multiple gametypes (TDM, CTF)
- [ ] RCON for remote admin
- [ ] Map change voting
- [ ] Player teams

---

## Test Scenario

**Goal:** Simple deathmatch server for testing

1. Launch server:
```bash
npx shag-server --map wdm2 --gametype dm --fraglimit 10
```

2. Server output:
```
[SHAG Server] Starting...
[SHAG Server] Loading map: wdm2
[SHAG Server] Gametype: Deathmatch
[SHAG Server] Listening on port 27015
[SHAG Server] Waiting for players...
```

3. Client connects:
```
/connect localhost:27015
```

4. Game starts:
- 2+ players → warmup countdown
- First to 10 frags wins
- Match ends → scoreboard → next map

---

## Open Questions for User

1. **Scripted gametypes?** Should gametypes be TypeScript classes (compiled) or scripts (runtime loadable like Warsow's AngelScript)?

2. **Server browser?** Do we want a master server that lists all running servers?

3. **Authentication?** Anonymous play or require accounts?

4. **Anti-cheat?** Server-authoritative is first step, but any additional measures?

5. **Voice chat?** WebRTC voice between players?
