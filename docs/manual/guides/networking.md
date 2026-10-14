# Networking System

SHAG Engine uses Q3-style server-authoritative multiplayer networking. If you've ever wondered why Quake felt so good over dial-up while modern games feel laggy over fiber—this is why.

---

## The Big Picture

```
┌─────────────────────────┐                    ┌─────────────────────────┐
│         CLIENT          │                    │         SERVER          │
│                         │                    │                         │
│  ┌─────────────────┐    │     Commands       │  ┌─────────────────┐    │
│  │  Local Input     │───┼───────────────────>│  │ Command Queue   │    │
│  └─────────────────┘    │     (125Hz)        │  └───────┬─────────┘    │
│         │               │                    │          │              │
│         v               │                    │          v              │
│  ┌─────────────────┐    │                    │  ┌─────────────────┐    │
│  │  Prediction      │   │                    │  │  Simulation     │    │
│  │  (instant)       │   │                    │  │  (125Hz ticks)  │    │
│  └─────────────────┘    │                    │  └───────┬─────────┘    │
│         │               │     Snapshots      │          │              │
│         v               │     (60Hz)         │          v              │
│  ┌─────────────────┐    │<───────────────────│  ┌─────────────────┐    │
│  │ Reconciliation   │   │                    │  │   Broadcast     │    │
│  └─────────────────┘    │                    │  └─────────────────┘    │
└─────────────────────────┘                    └─────────────────────────┘
```

**Key Principle:** The server is the source of truth. Clients predict locally for instant feedback, but server state always wins.

---

## Core Concepts

### Slow readers and diagnostics

The game server caps each WebSocket's queued output at approximately 8 MiB. A
reader that falls behind that limit is disconnected instead of receiving an
ever-growing backlog of stale snapshots. Admitted clients use the existing
session-resume path; healthy connections keep receiving broadcasts. This is a
resource bound, not a change to snapshot delta encoding or gameplay simulation.

`cl_netgraph` labels snapshot gaps as **gaps**, an estimate rather than a wire
packet-loss measurement. It learns cadence from recent arrivals and clears its
history on reconnect/resume. Welcome currently sends the simulation tick rate,
not the snapshot rate, so consistently missing every other snapshot remains
ambiguous. The overlay paints at 10 Hz and resizes only when dimensions change.

### Supported network timing

The FPS browser client supports **125Hz simulation (8ms steps)**. Input sampling
and prediction use the same rate. `initializeNetwork` rejects other client rate
settings, and `NetworkGameHost` checks the server's Welcome before map loading,
seat acceptance or snapshot delivery. A mismatch rejects the connection with an
error naming the advertised and required rates; resumed connections are checked
again. Early snapshot datagrams are discarded until the handshake completes.

Server timing experiments at other integer rates remain available, but a 60Hz
or 250Hz server cannot be joined by this FPS client. Welcome represents tick rate
as one byte, so server configuration is limited to 1–255Hz. Arbitrary-rate FPS
prediction requires further work on tick-based gameplay constants.

### 1. Tick-Based Simulation

The game runs in discrete time steps called **ticks**, not continuous real-time.

```
Tick 0    Tick 1    Tick 2    Tick 3    Tick 4
  │         │         │         │         │
  ├─ 8ms ───┼─ 8ms ───┼─ 8ms ───┼─ 8ms ───┤
  │         │         │         │         │
  Process   Process   Process   Process   Process
  commands  commands  commands  commands  commands
  Run       Run       Run       Run       Run
  physics   physics   physics   physics   physics
```

At **125Hz** tick rate, each tick is **8ms**. All game logic happens in ticks:

- Player inputs are processed at tick boundaries
- Physics runs once per tick
- Snapshots broadcast every 2nd tick (**60Hz**)

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

Why the difference? Imagine you're running at 60fps with a 125Hz server:

```
Without the distinction:
  Server tick: 0, 1, 2, 3...
  Client tick: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9...  (racing ahead!)

With predict():
  Server tick: synced via snapshots
  Client prediction: runs physics for instant feedback, doesn't advance tick
```

### 3b. Fixed-Rate Authoritative Physics

The server advances each player's physics **exactly one `dt` per server tick**, regardless of how fast that client sends input:

- It consumes **at most one** buffered command per tick (FIFO, in sequence order) and **repeats the last input** when none arrived (so gravity and momentum still advance).
- The input buffer is capped, so a fast/flooding client can't bank extra physics steps.
- It acks the last **simulated** sequence (`input.lastProcessedSeq`), not the last received, so reconciliation replays exactly the un-simulated inputs.

This closes an authority hole where a slow, laggy, throttled, or malicious client that halved its command rate would get *reduced* gravity and speed ("moon jump"). Input *content* still matters; input *rate* cannot change the physics.

Movement effect timers (slide, wall-jump charge, ledge grab, crouch view) are all derived from an **absolute sim clock** (`sequence × dt`), so reconciliation replays recompute identical timelines instead of double-advancing — replay-idempotent by construction.

### 3c. Input Sanitizer

Every usercmd is clamped at a single ingest choke point (`InputSanitizer`): reject non-finite direction/pitch/yaw, clamp look pitch to ±90°, wrap yaw, unit-clamp the wish direction, bound the weapon slot. The **same** clamp runs in client prediction, so predicted and simulated states can't diverge at steep pitch. A frozen/silent client also stops firing and jumping after a short grace (its repeated input has action buttons stripped).

Detection telemetry (uplink jitter/loss, view-flick histograms, accuracy/headshot, impossible-input counters) sits on top of this and is **strictly log-only** — it produces signals, never verdicts, until calibrated. The simulation is RNG-deterministic, enabling tamper-evident demo re-simulation (`demo:verify`).

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

### 5. Reconciliation (Input Replay + Visual Smoothing)

Sometimes prediction is wrong. Maybe another player shot you, or collision differed slightly on the server.

**How it works:**

1. Server sends snapshot with `ackedInputSeq` — the last input it processed
2. Client rewinds to server state (position, velocity, grounded)
3. Client replays all **unacknowledged inputs** from `ackedInputSeq` forward
4. Result: predicted position that accounts for server corrections

**Visual smoothing:** The difference between the pre- and post-reconciliation positions is stored as a `visualOffset`, which decays over ~50ms. This prevents camera jitter from minor corrections.

```typescript
// After reconciliation:
const correction = preReconcilePos - postReconcilePos;

if (correctionMagnitude > 50) {
  // Large correction (KB, teleport, respawn) → snap immediately
  visualOffset = { x: 0, y: 0, z: 0 };
} else {
  // Small correction → smooth it over time
  visualOffset += correction;
}

// Each frame: decay toward zero
visualOffset *= (1 - dt * 20);  // ~50ms settle time
```

**Grounded state protection:** When no inputs need replay (`unacked=0`), the client preserves its local grounded state instead of adopting the server's, which can be stale. This prevents animation glitches (walk bob restarts) from reconciliation.

### 6. Delta Compression

Sending full state every snapshot wastes bandwidth. Delta compression sends only what changed:

```
Full snapshot: all entities × (position + velocity + grounded) = ~200 bytes
Delta snapshot: only changed entities = ~40 bytes
```

**How it works:**

1. The server keeps the last 64 snapshots it sent each client
2. Each client acknowledges received snapshots via `Ack` messages
3. The server picks that client's last acked snapshot as the **baseline**
4. Only values that changed since the baseline are encoded
5. The snapshot **names** the baseline it used, and the client keeps its last
   128 snapshots to decode against. A client that no longer holds the named
   baseline cannot silently decode against the wrong one

### 7. ClockSync

Remote entity interpolation needs accurate time. `ClockSync` provides NTP-like synchronization:

1. **Burst sampling** — 5 Ping/Pong round-trips on connect
2. **Offset calculation** — `serverTime = localTime + offset`
3. **Outlier rejection** — Discard pings with abnormal RTT
4. **Periodic resync** — Every 30 seconds to correct clock drift

The `SnapshotBuffer` uses server-authoritative timestamps (converted to local time via ClockSync) for interpolation, eliminating jitter from network delay variation.

### 8. SnapshotBuffer & Entity Interpolation

Remote players (not the local player) are interpolated between snapshots using `SnapshotBuffer`:

```
Snapshot at t=100ms: Player B at (100, 0, 200)
Snapshot at t=116ms: Player B at (105, 0, 200)

Render at 60fps between snapshots:
  Frame 1: (100.0, 0, 200)
  Frame 2: (101.7, 0, 200)
  Frame 3: (103.3, 0, 200)
  Frame 4: (105.0, 0, 200)
```

**Features:**

- **Auto-adjusting interp delay** — Based on snapshot arrival jitter (1× stddev), clamped to 16-150ms
- **Velocity-based extrapolation** — On packet loss, extrapolate using last known velocity
- **`cl_interp` CVar** — Manual interpolation delay (0 = auto-adjust)
- **`cl_timenudge` CVar** — Render time offset for competitive advantage

Default interpolation delay: **~50ms** (down from 100ms in earlier versions).

### 9. Server-Authoritative Projectiles

Projectiles (rockets, grenades, plasma) are server-authoritative:

1. Client sends fire input → server creates projectile entity
2. Projectile included in snapshots as `proj_` entities with position + velocity
3. Client renders projectiles by interpolating `proj_` entities via `SnapshotBuffer`
4. Server handles all collision detection and damage
5. `projectile_spawn` event tells client which weapon model/trail to render

**Client-predicted explosions:** For responsiveness, the client shows explosions immediately on local impact. Server events are deduplicated via position + defId matching.

### 10. Knockback System

Server-side knockback, replicated as state:

1. **Server:** Damage dealt → knockback impulse queued on victim
2. **Server:** Impulse applied as velocity change before next movement simulation
3. **Server:** Air drag steps the impulse's age once per tick; a landing or the end of the drag window ends it
4. **Snapshot:** The impulse travels as velocity. Its owner alone also receives `knockback_state` — the drag age after that tick, or null when inactive
5. **Client:** Reconciliation adopts the age with position and velocity, and every predicted or replayed step advances it through the same `applyKnockbackDrag` the server runs. The client never predicts an impulse itself

Splash damage uses radius-based falloff with configurable `splashRadius`, `splashDamage`, and `knockbackScale` per weapon.

### 11. Lag Compensation (Hit Registration)

A shot is judged against the world the shooter actually saw, not the world as
it is when the packet lands. The server keeps a short history of player and
mover positions and rewinds to the view that client had:

1. The client reports the tick its input belongs to — the same tick it was
   already sending for reconciliation.
2. `LagCompensation.rewind()` converts that, or the client's ping, into a
   target tick within the rewind budget, and returns the world at that tick —
   the bodies being aimed at, and the movers that were or were not in the way.
3. The hit is resolved against that view, then the present state is restored.

The budget is `maxCompensationMs`, **100 ms**, for every server. Raising it
favours the shooter, lowering it favours the target being shot at behind their
own corner; there is no value that is fair to both, so it is one deliberate
number rather than a per-match setting. A shot older than the budget gets the
oldest view the budget allows rather than the present one. A server running at
a different tick rate must override `tickRate` in the same config, because the
ms-per-tick conversion depends on it.

`src/engine/server/lagcomp/` owns this; `npm run net:viewlag` measures the lag
a server actually observes over a real socket.

---

### 12. Anti-Warp (MovementValidator)

Server-side protection against speed hacking via input flooding:

- **Rate cap** — Max inputs per tick prevents flooding
- **Time budget** — Accumulated delta-time prevents time manipulation
- **Silent drops** — Rejected inputs silently dropped (no disconnect)
- **Strike counter** — Tracks violations for server-side monitoring

---

## Server Architecture

```
GameServer
├── WebSocket Server (port 7777)
├── BSP Collision World (server-side)
├── ECS Game State
├── Systems
│   ├── FPSMovementSubsystem (125Hz physics)
│   ├── ProjectileSystem (server-auth projectiles)
│   ├── CombatSystem (damage, knockback)
│   ├── WeaponSystem (fire, ammo, switching)
│   ├── DroppedWeaponSystem (death drops, pickup)
│   ├── PickupSystem (item spawns, respawn timers)
│   └── MovementValidator (anti-warp)
├── GametypeController (deathmatch rules, spawns)
└── Tick Loop (125Hz, snapshots every 2nd tick = 60Hz)
```

---

## Console Commands

### Server

```bash
# Start dedicated server
npm run net:server -- --map wdm2

# With options
npm run net:server -- --port 8080 --name "My Server" --map wdm2 --max 8

# Custom snapshot rate
npm run net:server -- --map wdm2 --snapshotrate 30
```

### Client

```bash
# Connect
connect localhost:7777
connect ws://192.168.1.100:7777

# Status: the NetGraph overlay is the status readout
cl_netgraph 1

# Disconnect
disconnect

# NetGraph (Q3-style diagnostics overlay)
cl_netgraph 0         # Off
cl_netgraph 1         # Text stats
cl_netgraph 2         # Text + rolling graph

# Interpolation tuning
cl_interp 0           # Auto-adjust (default)
cl_interp 50          # Fixed 50ms delay
cl_timenudge -20      # Render 20ms ahead (competitive)
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
   │<──── SNAPSHOT ────────────────────│  Initial game state (full, no delta)
   │                                   │
   │<──── Ping ────────────────────────│  ClockSync burst (×5)
   │──── Pong ────────────────────────>│
   │                                   │
   │──── INPUT ───────────────────────>│  (continuous, 125Hz)
   │<──── SNAPSHOT ────────────────────│  (60Hz, delta-compressed)
   │──── ACK ─────────────────────────>│  (acknowledges snapshots)
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
| LegacySnapshot | 0x04 | Pre-baseline snapshot envelope. It never said which state it was deltaed against, so it is unsafe to decode on the live network and is kept only for reading old data |
| PlayerJoined | 0x05 | Another player connected |
| PlayerLeft | 0x06 | Another player disconnected |
| GameStart | 0x07 | Match started |
| Ack | 0x08 | Command acknowledged |
| ServerMessage | 0x09 | Server → client text: a queue position, a rejection, an informational line |
| Pong | 0x0A | ClockSync pong (server → client) |
| Snapshot | 0x0B | Game state update, delta-compressed against a **named** baseline |
| ResumeToken | 0x0C | The token a dropped client presents to take its seat back |

### Client → Server (0x81-0x8F)

| Type | Code | Purpose |
|------|------|---------|
| Join | 0x81 | Request to join game |
| Ready | 0x82 | Player ready to start |
| Input | 0x83 | Player command (with sequence #) |
| Disconnect | 0x84 | Graceful disconnect |
| Ping | 0x85 | ClockSync ping (server replies Pong) |
| JoinGame | 0x86 | Spectator → player |
| Spectate | 0x87 | Player → spectator |
| RequestSpawn | 0x88 | Dead player requests respawn |
| Chat | 0x89 | In-game chat text (server sanitizes + rate-limits, rebroadcasts as a `chat` snapshot event) |
| SetLoadout | 0x8A | The kit chosen for the next round, in the modes that ask |
| Resume | 0x8B | A reconnecting client claiming the session it was dropped from |

Snapshot one-shot events include `weapon_fire`, `projectile_spawn` / `projectile_impact`, `damage`, `death`, `award`, `weapon_chain`, and `chat` — all carried in the events section and captured verbatim into demo recordings (the snapshot is built once and shared by the broadcaster and recorder).

### Snapshot Format

```
Envelope (MessageCodec):
  hasBaseline (uint8)  - 1 when this snapshot is a delta, 0 when it is complete
  baselineTick (uint32) - Which snapshot it was deltaed against; 0 when complete

Header:
  tick (uint32) - Server tick number
  timestamp (float64) - Server time (ms, for ClockSync interpolation)
  ackedInputSeq (uint32) - Last processed input sequence

Entities:
  count (uint16)
  for each entity:
    id (string)
    flags (uint8)
      0x01 = position changed
      0x02 = velocity changed
      0x04 = grounded changed
      0x08 = rotation changed (yaw/pitch)
      0x10 = movement state (every snapshot for a player)
      0x20 = weaponMeta (item entities)
      0x40 = powerup mask (every snapshot)
    if 0x01: x, y, z (float32 × 3)
    if 0x02: vx, vy, vz (float32 × 3)
    if 0x04: grounded (uint8)
    if 0x08: yaw, pitch (float32 × 2)
    if 0x10: movement (uint8: bit 0 crouching, 1 sliding, 2 wall-jumping,
             7 view follows); if bit 7, the player's view (4 bytes):
               keys (uint8: bits 0-1 strafe, 2-3 forward; 0 none,
                     1 right/forward, 2 left/back)
               slidePhase, ledgeGrabPhase (uint8 each, 0-255 for 0-1)
               crouchViewOffset (int8, quarter units)
             What a watcher needs to rebuild that player's screen: the
             strafe lean, the slide dip and ledge lift, the crouch eye.
    if 0x20: weaponId (string), settled (uint8)
    if 0x40: powerup mask (uint8)

Players:
  count (uint16)
  for each player:
    id (string)
    flags (uint8)
    ... (entity ID, name, score, deaths, ping)

Events:
  count (uint16)
  for each: type (uint8) + payload
    Types: projectile_spawn, damage, death, combat_state, ...
```

The envelope is what makes a delta safe to apply: a client that no longer holds
the named baseline asks for a complete snapshot instead of decoding against the
wrong state. A decoder refuses a header that claims no baseline while naming a
tick, or vice versa.

---

## V2NetworkClient (FPS Games)

The `V2NetworkClient` provides Q3-style client prediction for FPS games:

```typescript
import { V2NetworkClient } from '@game/client/V2NetworkClient';

const v2Client = new V2NetworkClient(tickRate);

// On each frame
v2Client.update(deltaTime, inputState);

// Get predicted position for rendering (with visual smoothing)
const pos = v2Client.getVisualPosition();

// Get raw predicted position (without smoothing)
const rawPos = v2Client.getPosition();

// Check if we have valid server data
if (v2Client.hasValidPosition()) {
  // Safe to use position
}

// Get predicted movement state for visual effects
const ms = v2Client.getMovementState();
// { isSliding, isCrouching, crouchViewOffset, wallJumpState,
//   ledgeGrabState, actualHorizSpeed, slidePhase, ledgeGrabPhase }
```

### Features

- **125Hz client tick rate** with 60Hz server snapshot rate
- **Input history** for replay during reconciliation
- **Visual offset smoothing** (absorbs corrections over ~50ms)
- **Snap correction** for major desyncs (respawn, teleport, knockback > 50 units)
- **Grounded state protection** when no inputs need replay
- **Predicted movement state** for visual effects (crouchslide, wall jump, ledge grab)
- **Client-side knockback prediction** for instant self-damage feedback

### Reconciliation Flow

```
1. Client records input with sequence number
2. Client predicts locally (instant feedback)
3. Server processes input, sends snapshot with ackedInputSeq
4. Client finds unacknowledged inputs (seq > ackedInputSeq)
5. Client resets to server position/velocity/grounded
6. Client replays all unacked inputs through physics
7. Compute visual offset = (pre-reconcile pos) - (post-reconcile pos)
8. Decay visual offset over ~50ms for smooth camera
```

---

## NetGraph Overlay

Quake 3 / Source-style network diagnostics:

```
cl_netgraph 0         # Off
cl_netgraph 1         # Text-only stats
cl_netgraph 2         # Text + rolling history graph
```

**Displayed metrics (7 total):**

| Metric | Description |
|--------|-------------|
| Ping | Round-trip time to server |
| Snapshot Rate | Snapshots received per second |
| Packet Loss % | Estimated from tick gaps |
| Interp Delay | Current interpolation buffer delay |
| Command Rate | Inputs sent per second |
| Reconciliation | Reconciliation events per second |
| Clock Offset | ClockSync time offset to server |

---

## HUD Data Layer

Server sends gameplay data to clients via snapshot events:

| Event | Data | Recipient |
|-------|------|-----------|
| `combat_state` | Health, armor | Owner only (private) |
| `damage` | Amount, attacker, weapon | Victim |
| `death` | Victim, attacker, weapon | All clients |
| `projectile_spawn` | Entity ID, weapon def | All clients |

**Client-side:** `HUDState` singleton aggregates all events into a queryable state object (health, armor, scoreboard, kill feed, damage numbers).

---

## Testing

### Two-Client Test

```bash
# Terminal 1: Server
npm run net:server -- --map wdm2

# Terminal 2: Client 1 (browser)
npm run dev
# Console: connect localhost:7777

# Terminal 3: Client 2 (headless)
npm run net:client -- --name Bob
```

### In-Game Test

1. Start server: `npm run net:server -- --map wdm2`
2. Start game: `npm run dev`
3. Open console: `~`
4. Connect: `connect localhost:7777`
5. Verify with the NetGraph: `cl_netgraph 2`

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

- Check visual offset smoothing is working (`getVisualPosition()` not `getPosition()`)
- Verify reconciliation isn't replaying too many inputs (max 32 cap)
- Check for large knockback events (> 50 units triggers snap)

### "High bandwidth usage"

- Delta compression should be active (client sends Ack messages)
- Check snapshot rate: `--snapshotrate 30` for lower bandwidth
- Verify SnapshotBuffer isn't accumulating stale entries

### "Jittery remote players"

- Check `cl_netgraph 2` for packet loss %
- Increase `cl_interp` for smoother interpolation (trade-off: more visual latency)
- Verify ClockSync is active (clock offset should be stable)

---

## For AI Assistants

Key files to understand the networking system:

| File | Purpose |
|------|---------|
| `src/games/fps/client/V2NetworkClient.ts` | Client prediction, reconciliation, visual smoothing |
| `src/games/fps/Game.ts` | Game loop: processSnapshots → input → tick |
| `src/games/fps/server/GameServer.ts` | Server tick loop, snapshot broadcast, delta compression |
| `src/engine/network/client/SnapshotBuffer.ts` | Time-based interpolation for remote entities |
| `src/engine/network/client/ClockSync.ts` | NTP-like time synchronization |
| `src/games/fps/client/RemotePlayerRenderer.ts` | Remote player interpolation rendering |
| `src/games/fps/server/systems/CombatSystem.ts` | Damage, knockback, splash damage |
| `src/games/fps/server/systems/WeaponSystem.ts` | Server-side weapon logic |

When debugging networking issues:

1. Check `cl_netgraph 2` for connection quality
2. Look at reconciliation warnings in console (`GROUNDED FLIP`, `SPEED CHANGE`)
3. Verify snapshot rate matches expectations (60Hz default)
4. Check ClockSync offset stability

---

## See Also

- [Headless Mode](./headless-mode.md) — Dedicated server setup
- [Console System](./console-system.md) — Command registration
- [Movement System](./movement-system.md) — Physics that networking syncs
- [Weapon System](./weapon-system.md) — Server-authoritative weapons
