# Networking Architecture Research

## Goal

Implement Q3/Warsow-style authoritative multiplayer server for SHAG Engine games. The server runs game code and serves all connected clients with synchronized game state.

## Reference: Quake 3 Network Model

The Q3 network model is the gold standard for fast-paced multiplayer games. Understanding it is essential.

### Core Concepts

1. **Authoritative Server** - Server is the single source of truth
2. **Client Prediction** - Client predicts local player movement immediately
3. **Snapshot System** - Server sends delta-compressed game state snapshots
4. **UDP Only** - No TCP, unreliable transport is preferred

### How It Works

```
Client                          Server
  |                               |
  |-- Input Commands (UDP) ------>|
  |                               |-- Simulate Game World
  |                               |-- Generate Snapshot
  |<---- Snapshot (delta) --------|
  |                               |
  |-- Predict locally             |
  |-- Interpolate other entities  |
  |-- Render                      |
```

### Key Techniques

| Technique | Purpose |
|-----------|---------|
| **Client Prediction** | Immediate response to input, reconcile with server |
| **Snapshot Interpolation** | Smooth rendering of other players (100ms behind) |
| **Delta Compression** | Only send changes from last acknowledged state |
| **Backwards Reconciliation** | Server rewinds time for hit detection |

### Why UDP?

> "In a fast paced environment any information that is not received on first transmission is not worth sending again because it will be too old anyway."

TCP's reliability guarantees cause head-of-line blocking - if one packet is delayed, everything behind it waits.

**Sources:**
- [Quake 3 Network Protocol](https://www.jfedor.org/quake3/)
- [Quake 3 Source Code Review: Network Model](https://fabiensanglard.net/quake3/network.php)
- [Quake 3 Networking Primer](https://www.ra.is/unlagged/network.html)
- [The Quake3 Networking Model](https://fabiensanglard.net/quake3/The%20Quake3%20Networking%20Mode.html)

---

## Reference: Warsow/Qfusion

Warsow is built on **Qfusion**, a cross-platform OpenGL engine derived from Quake 2. It uses the same authoritative server model.

- **License:** GPLv2 (code), mixed CC licenses (assets)
- **Language:** C++
- **Game Logic:** AngelScript (asprogs repository)
- **Repositories:** [github.com/Warsow](https://github.com/Warsow)

The fork **Warfork** is actively maintained and available on Steam.

---

## Browser Networking Options

### 1. WebSocket (TCP)

**Pros:**
- Simple API, well-supported
- Works everywhere
- Easy to implement

**Cons:**
- TCP only - head-of-line blocking
- Higher latency for fast-paced games
- Not suitable for 60+ tick rate shooters

**Best for:** Turn-based, slow-paced, casual multiplayer

### 2. WebRTC DataChannels (UDP-like)

**Pros:**
- Unreliable/unordered mode = UDP semantics
- Works in browsers
- Can also do reliable channels

**Cons:**
- Complex setup (STUN/TURN, SDP exchange)
- Requires signaling server
- NAT traversal complications

**Best for:** Fast-paced games requiring low latency

### 3. WebTransport (Emerging)

**Pros:**
- Built on QUIC/HTTP3
- Native unreliable datagrams
- Simpler than WebRTC
- Modern congestion control (BBRv1)

**Cons:**
- Limited browser support (Chrome, Edge)
- Newer, less battle-tested
- Requires HTTP/3 server

**Best for:** Future-proof low-latency games

---

## Framework Options

### 1. Colyseus (Recommended for MVP)

**Type:** Authoritative game server framework for Node.js

**Features:**
- Room-based matchmaking
- Automatic state synchronization
- Delta compression built-in
- TypeScript native
- SDKs for web, Unity, Godot, etc.

**Architecture:**
```typescript
// Server
class GameRoom extends Room<GameState> {
  onCreate() { this.setState(new GameState()); }
  onJoin(client) { /* add player */ }
  onMessage(client, message) { /* handle input */ }
  update(deltaTime) { /* simulate game */ }
}

// Client
const room = await client.joinOrCreate("game");
room.state.players.onAdd((player) => { /* render */ });
room.send("input", { keys: [...] });
```

**Pros:**
- Easiest to get started
- Great documentation
- Active community (6.4K GitHub stars)
- MIT license, free
- Handles rooms, matchmaking, reconnection

**Cons:**
- WebSocket only (TCP)
- Not ideal for 60+ tick shooters
- Less control over network layer

**Best for:** RPGs, strategy, casual action games

**Links:**
- [colyseus.io](https://colyseus.io/)
- [GitHub](https://github.com/colyseus/colyseus)
- [Documentation](https://docs.colyseus.io/)

### 2. geckos.io (Best for Fast-Paced)

**Type:** WebRTC-based UDP communication for Node.js

**Features:**
- True UDP-like unreliable messaging
- Client/server architecture (not P2P)
- Configurable reliability per message
- Works with any game framework

**Architecture:**
```typescript
// Server
const io = geckos();
io.onConnection(channel => {
  channel.onMessage(data => {
    // Handle input, broadcast state
  });
  channel.emit('snapshot', gameState, { reliable: false });
});

// Client
const channel = geckos({ port: 3000 });
channel.onConnect(() => {
  channel.emit('input', inputData);
});
channel.on('snapshot', (state) => { /* render */ });
```

**Pros:**
- Real UDP semantics in browser
- Lower latency than WebSocket
- Configurable reliable/unreliable per message
- Good for shooters, racing games

**Cons:**
- More complex setup (WebRTC)
- Need TURN server for some NAT situations
- Smaller community than Colyseus

**Best for:** Fast-paced action, FPS, racing

**Links:**
- [geckos.io](https://geckos.io/)
- [GitHub](https://github.com/geckosio/geckos.io)
- [Babylon.js Forum Discussion](https://forum.babylonjs.com/t/html5-multiplayer-games-over-udp-client-server-using-geckos-io/11436)

### 3. Lance (Alternative)

**Type:** Real-time multiplayer game server

**Features:**
- Physics synchronization
- Client prediction built-in
- Step-based simulation

**Pros:**
- Handles physics sync
- Good abstractions

**Cons:**
- Less active development
- Smaller community

### 4. Nakama (Feature-Rich)

**Type:** Full backend platform

**Features:**
- Realtime multiplayer
- Leaderboards, achievements
- User accounts, social
- Lua/Go/TypeScript runtimes

**Pros:**
- Complete backend solution
- Scales well
- Many built-in features

**Cons:**
- Requires Docker
- More complex deployment
- Overkill for simple games

---

## Proposed Architecture for SHAG Engine

### Phase 1: Colyseus MVP

Start with Colyseus for rapid prototyping:

```
┌─────────────────────────────────────────────────────────┐
│                    SHAG Game Server                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Colyseus Server (Node.js)           │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐         │    │
│  │  │ Room 1  │  │ Room 2  │  │ Room N  │         │    │
│  │  │ (Match) │  │ (Match) │  │ (Match) │         │    │
│  │  └─────────┘  └─────────┘  └─────────┘         │    │
│  │         │           │           │               │    │
│  │         └───────────┼───────────┘               │    │
│  │                     │                           │    │
│  │              Game Logic Layer                   │    │
│  │         (Shared with Client - TypeScript)       │    │
│  └─────────────────────┬───────────────────────────┘    │
│                        │ WebSocket                       │
└────────────────────────┼────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────┴────┐     ┌────┴────┐     ┌────┴────┐
   │ Client 1│     │ Client 2│     │ Client N│
   │ (SHAG)  │     │ (SHAG)  │     │ (SHAG)  │
   └─────────┘     └─────────┘     └─────────┘
```

### Phase 2: geckos.io for Fast-Paced

Upgrade to geckos.io for games requiring low latency:

```
┌─────────────────────────────────────────────────────────┐
│                    SHAG Game Server                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │              geckos.io Server (Node.js)          │    │
│  │                                                  │    │
│  │  ┌──────────────────────────────────────────┐   │    │
│  │  │           Game Simulation Loop            │   │    │
│  │  │  - Tick rate: 20-60 Hz                   │   │    │
│  │  │  - Input processing                       │   │    │
│  │  │  - Physics/collision                      │   │    │
│  │  │  - Snapshot generation                    │   │    │
│  │  └──────────────────────────────────────────┘   │    │
│  │                     │                           │    │
│  │         ┌───────────┴───────────┐              │    │
│  │   Reliable Channel      Unreliable Channel     │    │
│  │   (chat, events)        (snapshots, input)     │    │
│  └─────────────────────────────────────────────────┘    │
│                        │ WebRTC                          │
└────────────────────────┼────────────────────────────────┘
                         │
              Signaling Server (WebSocket)
```

### Shared Game Code

Key insight: **Share game logic between client and server**

```
src/
├── engine/              # SHAG Engine (client-only)
├── games/
│   └── default/
│       ├── shared/      # Shared between client & server
│       │   ├── GameState.ts
│       │   ├── PlayerInput.ts
│       │   ├── Physics.ts
│       │   └── GameRules.ts
│       ├── client/      # Client-only (rendering, UI)
│       │   └── GameScene.ts
│       └── server/      # Server-only (authoritative)
│           └── GameRoom.ts
└── server/              # Dedicated server entry point
    └── index.ts
```

### Network Message Types

```typescript
// Client → Server
interface InputMessage {
  seq: number;           // Sequence for reconciliation
  tick: number;          // Client tick
  keys: number;          // Bitmask of pressed keys
  viewAngles: [number, number];  // Pitch, yaw
  buttons: number;       // Fire, jump, etc.
}

// Server → Client
interface SnapshotMessage {
  tick: number;          // Server tick
  ack: number;           // Last received input seq
  players: PlayerState[];
  entities: EntityState[];
  events: GameEvent[];   // Sounds, effects, etc.
}
```

---

## Implementation Roadmap

### Phase 1: Research & Prototype (Current)
- [x] Research Q3 network model
- [x] Evaluate framework options
- [ ] Build minimal Colyseus prototype
- [ ] Test with simple movement sync

### Phase 2: Core Networking
- [ ] Implement shared game state schema
- [ ] Client prediction for local player
- [ ] Snapshot interpolation for remote players
- [ ] Input buffering and timing

### Phase 3: Game Integration
- [ ] Integrate with existing SHAG game loop
- [ ] Network-aware entity system
- [ ] Replicated physics (if needed)
- [ ] Chat and events

### Phase 4: Production Features
- [ ] Reconnection handling
- [ ] Lag compensation (backwards reconciliation)
- [ ] Matchmaking
- [ ] Server browser / lobby

### Phase 5: Optimization
- [ ] Delta compression
- [ ] Bandwidth throttling
- [ ] Upgrade to geckos.io if needed
- [ ] Consider WebTransport when mature

---

## Key Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Initial Framework | Colyseus | Fastest to prototype, great TypeScript support |
| Transport | WebSocket first | Simpler, works everywhere, upgrade later if needed |
| Tick Rate | 20 Hz server, 60 Hz client | Balance between responsiveness and bandwidth |
| State Sync | Automatic (Colyseus) | Reduces boilerplate, handles delta compression |
| Game Logic Location | Shared TypeScript | Same code runs on client (prediction) and server (authority) |

---

## Resources

### Documentation
- [Colyseus Docs](https://docs.colyseus.io/)
- [geckos.io GitHub](https://github.com/geckosio/geckos.io)
- [Snapshot Interpolation](https://snapnet.dev/blog/netcode-architectures-part-3-snapshot-interpolation/)

### Q3 Network Model
- [Quake 3 Network Protocol](https://www.jfedor.org/quake3/)
- [Fabien Sanglard's Q3 Analysis](https://fabiensanglard.net/quake3/network.php)
- [Unlagged Network Primer](https://www.ra.is/unlagged/network.html)

### Source Code
- [Warsow/Qfusion](https://github.com/Warsow/qfusion) - GPLv2
- [Quakemonkey](https://github.com/benruijl/quakemonkey) - Q3 netcode for jMonkey
