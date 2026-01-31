# Deep Dive: Multi-Rate Tick System Architecture

> **Date:** 2026-01-31  
> **Status:** Design Phase  
> **Goal:** Modern, flexible tick system that scales from FPS to RTS

## Overview

The multi-rate tick system is the **heartbeat** of our engine. Unlike traditional single-rate loops, this architecture allows different subsystems to run at their optimal frequencies while maintaining determinism and synchronization.

```
┌──────────────────────────────────────────────────────────────────┐
│                    MAIN ORCHESTRATOR (Variable Rate)             │
│  • Drives requestAnimationFrame / setImmediate                   │
│  • Distributes real time to subsystems via accumulators          │
│  • Coordinates inter-system communication                        │
└─────────────────────────┬────────────────────────────────────────┘
                          │
      ┌───────────────────┼───────────────────┐
      │                   │                   │
      ▼                   ▼                   ▼
┌──────────┐       ┌──────────┐       ┌──────────┐
│ PHYSICS  │       │ GAMEPLAY │       │ NETWORK  │
│  125 Hz  │       │  30 Hz   │       │  60 Hz   │
│  (8ms)   │       │ (33ms)   │       │ (16ms)   │
└──────────┘       └──────────┘       └──────────┘
      │                   │                   │
      └───────────────────┼───────────────────┘
                          ▼
                   World State
```

---

## 1. Main Orchestrator

The orchestrator is the **only** component that touches real time. Everything below it operates on logical ticks.

### Core Design

```typescript
/**
 * The main tick orchestrator
 * - Receives real delta time from browser/Node
 * - Converts to logical ticks for each subsystem
 * - Never skips ticks (prevents physics tunneling)
 */
class TickOrchestrator {
  private readonly subsystems: Map<string, Subsystem> = new Map();
  private readonly accumulators: Map<string, number> = new Map();
  private readonly tickCounts: Map<string, number> = new Map();
  
  // Performance metrics
  private metrics: TickMetrics = {
    frameTime: 0,
    ticksPerFrame: new Map(),
    systemTimes: new Map(),
  };
  
  /**
   * Register a subsystem with its target tick rate
   */
  register(name: string, subsystem: Subsystem, config: SubsystemConfig): void {
    this.subsystems.set(name, subsystem);
    this.accumulators.set(name, 0);
    this.tickCounts.set(name, 0);
    
    // Store config for runtime adjustment
    subsystem.config = config;
  }
  
  /**
   * Main update loop - called by requestAnimationFrame or setImmediate
   * @param realDeltaTime - Actual elapsed time since last call (seconds)
   */
  update(realDeltaTime: number): void {
    const frameStart = performance.now();
    
    // Clamp delta to prevent spiral of death
    const clampedDelta = Math.min(realDeltaTime, MAX_FRAME_TIME);
    
    // Update each subsystem according to its tick rate
    for (const [name, subsystem] of this.subsystems) {
      const config = subsystem.config;
      if (config.tickRate === 0) continue; // Disabled
      
      const tickTime = 1 / config.tickRate;
      let accumulated = this.accumulators.get(name)! + clampedDelta;
      
      // Run as many ticks as accumulated
      let ticksThisFrame = 0;
      const maxTicksPerFrame = config.maxTicksPerFrame || 10;
      
      while (accumulated >= tickTime && ticksThisFrame < maxTicksPerFrame) {
        const tickStart = performance.now();
        
        subsystem.tick(tickTime);
        
        accumulated -= tickTime;
        ticksThisFrame++;
        
        // Track timing
        const tickDuration = performance.now() - tickStart;
        this.metrics.systemTimes.set(name, tickDuration);
      }
      
      this.accumulators.set(name, accumulated);
      this.tickCounts.set(name, this.tickCounts.get(name)! + ticksThisFrame);
      this.metrics.ticksPerFrame.set(name, ticksThisFrame);
    }
    
    this.metrics.frameTime = performance.now() - frameStart;
  }
  
  /**
   * Get current metrics for debugging/profiling
   */
  getMetrics(): TickMetrics {
    return { ...this.metrics };
  }
}

interface SubsystemConfig {
  tickRate: number;           // Desired ticks per second (Hz)
  maxTicksPerFrame: number;   // Cap to prevent spiral of death
  priority: number;           // Execution order (lower = first)
  dependencies: string[];     // Must run after these systems
}
```

### Spiral of Death Prevention

If the system can't keep up (e.g., 60fps drops to 10fps), we could accumulate so many ticks that we never catch up:

```typescript
// BAD: Frame took 100ms, accumulator builds up to 12+ ticks
// Each tick adds more work, making the next frame even slower!

// GOOD: Clamp max ticks per frame
const maxTicksPerFrame = config.maxTicksPerFrame || 10;
while (accumulated >= tickTime && ticksThisFrame < maxTicksPerFrame) {
  // Run tick
  ticksThisFrame++;
}

// If we hit the cap, time effectively slows down
// This is better than the game freezing!
if (ticksThisFrame === maxTicksPerFrame && accumulated > 0) {
  console.warn(`[${name}] Tick cap reached, dropping ${accumulated}s of simulation`);
  accumulated = 0; // Discard excess time
}
```

---

## 2. Subsystem Architecture

Each subsystem is an independent unit with its own tick rate and state.

### Subsystem Interface

```typescript
interface Subsystem {
  config: SubsystemConfig;
  
  /**
   * Initialize the subsystem
   */
  init(world: WorldState): void;
  
  /**
   * Run one tick at the subsystem's fixed timestep
   * @param dt - Fixed delta time for this subsystem (e.g., 0.008 for 125Hz)
   */
  tick(dt: number): void;
  
  /**
   * Clean up resources
   */
  destroy(): void;
  
  /**
   * Get state for serialization/debugging
   */
  getState(): SubsystemState;
}
```

### Standard Subsystems

```typescript
// Core subsystems with recommended tick rates
const SUBSYSTEMS = {
  // === HIGH FREQUENCY (Twitch Response) ===
  physics: {
    tickRate: 125,      // 8ms - FPS-quality movement
    priority: 0,        // Runs first
    dependencies: [],
  },
  
  input: {
    tickRate: 125,      // Match physics
    priority: -1,       // Before physics
    dependencies: [],
  },
  
  // === MEDIUM FREQUENCY (Gameplay) ===
  combat: {
    tickRate: 60,       // 16ms - Damage, projectiles
    priority: 10,
    dependencies: ['physics'],
  },
  
  ai: {
    tickRate: 30,       // 33ms - Decision making
    priority: 20,
    dependencies: ['physics', 'combat'],
  },
  
  animation: {
    tickRate: 60,       // 16ms - State machine updates
    priority: 30,
    dependencies: ['physics'],
  },
  
  // === NETWORK ===
  network: {
    tickRate: 60,       // 60 snapshots/sec
    priority: 100,      // Last to capture all changes
    dependencies: ['physics', 'combat'],
  },
  
  // === LOW FREQUENCY (Strategy) ===
  economy: {
    tickRate: 4,        // 250ms - Resource ticks (RTS)
    priority: 40,
    dependencies: ['ai'],
  },
  
  pathfinding: {
    tickRate: 10,       // 100ms - Path updates (RTS)
    priority: 15,
    dependencies: [],
  },
  
  // === VARIABLE (Not Fixed Tick) ===
  rendering: {
    tickRate: 0,        // Runs every frame (variable)
    priority: 200,
    dependencies: ['*'], // After all fixed-tick systems
  },
};
```

---

## 3. System Execution Order

Systems execute in a **deterministic order** based on dependencies and priority.

### Dependency Resolution

```typescript
class DependencyResolver {
  /**
   * Sort subsystems into execution order
   * Uses topological sort with priority as tie-breaker
   */
  resolve(subsystems: Map<string, SubsystemConfig>): string[] {
    const resolved: string[] = [];
    const unresolved = new Set(subsystems.keys());
    
    while (unresolved.size > 0) {
      let made_progress = false;
      
      // Find systems whose dependencies are all resolved
      const candidates: [string, number][] = [];
      
      for (const name of unresolved) {
        const config = subsystems.get(name)!;
        const depsResolved = config.dependencies.every(
          dep => resolved.includes(dep) || dep === '*'
        );
        
        if (depsResolved) {
          candidates.push([name, config.priority]);
        }
      }
      
      // Sort candidates by priority (lower = first)
      candidates.sort((a, b) => a[1] - b[1]);
      
      // Add first candidate to resolved
      if (candidates.length > 0) {
        const [name] = candidates[0];
        resolved.push(name);
        unresolved.delete(name);
        made_progress = true;
      }
      
      if (!made_progress) {
        throw new Error(`Circular dependency: ${[...unresolved].join(', ')}`);
      }
    }
    
    return resolved;
  }
}
```

### Execution Timeline Example

For a typical FPS game frame (16.67ms at 60fps):

```
Frame Timeline (16.67ms)
├─ Input tick 1            (0.1ms)   ← 125Hz, every 8ms
├─ Input tick 2            (0.1ms)
├─ Physics tick 1          (0.5ms)   ← 125Hz, runs after input
├─ Physics tick 2          (0.5ms)
├─ Combat tick 1           (0.3ms)   ← 60Hz, runs after physics
├─ AI tick (none)          (0.0ms)   ← 30Hz, not due this frame
├─ Animation tick 1        (0.2ms)   ← 60Hz
├─ Network tick 1          (0.4ms)   ← 60Hz, snapshot + send
├─ Render (variable)       (8.0ms)   ← Variable, runs every frame
└─ Frame complete          (10.1ms total)
                            ↓
                       6.57ms headroom
```

---

## 4. Inter-System Communication

Systems need to communicate without tight coupling. We use an **event bus** and **shared state queries**.

### Option A: Event Bus

```typescript
/**
 * Type-safe event bus for inter-system communication
 */
interface Events {
  'entity:spawn': { entityId: EntityId; position: Vec3 };
  'entity:destroy': { entityId: EntityId; reason: string };
  'player:damage': { targetId: EntityId; damage: number; sourceId: EntityId };
  'player:death': { playerId: EntityId; killerId: EntityId };
  'projectile:hit': { projectileId: EntityId; hitEntityId: EntityId };
  'ai:target-changed': { aiId: EntityId; newTargetId: EntityId | null };
  'economy:resource-changed': { playerId: EntityId; resource: string; delta: number };
}

class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private queue: QueuedEvent[] = [];
  
  /**
   * Subscribe to an event type
   */
  on<K extends keyof Events>(event: K, handler: (data: Events[K]) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);
  }
  
  /**
   * Emit event (queued for deterministic processing)
   */
  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    this.queue.push({ type: event, data, tick: this.currentTick });
  }
  
  /**
   * Process all queued events (called by orchestrator between ticks)
   */
  flush(): void {
    // Sort by tick for determinism
    this.queue.sort((a, b) => a.tick - b.tick);
    
    for (const event of this.queue) {
      const handlers = this.handlers.get(event.type);
      if (handlers) {
        for (const handler of handlers) {
          handler(event.data);
        }
      }
    }
    
    this.queue = [];
  }
}
```

### Option B: Shared State Queries (Preferred)

Events can become complex. For many cases, **querying shared state** is simpler:

```typescript
/**
 * World state is the single source of truth
 * Systems read from it, write results back
 */
class PhysicsSystem implements Subsystem {
  tick(dt: number): void {
    // Read from world state
    const entities = this.world.query(['transform', 'physics']);
    
    for (const entity of entities) {
      // Compute new position
      const newPos = this.integrate(entity, dt);
      
      // Write back to world state
      entity.transform.position = newPos;
    }
  }
}

class CombatSystem implements Subsystem {
  tick(dt: number): void {
    // Read positions computed by physics
    const projectiles = this.world.query(['projectile', 'transform']);
    const players = this.world.query(['player', 'transform', 'health']);
    
    for (const projectile of projectiles) {
      for (const player of players) {
        if (this.checkHit(projectile, player)) {
          // Write damage to world state
          player.health.current -= projectile.damage;
          
          // Mark projectile for removal
          projectile.destroyed = true;
        }
      }
    }
  }
}
```

### Communication Patterns Summary

| Pattern | Use Case | Deterministic? | Complexity |
|---------|----------|----------------|------------|
| **Direct Query** | Reading other system's output | ✅ Yes | Low |
| **Event Bus** | Decoupled notifications | ✅ If queued | Medium |
| **Shared State** | Cross-system data | ✅ If ordered | Low |
| **Callbacks** | Immediate notification | ❌ Order-dependent | High |

**Recommendation:** Use **shared state queries** as primary, events for truly decoupled notifications.

---

## 5. Performance Budgeting

For mobile/browser targets, we must carefully budget tick times.

### Target Budgets

```typescript
const PERFORMANCE_BUDGETS = {
  // Target: 60fps on mobile = 16.67ms per frame
  mobile: {
    frameBudget: 16.67,       // Total frame budget in ms
    physicsBudget: 4.0,       // Max time for physics
    networkBudget: 2.0,       // Max time for network
    combatBudget: 1.0,        // Max time for combat
    aiBudget: 2.0,            // Max time for AI
    renderBudget: 7.0,        // Remaining for rendering
    headroom: 0.67,           // Safety margin
  },
  
  // Target: 60fps on desktop = 16.67ms per frame
  desktop: {
    frameBudget: 16.67,
    physicsBudget: 2.0,       // More headroom
    networkBudget: 1.0,
    combatBudget: 0.5,
    aiBudget: 1.0,
    renderBudget: 10.0,       // Higher quality rendering
    headroom: 2.17,
  },
  
  // Target: Headless server = 8ms per tick (125Hz)
  server: {
    tickBudget: 8.0,
    physicsBudget: 3.0,
    networkBudget: 2.0,
    combatBudget: 1.0,
    aiBudget: 1.5,
    headroom: 0.5,
  },
};
```

### Adaptive Quality

When budgets are exceeded, we can adapt:

```typescript
class AdaptiveQualityController {
  private history: FrameMetrics[] = [];
  private qualityLevel = 1.0; // 0.0 = minimum, 1.0 = maximum
  
  onFrameComplete(metrics: FrameMetrics): void {
    this.history.push(metrics);
    if (this.history.length > 60) this.history.shift(); // Keep 1 second
    
    const avgFrameTime = this.history.reduce(
      (sum, m) => sum + m.frameTime, 0
    ) / this.history.length;
    
    if (avgFrameTime > 18.0) { // Sustained > 55fps
      this.decreaseQuality();
    } else if (avgFrameTime < 14.0 && this.qualityLevel < 1.0) {
      this.increaseQuality();
    }
  }
  
  decreaseQuality(): void {
    this.qualityLevel = Math.max(0.0, this.qualityLevel - 0.1);
    
    // Apply quality reductions
    if (this.qualityLevel < 0.8) {
      this.setPhysicsTickRate(60);  // Drop from 125Hz to 60Hz
    }
    if (this.qualityLevel < 0.5) {
      this.setAITickRate(10);       // Drop from 30Hz to 10Hz
    }
    if (this.qualityLevel < 0.3) {
      this.disableSubsystem('particles');
    }
  }
}
```

---

## 6. CLI Integration

Every subsystem must be testable from command line.

### CLI Commands

```bash
# Test single subsystem in isolation
npx tick test physics \
  --ticks 1000 \
  --scenario tests/physics/jumping.json \
  --profile

# Run orchestrator with specific config
npx tick run \
  --config configs/fps.json \
  --duration 10s \
  --metrics

# Benchmark subsystem performance
npx tick bench physics \
  --entities 100 \
  --iterations 10000

# Profile frame timing
npx tick profile \
  --config configs/fps.json \
  --duration 5s \
  --output profile.json
```

### Example CLI Output

```
$ npx tick bench physics --entities 100 --iterations 10000

PHYSICS BENCHMARK
─────────────────
Entities: 100
Iterations: 10000
Tick rate: 125Hz

Results:
  Mean tick time:     0.42ms
  Median tick time:   0.38ms
  95th percentile:    0.65ms
  99th percentile:    0.89ms
  Max tick time:      1.21ms
  
Budget analysis:
  Target: 8.0ms (125Hz)
  Used:   0.42ms (5.3%)
  ✅ Within budget

Entity breakdown:
  Integration:        0.12ms (29%)
  Collision detect:   0.18ms (43%)
  Collision resolve:  0.09ms (21%)
  Ground check:       0.03ms (7%)
```

---

## 7. RTS-Specific Considerations

Real-time strategy games have very different requirements.

### RTS Tick Configuration

```typescript
const RTS_CONFIG: TickConfig = {
  // Core - Lower frequency is fine for RTS
  physics: {
    tickRate: 30,       // Units move slowly, 30Hz is plenty
    priority: 0,
  },
  
  // Selection/Input - Needs responsiveness
  input: {
    tickRate: 60,       // Feels responsive
    priority: -1,
  },
  
  // Unit AI - Can be slow, lots of units
  unitAI: {
    tickRate: 10,       // 100ms per decision
    priority: 10,
  },
  
  // Strategic AI - Very slow, expensive
  strategicAI: {
    tickRate: 2,        // 500ms - high-level planning
    priority: 20,
  },
  
  // Pathfinding - Batched updates
  pathfinding: {
    tickRate: 10,       // Recalc paths 10x/sec
    priority: 5,
    maxUnitsPerTick: 20, // Limit to avoid stalls
  },
  
  // Economy - Slow ticks
  economy: {
    tickRate: 4,        // 250ms resource ticks
    priority: 30,
  },
  
  // Fog of War - Moderate
  fogOfWar: {
    tickRate: 15,       // Update visibility
    priority: 35,
  },
  
  // Network - Lower frequency for RTS
  network: {
    tickRate: 20,       // 20 snapshots/sec (50ms)
    priority: 100,
  },
};
```

### Batched Processing for Many Units

```typescript
class PathfindingSystem implements Subsystem {
  private pendingRequests: PathRequest[] = [];
  private requestIndex = 0;
  
  tick(dt: number): void {
    const MAX_UNITS_PER_TICK = 20;
    let processed = 0;
    
    // Process batch of requests
    while (
      processed < MAX_UNITS_PER_TICK &&
      this.requestIndex < this.pendingRequests.length
    ) {
      const request = this.pendingRequests[this.requestIndex];
      this.procesPathRequest(request);
      this.requestIndex++;
      processed++;
    }
    
    // Wrap around when done
    if (this.requestIndex >= this.pendingRequests.length) {
      this.requestIndex = 0;
    }
  }
}
```

---

## 8. Determinism Guarantees

For proper networking and replays, determinism is **non-negotiable**.

### Rules for Determinism

```typescript
// ❌ NON-DETERMINISTIC - Do NOT use in simulation!
Math.random();                    // Different per run
Date.now();                       // Wall clock time
performance.now();                // Only in orchestrator!
setTimeout/setInterval;           // Timing varies
async/await in tick();            // Non-deterministic ordering
console.log();                    // Can affect timing (browser)

// ✅ DETERMINISTIC - Safe to use
SeededRandom(seed);               // Reproducible random
state.tick;                       // Logical tick count
dt;                              // Fixed delta time from orchestrator
for loops with fixed bounds;      // Predictable iteration
Array.sort() with compare fn;     // Stable, deterministic
```

### Seeded Random Number Generator

```typescript
/**
 * Mulberry32 PRNG - Fast, deterministic, good quality
 */
class SeededRandom {
  private state: number;
  
  constructor(seed: number) {
    this.state = seed;
  }
  
  /**
   * Returns float in [0, 1)
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  
  /**
   * Returns integer in [min, max]
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  
  /**
   * Get current state for serialization
   */
  getState(): number {
    return this.state;
  }
  
  /**
   * Restore from saved state
   */
  setState(state: number): void {
    this.state = state;
  }
}
```

---

## Summary: Multi-Rate Architecture Benefits

| Aspect | Single-Rate | Multi-Rate |
|--------|-------------|------------|
| FPS feel | 60Hz physics feels floaty | 125Hz physics, crisp movement |
| RTS performance | Wasted cycles on physics | Heavy AI at 10Hz, physics at 30Hz |
| Network efficiency | Coupled to physics rate | Independent 60Hz snapshots |
| Mobile performance | One size fits all | Adaptive quality per subsystem |
| Testability | All or nothing | Test each subsystem independently |
| Determinism | Single timestep | Per-subsystem fixed timesteps |

**This is modern game engine architecture** - used by Unity, Unreal, and AAA titles. We're bringing it to the web!
