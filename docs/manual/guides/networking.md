# Networking System

SHAG Engine uses Q3-style server-authoritative multiplayer networking. If you've ever wondered why Quake felt so good over dial-up while modern games feel laggy over fiber—this is why.

---

## The Big Picture

```
┌─────────────────────┐                    ┌─────────────────────┐
│       CLIENT        │                    │       SERVER        │
│                     │                    │                     │
│  ┌───────────────┐  │     Commands       │  ┌───────────────┐  │
│  │  Local Input  │──┼───────────────────>│  │ Command Queue │  │
│  └───────────────┘  │                    │  └───────┬───────┘  │
│         │           │                    │          │          │
│         v           │                    │          v          │
│  ┌───────────────┐  │                    │  ┌───────────────┐  │
│  │  Prediction   │  │                    │  │  Simulation   │  │
│  │  (instant)    │  │                    │  │  (tick-based) │  │
│  └───────────────┘  │                    │  └───────┬───────┘  │
│         │           │                    │          │          │
│         v           │     Snapshots      │          v          │
│  ┌───────────────┐  │<───────────────────│  ┌───────────────┐  │
│  │ Reconciliation│  │                    │  │   Broadcast   │  │
│  └───────────────┘  │                    │  └───────────────┘  │
└─────────────────────┘                    └─────────────────────┘
```

**Key Principle:** The server is the source of truth. Clients predict locally for instant feedback, but server state always wins.

---

## Core Concepts

### 1. Tick-Based Simulation

The game runs in discrete time steps called **ticks**, not continuous real-time.

```
Tick 0    Tick 1    Tick 2    Tick 3    Tick 4
  │         │         │         │         │
  ├─ 50ms ──┼─ 50ms ──┼─ 50ms ──┼─ 50ms ──┤
  │         │         │         │         │
  Process   Process   Process   Process   Process
  commands  commands  commands  commands  commands
  Run       Run       Run       Run       Run
  physics   physics   physics   physics   physics
```

At 20Hz tick rate, each tick is 50ms. All game logic happens in ticks:
- Player inputs are processed at tick boundaries
- Physics runs once per tick
- State is broadcast after each tick

**Why ticks?** Determinism. Given the same inputs in the same order, the simulation produces identical results on every machine. This is essential for multiplayer.

### 2. Command Batching (Critical!)

Network packets arrive asynchronously. If we processed each command the moment it arrived, the simulation would be non-deterministic.

```
❌ WRONG: Process immediately

   Time ──────────────────────────────────>

   Player A's command arrives... process it
   Player B's command arrives... process it
   Player A's next command... process it

   Result: Order depends on network timing = different results on different machines
```

```
✅ RIGHT: Batch and process together

   Time ──────────────────────────────────>

   Commands arrive... queue them
   Commands arrive... queue them
   TICK! Process ALL queued commands together (sorted by player ID, then sequence)

   Result: Same order everywhere = identical simulation
```

**Implementation:**
```typescript
// Commands arrive asynchronously
handleCommand(command: Command): void {
  this.pendingCommands.push(command);  // Queue, don't process!
}

// Tick processes all queued commands
tick(): void {
  this.simulation.tick(this.pendingCommands);  // Process ALL together
  this.pendingCommands = [];                    // Clear for next tick
  this.broadcastSnapshot();                     // Send results to clients
}
```

### 3. tick() vs predict() — The Crucial Difference

The server and client both run the same simulation code, but they use it differently:

**Server uses `tick()`:**
- Processes commands
- Runs physics
- **Increments tick counter** (advances game time)

**Client uses `predict()`:**
- Processes commands (local input only)
- Runs physics
- **Does NOT increment tick counter**

Why the difference? Imagine you're running at 60fps with a 20Hz server:

```
Without the distinction:
  Server tick: 0, 1, 2, 3...
  Client tick: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9...  (racing ahead!)

With predict():
  Server tick: 0, 1, 2, 3...
  Client tick: synced from server snapshots
  Client prediction: runs physics for instant feedback, doesn't advance tick
```

**Implementation:**
```typescript
// Server
tick(commands: Command[]): void {
  this.processCommands(commands);
  this.runSystems();
  this.currentTick++;  // Advance game time
}

// Client
predict(commands: Command[]): void {
  this.processCommands(commands);
  this.runSystems();
  // Tick NOT incremented - server snapshots set the tick
}
```

### 4. Client Prediction

When you press W to move forward:

**Without prediction (bad):**
1. Press W
2. Send command to server (50ms)
3. Server processes, sends snapshot (50ms)
4. See movement (100ms later = laggy!)

**With prediction (good):**
1. Press W
2. Apply movement locally (instant!)
3. Send command to server (background)
4. Server confirms (or corrects) later

Prediction makes the game feel responsive even with network latency.

### 5. Reconciliation

Sometimes prediction is wrong. Maybe another player shot you, or you hit collision the server knew about but you didn't.

**Small error (< 0.5 units):** Ignore it, not noticeable

**Medium error (0.5-100 units):** Smooth correction
- Gradually drift toward server position over ~10 frames
- Player doesn't notice the correction

**Large error (> 100 units):** Snap immediately
- Probably a teleport, respawn, or major desync
- No point smoothing a 100-unit error

```typescript
const error = serverPos.subtract(localPos).length();

if (error < 0.5) {
  // Close enough, do nothing
} else if (error < 100) {
  // Smooth correction
  localPos = Vector3.Lerp(localPos, serverPos, 0.3);
} else {
  // Snap
  localPos = serverPos.clone();
}
```

### 6. The Grounded Flag (Don't Forget This!)

The server must tell clients whether the player is on the ground. Without it, the client doesn't know if jumping is allowed.

```
❌ Without grounded flag:
   - Server knows player landed
   - Client still thinks player is mid-air
   - Player presses jump... nothing happens
   - "This game is broken!"

✅ With grounded flag:
   - Server sends grounded=true in snapshot
   - Client knows player can jump
   - Jump works correctly
```

**Binary Protocol:**
```
Component flags:
  0x01 = position changed
  0x02 = velocity changed
  0x04 = grounded state changed  ← CRITICAL!
```

### 7. Delta Compression

Sending full state every tick wastes bandwidth. Delta compression sends only what changed:

```
Full state: 3 players × (position + velocity + grounded) = ~100 bytes
Delta state: Only player 2 moved = ~25 bytes

At 20Hz = 2KB/sec vs 500 bytes/sec
```

**How it works:**
1. Server tracks last acknowledged snapshot per client
2. Compare current state to acknowledged state
3. Only encode changed values
4. Client reconstructs full state from baseline + delta

---

## Server Architecture

```
GameServer
├── Room (game instance)
│   ├── Simulation (deterministic game logic)
│   ├── Clients (connected players)
│   ├── Command Queue (pending inputs)
│   └── Tick Loop (20Hz)
└── WebSocket Handler
```

### Room Lifecycle

```typescript
// Create room with game-specific simulation
const room = new Room('room-1', config, FPSSimulation, 16);

// Clients connect
room.addClient(clientId, transport);  // → WELCOME, JOIN_ACCEPT, SNAPSHOT

// Game runs
room.start(20);  // 20Hz tick rate

// Tick loop (every 50ms)
private tick(): void {
  this.currentTick++;
  this.simulation.tick(this.pendingCommands);  // All commands together
  this.pendingCommands = [];
  this.broadcastSnapshot();  // Send state to all clients
}
```

---

## Console Commands

### Server
```bash
# Start dedicated server
npm run net:server

# With options
npm run net:server -- --port 8080 --name "My Server" --map dm17 --max 8
```

### Client
```bash
# Connect
connect localhost:7777
connect ws://192.168.1.100:7777

# Status
network status

# Disconnect
disconnect
```

---

## Connection Handshake

```
Client                              Server
   │                                   │
   │──── WebSocket Connect ───────────>│
   │                                   │
   │<──── WELCOME ─────────────────────│  Server info (name, map, tick rate)
   │                                   │
   │──── JOIN ────────────────────────>│  Player name
   │                                   │
   │<──── JOIN_ACCEPT ─────────────────│  Client ID, Player ID, Entity ID
   │                                   │
   │<──── SNAPSHOT ────────────────────│  Initial game state
   │                                   │
   │──── INPUT ───────────────────────>│  (continuous)
   │<──── SNAPSHOT ────────────────────│  (20Hz)
   │                                   │
```

---

## Binary Protocol

All messages use binary encoding for efficiency:

### Server → Client (0x01-0x0F)

| Type | Code | Purpose |
|------|------|---------|
| Welcome | 0x01 | Server info on connect |
| JoinAccept | 0x02 | Player accepted, IDs assigned |
| JoinReject | 0x03 | Connection refused |
| Snapshot | 0x04 | Game state update |
| PlayerJoined | 0x05 | Another player connected |
| PlayerLeft | 0x06 | Another player disconnected |
| GameStart | 0x07 | Match started |
| Ack | 0x08 | Command acknowledged |

### Client → Server (0x81-0x8F)

| Type | Code | Purpose |
|------|------|---------|
| Join | 0x81 | Request to join game |
| Ready | 0x82 | Player ready to start |
| Input | 0x83 | Player command |
| Disconnect | 0x84 | Graceful disconnect |

### Snapshot Format

```
Header:
  tick (uint32) - Server tick number
  timestamp (uint32) - Server time (ms)

Entities:
  count (uint16)
  for each entity:
    id (string)
    flags (uint8)
      0x01 = position changed
      0x02 = velocity changed
      0x04 = grounded changed
    if 0x01: x, y, z (float32 × 3)
    if 0x02: vx, vy, vz (float32 × 3)
    if 0x04: grounded (uint8)

Players:
  count (uint16)
  for each player:
    id (string)
    flags (uint8)
    ... (entity ID, name, score)

Events:
  count (uint16)
  for each: type + JSON data
```

---

## Entity Interpolation

Remote players (not the local player) are interpolated between snapshots:

```
Snapshot at tick 100: Player B at (100, 0, 200)
Snapshot at tick 101: Player B at (105, 0, 200)

Render at 60fps between ticks:
  Frame 1: (100.0, 0, 200)
  Frame 2: (101.7, 0, 200)
  Frame 3: (103.3, 0, 200)
  Frame 4: (105.0, 0, 200)
```

The interpolation buffer stores recent snapshots and renders 2 ticks behind for smoothness. This adds 100ms visual latency for remote players but makes movement perfectly smooth.

---

## Testing

### Two-Client Test
```bash
# Terminal 1: Server
npm run net:server -- --map wdm7

# Terminal 2: Client 1
npm run net:client -- --name Alice

# Terminal 3: Client 2
npm run net:client -- --name Bob
```

### In-Game Test
1. Start server: `npm run net:server`
2. Start game: `npm run dev`
3. Open console: `~`
4. Connect: `connect localhost:7777`
5. Verify: `network status`

---

## Troubleshooting

### "Movement feels wrong"
- Check that grounded flag is being transmitted (0x04 in component flags)
- Verify command batching is working (all commands processed at tick boundary)
- Confirm client uses `predict()` not `tick()` for local prediction

### "Jumping doesn't work"
- The grounded flag must be transmitted in snapshots
- Client must read and apply grounded state from velocity component
- Server must set grounded=true when player touches ground

### "Players teleport/snap"
- Smooth correction threshold may be too low
- Check for large tick divergence between client and server
- Verify interpolation buffer has enough snapshots

### "High bandwidth usage"
- Enable delta compression (compare to baseline)
- Reduce tick rate if acceptable (20Hz → 10Hz)
- Check for unnecessary state being transmitted

---

## For AI Assistants

Key files to understand the networking system:

| File | Purpose |
|------|---------|
| `src/engine/network/core/Simulation.ts` | tick() vs predict() |
| `src/engine/network/server/Room.ts` | Command batching, tick loop |
| `src/engine/network/client/hosts/NetworkGameHost.ts` | Prediction, reconciliation |
| `src/engine/network/protocol/BinaryProtocol.ts` | Delta compression, grounded flag |
| `src/engine/network/client/InterpolationBuffer.ts` | Remote entity smoothing |

When debugging networking issues:
1. Check command batching first (commands queued, not processed immediately)
2. Verify grounded flag is transmitted and read
3. Confirm client uses predict() not tick()
4. Check reconciliation thresholds

---

## V2NetworkClient (FPS Games)

The `V2NetworkClient` provides Q3-style client prediction for FPS games:

```typescript
import { V2NetworkClient } from '@game/client/V2NetworkClient';

const v2Client = new V2NetworkClient(tickRate);

// On each frame
v2Client.update(deltaTime, inputState);

// Get predicted position for rendering
const pos = v2Client.getPosition();

// Check if we have valid server data
if (v2Client.hasValidPosition()) {
  // Safe to use position
}
```

### Features

- **125Hz client tick rate** with variable server tick rate
- **Input history** for replay during reconciliation
- **Smooth correction** for minor position errors
- **Snap correction** for major desyncs (respawn, teleport)

### Reconciliation Flow

```
1. Client records input with sequence number
2. Client predicts locally (instant feedback)
3. Server processes input, sends snapshot with ack'd sequence
4. Client compares: predicted position vs server position
5. If error > threshold:
   - Rewind to server position
   - Replay all unacknowledged inputs
   - Smoothly correct any remaining error
```

---

## Dedicated Server

Run a headless server without rendering:

```bash
# Start dedicated FPS server
npm run net:server -- --map wdm2 --port 7777

# Options
npm run net:server -- \
  --map wdm2 \
  --port 7777 \
  --name "My Server" \
  --max 16 \
  --tickrate 20
```

### Server Architecture

```
HeadlessNetServer
├── WebSocket Server (port 7777)
├── BSP Collision World (server-side)
├── FPS Movement Subsystem
├── Spawn Point Manager
└── ECS Game State
```

The server loads the BSP map for collision detection but does no rendering.

---

## See Also

- [Headless Mode](./headless-mode.md) — Dedicated server setup
- [Console System](./console-system.md) — Command registration
- [Movement System](./movement-system.md) — Physics that networking syncs
