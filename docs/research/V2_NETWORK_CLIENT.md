# V2 Network Client Architecture

> **Date:** 2026-02-01  
> **Status:** Design Phase  
> **Goal:** Clean network client for V2 server with proper Q3-style prediction

---

## Overview

The V2 network client is a dedicated client implementation designed specifically for the V2 server (`headless-netserver-v2.ts`). It replaces the current `NetworkGameHost` with clean Q3/Warsow-style prediction.

### Design Goals

1. **Full local prediction** - Instant movement response (0ms latency feel)
2. **Server authority** - Server is truth for all game events
3. **Q3-style reconciliation** - Reset to server state + replay unacked inputs
4. **Feature parity** - Support everything that works locally

---

## File Structure

```
src/games/fps/
├── client/                          ← NEW: V2 Network Client
│   ├── index.ts                     ← Exports
│   ├── V2NetworkClient.ts           ← Main client class
│   ├── InputHistory.ts              ← Stores inputs for replay
│   ├── Reconciler.ts                ← Q3-style reset + replay
│   └── ClientState.ts               ← Local player state
│
├── server/                          ← V2 Server (existing)
│   ├── systems/                     
│   │   ├── CharacterPhysicsSystem.ts
│   │   ├── ProjectileSystem.ts
│   │   ├── WeaponSystem.ts
│   │   └── CombatSystem.ts
│   └── ...
│
├── simulation/                      ← Local simulation (unchanged)
│   ├── FPSSimulation.ts
│   ├── FPSMovementProfile.ts
│   └── collision/
│
├── FPSGameManager.ts               ← MODIFY: Add V2 client mode
├── FPSPlayer.ts                    ← Keep as-is (rendering)
└── FPSController (in engine/)      ← Keep as-is (input capture)
```

---

## Integration Points

### What We Keep From Local Mode

| Component | Location | Use in V2 Client |
|-----------|----------|------------------|
| FPSController | engine/camera/controllers/ | Input capture, rendering |
| BSP loading | engine/loader/bsp/ | Map collision data |
| Console commands | engine/console/commands/ | `map`, `connect`, etc |
| Viewport effects | engine/viewport/ | Walk bob, speed FOV, etc |
| Weapon visuals | engine/weapon/ | First-person weapon models |
| Audio system | engine/audio/ | Sound playback |
| UI/HUD | (to integrate) | Health, ammo, crosshair |

### What V2 Client Replaces

| Old Component | New V2 Component | Reason |
|--------------|------------------|--------|
| NetworkGameHost | V2NetworkClient | Proper input replay |
| SmoothCorrection | Reconciler | Q3-style reset+replay |
| InterpolationBuffer | (keep) | Still needed for other players |

---

## V2NetworkClient Design

### Core Concept

```
┌─────────────────────────────────────────────────────────────┐
│                    V2NetworkClient                          │
│                                                             │
│  ┌──────────┐    ┌─────────────┐    ┌──────────────────┐  │
│  │ Input    │───→│ InputHistory│───→│ Reconciler       │  │
│  │ Handler  │    │ (seq nums)  │    │ (reset+replay)   │  │
│  └──────────┘    └─────────────┘    └──────────────────┘  │
│       │                                     ▲              │
│       ▼                                     │              │
│  ┌──────────┐    ┌─────────────┐            │              │
│  │ Physics  │───→│ Local State │────────────┘              │
│  │ Predict  │    │ (predicted) │                           │
│  └──────────┘    └─────────────┘                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Server Snapshot                      │   │
│  │  position, velocity, ackedInputSeq, other players   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Classes

#### V2NetworkClient.ts
```typescript
class V2NetworkClient {
  // State
  private localPlayer: PlayerState;
  private inputHistory: InputHistory;
  private physics: CharacterPhysics;  // Same as server
  
  // Server sync
  private lastAckedSeq: number = 0;
  private serverTick: number = 0;
  
  // On player input (called every frame from FPSController)
  onInput(input: PlayerInput): void {
    // 1. Store in history with sequence number
    const seq = this.inputHistory.add(input);
    
    // 2. Apply locally for instant feedback
    this.localPlayer = this.physics.simulate(this.localPlayer, input);
    
    // 3. Send to server
    this.transport.send(MessageCodec.encodeInput(seq, input));
  }
  
  // On server snapshot
  onSnapshot(snapshot: ServerSnapshot): void {
    // 1. Reset local player to server position
    this.localPlayer.position = snapshot.position;
    this.localPlayer.velocity = snapshot.velocity;
    
    // 2. Get unacked inputs
    const unacked = this.inputHistory.getAfter(snapshot.ackedInputSeq);
    
    // 3. Replay each input through physics
    for (const input of unacked) {
      this.localPlayer = this.physics.simulate(this.localPlayer, input);
    }
    
    // 4. Prune old inputs
    this.inputHistory.removeUpTo(snapshot.ackedInputSeq);
    this.lastAckedSeq = snapshot.ackedInputSeq;
  }
}
```

#### InputHistory.ts
```typescript
class InputHistory {
  private inputs: Map<number, PlayerInput> = new Map();
  private nextSeq: number = 0;
  
  add(input: PlayerInput): number {
    const seq = this.nextSeq++;
    this.inputs.set(seq, input);
    return seq;
  }
  
  getAfter(seq: number): PlayerInput[] {
    return [...this.inputs.entries()]
      .filter(([s]) => s > seq)
      .sort(([a], [b]) => a - b)
      .map(([, input]) => input);
  }
  
  removeUpTo(seq: number): void {
    for (const key of this.inputs.keys()) {
      if (key <= seq) this.inputs.delete(key);
    }
  }
}
```

---

## Server Protocol Requirements

### Current V2 Server Sends
- Position, velocity, grounded
- Entity/player mappings
- Tick number

### V2 Server Needs to Add
- **`ackedInputSeq`** per player in snapshots
  - Last input sequence number the server processed

### Server Modification (minimal)
```typescript
// In NextGenServer.toGameState() or broadcastSnapshot()
for (const client of this.clients.values()) {
  const entity = this.getPlayerEntity(client.playerId);
  // Include the last processed input sequence
  snapshot.ackedInputSeq = entity.input.sequence;
}
```

---

## FPSGameManager Integration

### New Mode: `initializeNetworkV2()`

```typescript
async initializeNetworkV2(url: string): Promise<void> {
  // Create V2 client
  this.v2Client = new V2NetworkClient({
    transport: await TransportFactory.create(url),
    physics: new CharacterPhysics(new BSPCollisionWorld()),
  });
  
  // Connect and get server info
  const serverInfo = await this.v2Client.connect(url);
  
  // Load map
  await this.loadMap(serverInfo.map);
  
  // Wire collision
  this.v2Client.setCollisionWorld(new BSPCollisionWorld());
  
  // Ready
  this.isRunning = true;
  this.isNetworkV2 = true;
}
```

---

## Feature Parity Checklist

| Feature | Local | V2 Client | Notes |
|---------|-------|-----------|-------|
| Movement (WASD) | ✅ | 🔲 | Core priority |
| Jumping | ✅ | 🔲 | Physics |
| Crouching | ✅ | 🔲 | Physics |
| Sprint | ✅ | 🔲 | Physics |
| Wall jump | ✅ | 🔲 | Physics |
| Ledge grab | ✅ | 🔲 | Physics |
| Mouse look | ✅ | 🔲 | Input |
| Weapon switch | ✅ | 🔲 | Server authority |
| Shooting | ✅ | 🔲 | Server authority |
| Damage/health | ✅ | 🔲 | Server authority |
| Death/respawn | ✅ | 🔲 | Server authority |
| Other players | N/A | 🔲 | Interpolation |
| Console commands | ✅ | ✅ | Keep existing |
| Map loading | ✅ | ✅ | Keep existing |
| Viewport effects | ✅ | 🔲 | Wire to predicted state |
| Walk bob | ✅ | 🔲 | Wire to velocity |
| Speed FOV | ✅ | 🔲 | Wire to speed |

---

## Implementation Order

### Phase 1: Basic Movement (MVP)
1. Create `src/games/fps/client/` folder
2. InputHistory.ts - Store inputs
3. V2NetworkClient.ts - Connect, send input, receive snapshots
4. Reconciler.ts - Reset + replay
5. Wire to FPSGameManager
6. Test with V2 server

### Phase 2: Full Features
7. Viewport effects integration
8. Weapon visuals
9. Other players rendering (interpolation)
10. Server authority events (damage, pickups)

### Phase 3: Polish
11. Delta compression
12. Lag compensation (hitscan)
13. Network stats UI

---

## Testing Strategy

### Unit Tests
- InputHistory: add/get/prune
- Reconciler: reset+replay matches expected

### Integration Tests
- Connect to V2 server
- Move and verify stable position
- Stress test: 1000 inputs, verify no desync

### Manual Tests
- Open browser, connect, move around
- Should feel identical to local (0ms latency on movement)
- Server position should converge smoothly
