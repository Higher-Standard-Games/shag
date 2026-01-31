# Multiplayer Server Architecture: Deterministic Simulation Design

> **Date:** 2026-01-31  
> **Status:** Design Phase  
> **Version:** 0.9.0  
> **Philosophy:** Separate concerns, enforce contracts, eliminate ambiguity, testability-first

## Executive Summary

This document proposes a complete redesign of our multiplayer server architecture using a **three-layer deterministic simulation** approach. The design prioritizes:

1. **Determinism** - Same inputs always produce same outputs
2. **Testability** - Every component is testable in isolation via CLI
3. **Clean separation** - Simulation, Network, and Game logic are independent
4. **Type safety** - Explicit units and contracts prevent common bugs

### Related Documents

| Document | Focus |
|----------|-------|
| [Tick System Deep Dive](tick-system-deep-dive.md) | Multi-rate orchestration, subsystem independence, performance budgets |
| [ECS & Network Protocol](ecs-network-protocol-deep-dive.md) | Entity-Component with COW, binary serialization, delta compression |
| [Lag Compensation](lag-compensation-deep-dive.md) | Hit detection, server rewind, peeker's advantage, modern techniques |
| [Critical Review Addendum](architecture-review-addendum.md) | Peer review solutions, COW decision, Q3-style prediction |
| [Implementation Plan](server-implementation-plan.md) | Directory structure, phases, migration strategy |

---

## Design Decisions (Detailed)

### 1. Type Safety: Pure TypeScript Branded Types ✅

**Decision:** Use TypeScript branded types for units. No external libraries.

```typescript
// Branded types prevent mixing incompatible units
type VelocityPerSecond = Vec3 & { readonly __brand: 'vec3/velocity/sec' };
type DisplacementPerTick = Vec3 & { readonly __brand: 'vec3/displacement/tick' };
type PositionWorld = Vec3 & { readonly __brand: 'vec3/position/world' };

// Compile-time safety - these would be errors:
const vel: VelocityPerSecond = { x: 0, y: 0, z: 0 } as VelocityPerSecond;
const pos: PositionWorld = vel;  // ❌ Type error!

// Explicit conversion functions with clear names
function velocityToDisplacement(v: VelocityPerSecond, dt: number): DisplacementPerTick {
  return vec3.scale(v, dt) as DisplacementPerTick;
}

function displacementToVelocity(d: DisplacementPerTick, dt: number): VelocityPerSecond {
  return vec3.scale(d, 1/dt) as VelocityPerSecond;
}
```

**Rationale:** 
- Zero runtime overhead (brands are compile-time only)
- No external dependencies
- Catches bugs at compile time
- Self-documenting code

---

### 2. State Management: Copy-on-Write (COW) ✅

**Decision:** Use Copy-on-Write for memory efficiency with hundreds of entities.

#### The Problem
Full cloning every tick with hundreds of entities = massive GC pressure.
- RTS with 500 units, 5% moving per tick
- Full clone: 500 objects/tick = 62,500/sec at 125Hz
- **This will stutter on mobile!**

#### Solution: Copy-on-Write

Only clone entities that actually change:

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
   */
  nextTick(): WorldState {
    const next = new WorldState();
    next.tick = this.tick + 1;
    next.entities = new Map(this.entities); // Shallow copy
    next.modified = new Set();
    return next;
  }
}
```

**Memory comparison (RTS, 500 units, 5% moving):**

| Approach | Clones/tick | At 125Hz |
|----------|-------------|----------|
| Full Clone | 500 | 62,500/sec |
| **COW** | 25 | **3,125/sec** |

**20x improvement!** Essential for mobile/browser targets.

#### Implementation Notes
1. **Entities immutable by default** - use `readonly` properties
2. **`getEntityMut()` is only write path** - enforces COW discipline
3. **TypeScript helps** - `Readonly<Entity>` return type for reads

**Future:** If manual cloning becomes unwieldy, Immer is MIT-licensed and could be adopted incrementally for specific subsystems.

---

### 3. Tick Rates: Multi-Rate System Architecture

**Decision:** Hierarchical tick rates with subsystem independence.

#### Industry Research

| Game | Server Tick Rate | Notes |
|------|------------------|-------|
| **Quake 3 Arena** | 20 Hz (50ms) | Default `sv_fps=20`, pros use 40-125Hz |
| **Warsow** | 62.5 Hz (16ms) | Default, supports up to 125Hz |
| **Valorant** | 128 Hz (7.8ms) | Highest among mainstream shooters |
| **CS2** | 64 Hz + subtick | Subtick system records inputs between ticks |
| **Overwatch 2** | 63 Hz (~16ms) | Good balance for hero shooter |
| **Fortnite** | 30 Hz (33ms) | Lower due to player count |
| **PUBG** | 20-60 Hz | Adaptive based on player count |

**Our Approach: Configurable Multi-Rate System**

```typescript
interface TickConfig {
  // Core systems - high frequency for responsiveness
  physics: number;     // Default: 125 Hz (8ms) - FPS movement
  collision: number;   // Same as physics (coupled)
  
  // Game systems - can be lower frequency
  ai: number;          // 20 Hz (50ms) - AI decisions don't need high freq
  networking: number;  // 60 Hz (16.7ms) - snapshot rate
  
  // Strategy systems - even lower for RTS
  economy: number;     // 4 Hz (250ms) - resource ticks
  pathfinding: number; // 10 Hz (100ms) - path updates
}

// Configurable per game mode
const FPS_CONFIG: TickConfig = {
  physics: 125,
  collision: 125,
  ai: 30,
  networking: 60,
  economy: 0,        // Not used
  pathfinding: 0,    // Not used
};

const RTS_CONFIG: TickConfig = {
  physics: 30,       // Lower - RTS doesn't need twitch response
  collision: 30,
  ai: 10,
  networking: 20,
  economy: 4,
  pathfinding: 10,
};
```

**Implementation: Accumulator Pattern**

```typescript
class SimulationLoop {
  private accumulators: Map<string, number> = new Map();
  
  update(realDeltaTime: number): void {
    for (const [system, hz] of Object.entries(this.config)) {
      if (hz === 0) continue;
      
      const tickTime = 1 / hz;
      const acc = (this.accumulators.get(system) || 0) + realDeltaTime;
      
      // Run as many ticks as accumulated
      let remaining = acc;
      while (remaining >= tickTime) {
        this.systems.get(system)!.tick(tickTime);
        remaining -= tickTime;
      }
      
      this.accumulators.set(system, remaining);
    }
  }
}
```

**Benefits:**
- FPS gets 125Hz physics for Warsow-quality feel
- RTS can run heavier AI/pathfinding at lower frequency
- Network can decouple from physics (save bandwidth)
- Each system tunable independently

---

### 4. Serialization: Binary for Network, JSON for Debug

**Decision:** Use binary encoding for network, JSON for testing/debugging.

#### Binary Format: Protocol Buffers or Custom

**Option A: Protocol Buffers (protobuf)**
- ✅ Well-established, cross-language
- ✅ Schema evolution (backward compatible)
- ✅ ~3-10x smaller than JSON
- ❌ Requires code generation step
- ❌ Additional dependency

**Option B: Custom Binary Encoding**
- ✅ Zero dependencies
- ✅ Full control over format
- ✅ Can optimize for our specific data
- ❌ More development effort
- ❌ Maintenance burden

**Option C: MessagePack**
- ✅ Schema-less (like JSON but binary)
- ✅ ~30-50% smaller than JSON
- ✅ Easy migration from JSON
- ✅ MIT license, small library
- ❌ Not as compact as protobuf

**Recommendation: MessagePack + Custom Hot Paths**

```typescript
// Default: MessagePack for general serialization
import msgpack from '@msgpack/msgpack';

interface NetworkSerializer {
  // General purpose - uses MessagePack
  encode(data: unknown): Uint8Array;
  decode(bytes: Uint8Array): unknown;
  
  // Hot path - custom binary for snapshot positions
  encodePositions(entities: Entity[]): Uint8Array;
  decodePositions(bytes: Uint8Array): Vec3[];
}

// Custom binary for position data (hot path)
function encodePositions(entities: Entity[]): Uint8Array {
  // 4 bytes entity ID + 12 bytes position (3x float32) = 16 bytes/entity
  const buffer = new ArrayBuffer(entities.length * 16);
  const view = new DataView(buffer);
  
  let offset = 0;
  for (const entity of entities) {
    view.setUint32(offset, entity.id, true); offset += 4;
    view.setFloat32(offset, entity.transform.position.x, true); offset += 4;
    view.setFloat32(offset, entity.transform.position.y, true); offset += 4;
    view.setFloat32(offset, entity.transform.position.z, true); offset += 4;
  }
  
  return new Uint8Array(buffer);
}
```

**Size Comparison (10 entities with position):**
| Format | Size | Ratio |
|--------|------|-------|
| JSON | ~800 bytes | 1.0x |
| MessagePack | ~400 bytes | 0.5x |
| Custom Binary | 160 bytes | 0.2x |

**Debug Mode:** JSON for human readability
```typescript
if (DEBUG) {
  return JSON.stringify(state, null, 2);
} else {
  return msgpack.encode(state);
}
```

---

### 5. Testability: Beyond CLI-First

**Decision:** Multi-layer testing strategy with determinism guarantees.

#### Testing Pyramid

```
                    /\
                   /  \
                  / E2E \           Browser-based integration tests
                 /------\
                / Network \         Client-server sync tests
               /----------\
              /  Simulation \       Headless physics/game tests
             /--------------\
            /     Unit       \      Component/system unit tests
           /------------------\
```

#### 1. Unit Tests (Fast, Many)
```typescript
// Pure function testing - no setup needed
describe('PhysicsSystem', () => {
  it('applies gravity correctly', () => {
    const entity = createTestEntity({ velocity: { x: 0, y: 0, z: 0 } });
    const physics = new PhysicsSystem();
    
    physics.applyGravity(entity, 0.008); // 8ms tick
    
    expect(entity.physics.velocity.y).toBe(-6.4); // 800 * 0.008
  });
});
```

#### 2. Simulation Tests (CLI-Runnable)
```bash
# Test determinism - same inputs = same outputs
npm run test:sim -- --scenario physics/wall-collision
npm run test:sim -- --replay match-001.log --verify-checksum

# Replay and diff
npm run test:sim -- --replay match-001.log > result1.json
npm run test:sim -- --replay match-001.log > result2.json
diff result1.json result2.json  # Must be empty!
```

#### 3. Network Tests (Simulated Conditions)
```bash
# Test prediction with various network conditions
npm run test:network -- --lag 50ms --jitter 10ms --loss 2%
npm run test:network -- --lag 150ms --jitter 30ms --loss 5%  # Bad connection
```

#### 4. Fuzz Testing (Find Edge Cases)
```bash
# Random inputs for N ticks - check for crashes/NaN
npm run test:fuzz -- --ticks 100000 --seed 42
```

#### 5. Regression Tests (Prevent Regressions)
```typescript
// Golden file testing - compare against known-good output
describe('Regression', () => {
  it('match-001 produces expected final state', async () => {
    const result = await runReplay('tests/replays/match-001.log');
    const expected = await loadJson('tests/golden/match-001-final.json');
    
    expect(result.checksum).toBe(expected.checksum);
    expect(result.entities).toMatchSnapshot();  // Jest snapshot
  });
});
```

#### 6. Visual Diff Testing (For UI/Rendering)
```bash
# Capture screenshots at specific ticks, compare to golden
npm run test:visual -- --scenario spawn-and-move --tick 60
```

#### Testability Guarantees

| Guarantee | How We Ensure It |
|-----------|------------------|
| **Determinism** | Fixed timestep, no random() without seed, no Date.now() in simulation |
| **Reproducibility** | All inputs logged with timestamps, replay system |
| **Isolation** | No global state, dependency injection, pure functions |
| **Speed** | Headless mode, no rendering, parallel test execution |
| **Coverage** | Simulation code has 100% coverage target |


---

### 6. Lag Compensation: Fair Hit Detection ✅

**Decision:** Server-side rewind with configurable bounds, defensive ability override.

> See [Lag Compensation Deep Dive](lag-compensation-deep-dive.md) for detailed research.

#### Evolution of FPS Netcode

| Generation | Era | Approach |
|------------|-----|----------|
| Gen 1 | Early FPS | No compensation (high ping = unplayable) |
| Gen 2 | **Q3 Unlagged** (2002) | Server rewinds to shooter's tick |
| Gen 3 | **Source** (2004) | cl_interp + bounded rewind |
| Gen 4 | **Overwatch** (2016) | Favor-the-shooter + ability override |
| Gen 5 | **Valorant** (2020) | 128Hz + skeleton animation rewind |
| Gen 6 | **CS2** (2023) | Subtick timestamps, tick-rate independent |

#### Our Approach: Hybrid Modern

```typescript
interface LagCompensationConfig {
  /** Max rewind time (higher = more lag friendly, less fair) */
  maxRewindMs: number;  // 100-150ms typical
  
  /** Defensive abilities can override pending hits */
  allowAbilityOverride: boolean;  // Like Overwatch's Blink/Dash
  
  /** Historical buffer for rewind */
  historyBufferSize: number;  // 128 ticks = 1 sec at 125Hz
}

// Configurable per game mode
const configs = {
  casual:      { maxRewindMs: 200, allowAbilityOverride: true },
  competitive: { maxRewindMs: 100, allowAbilityOverride: true },
  tournament:  { maxRewindMs: 50,  allowAbilityOverride: true },
};
```

#### Key Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Base system** | Server-side rewind | Q3-proven, anti-cheat friendly |
| **Max rewind** | 100-150ms (configurable) | Balance fairness vs accessibility |
| **Hitboxes** | Multi-part capsules | Head/body/legs damage zones |
| **Projectiles** | No lag comp | They're simulated entities |
| **Abilities** | Can override hits | Skill expression (dash escapes) |

#### Hitscan vs Projectile

```typescript
// Hitscan weapons: use lag compensation
const RIFLE: WeaponConfig = {
  type: 'hitscan',
  useLagCompensation: true,  // ← Rewind for hit detection
};

// Projectile weapons: simulate as entities
const ROCKET: WeaponConfig = {
  type: 'projectile',
  projectileSpeed: 1000,
  useLagCompensation: false,  // ← No rewind, projectile is entity
};
```

---

## Layer 1: Simulation (Deterministic Core)

**Purpose:** Pure game state simulation - zero networking, rendering, or I/O

### Key Principles
- **Deterministic:** Same inputs → same outputs, always (bit-for-bit)
- **Frame-based:** Fixed timestep (8ms = 125Hz)
- **Stateless:** Each tick is pure function of `(state, inputs) → new state`
- **No side effects:** No console.log, no network, no disk I/O
- **Serializable:** Full state can be saved/loaded as JSON

### Core Components

#### World State (Immutable)
```typescript
interface WorldState {
  tick: number;                    // Monotonic tick counter
  entities: Map<EntityId, Entity>; // All entities
  checksum: number;                // CRC32 for desync detection
  
  // Read-only references (set once at init)
  readonly collisionWorld: CollisionWorld;
  readonly mapBounds: AABB;
}
```

**Critical:** State is **readonly after creation** - tick() returns NEW state.

#### Entity (Pure Data Structure)
```typescript
interface Entity {
  readonly id: EntityId;
  readonly type: EntityType;  // 'player', 'projectile', 'item'
  
  // Components stored as plain objects (not Map for perf)
  transform?: TransformComponent;
  physics?: PhysicsComponent;
  input?: InputComponent;
  health?: HealthComponent;
}

// All components are POJOs - easy to serialize
interface TransformComponent {
  position: Vec3;      // World units
  rotation: Quat;
}

interface PhysicsComponent {
  velocity: VelocityPerSecond;  // Explicit units!
  mass: number;
  grounded: boolean;
}

// Branded types prevent mixing units
type VelocityPerSecond = Vec3 & { __brand: 'velocity/sec' };
type DisplacementPerTick = Vec3 & { __brand: 'displacement/tick' };
```

#### Simulation Tick (Pure Function)
```typescript
class Simulation {
  private readonly systems: System[];
  
  /**
   * Pure simulation step
   * @param state - Current world state (NOT mutated)
   * @param inputs - All player inputs for this tick
   * @param dt - Fixed timestep (always 0.008 = 8ms)
   * @returns New world state
   */
  tick(state: WorldState, inputs: InputBatch, dt: number): WorldState {
    // Clone state for immutability
    const newState = state.clone();
    newState.tick++;
    
    // Run all systems in deterministic order
    for (const system of this.systems) {
      system.update(newState, inputs, dt);
    }
    
    // Compute checksum for desync detection
    newState.checksum = this.computeChecksum(newState);
    
    return newState;
  }
  
  /**
   * Serialize state to JSON (for saves, replays, tests)
   */
  saveState(state: WorldState): string {
    return JSON.stringify(state, (key, value) => {
      // Custom serialization for Maps
      if (value instanceof Map) {
        return { __type: 'Map', entries: Array.from(value) };
      }
      return value;
    });
  }
}
```

### Physics System Example

```typescript
class PhysicsSystem implements System {
  update(state: WorldState, inputs: InputBatch, dt: number): void {
    const GRAVITY = 800; // units/sec²
    
    for (const [id, entity] of state.entities) {
      if (!entity.physics || !entity.transform) continue;
      
      const physics = entity.physics;
      const transform = entity.transform;
      
      // Apply gravity (units/sec² * sec = units/sec)
      if (!physics.grounded) {
        physics.velocity.y -= GRAVITY * dt;
      }
      
      // Calculate movement for this tick
      const movement: DisplacementPerTick = vec3.scale(physics.velocity, dt);
      
      // Collision-aware movement (read-only collision world)
      const result = state.collisionWorld.stepSlideMove(
        transform.position,
        movement,
        { radius: 16, height: 56 }
      );
      
      // Update entity state
      transform.position = result.endPos;
      physics.velocity = vec3.scale(result.velocity, 1/dt); // Back to velocity/sec
      physics.grounded = result.grounded;
    }
  }
}
```

**Note:** `stepSlideMove` gets MOVEMENT (displacement), not velocity!

### Collision World Interface

```typescript
interface CollisionWorld {
  /**
   * Trace a ray/box through the world
   * @param start - Start position
   * @param end - End position  
   * @param bounds - Bounding box (optional)
   * @returns Trace result (immutable)
   */
  trace(start: Vec3, end: Vec3, bounds?: AABB): TraceResult;
  
  /**
   * Q3-style step-slide move with stair stepping
   * @param position - Current position
   * @param displacement - Movement THIS TICK (already scaled by dt!)
   * @param bounds - Collision bounds
   * @returns New position and velocity after collision response
   */
  stepSlideMove(
    position: Vec3,
    displacement: DisplacementPerTick,
    bounds: CollisionBounds
  ): StepSlideMoveResult;
  
  /**
   * Check what content type is at position
   */
  pointContents(position: Vec3): ContentsFlags;
}

// Results are immutable
interface StepSlideMoveResult {
  readonly endPos: Vec3;
  readonly velocity: DisplacementPerTick;  // Clipped movement
  readonly grounded: boolean;
  readonly hitCount: number;
}
```

**Critical:** Collision world is **stateless** - it's geometry query engine, not an entity manager!

---

## Layer 2: Network (Client/Server Transport)

**Purpose:** Synchronize simulation state between client and server

### Server Authority Model

```
Client 1 ──input──┐
Client 2 ──input──┤
Client 3 ──input──┼──→ [SERVER SIMULATION] ──snapshots──→ All Clients
Client 4 ──input──┘        (authoritative)
```

### Protocol Design

#### Client → Server: Input Commands
```typescript
interface InputCommand {
  sequence: number;         // Monotonic per client
  clientTick: number;       // Client's predicted tick
  buttons: ButtonBitmask;   // Jump, shoot, crouch, etc.
  viewAngles: { yaw: number; pitch: number };
  wishDir: Vec3;            // Normalized movement direction
}
```

**Note:** Client sends INPUTS, never positions!

#### Server → Client: World Snapshots
```typescript
interface WorldSnapshot {
  serverTick: number;              // Server's authoritative tick
  acknowledgedInput: number;       // Last input seq we processed
  entities: EntitySnapshot[];      // Delta-compressed
  checksum: number;                // For detecting desyncs
}

interface EntitySnapshot {
  id: EntityId;
  position: Vec3;
  velocity: Vec3;
  rotation: Quat;
  grounded: boolean;
  // ... other replicated fields
}
```

### Client Prediction & Reconciliation

```typescript
class ClientPrediction {
  private serverState: WorldState;      // Last confirmed state from server
  private predictedState: WorldState;   // Our predicted future
  private inputHistory: InputCommand[]; // Unacknowledged inputs
  
  /**
   * Handle server snapshot - reconcile our prediction
   */
  onSnapshot(snapshot: WorldSnapshot): void {
    // 1. Update authoritative server state
    this.serverState = snapshot.deserialize();
    
    // 2. Find which inputs server has processed
    const ackedSeq = snapshot.acknowledgedInput;
    this.inputHistory = this.inputHistory.filter(i => i.sequence > ackedSeq);
    
    // 3. Replay unacknowledged inputs from server state
    this.predictedState = this.serverState.clone();
    for (const input of this.inputHistory) {
      this.predictedState = this.simulation.tick(
        this.predictedState,
        [input],
        FIXED_DT
      );
    }
    
    // 4. Check prediction error
    const myEntity = this.predictedState.getMyEntity();
    const serverEntity = this.serverState.getMyEntity();
    const error = vec3.distance(myEntity.position, serverEntity.position);
    
    // 5. Handle errors
    if (error > SNAP_THRESHOLD) {
      // Large error (teleport, respawn) - hard snap
      console.warn(`[Prediction] Large error: ${error.toFixed(1)} units - snapping`);
      this.predictedState = this.serverState.clone();
      this.inputHistory = [];
    } else if (error > SMOOTH_THRESHOLD) {
      // Small error - smooth correction over time
      this.smoothCorrection = error;
    }
    
    // 6. Desync detection
    if (this.predictedState.checksum !== snapshot.checksum) {
      console.error('[Prediction] DESYNC DETECTED!');
      this.reportDesync();
    }
  }
}
```

---

## Layer 3: Game (Genre-Specific)

**Purpose:** Implement game rules on top of simulation

### FPS Game Example
```typescript
class FPSGame {
  private simulation: Simulation;
  private rules: FPSRules;
  
  /**
   * Process high-level player input → simulation commands
   */
  processInput(playerInput: PlayerInput): InputCommand {
    const wishDir = this.calculateWishDir(
      playerInput.forward,
      playerInput.right,
      playerInput.viewAngles
    );
    
    return {
      sequence: playerInput.sequence,
      clientTick: playerInput.tick,
      buttons: this.encodeButtons(playerInput),
      viewAngles: playerInput.viewAngles,
      wishDir,
    };
  }
  
  /**
   * Apply game rules (scoring, respawning, etc.)
   */
  onTick(state: WorldState): void {
    // Check win conditions
    if (this.rules.checkWinCondition(state)) {
      this.endMatch(state);
    }
    
    // Respawn dead players
    for (const player of this.getDeadPlayers(state)) {
      if (player.respawnTime <= state.tick) {
        this.respawnPlayer(state, player);
      }
    }
  }
}
```

### RTS Game Example
```typescript
class RTSGame {
  /**
   * RTS commands can affect multiple entities
   */
  processCommand(cmd: RTSCommand): InputCommand[] {
    const commands: InputCommand[] = [];
    
    switch (cmd.type) {
      case 'MOVE_UNITS':
        for (const unitId of cmd.selectedUnits) {
          commands.push({
            entityId: unitId,
            type: 'MOVE_TO',
            target: cmd.destination,
          });
        }
        break;
      
      case 'ATTACK':
        for (const unitId of cmd.selectedUnits) {
          commands.push({
            entityId: unitId,
            type: 'ATTACK',
            targetId: cmd.targetEntity,
          });
        }
        break;
    }
    
    return commands;
  }
}
```

---

## Testability: CLI-First Design

**Philosophy:** If you can't test it from command line, you can't test it properly.

### Simulation Testing

#### 1. Single Tick Test
```bash
# Test one simulation tick in isolation
npx sim tick \
  --state tests/states/spawn.json \
  --inputs tests/inputs/jump.json \
  --output result.json
  
# Verify output
npx sim verify result.json --expect tests/expect/after-jump.json
```

**Implementation:**
```typescript
// src/cli/sim-tick.ts
async function main() {
  const stateJson = await fs.readFile(args.state, 'utf8');
  const inputsJson = await fs.readFile(args.inputs, 'utf8');
  
  const state = Simulation.deserialize(stateJson);
  const inputs = JSON.parse(inputsJson);
  
  const sim = new Simulation();
  const result = sim.tick(state, inputs, 0.008);
  
  await fs.writeFile(args.output, sim.serialize(result));
}
```

#### 2. Replay Test (Determinism)
```bash
# Run a recorded session twice - should be identical
npx sim replay tests/replays/match-001.log > run1.json
npx sim replay tests/replays/match-001.log > run2.json
diff run1.json run2.json  # Should be empty!
```

**Replay format:**
```jsonlines
{"tick":0,"type":"init","state":{...}}
{"tick":1,"type":"input","data":{...}}
{"tick":2,"type":"input","data":{...}}
...
```

####3. Physics Regression Test
```bash
# Test player movement for 1 second (125 ticks)
npx sim test-physics \
  --scenario tests/physics/wall-collision.json \
  --ticks 125 \
  --expect tests/physics/wall-collision-expected.json
```

**Scenario format:**
```json
{
  "map": "wdm14",
  "spawn": {"x": -616, "y": 456, "z": -120},
  "inputs": [
    {"tick": 0, "buttons": 0, "wishDir": {"x": 0, "y": 0, "z": 1}},
    {"tick": 20, "buttons": 1, "wishDir": {"x": 0, "y": 0, "z": 1}}
  ],
  "expected": {
    "finalPosition": {"x": -616, "y": 448, "z": -50},
    "finalVelocity": {"x": 0, "y": 0, "z": 350}
  }
}
```

### Network Testing

#### 4. Predict & Reconcile Test
```bash
# Test client prediction with simulated lag
npx network test-prediction \
  --lag 50ms \
  --packet-loss 5% \
  --replay tests/replays/match-001.log
```

Output:
```
Tick 100: Prediction error: 2.3 units (OK)
Tick 150: Prediction error: 45.7 units (SNAP)
Tick 200: Prediction error: 1.1 units (OK)
...
Average error: 3.2 units
Max error: 45.7 units
Snaps: 1
```

#### 5. Desync Detection Test
```bash
# Verify client and server stay in sync
npx network test-sync \
  --clients 4 \
  --duration 60s \
  --checksum-every 10
```

### Game Logic Testing

#### 6. Full Match Simulation
```bash
# Run entire match headlessly (for AI training!)
npx game simulate \
  --config tests/configs/deathmatch-4v4.json \
  --bots 8 \
  --duration 300s \
  --output match-results.json
```

**Config format:**
```json
{
  "map": "wdm14",
  "gameMode": "deathmatch",
  "scoreLimit": 50,
  "bots": [
    {"name": "Bot1", "skill": 0.7, "team": "red"},
    {"name": "Bot2", "skill": 0.5, "team": "blue"}
  ]
}
```

**Results:**
```json
{
  "duration": 182.5,
  "winner": "red",
  "scores": {
    "Bot1": 28,
    "Bot2": 15
  },
  "replay": "replays/match-001.log"
}
```

---

## Critical Design Decisions & Rationale

### 1. **Fixed Timestep Everywhere**
- Server: 125Hz (8ms)
- Client prediction: 125Hz (8ms)
- Rendering: Variable (interpolates between ticks)

**Rationale:** Floating point math is NOT deterministic with variable timestep. Even tiny differences compound over thousands of ticks, causing client/server divergence.

**Trade-off:** Server CPU usage is constant (not adaptive), but we gain perfect determinism.

### 2. **Immutable State Transitions**
```typescript
// ❌ BAD: Mutation - hard to test, easy to corrupt
function tick(state: WorldState) {
  state.tick++;
  state.entities.get(id).position.x += 5;
}

// ✅ GOOD: Pure function - trivial to test, impossible to corrupt
function tick(state: WorldState): WorldState {
  const newState = state.clone();
  newState.tick++;
  const entity = newState.entities.get(id);
  entity.position = { ...entity.position, x: entity.position.x + 5 };
  return newState;
}
```

**Rationale:** Makes rollback/replay trivial. Prevents accidental state corruption. Easy to test (compare JSON).

**Trade-off:** Memory allocations (mitigated by object pooling if needed).

### 3. **Explicit Units in Types**
```typescript
// ❌ BAD: Ambiguous - is this per-second or per-frame?
velocity: Vec3;

// ✅ GOOD: Self-documenting - compiler prevents mixing units
type VelocityPerSecond = Vec3 & { __brand: 'velocity/sec' };
type DisplacementPerTick = Vec3 & { __brand: 'displacement/tick' };

velocity: VelocityPerSecond;
movement: DisplacementPerTick;

// Explicit conversions
const movement = toDisplacement(velocity, deltaTime);
const velocity = toVelocity(movement, deltaTime);
```

**Rationale:** **This would have prevented ALL our velocity scaling bugs!** The type system catches unit mismatches at compile time.

### 4. **Collision World is Stateless Query Interface**
```typescript
// ❌ BAD: Collision system "owns" entities
collision.addPlayer(id, position);
collision.movePlayer(id, velocity);
const newPos = collision.getPlayerPosition(id);

// ✅ GOOD: Collision is pure geometry queries
const result = collision.stepSlideMove(currentPos, movement, bounds);
entity.position = result.endPos;  // Entity system owns state
```

**Rationale:** Single source of truth (entity system). Collision can be reused for projectiles, items, NPCs without special casing.

**Trade-off:** Can't exploit spatial caching as easily (but SpatialHash solves this).

### 5. **Server Never Trusts Client**
```typescript
// ❌ BAD: Trust client position - allows cheating!
onClientPacket(packet: ClientPacket) {
  player.position = packet.position;
  player.velocity = packet.velocity;
}

// ✅ GOOD: Only accept inputs, validate server-side
onClientInput(input: InputCommand) {
  // Validate input
  if (!this.isValidInput(input)) {
    this.kickPlayer(input.clientId);
    return;
  }
  
  // Queue for next simulation tick
  this.inputQueue.push(input);
}
```

**Rationale:** Client can be compromised. All game-affecting decisions happen server-side.

### 6. **Snapshots, Not Deltas** (Initially)
```typescript
// Phase 1: Send full snapshots (simple, robust)
interface Snapshot {
  entities: Entity[];  // All visible entities, full state
}

// Phase 2: Delta compression (optimize bandwidth)
interface DeltaSnapshot {
  baseTick: number;
  changed: Partial<Entity>[];  // Only changed fields
  removed: EntityId[];
}
```

**Rationale:** Start simple (full snapshots), optimize later (deltas). Premature optimization = bugs.

**Trade-off:** Higher bandwidth initially, but easier to debug.

---

## Improvements Over Current Design

### Identified Issues & Solutions

| # | Issue | Current | New Design | Test |
|---|-------|---------|------------|------|
| 1 | Velocity unit confusion | Implicit | Branded types `VelocityPerSecond` | `sim test-physics` |
| 2 | Client/server code divergence | Separate implementations | Single `Simulation` class | `sim replay --determinism` |
| 3 | Spawn position desync | Unclear coordination | Server authority, client receives snapshot | `network test-sync` |
| 4 | Ground detection mismatch | Different logic paths | Single `PhysicsSystem` | `sim test-physics walls.json` |
| 5 | Position reconciliation bugs | Mutating wrong objects | Immutable state, explicit replay | `network test-prediction --lag 100ms` |
| 6 | Untestable simulation | Requires full network | CLI commands for every layer | All `sim`, `network`, `game` commands |
| 7 | Non-deterministic physics | Variable `deltaTime` | Fixed 8ms timestep | `sim replay --verify-checksum` |

### Additional Improvements

**State serialization:**
```typescript
// Current: Can't easily save/load game state
// New: Full state is JSON-serializable
const state = simulation.saveState();
fs.writeFileSync('savegame.json', state);
const loaded = simulation.loadState(fs.readFileSync('savegame.json'));
```

**Replay system:**
```typescript
// Current: No replay capability
// New: Record inputs → replay deterministically
recorder.save('replay.log');
const replay = Replay.load('replay.log');
const finalState = replay.run();  // Bit-perfect reproduction
```

**AI training:**
```typescript
// Current: Can't run matches headlessly
// New: Perfect for training bots!
for (let i = 0; i < 10000; i++) {
  const result = game.simulate({bots: 8, duration: 300});
  neuralNet.train(result.actions, result.scores);
}
```

---

## Migration Strategy

### Phase 1: Core Simulation (Week 1)
**Goal:** Deterministic simulation that matches local mode

- [ ] Define core interfaces (`WorldState`, `Entity`, `System`)
- [ ] Implement `Simulation` class with replay
- [ ] Port `PhysicsSystem` with collision
- [ ] Create CLI test harness
- [ ] **Validation:** 100 replays → identical checksums

**Deliverable:** `npx sim replay tests/physics.log` works perfectly

### Phase 2: Network Layer (Week 2)
**Goal:** Server authority with client prediction

- [ ] Implement server loop (tick → snapshot → broadcast)
- [ ] Implement client prediction (input buffer → replay)
- [ ] Add lag compensation
- [ ] Create network test suite
- [ ] **Validation:** 4 clients, 5% packet loss, no desyncs

**Deliverable:** `npx network test-sync --clients 4` passes

### Phase 3: FPS Game Integration (Week 3)
**Goal:** Feature parity with current implementation

- [ ] Port FPS movement to new `PhysicsSystem`
- [ ] Implement spawning, respawning, health
- [ ] Integrate weapons system  
- [ ] Add HUD/UI sync
- [ ] **Validation:** Full  match plays identically to current system

**Deliverable:** Headless match simulation works

### Phase 4: Production Hardening (Week 4)
**Goal:** Production-ready server

- [ ] Optimize bandwidth (delta compression)
- [ ] Add desync recovery (checksum validation → snap)
- [ ] Implement anti-cheat foundations
- [ ] Performance profiling (target: 64 players @ 125Hz)
- [ ] Load testing (stress test server capacity)
- [ ] **Validation:** Production stress test passes

**Deliverable:** Server handles 64 players reliably

### Backward Compatibility Strategy

```
src/
├── engine/
│   └── network-v1/        # Current (legacy)
│   └── network-v2/        # New architecture
├── games/
│   └── fps/
│       └── simulation/
│           ├── FPSMovementProfile.ts      # Legacy
│           └── v2/
│               ├── FPSSimulation.ts       # New
│               └── FPSPhysicsSystem.ts    # New
```

**Migration path:**
1. **Weeks 1-2:** Build new system alongside old (no integration)
2. **Week 3:** Add feature flag: `USE_V2_NETWORKING=true`
3. **Week 4:** Default to v2, keep v1 as fallback
4. **Week 5:** Remove v1 after thorough testing

---

## Success Criteria

### Functional Requirements
- [ ] Single-player (local mode) works identically
- [ ] Multiplayer with 125Hz server and client prediction
- [ ] Client prediction error < 5 units on average (< 50 units max)
- [ ] No desyncs under normal network conditions
- [ ] Deterministic replay system

### Non-Functional Requirements
- [ ] 125Hz tick rate with 64 players
- [ ] < 5ms server tick time (leaves headroom)
- [ ] < 10KB/s bandwidth per player (with delta compression)
- [ ] 100% test coverage for simulation layer
- [ ] All systems testable via CLI

### Quality Goals
- [ ] Zero ambiguous types (branded types enforced)
- [ ] Zero global mutable state
- [ ] Every bug has a regression test
- [ ] Documentation for every public API

---

## Critical Review Decisions (Peer Reviewed 2026-01-31)

These decisions were made after critical "outsider" review of the architecture:

| Topic | Decision | Rationale |
|-------|----------|-----------|
| **State cloning** | Copy-on-Write | 20x memory savings for RTS (500 units) |
| **Multi-rate events** | Best-case optimization | Focus on making things better, not worst-case |
| **Determinism** | Trust V8, CI tests | Same engine everywhere (Electron, Capacitor, Node) |
| **Rollback** | Q3 model: input history | Store inputs (~2.5KB), not states |
| **Server authority** | Absolute | Never trust client for anything |
| **Anti-cheat** | Architecture now, impl later | Foundation ready, details in Phase 4 |
| **Branded types** | Utility library day 1 | Make correct usage easy |
| **Tick timing** | Prediction handles it | Network snapshot variation invisible to player |

### Key Insights from Review

1. **COW is essential** - Full cloning will stutter on mobile with 100+ entities
2. **No state history needed** - Store inputs, replay from server state
3. **V8 everywhere** - Cross-platform determinism is less of a concern than feared
4. **Client prediction smooths everything** - Network rate ≠ perceived smoothness

See [architecture-review-addendum.md](architecture-review-addendum.md) for detailed analysis.

---

## Conclusion

This architecture solves our current problems through:

1. **Separation of concerns** - Simulation, Network, Game are fully independent
2. **Type safety** - Branded types prevent unit confusion
3. **Determinism** - Fixed timestep + immutable state = perfect replays
4. **Testability** - CLI-first design enables comprehensive testing
5. **Clarity** - Single source of truth, explicit ownership

**Most importantly:** This design makes entire classes of bugs **impossible**!

The investment in proper architecture will pay dividends in:
- Faster feature development (less debugging)
- Confident refactoring (comprehensive tests)
- Future capabilities (AI training, replay analysis, etc.)

**Next Steps:**
1. Review and refine this design
2. Create detailed API specifications
3. Begin Phase 1 implementation
