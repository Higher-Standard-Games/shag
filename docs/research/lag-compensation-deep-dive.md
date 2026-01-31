# Deep Dive: Lag Compensation & Hit Registration

> **Date:** 2026-01-31  
> **Status:** Design Phase  
> **Goal:** Fair, responsive hit detection that works across 20-200ms ping ranges

---

## The Fundamental Problem

In networked FPS, there's an inherent conflict:

```
Player A (50ms ping):  "I shot him! He was right there!"
Player B (50ms ping):  "I was behind cover! This is BS!"
Server:                "Both of you are 50ms in the past..."
```

**Timeline of a Shot:**

```
Time 0ms:    A sees B at position X
Time 25ms:   A fires (network delay to server)
Time 50ms:   Server receives "A fired at time 0"
Time 50ms:   B is now at position X+50 (moved behind cover)

Question: Was it a hit?
```

Without lag compensation, the server would check B's position at T=50ms and miss.
With lag compensation, we rewind to T=0ms and confirm the hit.

---

## Evolution of Lag Compensation

### Generation 1: Early FPS (No Compensation)

```
Client: "I shot at X,Y,Z"
Server: "Target not there anymore. Miss."
```

**Result:** High ping = unplayable. You had to "lead" your targets.

### Generation 2: Quake 3 / Unlagged

**Q3 Unlagged** (2002) introduced server-side rewind:

```
1. Client sends: "I fired at tick 100, view angles = X"
2. Server receives at tick 110
3. Server rewinds all player positions to tick 100
4. Server performs hit detection
5. Server restores current positions
```

**Pros:**
- High ping players can hit targets where they saw them
- Server authoritative (anti-cheat)

**Cons:**
- Victims get shot "around corners"
- Memory overhead for position history
- Complex to implement correctly

### Generation 3: Source Engine (2004)

Valve refined the approach with:
- **Interpolation delay** (cl_interp) - smooth rendering between packets
- **Bounded rewind** - max 200ms to prevent abuse
- **Latency-based capsule expansion** - slight hitbox expansion for high ping

```cpp
// Source Engine simplified
void LagCompensation() {
    float targetTime = client.commandTime - client.latency;
    RewindAllPlayers(targetTime);
    
    // Check hit with rewound positions
    TraceResult result = TraceLine(shootOrigin, shootEnd);
    
    RestoreAllPlayers();
}
```

### Generation 4: Overwatch "Favor the Shooter" (2016)

Blizzard's philosophy: **Make shooting feel good. Always.**

```
If you can aim and click on someone, you will hit them.
Period. Even if they've moved on their screen.
```

**Key Features:**

1. **Aggressive favor-the-shooter** - Shooter's client is trusted more
2. **Defensive ability exceptions** - Abilities like Tracer's Blink or Reaper's Wraith override hits
3. **Deterministic simulation** - Same code on client and server
4. **High tick rate** (63Hz) with interpolation

**Trade-offs:**
- Victims feel "shot around corners" more often
- Defensive abilities become crucial skill expressions
- Peeker's advantage is significant

### Generation 5: Valorant (2020)

Riot built specifically for competitive:

```
128 tick servers + historical buffer + server authority
```

**Key Features:**

1. **128 Hz tick rate** - 7.8ms per tick (vs 15.6ms at 64Hz)
2. **Historical position buffer** - Rewind to exact shooter's timestamp
3. **Animation rewind** - Not just positions, but skeletal state too!
4. **Optimized every 4th frame** - Interpolate between for perf

```typescript
// Valorant-style (conceptual)
function checkHit(shot: ShotEvent): boolean {
    // Rewind to shooter's perceived time
    const targetTime = shot.timestamp - shooter.latency;
    
    // Get historical state (position + animation!)
    const historicalState = historyBuffer.getAt(targetTime);
    
    // Check against historical hitbox (animated skeleton)
    return traceAgainstSkeleton(
        shot.origin,
        shot.direction,
        historicalState.skeleton
    );
}
```

### Generation 6: CS2 Subtick (2023)

Valve's radical new approach: **Make tick rate irrelevant.**

```
Every input is timestamped with sub-tick precision.
Server processes at exact timestamp, not next tick.
```

**How it works:**

1. Client timestamps every action (shoot, move, jump) with precise time
2. Server receives timestamped inputs
3. Server processes at exact timestamp, interpolating between ticks
4. Results are more accurate than any fixed tick rate

**Pros:**
- 64Hz server feels like 128Hz+
- Reduces peeker's advantage
- More bandwidth efficient than 128Hz

**Cons:**
- Complex implementation
- "Shooting into the future" edge cases
- Still being refined (controversial in community)

---

## Modern Techniques Summary

| Game | Tick Rate | Rewind Max | Special Features |
|------|-----------|------------|-----------------|
| Q3/Warsow | 20-125Hz | 200ms | Classic unlagged |
| Source (CS:GO) | 64/128Hz | 200ms | cl_interp, bounded |
| Overwatch | 63Hz | ~250ms | Favor shooter, ability exceptions |
| Valorant | 128Hz | ~150ms | Skeleton rewind |
| CS2 | 64Hz | Variable | Subtick timestamps |

---

## Our Architecture: Hybrid Approach

Based on research, here's our recommended design:

### Core Philosophy

1. **Favor the shooter** - Within reason (max 150ms rewind)
2. **Server authoritative** - Client sends inputs, server decides hits
3. **Bounded compensation** - High ping players have disadvantage (fair)
4. **Skill abilities can override** - Dash/blink escape can cancel pending hits

### Implementation Design

```typescript
// ═══════════════════════════════════════════════════════════════════
// LAG COMPENSATION SYSTEM
// ═══════════════════════════════════════════════════════════════════

interface LagCompensationConfig {
  /** Maximum rewind time in ms (higher = more lag friendly, less fair) */
  maxRewindMs: number;  // Default: 150ms
  
  /** Hitbox expansion per 10ms of ping (subtle compensation) */
  hitboxExpansionPerMs: number;  // Default: 0.0 (disabled)
  
  /** Enable defensive ability override (like Overwatch) */
  allowAbilityOverride: boolean;  // Default: true
  
  /** Historical buffer size in ticks */
  historyBufferSize: number;  // Default: 128 (1 sec at 125Hz)
}

class LagCompensationSystem {
  private config: LagCompensationConfig;
  private historyBuffer: CircularBuffer<WorldSnapshot>;
  
  constructor(config: LagCompensationConfig) {
    this.config = config;
    this.historyBuffer = new CircularBuffer(config.historyBufferSize);
  }
  
  /**
   * Record current world state for future rewind
   * Called every simulation tick
   */
  recordSnapshot(state: WorldState): void {
    const snapshot: WorldSnapshot = {
      tick: state.tick,
      timestamp: state.tick * TICK_MS,
      entities: new Map(),
    };
    
    // Store position + hitbox for all players
    for (const entity of state.players()) {
      snapshot.entities.set(entity.id, {
        position: entity.transform!.position,
        rotation: entity.transform!.rotation,
        hitbox: this.computeHitbox(entity),
        // Could also store skeleton pose for Valorant-style
      });
    }
    
    this.historyBuffer.push(snapshot);
  }
  
  /**
   * Check if a shot hit, using lag compensation
   */
  checkHit(shot: ShotCommand, currentState: WorldState): HitResult | null {
    // 1. Calculate target time (when shooter saw the world)
    const shooterLatency = this.getPlayerLatency(shot.shooterId);
    const targetTime = shot.tick * TICK_MS - shooterLatency;
    
    // 2. Clamp to max rewind (prevent abuse)
    const maxRewind = currentState.tick * TICK_MS - this.config.maxRewindMs;
    const rewindTime = Math.max(targetTime, maxRewind);
    
    // 3. Get historical snapshot (interpolate if needed)
    const snapshot = this.getSnapshotAt(rewindTime);
    if (!snapshot) {
      console.warn(`No history for time ${rewindTime}`);
      return null;
    }
    
    // 4. Perform hit detection against historical positions
    const hits: HitResult[] = [];
    
    for (const [entityId, historical] of snapshot.entities) {
      if (entityId === shot.shooterId) continue;  // Can't shoot self
      
      // Check line vs hitbox
      const hit = this.traceAgainstHitbox(
        shot.origin,
        shot.direction,
        historical.hitbox,
        historical.position
      );
      
      if (hit) {
        hits.push({
          targetId: entityId,
          hitPoint: hit.point,
          hitPart: hit.part,  // head, body, limb
          damage: this.calculateDamage(shot, hit),
        });
      }
    }
    
    // 5. Return first hit (closest)
    if (hits.length === 0) return null;
    return hits.sort((a, b) => 
      vec3.distance(shot.origin, a.hitPoint) - 
      vec3.distance(shot.origin, b.hitPoint)
    )[0];
  }
  
  /**
   * Check if defensive ability cancels a pending hit
   * (Overwatch-style ability override)
   */
  checkAbilityOverride(hit: HitResult, targetState: Entity): boolean {
    if (!this.config.allowAbilityOverride) return false;
    
    // Check if target used a defensive ability
    const abilities = targetState.abilities;
    if (!abilities) return false;
    
    // List of abilities that can override hits
    const overrideAbilities = ['dash', 'blink', 'phase', 'invuln'];
    
    for (const ability of overrideAbilities) {
      if (abilities.isActive(ability)) {
        return true;  // Hit is cancelled
      }
    }
    
    return false;
  }
  
  /**
   * Get interpolated snapshot at specific time
   */
  private getSnapshotAt(targetTime: number): WorldSnapshot | null {
    // Find two surrounding snapshots
    let before: WorldSnapshot | null = null;
    let after: WorldSnapshot | null = null;
    
    for (const snapshot of this.historyBuffer) {
      if (snapshot.timestamp <= targetTime) {
        before = snapshot;
      } else if (!after) {
        after = snapshot;
        break;
      }
    }
    
    if (!before) return null;
    if (!after) return before;  // At or past latest
    
    // Interpolate between snapshots
    const t = (targetTime - before.timestamp) / (after.timestamp - before.timestamp);
    return this.interpolateSnapshots(before, after, t);
  }
  
  private interpolateSnapshots(
    a: WorldSnapshot,
    b: WorldSnapshot,
    t: number
  ): WorldSnapshot {
    const result: WorldSnapshot = {
      tick: a.tick,  // Use earlier tick
      timestamp: a.timestamp + t * (b.timestamp - a.timestamp),
      entities: new Map(),
    };
    
    // Interpolate each entity
    for (const [id, entityA] of a.entities) {
      const entityB = b.entities.get(id);
      if (!entityB) continue;  // Entity didn't exist in both
      
      result.entities.set(id, {
        position: vec3.lerp(entityA.position, entityB.position, t),
        rotation: vec3.lerp(entityA.rotation, entityB.rotation, t),
        hitbox: entityA.hitbox,  // Hitbox doesn't change
      });
    }
    
    return result;
  }
}
```

### Hitbox Design

```typescript
/**
 * Multi-part hitbox for damage zones
 */
interface PlayerHitbox {
  head: Capsule;      // 2x damage
  body: Capsule;      // 1x damage
  legs: Capsule;      // 0.75x damage
}

/**
 * Simplified capsule hitbox
 */
interface Capsule {
  /** Offset from entity origin */
  offset: Vec3;
  /** Capsule radius */
  radius: number;
  /** Capsule height (total, including hemisphere caps) */
  height: number;
}

const PLAYER_HITBOX: PlayerHitbox = {
  head: { offset: { x: 0, y: 52, z: 0 }, radius: 8, height: 10 },
  body: { offset: { x: 0, y: 32, z: 0 }, radius: 14, height: 24 },
  legs: { offset: { x: 0, y: 8, z: 0 }, radius: 10, height: 20 },
};
```

### Weapon Types & Compensation

```typescript
/**
 * Weapon-specific lag compensation rules
 */
interface WeaponLagConfig {
  /** Hitscan = instant, Projectile = travels */
  type: 'hitscan' | 'projectile';
  
  /** For projectile: speed in units/sec */
  projectileSpeed?: number;
  
  /** For hitscan: max range */
  maxRange?: number;
  
  /** Use lag compensation? (projectiles usually don't) */
  useLagCompensation: boolean;
}

const WEAPON_CONFIG: Record<string, WeaponLagConfig> = {
  // Hitscan weapons - need lag compensation
  rifle: { type: 'hitscan', maxRange: 5000, useLagCompensation: true },
  shotgun: { type: 'hitscan', maxRange: 800, useLagCompensation: true },
  sniper: { type: 'hitscan', maxRange: 10000, useLagCompensation: true },
  
  // Projectile weapons - NO lag compensation (projectile is entity)
  rocket: { type: 'projectile', projectileSpeed: 1000, useLagCompensation: false },
  grenade: { type: 'projectile', projectileSpeed: 800, useLagCompensation: false },
  plasma: { type: 'projectile', projectileSpeed: 2000, useLagCompensation: false },
};
```

---

## Peeker's Advantage Mitigation

Peeker's advantage is when the attacker sees the defender before they're seen:

```
Attacker moves out of cover → sees defender
Network delay (50ms) → defender's client updates
Defender reacts (150ms human) → too late!

Attacker has ~50-100ms head start + reaction time advantage
```

### Mitigation Strategies

**1. Movement Speed Reduction (Like Valorant)**
```typescript
// Slow down players during gunfights
const ACCURACY_PENALTY_ON_MOVE = 0.5;  // 50% penalty while moving
const MOVEMENT_SLOW_WHILE_ADS = 0.7;   // 70% speed while aiming
```

**2. High Tick Rate**
Higher tick rate = smaller time steps = less advantage
- 64Hz = 15.6ms between updates
- 128Hz = 7.8ms between updates

**3. Interpolation Delay Reduction**
```typescript
// Lower interp = less delay, but more jitter
const INTERP_RATIO = 2;  // Interpolate over 2 ticks (16ms at 125Hz)
```

**4. Lean/Peak Mechanics (Not instant)**
Force players to commit to peeking:
```typescript
// Quick-peek penalty
const PEEK_ACCURACY_RECOVERY_TIME = 100; // ms to regain full accuracy
```

---

## Client-Side Prediction for Weapons

### Hitscan Prediction

```typescript
/**
 * Client predicts hitscan results for instant feedback
 */
class ClientWeaponPrediction {
  /**
   * Immediately show hit effect, server confirms later
   */
  predictHitscan(shot: ShotCommand, localState: WorldState): void {
    // 1. Trace against current (predicted) positions
    const hit = this.traceHitscan(shot, localState);
    
    if (hit) {
      // 2. Show predicted effects immediately
      this.showHitMarker(hit.hitPoint, hit.hitPart === 'head');
      this.showBloodEffect(hit.hitPoint);
      this.playHitSound(hit.hitPart);
      
      // 3. Apply predicted damage (will be corrected by server)
      this.predictedDamage.set(hit.targetId, hit.damage);
    }
    
    // 4. Send to server for authoritative check
    this.network.sendShot(shot);
  }
  
  /**
   * Server confirms or denies hit
   */
  onServerHitResult(result: HitResult | null): void {
    const predicted = this.predictedDamage.get(result?.targetId);
    
    if (result && !predicted) {
      // Server registered hit we didn't predict (lag spike?)
      this.showLateHitEffect(result);
    } else if (!result && predicted) {
      // We predicted hit, server said miss (rare with lag comp)
      console.log('Predicted hit rejected by server');
    }
    
    this.predictedDamage.clear();
  }
}
```

### Projectile Prediction

Projectiles are simulated entities - no special prediction needed:

```typescript
/**
 * Projectile spawns on client immediately
 * Server authoritative for collision
 */
function fireProjectile(weapon: Weapon, origin: Vec3, direction: Vec3): void {
  // Spawn predicted projectile
  const predictedProjectile = createProjectile(origin, direction, weapon.speed);
  this.predictedProjectiles.add(predictedProjectile);
  
  // Server will spawn authoritative version
  this.network.sendFireProjectile({
    weaponId: weapon.id,
    origin,
    direction,
    tick: this.currentTick,
  });
}
```

---

## Configuration Recommendations

### Casual/Pub Games
```typescript
const CASUAL_CONFIG: LagCompensationConfig = {
  maxRewindMs: 200,           // Generous for high ping players
  hitboxExpansionPerMs: 0.1,  // Slight hitbox expansion for pings
  allowAbilityOverride: true,
  historyBufferSize: 256,     // 2 seconds at 125Hz
};
```

### Competitive/Ranked
```typescript
const COMPETITIVE_CONFIG: LagCompensationConfig = {
  maxRewindMs: 100,            // Tighter, rewards low ping
  hitboxExpansionPerMs: 0.0,   // No handicap
  allowAbilityOverride: true,
  historyBufferSize: 128,      // 1 second
};
```

### Tournament/LAN
```typescript
const TOURNAMENT_CONFIG: LagCompensationConfig = {
  maxRewindMs: 50,             // Minimal, everyone is low ping
  hitboxExpansionPerMs: 0.0,
  allowAbilityOverride: true,
  historyBufferSize: 64,       // 0.5 seconds
};
```

---

## Testing Strategy

### CLI Commands

```bash
# Test lag compensation with simulated latency
npx lagcomp test \
  --latency 100ms \
  --scenario tests/lagcomp/peek-fight.json

# Measure hit registration accuracy
npx lagcomp accuracy \
  --replays tests/replays/*.log \
  --tolerance 0.1

# Visualize rewind (outputs debug frames)
npx lagcomp visualize \
  --shot tests/shots/around-corner.json \
  --output debug/rewind-frames/
```

### Automated Tests

```typescript
describe('LagCompensation', () => {
  it('should hit target at rewound position', () => {
    // Setup: Target was at X at T=0, now at Y at T=100
    const history = createHistory([
      { tick: 0, position: { x: 0, y: 0, z: 0 } },
      { tick: 100, position: { x: 100, y: 0, z: 0 } },
    ]);
    
    // Shooter with 100ms latency fires at T=100
    const shot = { tick: 100, origin: { x: 50, y: 0, z: 100 }, direction: { x: 0, y: 0, z: -1 } };
    const shooterLatency = 100;
    
    // Should hit because target was at X=0 at T=0
    const result = lagComp.checkHit(shot, shooterLatency, history);
    expect(result).toBeTruthy();
    expect(result.hitPoint.x).toBeCloseTo(0, 1);
  });
  
  it('should NOT hit if rewind exceeds maxRewindMs', () => {
    // Same setup, but shooter has 300ms latency
    const shooterLatency = 300;
    const config = { maxRewindMs: 150 };
    
    // Should miss because we only rewind 150ms, target not there
    const result = lagComp.checkHit(shot, shooterLatency, history, config);
    expect(result).toBeNull();
  });
  
  it('should respect defensive ability override', () => {
    // Target used dash at T=50
    history[50].abilities = { dash: true };
    
    // Shooter fires at T=100, rewinds to T=0
    // Hit would connect, but dash overrides
    const result = lagComp.checkHit(shot, 100, history);
    expect(result).toBeNull();  // Dash cancelled the hit
  });
});
```

---

## Summary: Our Approach

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| **Base System** | Server-side rewind | Q3/Unlagged proven, anti-cheat |
| **Max Rewind** | 100-150ms (configurable) | Balance between fairness and accessibility |
| **Hitbox** | Multi-part capsules | Simple, performant, headshot zones |
| **Projectiles** | No lag comp | They're entities, simulate normally |
| **Abilities** | Can override hits | Overwatch-style skill expression |
| **Peeker's mitigation** | High tick rate + accuracy penalty | Modern competitive approach |
| **Client prediction** | Visual only | Immediate feedback, server authoritative |

---

## Future Considerations

### Subtick (CS2-style)
If we want to go further:
```typescript
// Instead of tick-aligned inputs
interface SubtickInput {
  tick: number;
  subTickTime: number;  // 0.0 - 1.0 within tick
  buttons: number;
  viewAngles: Vec2;
}
```

### Skeleton Rewind (Valorant-style)
For better accuracy with complex animations:
```typescript
interface AnimationSnapshot {
  pose: JointPose[];  // All bone transforms
  hitboxes: Capsule[];  // Derived from pose
}
```

These are more complex but could be Phase 2 improvements.
