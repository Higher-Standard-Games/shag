# Bot Intelligence Server (BIS) — Research Document

**Date:** 2026-03-18  
**Branch:** `feature/bot-ai`  
**Status:** Research / Brainstorming

---

## 1. Vision

Build a **Bot Intelligence Server** — a separate Node.js process that connects "robot clients" to game servers. Bots behave exactly like human players from the game server's perspective: they connect via the same transport protocol, receive snapshots, and send input commands.

### Why This Approach?

| Approach | Pros | Cons |
|---|---|---|
| **Server-side bots** (Q3/Warsow) | Simple, low latency | Bloats game server, tightly coupled, hard to iterate AI |
| **Client-side bots** | Full client stack, visual debugging | Needs rendering engine, GPU, very heavy per bot |
| **Bot Intelligence Server** ✅ | Decoupled, scalable, real protocol, trainable | Slight network latency (negligible on localhost) |

Traditional Q3/Warsow bots run inside the game server — they have direct access to game state and bypass the network protocol. This makes them fast but also means:

- Bot AI code is tangled with server code
- Bots can "cheat" by reading state they shouldn't have
- Bot behavior feels robotic because it reacts to raw game state, not what a human would perceive

**Our approach:** Bots connect as real clients. They see exactly what a player sees (snapshots), and can only do what a player can do (send input). This naturally constrains them to human-like information boundaries.

---

## 2. Architecture Overview

```
┌──────────────────┐     WebSocket      ┌──────────────────┐
│   Lobby Server   │◄──────────────────►│   Game Server    │
│   (port 9000)    │   spawn/manage     │  (port 7777+)    │
└──────────────────┘                    └────────┬─────────┘
                                                 │
                              WebSocket/WT       │  WebSocket/WT
                                                 │
                    ┌────────────────────────────┤
                    │                            │
          ┌─────────▼──────────┐     ┌───────────▼──────────┐
          │  Human Client 1    │     │  Bot Intelligence    │
          │  (browser)         │     │  Server (BIS)        │
          └────────────────────┘     │  (port 9100)         │
                                     │                      │
                                     │  ┌────────────────┐  │
                                     │  │ BotClient #1   │  │
                                     │  │ BotClient #2   │  │
                                     │  │ BotClient #3   │  │
                                     │  │ ...            │  │
                                     │  └────────────────┘  │
                                     └──────────────────────┘
```

### Key Components

1. **Bot Intelligence Server** (`npm run bot:server`) — Node.js process managing bot lifecycle
2. **BotClient** — Headless network client per bot (reuses `MessageCodec`/`BinaryProtocol`)
3. **BotBrain** — AI decision engine (state machine + optional brain.js neural net)
4. **DemoRecorder** — Server-side gameplay recording for training data
5. **BotTrainer** — Offline tool to train brain.js nets from demo data

---

## 3. Existing Codebase — What We Already Have

### 3.1 Headless Net Client (perfect prototype!)

`src/cli/headless-netclient.ts` — **Already implements 80% of what a BotClient needs:**

- Connects via `WebSocket`
- Sends `MessageCodec.encodeJoin(playerName)`
- Handles `Welcome` → `JoinAccept` → `Snapshot` loop
- Sends `MessageCodec.encodeAck(tick)` for each snapshot
- Sends `Input` messages with direction/pitch/yaw/buttons via `BinaryEncoder`
- Periodic input at 50ms intervals (20Hz)

**BotClient = headless-netclient + BotBrain replacing the hardcoded test input.**

### 3.2 Existing Server-Side Bots (what we're replacing)

`GameServer.spawnBot()` creates server-side entity with:

- Physics (movement subsystem)
- Health + weapons
- No input processing (just stands there)
- Themed bot names (`getNextBotName`)
- Registered with gametype controller

**These are "mannequins" — they exist but don't play. BIS bots would replace them entirely.**

### 3.3 Game Server Client Protocol

```
Client → Server:
  MessageType.Join          → { playerName }
  MessageType.JoinGame      → { teamId? }
  MessageType.RequestSpawn   → (respawn after death)
  MessageType.Input         → { playerId, seq, direction, pitch, yaw, buttons }
  MessageType.Ack           → { tick }
  MessageType.Ping          → { clientSendTime }

Server → Client:
  MessageType.Welcome       → { serverName, map, tickRate, playerCount }
  MessageType.JoinAccept    → { clientId, playerId, entityId }
  MessageType.Snapshot      → { tick, entities[], players[] }
  MessageType.PlayerJoined/Left/Kill/Chat
  MessageType.Pong          → { clientSendTime, serverTime }
```

### 3.4 Transport Layer

- **Server:** `WebTransportTransport` + `WebSocketTransport` (both implement same `Transport` interface)
- **Client:** `Transport` interface with `connect(url)`, `send(data)`, `onMessage(cb)`
- **For BIS:** Use `WebSocket` from `ws` npm package (already used by headless-netclient and lobby server)

### 3.5 Lobby Server Architecture (reference for BIS)

`LobbyServer` is a perfect architectural reference:

- CLI entry point: `src/cli/lobby-server.ts` (simple, clean)
- Class-based: `LobbyServer` manages connections, state, lifecycle
- WebSocket server with JSON messages
- Spawns game server processes via child_process

**BIS follows same pattern but in reverse: it spawns bot CLIENTS instead of servers.**

---

## 4. BotClient Design

### 4.1 Core Loop

```typescript
class BotClient {
  private ws: WebSocket;
  private brain: BotBrain;
  private gameState: BotGameState;  // Parsed from snapshots
  
  async connect(serverUrl: string, botName: string) {
    this.ws = new WebSocket(serverUrl);
    this.ws.on('message', (data) => this.handleMessage(data));
    // After Welcome → send Join → after JoinAccept → send JoinGame
  }
  
  private handleMessage(data: Uint8Array) {
    const type = MessageCodec.peekMessageType(data);
    if (type === MessageType.Snapshot) {
      this.gameState.update(MessageCodec.decodeSnapshot(data));
      this.sendAck(snapshot.tick);
      
      // === AI DECISION ===
      const input = this.brain.decide(this.gameState);
      this.sendInput(input);
    }
  }
  
  private sendInput(input: BotInput) {
    // Encode as MessageType.Input — identical to what browser client sends
    const encoded = MessageCodec.encodeInput(
      this.playerId, this.sequence++,
      input.direction, input.pitch, input.yaw, input.buttons
    );
    this.ws.send(encoded);
  }
}
```

### 4.2 BotGameState — World Perception

Parsed from server snapshots. This is what the bot "sees":

```typescript
interface BotGameState {
  // From snapshot entities
  self: {
    position: Vec3;
    velocity: Vec3;
    health: number;
    armor: number;
    weapons: string[];
    currentWeapon: string;
    ammo: Map<string, number>;
    isDead: boolean;
  };
  
  // Other players (enemies + teammates)
  players: Array<{
    id: string;
    position: Vec3;
    velocity: Vec3;
    health?: number;  // Only if visible/known
    isDead: boolean;
  }>;
  
  // Pickups (weapons, ammo, health, armor)
  pickups: Array<{
    type: string;
    position: Vec3;
    isActive: boolean;
  }>;
  
  // Projectiles (dodge incoming!)
  projectiles: Array<{
    position: Vec3;
    velocity: Vec3;
    owner: string;
  }>;
  
  // Map knowledge (built from experience + BSP vision)
  mapData: {
    spawnPoints: Vec3[];              // Learned from respawn positions
    knownPickupLocations: Vec3[];     // Learned from snapshot pickup entities
    dangerZones: Vec3[];              // Where bot dies frequently
    playerTraffic: Map<string, number>; // Region → enemy frequency
  };
}
```

### 4.3 BotVision — Spatial Awareness via BSP Raytracing

> [!IMPORTANT]
> **Key design decision:** Bots do NOT need a precomputed navmesh. They load the same BSP collision data the server uses and raytrace against it to "see" the world — exactly like a human player uses their eyes, but mathematically.

The bot has access to the same BSP file as the server. Instead of rendering it visually, it casts rays to perceive geometry:

```typescript
class BotVision {
  private bsp: CollisionWorld;  // Same BSP the server loads
  
  constructor(mapName: string) {
    // Load BSP collision data (headless, no rendering)
    this.bsp = HeadlessBSPCollisionWorld.load(mapName);
  }
  
  // "Can I see this enemy?" — line-of-sight trace
  canSee(from: Vec3, target: Vec3): boolean {
    return !this.bsp.traceLine(from, target).hit;
  }
  
  // "What's around me?" — radial scan for spatial awareness
  scanSurroundings(position: Vec3, heading: number): SpatialScan {
    const rays = 16;  // Cast 16 rays in a circle
    const distances: number[] = [];
    for (let i = 0; i < rays; i++) {
      const angle = heading + (i / rays) * Math.PI * 2;
      const dir = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
      const end = { x: position.x + dir.x * 2000, y: position.y, z: position.z + dir.z * 2000 };
      const trace = this.bsp.traceLine(position, end);
      distances.push(trace.hit ? trace.distance : 2000);
    }
    // Bot now knows: corridor? open room? near wall? ledge ahead?
    return { distances, isOpenArea: distances.every(d => d > 500) };
  }
  
  // "Can I walk there?" — path clearance check
  isPathClear(from: Vec3, to: Vec3): boolean {
    // Trace at feet height + player width offset
    return !this.bsp.traceLine(from, to).hit;
  }
  
  // "Where can I go?" — find open movement directions
  findOpenDirections(position: Vec3): Vec3[] {
    const directions: Vec3[] = [];
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const dir = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
      const target = { x: position.x + dir.x * 200, y: position.y, z: position.z + dir.z * 200 };
      if (!this.bsp.traceLine(position, target).hit) {
        directions.push(dir);
      }
    }
    return directions;
  }
  
  // "Is there a drop here?" — edge/gap detection
  checkDrop(position: Vec3, direction: Vec3): boolean {
    const ahead = { x: position.x + direction.x * 100, y: position.y, z: position.z + direction.z * 100 };
    const below = { x: ahead.x, y: ahead.y - 500, z: ahead.z };
    const trace = this.bsp.traceLine(ahead, below);
    return !trace.hit || trace.distance > 200; // Gap or big drop
  }
}
```

**What this enables (no navmesh needed):**

- ✅ Line-of-sight checks for enemies
- ✅ Pathfinding by raytracing — scan ahead, if blocked try diagonal
- ✅ Jump gap detection — trace downward ahead
- ✅ Cover evaluation — "am I exposed to enemy position?"
- ✅ Room classification — open area vs corridor vs tight space
- ✅ **Works on ANY map automatically** — just load the BSP

**Existing code we reuse:** `HeadlessBSPCollisionWorld` already exists at `src/cli/HeadlessBSPCollisionWorld.ts` for server-side BSP collision. The BIS loads the same BSP data.

---

## 5. BotBrain — AI Decision System

### 5.1 Phase 1: State Machine (Immediate — No ML)

Traditional behavior tree/state machine for core competence:

```
┌──────────────┐
│   SPAWN      │ → Request spawn, pick initial weapon
├──────────────┤
│   FIGHT      │ → Track enemy, aim, shoot, strafe
├──────────────┤
│   HUNT       │ → Seek enemies (move toward sounds/last known position)
├──────────────┤
│   ITEM_RUN   │ → Navigate to health/armor/weapon pickups
├──────────────┤
│   DODGE      │ → Evade incoming projectiles (rockets, plasma)
├──────────────┤
│   RETREAT    │ → Low health → flee toward health/armor
└──────────────┘
```

**Priority system:**

```
1. DEAD?        → RequestSpawn
2. Being shot?  → DODGE or FIGHT (engage attacker)
3. Enemy in LOS → FIGHT
4. Low health   → RETREAT (seek health)
5. Need items   → ITEM_RUN
6. Default      → HUNT (patrol/seek)
```

### 5.2 Core Skills (Code-Based)

These are deterministic, always available:

#### Aiming

```typescript
// Lead target based on weapon projectile speed + distance
function aimAt(target: Vec3, targetVel: Vec3, weapon: WeaponDef): { pitch: number; yaw: number } {
  const toTarget = target.subtract(self.position);
  const distance = toTarget.length();
  
  // Projectile travel time
  const travelTime = distance / weapon.projectileSpeed;
  
  // Predicted position
  const predicted = target.add(targetVel.scale(travelTime));
  
  // Calculate angles
  const delta = predicted.subtract(self.position);
  const yaw = Math.atan2(delta.x, delta.z);
  const pitch = Math.atan2(delta.y, Math.sqrt(delta.x * delta.x + delta.z * delta.z));
  
  return { pitch, yaw };
}
```

#### Movement

```typescript
// Strafe-jumping style movement
function moveToward(target: Vec3): BotInput {
  const delta = target.subtract(self.position);
  const yaw = Math.atan2(delta.x, delta.z);
  
  return {
    direction: { x: 0, y: 0, z: 1 },  // Forward
    yaw,
    pitch: 0,
    buttons: BUTTON_FORWARD, // + jump for strafe jumping
  };
}
```

#### Weapon Selection

```typescript
function selectWeapon(distance: number, enemyHealth: number): string {
  if (distance < 200) return 'riotgun';        // Close range
  if (distance < 500) return 'plasmagun';       // Medium
  if (distance < 1000) return 'rocketlauncher'; // Mid-long
  return 'electrobolt';                          // Long range (instagun)
}
```

### 5.3 Phase 2: brain.js Neural Network (ML Enhancement)

> [!IMPORTANT]
> Phase 2 depends on demo recording (Section 6) for training data. Phase 1 state machine should be fully functional first.

**What brain.js can learn:**

- **Aim style** — human-like flick shots, tracking, prediction errors
- **Movement patterns** — strafe patterns, when to jump, dodge timing
- **Decision making** — when to push vs retreat, weapon switching habits
- **Map control** — item timing, positioning preferences

#### Training Pipeline

```
Demo Recording → Feature Extraction → Training Data → brain.js → Trained Net
     (BDM)            (parser)           (JSON)        (train)     (export)
```

#### Neural Net Architecture

```typescript
import { NeuralNetwork } from 'brain.js';

// Input features (from BotGameState)
interface AimInput {
  relativeEnemyX: number;    // -1 to 1 (normalized)
  relativeEnemyY: number;
  relativeEnemyZ: number;
  enemyVelX: number;
  enemyVelY: number;
  enemyVelZ: number;
  distance: number;          // 0-1 (normalized to max range)
  currentWeapon: number;     // One-hot encoded
  selfVelX: number;
  selfVelY: number;
  selfVelZ: number;
}

// Output: aim adjustment
interface AimOutput {
  deltaYaw: number;   // -1 to 1
  deltaPitch: number; // -1 to 1
  shouldShoot: number; // 0 or 1
}

const aimNet = new NeuralNetwork<AimInput, AimOutput>({
  hiddenLayers: [32, 16],
  activation: 'sigmoid',
  learningRate: 0.01,
});

// Train from demo data
aimNet.train(trainingData, {
  iterations: 20000,
  errorThresh: 0.005,
});

// Export for runtime use
const exported = aimNet.toJSON();
fs.writeFileSync('bot-aim-model.json', JSON.stringify(exported));
```

#### Runtime Integration

```typescript
class BrainJSBotBrain extends BotBrain {
  private aimNet: NeuralNetwork;
  private moveNet: NeuralNetwork;
  
  constructor() {
    // Load pre-trained models
    this.aimNet = new NeuralNetwork();
    this.aimNet.fromJSON(require('./models/aim-model.json'));
    
    this.moveNet = new NeuralNetwork();
    this.moveNet.fromJSON(require('./models/move-model.json'));
  }
  
  decide(state: BotGameState): BotInput {
    // Use state machine for high-level decisions (fight/retreat/hunt)
    const mode = this.stateLogic(state);
    
    // Use neural net for low-level execution (aim, movement timing)
    if (mode === 'FIGHT' && state.nearestEnemy) {
      const aimResult = this.aimNet.run(this.extractAimFeatures(state));
      const moveResult = this.moveNet.run(this.extractMoveFeatures(state));
      
      return {
        pitch: state.self.pitch + aimResult.deltaPitch * 0.1,
        yaw: state.self.yaw + aimResult.deltaYaw * 0.1,
        buttons: aimResult.shouldShoot > 0.5 ? BUTTON_FIRE : 0,
        direction: this.interpretMoveOutput(moveResult),
      };
    }
    
    // Fall back to state machine for non-combat
    return this.stateMachineDecide(state, mode);
  }
}
```

---

## 6. Server-Side Demo Recording

### 6.1 Why Server Demos?

| Type | Data Quality | Storage | Use for Training |
|---|---|---|---|
| Client demo | One POV only, interpolated, visual artifacts | Large (textures, models referenced) | ❌ Limited |
| **Server demo** ✅ | All players, authoritative, raw input + state | Small (binary, no assets) | ✅ Perfect |

Server demos contain **everything**: every player's inputs, positions, weapon states, kills, items — the complete authoritative game state. This is exactly what we need for ML training.

### 6.2 Demo Format (.bdm — Binary Demo)

```
BDM Header:
  magic: "BDM1"          (4 bytes)
  version: uint16         (2 bytes)
  map: string             (variable)
  gametype: string        (variable)
  tickRate: uint16        (2 bytes)
  playerCount: uint8      (1 byte)
  startTime: uint64       (8 bytes)

Per-Tick Frame:
  tick: uint32            (4 bytes)
  timestamp: uint32       (4 bytes, ms since start)
  inputCount: uint8       (1 byte)
  inputs[]:
    playerId: uint16
    sequence: uint16
    dirX: float16
    dirY: float16
    dirZ: float16
    pitch: float16
    yaw: float16
    buttons: uint16
  entityCount: uint16     (2 bytes)
  entities[]:             (delta-compressed snapshot)
    entityId: uint16
    components...         (reuse BinaryProtocol encoding)
  events[]:               (kills, pickups, spawns)
    eventType: uint8
    eventData: variable

Footer:
  totalTicks: uint32
  duration: uint32 (ms)
  checksum: uint32
```

### 6.3 Implementation in GameServer

```typescript
class DemoRecorder {
  private stream: WriteStream;
  private startTime: number;
  
  constructor(filename: string, map: string, gametype: string, tickRate: number) {
    this.stream = createWriteStream(filename);
    this.writeHeader(map, gametype, tickRate);
    this.startTime = Date.now();
  }
  
  // Called every server tick
  recordTick(tick: number, inputs: Map<string, PlayerInput>, state: GameState, events: GameEvent[]) {
    // Write tick frame with all inputs + entity state + events
    // Delta-compress entities (same as snapshot broadcasting)
    this.writeTick(tick, Date.now() - this.startTime, inputs, state, events);
  }
  
  finish() {
    this.writeFooter();
    this.stream.close();
  }
}
```

**Integration point:** `GameServer.tick()` — after simulation step, before snapshot broadcast:

```typescript
tick(): void {
  // ... existing simulation ...
  
  // Record demo frame
  if (this.demoRecorder) {
    this.demoRecorder.recordTick(
      this.simulation.currentTick,
      this.lastInputs,
      this.simulation.getState(),
      this.pendingEvents
    );
  }
  
  // ... broadcast snapshots ...
}
```

### 6.4 Demo Playback for Training

```typescript
class DemoParser {
  static async *readFrames(filename: string): AsyncGenerator<DemoFrame> {
    // Stream-read demo file, yield parsed frames
    // Each frame contains: tick, all player inputs, all entity states, events
  }
  
  // Extract training features from a demo
  static async extractTrainingData(filename: string, targetPlayerId: string): TrainingSet {
    const data: TrainingPair[] = [];
    
    for await (const frame of this.readFrames(filename)) {
      const playerState = frame.getPlayerState(targetPlayerId);
      const playerInput = frame.getPlayerInput(targetPlayerId);
      if (!playerState || !playerInput) continue;
      
      // Build input features from game state
      const features = extractFeatures(playerState, frame);
      // Output = what the player actually did
      const label = {
        deltaYaw: playerInput.yaw - playerState.lastYaw,
        deltaPitch: playerInput.pitch - playerState.lastPitch,
        shouldShoot: (playerInput.buttons & BUTTON_FIRE) ? 1 : 0,
        moveDir: playerInput.direction,
      };
      
      data.push({ input: features, output: label });
    }
    
    return data;
  }
}
```

---

## 7. Bot Intelligence Server Design

### 7.1 Entry Point

```
src/
  cli/
    bot-server.ts          ← CLI entry (like lobby-server.ts)
  bot/
    BotServer.ts           ← Main server class
    BotClient.ts           ← Headless client per bot
    BotBrain.ts            ← AI base class
    StateMachineBrain.ts   ← Phase 1: rule-based AI
    NeuralBrain.ts         ← Phase 2: brain.js AI
    BotGameState.ts        ← World state from snapshots
    BotConfig.ts           ← Bot difficulty, personality settings
    models/                ← Trained brain.js model JSONs
  demo/
    DemoRecorder.ts        ← Server-side recording
    DemoParser.ts          ← Read demos for training
    DemoTrainer.ts         ← brain.js training pipeline
```

### 7.2 BotServer Class

```typescript
class BotServer {
  private bots: Map<string, BotClient> = new Map();
  private wss: WebSocketServer;  // Control API
  
  constructor(port: number = 9100) { ... }
  
  // Spawn a bot that connects to a game server
  async addBot(gameServerUrl: string, options: BotOptions): Promise<string> {
    const bot = new BotClient(options);
    await bot.connect(gameServerUrl);
    this.bots.set(bot.id, bot);
    return bot.id;
  }
  
  // Remove a bot
  async removeBot(botId: string) {
    const bot = this.bots.get(botId);
    if (bot) {
      await bot.disconnect();
      this.bots.delete(botId);
    }
  }
  
  // Control API — game server or client can request bots
  private handleControlMessage(msg: any) {
    switch (msg.type) {
      case 'add_bot':
        this.addBot(msg.gameServerUrl, msg.options);
        break;
      case 'remove_bot':
        this.removeBot(msg.botId);
        break;
      case 'set_difficulty':
        this.bots.get(msg.botId)?.setDifficulty(msg.level);
        break;
    }
  }
}
```

### 7.3 Flow: "addbot" Command

```
1. Player types "/addbot" in game console
2. Client sends addbot command to game server (reliable message)
3. Game server forwards request to BIS via control WebSocket
4. BIS spawns new BotClient
5. BotClient connects to game server via WebSocket (same as human client)
6. Game server sees new connection → handleJoin → handleJoinGame
7. Bot is now a regular player in the match
```

---

## 8. Bot Personalities & Difficulty

### 8.1 Difficulty Levels

```typescript
interface BotDifficulty {
  // Aiming
  aimAccuracy: number;      // 0-1: how close to perfect aim (add noise below 1)
  reactionTimeMs: number;   // Delay before engaging (100-500ms)
  trackingSpeed: number;    // How fast crosshair follows target (deg/sec)
  
  // Decision making
  predictionSkill: number;  // 0-1: how well they predict enemy movement
  itemTimingSkill: number;  // 0-1: how precisely they track item respawns
  
  // Movement
  strafeJumpSkill: number;  // 0-1: quality of strafe-jump chains
  dodgeSkill: number;       // 0-1: how well they dodge projectiles
  
  // Human-like imperfections
  mistakeRate: number;      // Random dumb decisions per minute
  lookAroundRate: number;   // Random head movement (human-like scanning)
}

// Presets
const DIFFICULTIES = {
  easy:   { aimAccuracy: 0.3, reactionTimeMs: 400, ... },
  medium: { aimAccuracy: 0.55, reactionTimeMs: 250, ... },
  hard:   { aimAccuracy: 0.8, reactionTimeMs: 120, ... },
  insane: { aimAccuracy: 0.95, reactionTimeMs: 50, ... },
};
```

### 8.2 Personality System

When trained from demo recordings, bots can mimic specific players:

```typescript
interface BotPersonality {
  name: string;
  trainedFrom: string;      // Demo file(s) used for training
  preferredWeapons: string[];
  aggression: number;        // 0 (camper) to 1 (always pushing)
  modelPath: string;         // brain.js model JSON
}
```

---

## 9. Implementation Phases

### Phase 1: Foundation (MVP Bot Server)

- [ ] `BotServer` with control WebSocket API
- [ ] `BotClient` based on `headless-netclient.ts`
- [ ] `BotGameState` parsing from snapshots
- [ ] `StateMachineBrain` — basic fight/hunt/retreat
- [ ] Basic aiming (direct aim, no prediction)
- [ ] Basic movement (move toward target, strafe randomly)
- [ ] "addbot" console command
- [ ] `npm run bot:server` CLI entry point

**Result:** Bots that can connect, move around, acquire targets, and shoot. Not smart, but functional.

### Phase 2: Server Demo Recording

- [ ] `DemoRecorder` in `GameServer.tick()`
- [ ] Binary demo format (.bdm)
- [ ] Demo start/stop commands
- [ ] `DemoParser` for reading demos
- [ ] Training data extraction pipeline

**Result:** Can record human gameplay and extract training features.

### Phase 3: brain.js AI Enhancement

- [ ] Feature extraction from demos (aim deltas, movement patterns)
- [ ] Train aim model (predict aim adjustments from game state)
- [ ] Train movement model (predict movement from game state)  
- [ ] `NeuralBrain` combining state machine + neural nets
- [ ] Personality system (train from specific player demos)
- [ ] Difficulty scaling (blend neural net output with randomness)

**Result:** Bots that play like specific human players, with difficulty adjustment.

### Phase 4: Advanced Features (Future)

- [ ] Team coordination (for team gametypes)
- [ ] Voice/text chat timing (human-like comms)
- [ ] Bot vs Bot self-play training loop (automatic improvement cycle)
- [ ] Online learning (adjust during match based on opponent)
- [ ] Spatial memory persistence (save map knowledge between sessions)
- [ ] Advanced BSP analysis (detect jump pads, teleporters, water)

---

## 10. Technical Considerations

### 10.1 Performance

- **1 BotClient = 1 WebSocket connection + 1 BotBrain tick per snapshot**
- brain.js `run()` is fast (~0.1ms for small nets) — 100+ bots per BIS instance easily
- State machine logic is negligible CPU
- **Bottleneck:** Network I/O (WebSocket per bot), but on localhost this is trivial

### 10.2 Dependencies

| Dependency | Purpose | Size |
|---|---|---|
| `ws` | WebSocket client (already used) | Minimal |
| `brain.js` | Neural network training + inference | ~150KB |
| `@engine/network/protocol/*` | Reuse MessageCodec, BinaryProtocol | Already exists |

### 10.3 Reused Code

| Module | Usage in BIS |
|---|---|
| `MessageCodec` | Encode/decode all protocol messages |
| `BinaryProtocol` | Input encoding, snapshot decoding |
| `BinaryEncoder/Decoder` | Low-level binary operations |
| `headless-netclient.ts` | Direct template for BotClient |
| `lobby-server.ts` | Architectural template for bot-server.ts |

### 10.4 Limitations & Challenges

> [!TIP]
> **No navmesh needed!** Bots use BSP raytracing for spatial awareness — same collision data the server already loads. Works on any map automatically without preprocessing.

> [!NOTE]
> **brain.js is CPU-only.** For serious ML training, we'd eventually want TensorFlow.js or ONNX runtime. But brain.js is perfect for starting: simple API, small models, fast inference, pure JS.

> [!IMPORTANT]
> **Bots play by human rules.** Same PVS-culled snapshots (can't see through walls), same input rate limits, artificial network latency (50-100ms), and same weapon/reload timing. This is what makes them feel human.

> [!NOTE]
> **Bootstrapping without human data.** Phase 1 state machine bots can play against each other immediately. Record those games → train brain.js → better bots → record again → iterate. Human demos refine later, but self-play gets us started with zero manual data collection.

---

## 11. package.json Scripts

```json
{
  "scripts": {
    "bot:server": "npx vite-node src/cli/bot-server.ts",
    "bot:train": "npx vite-node src/cli/bot-train.ts -- --demo <file>"
  }
}
```

---

## 12. Open Questions

### Resolved

1. ~~**NavMesh generation**~~ → **Resolved: BSP raytracing.** Bots use `CollisionWorld` (same BSP the server loads) to raytrace their surroundings. No navmesh files needed. They learn map layout through experience + line-of-sight traces, just like a human player explores a new map.

2. ~~**Demo format compatibility**~~ → **Resolved: Own format.** Warsow demos won't work — different maps, different gameplay. We'll create our own efficient `.bdm` format optimized for our entity/component system, reusing `BinaryProtocol` encoding.

3. ~~**brain.js model size**~~ → **Resolved: Start tiny, grow.** Begin with `hiddenLayers: [16, 8]` (fast training, < 1 min). Scale to `[32, 16]` then `[64, 32]` as more demo data accumulates. Iterate quickly.

4. ~~**Bot visual representation**~~ → **Resolved: Keep simple.** Bots are regular players, no special treatment. No `[BOT]` tags or unique skins needed.

5. ~~**Training data volume**~~ → **Resolved: Self-play bootstrap.** Phase 1 state machine bots generate training data by playing against each other — no human demos needed to start. 15-30 minutes of human gameplay can refine aim models later. The cycle: `bots play → record → train → better bots → repeat`.

### Resolved (from codebase review)

1. ~~**BSP loading in BIS process**~~ → **Resolved: Reuse `loadBspCollision()`.** The headless server at `headless-netserver-v2.ts` already has a fully headless `loadBspCollision(mapName, gamePath)` function that returns `{collision, spawnPoints, pickupItems, pvs}`. BIS can import and call this directly. **Dependency note:** `HeadlessBSPCollisionWorld` imports `@babylonjs/core/Maths/math.vector` (Vector3) — BIS will need `@babylonjs/core` as a dependency, but only the math module (no rendering).

2. ~~**Snapshot decode on Node.js**~~ → **Resolved: Works natively.** `MessageCodec.decodeSnapshot()` → `BinaryProtocol.decodeSnapshot()` uses only `BinaryDecoder`, `GameState`, `Entity` — pure data classes with zero Babylon.js or browser dependencies. Safe for Node.js.

3. ~~**Weapon switching inputs**~~ → **Resolved: `weaponSlot` field in command.** `BinaryProtocol.encodeCommand()` encodes `{direction, pitch, yaw, buttons, weaponSlot, tick}`. `weaponSlot` is a `uint8` (1-indexed slot number). `WeaponSystem.ts` detects slot changes via edge detection. Bot sends `weaponSlot: N` in its input command.

4. ~~**Death and respawn flow**~~ → **Resolved: `RequestSpawn` message.** Bot detects death via `combat_state` event (`dead: true`). Sends `MessageCodec.encodeRequestSpawn()` (1-byte message). Server sets `entity.input.wantsRespawn = true`, and `GametypeController.processRespawns()` handles respawn with its own timing. Bot should add a human-like delay (1-3 sec) before sending.

5. ~~**Scoring and game state**~~ → **Resolved: Multiple data sources.** Player scores via `decodePlayers()` (`{entityId, name, team, score, deaths, ping}`). Match state via `match_state` event (JSON). Combat state via `combat_state` event (`{health, armor, dead}`). Weapon state via `weapon_state` event (`{currentWeapon, weapons[], ammo{}, reloading}`).

6. ~~**Sound as information**~~ → **Partially resolved: Events as hearing.** Bot receives: `weapon_fire` (origin + direction), `projectile_spawn/impact`, `item_pickup` (position), `weapon_drop` (position), `damage` (attacker + direction). All PVS-filtered — same hearing range constraint as humans.

### Still Open

1. **Bot input timing and human-feel** — How to simulate network latency? Random 30-80ms delay + ±10ms jitter? Reaction time per-decision or per-frame?

2. **Multiple bots, one BSP** — Share one `CollisionWorld` per active map? `BotServer` owns map cache?

3. **Item respawn timing** — Can bots derive pickup respawn timing from snapshot data? Server uses 25-second respawn — can bots count ticks since `item_pickup` event?

4. **brain.js alternatives** — Evaluate ONNX.js or TensorFlow.js Lite for later phases?

5. **Strafe-jumping** — Hard-code or learn from demos? Very specific timing pattern.

6. **Self-play config** — Optimal map/gametype for bot-vs-bot training? Short FFA rounds vs 1v1 duels?

7. **Model versioning** — How to version brain.js models and benchmark generations?

8. **Cheating prevention** — Server-side BIS connection authorization?

9. **Buttons bitfield mapping** — Need exact bit flags for fire, jump, crouch, use, etc.

10. **Bot entity identification in snapshots** — How to find self-entity from `JoinAccept.entityId` in snapshot entities map?

11. **Delta compression baseline** — Bot must maintain `GameState` baseline for `decodeSnapshot(data, baseline)`. What if a snapshot is missed?

12. **Lobby integration** — How does game server request bots from BIS? Direct WebSocket? Lobby relay?

13. **Concurrent snapshot processing** — 60Hz × 4 bots = 240 snapshots/sec. Should bots use worker threads?

14. **Babylon.js Vector3 dependency** — `HeadlessBSPCollisionWorld` pulls in `@babylonjs/core`. Can we replace with lightweight vec3 for BIS?

---

## 13. Implementation Deep-Dive (Codebase Review)

Findings from reviewing the actual codebase to validate implementation assumptions.

### 13.1 Exact Input Command Format

From `BinaryProtocol.encodeCommand()`:

```typescript
// What the bot sends every tick:
{
  direction: { x: float32, y: float32, z: float32 },  // Movement direction
  pitch: float32,      // Look up/down (radians)
  yaw: float32,        // Look left/right (radians)
  buttons: uint16,     // Bitfield: fire, jump, crouch, etc.
  weaponSlot: uint8,   // 1-indexed weapon slot (0 = no change)
  tick: uint32,        // Client tick for server reconciliation
}
```

The bot constructs this identical structure per snapshot and sends via `MessageCodec.encodeCommand(playerId, sequence, command)`.

### 13.2 What Bots Receive from Snapshots

**Entities** (per entity — position, velocity, rotation, movement state):

- Flag `0x01`: position `{x, y, z}` + transform
- Flag `0x02`: velocity `{x, y, z}` + grounded state
- Flag `0x04`: grounded boolean
- Flag `0x08`: rotation `{yaw, pitch}`
- Flag `0x10`: movementState `{crouch, slide, wallJump}`
- Flag `0x20`: weaponMeta (for item entities)

**Players** (per player — scores and identity):

- `entityId`, `name`, `team`, `score`, `deaths`, `ping`

**Events** (game events broadcast in snapshot):

| Event | Code | Data | Bot Use |
| --- | --- | --- | --- |
| `combat_state` | 1 | health, armor, dead | Self-awareness |
| `match_state` | 2 | JSON gametype data | Strategy |
| `weapon_state` | 3 | currentWeapon, weapons[], ammo{} | Weapon management |
| `weapon_fire` | 4 | entityId, origin, direction | Enemy detection |
| `weapon_charge` | 5 | entityId, charging | Dodge timing |
| `projectile_spawn` | 6 | entityId, defId | Dodge incoming |
| `projectile_impact` | 7 | position, normal | Area denial |
| `item_pickup` | 8 | pickupId, who, position | Item timing |
| `weapon_drop` | 9 | weaponId, position, velocity | Pickup opportunity |
| `damage` | 10 | attacker, damage, weapon, position | React to threat |
| `death` | 11 | killer, weapon, position, knockback | Target eliminated |

### 13.3 Bot Connection Flow (Exact Protocol)

```
BotClient                          GameServer
   │                                    │
   │──── WebSocket connect ────────────►│
   │                                    │ handleConnect(conn)
   │◄──── (connection established) ─────│
   │                                    │
   │──── encodeJoin("BotName") ────────►│ handleJoin(conn, data)
   │                                    │   → creates ClientInfo (spectator)
   │◄──── encodeWelcome(serverInfo) ────│   → sendWelcome(client)
   │◄──── encodeJoinAccept(ids) ────────│   → sendJoinAccept(client)
   │                                    │
   │  [Bot stores clientId, playerId,   │
   │   entityId from JoinAccept]        │
   │                                    │
   │──── encodeJoinGame() ─────────────►│ handleJoinGame(conn)
   │                                    │   → createPlayerEntity()
   │                                    │   → gametypeController.onPlayerJoin()
   │◄──── encodeJoinAccept(ids) ────────│   → re-sends with entity confirmation
   │                                    │
   │  === GAME LOOP ===                 │
   │                                    │
   │◄──── encodeSnapshot(state) ────────│ tick() → broadcastSnapshot()
   │  [decode → BotBrain.decide()]      │
   │──── encodeCommand(input) ─────────►│ handleDatagram() → handleInput()
   │──── encodeAck(tick) ──────────────►│ handleDatagram() → update baseline
   │                                    │
   │  === DEATH ===                     │
   │                                    │
   │◄──── combat_state(dead=true) ──────│
   │  [wait 1-3 sec]                    │
   │──── encodeRequestSpawn() ─────────►│ handleRequestSpawn()
   │                                    │   → entity.input.wantsRespawn = true
   │                                    │   → gametype handles actual respawn
```

### 13.4 BSP Loading for BotVision

`loadBspCollision()` in `headless-netserver-v2.ts` is the reference implementation:

1. Finds BSP file (`.pk3` or `.bsp`) in `public/data/` paths
2. Parses via `BspLoader.load(buffer)` → `BspFile`
3. Creates collision via `createHeadlessCollisionWorld(bsp)` → `CollisionWorld`
4. Extracts spawn points + pickup items from BSP entities

**For BIS:** Extract `loadBspCollision()` into a shared module (e.g., `src/shared/bsp/BspDataLoader.ts`). BIS calls it on first bot connect to a map. Result is cached per map name.

### 13.5 Key Code Dependencies for BotClient

```
Bot needs to import:
  @engine/network/protocol/MessageCodec   ← encode/decode all messages
  @engine/network/protocol/BinaryProtocol ← encodeCommand, decodeSnapshot
  @engine/network/core/GameState          ← snapshot baseline management
  @engine/network/core/Entity             ← entity data access
  ws (npm)                                ← WebSocket client
  @babylonjs/core/Maths/math.vector       ← Vector3 for BSP raytracing
  jszip                                   ← PK3 extraction for BSP loading
```

> [!WARNING]
> The `@babylonjs/core` dependency is pulled in by `HeadlessBSPCollisionWorld` for `Vector3`. This is a large package. We should investigate whether we can replace it with a lightweight vec3 implementation for the BIS context.

---

## 14. Summary

The Bot Intelligence Server is a **separate Node.js process** that spawns **headless bot clients** connecting to game servers via the standard WebSocket protocol. Bots are indistinguishable from human players from the server's perspective.

**Phase 1** gives us functional bots using a state machine (fight/hunt/retreat) — no ML, just solid game logic.

**Phase 2** adds server-side demo recording, giving us the training data pipeline.

**Phase 3** introduces brain.js neural networks trained from demo data, making bots that can mimic human play styles.

The architecture is clean, modular, and builds on existing infrastructure (`headless-netclient`, `MessageCodec`, `LobbyServer` patterns). Each phase delivers standalone value.

**This is genuinely innovative for arena FPS games** — no other game engine we know of uses ML-trained bots that connect as real network clients and learn from recorded human gameplay.
