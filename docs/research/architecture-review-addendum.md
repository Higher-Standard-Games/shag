# Critical Review Addendum: Solutions & Decisions

> **Date:** 2026-01-31  
> **Status:** Addressing peer review concerns

---

## 1. Memory Efficiency: Copy-on-Write Architecture

### The Problem
Full cloning every tick with hundreds of entities = massive GC pressure.

### Solutions Compared

| Approach | How It Works | Pros | Cons |
|----------|--------------|------|------|
| **Full Clone** | Deep copy entire state | Simple, safe | O(n) memory per tick, GC pressure |
| **Object Pooling** | Pre-allocate, reuse objects | Avoids allocations | Complex lifecycle, still clones data |
| **Copy-on-Write (COW)** | Share unchanged, clone only modified | O(modified) per tick | More complex implementation |

### Recommendation: Copy-on-Write (COW)

**How COW works for game state:**

```typescript
/**
 * COW State: Only clone entities that actually changed
 */
class WorldState {
  readonly tick: number;
  private entities: Map<EntityId, Entity>;
  private modified: Set<EntityId> = new Set();
  
  /**
   * Get entity for reading (returns shared reference)
   */
  getEntity(id: EntityId): Readonly<Entity> | undefined {
    return this.entities.get(id);
  }
  
  /**
   * Get entity for writing (clones on first write)
   */
  getEntityMut(id: EntityId): Entity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;
    
    // First write? Clone it
    if (!this.modified.has(id)) {
      const cloned = entity.clone();
      this.entities.set(id, cloned);
      this.modified.add(id);
      return cloned;
    }
    
    // Already cloned this tick
    return entity;
  }
  
  /**
   * Advance to next tick - COW reset
   * Unchanged entities are still shared with previous state
   */
  nextTick(): WorldState {
    const next = new WorldState();
    next.tick = this.tick + 1;
    
    // Share the entities map (COW - will clone on write)
    next.entities = new Map(this.entities);
    next.modified = new Set();
    
    return next;
  }
}
```

**Memory usage comparison (100 entities, 10% modified per tick):**

| Approach | Clones/tick | Memory growth |
|----------|-------------|---------------|
| Full Clone | 100 entities | 100 × entity_size |
| COW | 10 entities | 10 × entity_size |

**For RTS with 500 units, 5% moving:**
- Full clone: 500 objects/tick = 62,500/sec at 125Hz
- COW: 25 objects/tick = 3,125/sec at 125Hz (20x improvement!)

### Implementation Notes

1. **Entities must be immutable by default** - use `readonly` properties
2. **getMut() is the only way to modify** - enforces COW discipline
3. **TypeScript can help** - return `Readonly<Entity>` from get()
4. **Benchmark needed** - Map spread `new Map(oldMap)` cost with 500 entries

---

## 2. Multi-Rate Event Timing: Best-Case Optimization

### Philosophy Change
Instead of "what if systems conflict?" → **"How can subsystem independence optimize our game?"**

### When Systems Share Events - Design Patterns

**Pattern A: Producer-Consumer (Most Common)**
```
Physics (125Hz) → produces positions
Combat (60Hz)  → consumes positions for hit detection
```
Consumer always sees latest state. No synchronization needed!

**Pattern B: Event Queue with Batching**
```
Input (125Hz)  → produces "fire weapon" events
Combat (60Hz)  → processes batch of events each tick
```
Events accumulate, processed in next combat tick. Slight delay (max 16ms) is acceptable.

**Pattern C: Critical Events (Rare)**
```
Player death → must sync animation, sound, respawn timer
```
Use explicit synchronization point or run at physics rate.

### Best-Case Examples

```typescript
// RTS: Heavy AI at 10Hz, pathfinding at 10Hz
// Units don't need 125Hz - they're not dodging bullets!
const RTS_OPTIMAL: TickConfig = {
  input: 60,        // Selection feels responsive
  physics: 30,      // Unit movement
  unitAI: 10,       // Per-unit decisions
  strategicAI: 2,   // Base building, threat assessment
  economy: 4,       // Resource ticks
  network: 20,      // Sufficient for RTS
};
// Result: CPU headroom for 500+ units!

// FPS: Twitch response needed
const FPS_OPTIMAL: TickConfig = {
  input: 125,       // Critical for aim
  physics: 125,     // Movement, projectiles
  combat: 125,      // Hitscan weapons need high freq
  ai: 30,           // Bots don't need twitch timing
  network: 60,      // 60 snapshots/sec is plenty
};
```

### Game Developer Responsibility
Document that:
- Systems should be **self-contained** for their tick rate
- If a system NEEDS another's data, read latest state (not events)
- Critical cross-system events are rare and should be documented

---

## 3. Cross-Platform Determinism: Pragmatic Approach

### Context: Our Platform Stack

| Environment | JS Engine | Float Behavior |
|-------------|-----------|----------------|
| Browser | V8 (Chrome) | IEEE 754 |
| Electron | V8 (Chrome) | Same as browser |
| Capacitor (iOS/Android) | V8 via Chromium | Same as browser |
| Node.js (server) | V8 | Same as browser |

**Key Insight:** We're V8 everywhere! This dramatically reduces determinism concerns.

### Decision: Trust V8, Validate on CI

1. **Rely on V8 consistency** - Same engine = same float behavior
2. **Add determinism tests to CI** - Run replay tests regularly
3. **Monitor for issues** - If problems arise, evaluate fixed-point
4. **Tolerance is acceptable** - Small position errors (< 0.01 units) won't break gameplay

### Validation Strategy

```bash
# CI runs determinism check on every commit
npm run test:determinism -- --replays 100 --tolerance 0.001
```

If this ever fails, we'll know immediately and can investigate.

---

## 4. Rollback: Following Quake 3 / Warsow Model

### How Q3/Warsow Handle It

1. **Client predicts ahead** - Runs physics locally while waiting for server
2. **Server sends authoritative state** - Every snapshot (20-60Hz)
3. **Client reconciles** - If prediction was wrong, snap or smooth
4. **No explicit "rollback"** - Just overwrite with server truth

### Our Implementation

```typescript
class ClientPrediction {
  // Store last N inputs (not states!)
  private inputHistory: CircularBuffer<InputCommand>;
  private readonly HISTORY_SIZE = 128; // ~1 second at 125Hz
  
  onServerSnapshot(snapshot: ServerSnapshot): void {
    // 1. Server state is truth
    const serverState = snapshot.toWorldState();
    
    // 2. Find unacknowledged inputs
    const lastAcked = snapshot.acknowledgedInput;
    const replayInputs = this.inputHistory.since(lastAcked);
    
    // 3. Replay from server state (NOT rollback - just re-predict)
    let predicted = serverState;
    for (const input of replayInputs) {
      predicted = this.simulation.tick(predicted, [input], FIXED_DT);
    }
    
    // 4. Compare and correct
    const error = distance(predicted.myPos, this.displayed.myPos);
    if (error < 0.5) {
      // Tiny error - ignore (normal network jitter)
    } else if (error < 50) {
      // Small error - smooth over next few frames
      this.smoothCorrect(predicted.myPos);
    } else {
      // Large error - teleport happened, snap immediately
      this.snap(predicted.myPos);
    }
    
    // 5. Use predicted state for display
    this.displayState = predicted;
  }
}
```

### Key Insight: No State History Needed!
We store **inputs**, not states. This is:
- Much smaller (input ~20 bytes vs entity ~200 bytes)
- Naturally bounded (128 inputs = ~2.5KB)
- Deterministic replay rebuilds state from server + inputs

---

## 5. Server Authority: Absolute

Already in architecture. Client does **zero** authoritative decisions.

```
Client sends: Inputs (wishDir, buttons, viewAngles)
Server sends: Authoritative state

Client NEVER sends: Position, velocity, health, ammo
```

---

## 6. Anti-Cheat: Foundation in Architecture

### Phase 1 (Now): Design for Cheat Resistance
- All game logic runs server-side
- Clients only send inputs
- No trust required

### Phase 2 (Later): Active Detection
```typescript
interface InputValidator {
  // Rate limiting
  validateFireRate(input: Input, lastFire: number): boolean;
  
  // Movement sanity
  validateMovement(input: Input, lastPos: Vec3): boolean;
  
  // Statistical anomaly
  recordForAnalysis(playerId: EntityId, input: Input): void;
}
```

### Phase 3 (Production): Response System
```typescript
interface CheatResponse {
  warn(playerId: EntityId, reason: string): void;
  kick(playerId: EntityId, reason: string): void;
  ban(playerId: EntityId, reason: string, duration: Duration): void;
}
```

---

## 7. Branded Types: Utility Library

Ship with comprehensive utilities:

```typescript
// src/engine/simulation/units.ts

// ═══════════════════════════════════════════════════════════════════
// Branded Types
// ═══════════════════════════════════════════════════════════════════

export type VelocityPerSec = Vec3 & { readonly __brand: 'vel/sec' };
export type DisplacementPerTick = Vec3 & { readonly __brand: 'disp/tick' };
export type PositionWorld = Vec3 & { readonly __brand: 'pos/world' };

// ═══════════════════════════════════════════════════════════════════
// Constructors (the ONLY way to create branded values)
// ═══════════════════════════════════════════════════════════════════

export function velocity(x: number, y: number, z: number): VelocityPerSec {
  return { x, y, z } as VelocityPerSec;
}

export function position(x: number, y: number, z: number): PositionWorld {
  return { x, y, z } as PositionWorld;
}

// ═══════════════════════════════════════════════════════════════════
// Converters (explicit unit conversion)
// ═══════════════════════════════════════════════════════════════════

export function toDisplacement(vel: VelocityPerSec, dt: number): DisplacementPerTick {
  return {
    x: vel.x * dt,
    y: vel.y * dt,
    z: vel.z * dt,
  } as DisplacementPerTick;
}

export function toVelocity(disp: DisplacementPerTick, dt: number): VelocityPerSec {
  return {
    x: disp.x / dt,
    y: disp.y / dt,
    z: disp.z / dt,
  } as VelocityPerSec;
}

export function addDisplacement(pos: PositionWorld, disp: DisplacementPerTick): PositionWorld {
  return {
    x: pos.x + disp.x,
    y: pos.y + disp.y,
    z: pos.z + disp.z,
  } as PositionWorld;
}
```

**Usage is clean:**
```typescript
const vel = velocity(100, 0, 50);
const disp = toDisplacement(vel, 0.008);
const newPos = addDisplacement(pos, disp);
```

---

## 8. Hidden Work: Implementation Checklist

### Serialization Infrastructure

| Item | Priority | Complexity | Notes |
|------|----------|------------|-------|
| JSON serializer for WorldState | P0 | Medium | Handle Map, Set, branded types |
| Binary encoder (MessagePack) | P1 | Medium | Use @msgpack/msgpack |
| Custom position encoder | P1 | Low | Float32 hot path |
| State checksum (CRC32) | P0 | Low | For determinism validation |

### Test Infrastructure

| Item | Priority | Complexity | Notes |
|------|----------|------------|-------|
| Test fixture generator | P0 | Medium | Spawn positions, input sequences |
| Replay recorder/player | P0 | High | Core determinism tool |
| Determinism diff tool | P1 | Medium | Show exactly where states diverged |
| Network simulator | P2 | High | Lag, jitter, packet loss |
| CI integration | P0 | Low | Run on every commit |

### CLI Tools

| Command | Priority | Purpose |
|---------|----------|---------|
| `sim tick` | P0 | Single tick test |
| `sim replay` | P0 | Determinism test |
| `sim bench` | P1 | Performance |
| `network test-sync` | P1 | Client/server sync |

---

## 10. Variable Update Order: Prediction Handles It

### The "Concern" Explained

Network snapshots capture state at 60Hz. Between snapshots, physics runs 2+ ticks:

```
Server Frame 1: Physics(1) → Physics(2) → Snapshot(1)
Server Frame 2: Physics(3) → Snapshot(2)
```

### Why This Is Fine

**Client prediction smooths everything:**

1. Client receives Snapshot(1) at server tick 2
2. Client has been predicting locally at 125Hz
3. Client reconciles: "Server says tick 2 = X, I predicted X', error = X-X'"
4. Client smoothly corrects or was already right

**The snapshot interval variation is invisible to player:**
- They always see smooth 125Hz local prediction
- Server updates just validate/correct
- As long as server physics is deterministic, predictions match

### Key Insight
Network rate ≠ perceived smoothness. Client prediction runs at 125Hz always. Network just provides correction checkpoints.

---

## Updated Decisions Summary

| Topic | Decision | Rationale |
|-------|----------|-----------|
| State cloning | **Copy-on-Write** | 20x memory savings for RTS |
| Multi-rate events | **Best-case optimization** | Focus on making things better |
| Determinism | **Trust V8, CI tests** | Same engine everywhere |
| Rollback | **Q3 model: input history** | Store inputs, not states |
| Server authority | **Absolute** | Never trust client |
| Anti-cheat | **Architecture now, implementation later** | Foundation ready |
| Branded types | **Utility library day 1** | Make it easy to use correctly |
| Hidden work | **Explicit in checklist** | No surprises |
| Update order | **Prediction handles it** | Client smooths everything |

---

## Revised Week 1 Goals

Focus on proving the architecture works:

1. **COW WorldState implementation** - Test with 500 entities
2. **Basic physics system** - Gravity, collision (reuse existing)
3. **Determinism test** - 1000 tick replay matches
4. **CLI: `sim tick` and `sim replay`** - Prove testability

If Week 1 succeeds, we know the core architecture is solid.
