# Bot Movement & Navigation Research

> Smart Waypoint Network (SWN) — BSP-derived, physics-probed, ML-ready navigation

## Status: Research / Pre-Implementation

---

## 1. Problem Statement

Arena FPS maps are complex 3D environments with:

- Multi-level architecture (ramps, stairs, platforms)
- Jump pads (`trigger_push`) that launch players between floors
- Teleporters (`trigger_teleport`) for instant map traversal
- Item placement at strategic positions requiring specific routes
- Momentum-based movement (strafe-jumping, bunny-hopping)

Current bot movement: walk in a direction and hope for the best. No pathfinding, no wall avoidance, no understanding of map topology.

## 2. Existing Systems We Can Leverage

| System | What It Does | Navigation Use |
|--------|-------------|----------------|
| `CollisionWorld` | BSP geometry traces (raycast, swept AABB) | Walk/jump edge detection |
| `BotVision.isPathClear()` | Player-sized AABB sweep between points | Ground path validation |
| `BotVision.canSee()` | Zero-radius LOS raycast | Visibility connectivity |
| `BotVision.findNearestItem()` | Finds BSP item positions by type | Natural waypoint positions |
| `MapKnowledgeData` | Spawn points + pickup positions from BSP | Waypoint seed data |
| `BotGameState.mapKnowledge` | Death positions, pickup times, learning data | Danger/reward maps |
| Server physics | Authoritative movement, gravity, jumppads | Real jump trajectories |

**Key insight**: We already have 80% of the infrastructure. The missing piece is a **graph that connects these systems**.

## 3. Architecture: Smart Waypoint Network (SWN)

### 3.1 Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Smart Waypoint Network                  │
│                                                          │
│  Layer 4: ML Route Optimizer (future)                    │
│     • Learned cost adjustments from gameplay             │
│     • Dynamic re-routing based on game state             │
│                                                          │
│  Layer 3: A* Pathfinder                                  │
│     • Graph search with weighted edges                   │
│     • Multi-goal queries (nearest health, etc.)          │
│                                                          │
│  Layer 2: Edge Connections (how to get between nodes)    │
│     • Walk / Jump / Fall / JumpPad / Teleporter          │
│     • Physics-probed: validated by real collision         │
│                                                          │
│  Layer 1: Waypoint Nodes (where can the bot stand)       │
│     • BSP items + spawns + grid-sampled floor positions   │
│                                                          │
│  Layer 0: Per-Tick Feelers (immediate obstacle avoidance)│
│     • 3-5 short raycasts for wall avoidance              │
│     • Runs regardless of pathfinding state               │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Layer 0: Per-Tick Feelers (Wall Avoidance)

Lightweight raycasting every tick for immediate obstacle reactions:

```
Bot facing direction →
         
    ╲   |   ╱         Cast 3-5 rays from bot center:
     ╲  |  ╱          - Forward (600 units)
      ╲ | ╱           - Forward-left 30° (400 units)
       ╲|╱            - Forward-right 30° (400 units)  
        B             - Left 60° (300 units, optional)
                      - Right 60° (300 units, optional)
```

When a ray hits geometry closer than threshold:

- **Steer away** from the hit direction
- **Slow down** if frontal ray is very close
- **Jump** if the obstacle is < step height (could be a ledge to hop over)

**Cost**: ~3-5 BSP traces per tick. Negligible.
**Purpose**: Prevents face-planting into walls. Works WITHOUT any pathfinding graph.

### 3.3 Layer 1: Waypoint Nodes

Sources of waypoint positions, in order of priority:

1. **BSP Item entities** — weapon spawns, health, armor, ammo
   - Already extracted into `MapKnowledgeData.pickupPositions`
   - ~20-40 per map, positioned at gameplay-critical locations
   - These ARE the strategic points of the map

2. **Spawn points** — player start positions
   - Already in `MapKnowledgeData.spawnPoints`
   - ~8-16 per map

3. **BSP Trigger entities** — jumppads, teleporters
   - Source position of `trigger_push` → jumppad start
   - Target/landing position → jumppad destination (may need physics probe)
   - `trigger_teleport` source and target positions

4. **Floor grid sampling** (fills navigation gaps)
   - Cast rays downward from a sparse 3D grid (every ~256 units)
   - Where ray hits solid → that's a valid floor position
   - Reject positions inside walls (`isInsideSolid()`)
   - Only needed in corridors/hallways with no items
   - ~50-100 additional waypoints

**Total per map**: ~80-200 waypoints. Lightweight graph.

### 3.4 Layer 2: Edge Connections

For each waypoint pair within proximity (~1500 units), test connectivity:

#### Walk Edge (bidirectional)

```
Condition: isPathClear(A, B) AND height difference < 40
Cost: euclidean distance
Both directions valid
```

#### Jump Edge (bidirectional, short gaps/ledges)

```
Condition: height diff 40-80 AND horizontal clear
Cost: distance × 1.3 (slightly penalized)
Jump arc simulation: can bot jump from lower → upper?
```

#### Fall Edge (one-way: high → low)

```
Condition: height diff > 80 AND landing is safe (floor below)
Cost: distance × 0.8 (fast! falling is free speed)
Direction: only from high to low
```

#### Jump Pad Edge (one-way: pad → landing)

```
Source: trigger_push entity position
Destination: physics-probed landing point (or BSP target key)
Cost: travel time (typically ~1-2 seconds)
Direction: one-way (source → destination)
```

#### Teleporter Edge (one-way or bidirectional)

```  
Source: trigger_teleport entity position
Destination: target entity position
Cost: near-zero (instant traversal!)
Direction: depends on map design
```

### 3.5 Layer 3: A* Pathfinding

Standard A* on the waypoint graph with weighted edges.

```typescript
interface NavNode {
    id: number;
    position: Vec3;
    type: 'item' | 'spawn' | 'jumppad' | 'teleporter' | 'floor';
    classname?: string;  // item_health_mega, weapon_rocketlauncher, etc.
}

interface NavEdge {
    from: number;
    to: number;
    type: 'walk' | 'jump' | 'fall' | 'jumppad' | 'teleporter';
    cost: number;         // base traversal cost
    dangerCost: number;   // learned danger adjustment (Layer 4)
}
```

**Multi-goal queries**: "Find nearest health pickup" = A* to all health nodes, return cheapest.

### 3.6 Layer 4: ML Route Optimization (Future)

The SWN graph structure is **perfect for reinforcement learning**:

- **State**: Current node + health + armor + weapons + enemy positions
- **Actions**: Which edge to take (which adjacent node to move toward)
- **Reward**: Survival time, damage dealt, items collected, kills

The ML layer adjusts edge costs dynamically:

- "This hallway is a death trap when enemy has RL" → increase cost
- "This route passes mega health" → decrease cost when low HP
- "Enemy just died, likely spawning near node X" → avoid/ambush routes

---

## 4. Innovative Ideas 💡

### 4.1 Physics-Probed Jump Arcs

**No one does this.** Instead of hardcoding "can the bot jump from A to B", we **simulate the jump using the actual game physics**:

1. Place virtual bot at position A
2. Apply jump impulse + forward velocity
3. Step physics for N frames
4. Record the trajectory arc
5. Where does it land? → That's our edge destination

**Why this is unique**: Jump behavior matches EXACTLY what a real player would experience. If physics change (gravity, jump height), the graph auto-adapts on rebuild.

### 4.2 Movement Memory ("Experience Map")

Bots already track `deathPositions` in `BotGameState.mapKnowledge`. Extend this:

- **Path recording**: Record the bot's actual movement path during gameplay
- **Success/failure tagging**: Did this path lead to a kill, death, or item pickup?
- **Heat maps**: Over many games, build statistical maps of "good positions" and "death zones"
- **Graph edge learns**: Edge costs adjust based on cumulative experience

This means **bots that played 1000 games navigate differently than fresh bots**.

### 4.3 Tactical Position Awareness ("Map Control Nodes")

Some waypoints are strategically more important:

- **Power item nodes**: Mega health, red armor — controlling these wins games
- **Chokepoint nodes**: Narrow hallways connecting map zones
- **Height advantage nodes**: Elevated platforms with good sightlines
- **Spawn trap nodes**: Positions that overlook common spawn points

These can be auto-detected:

- **Power items**: Already tagged by classname
- **Chokepoints**: Nodes with few connections (graph bottlenecks)
- **Height advantage**: Nodes with many visible-but-unreachable other nodes
- **Spawn proximity**: Nodes near spawn points

### 4.4 "Virtual Exploration" — Map Learning at Startup

**Revolutionary idea**: When a map first loads, run an accelerated invisible simulation:

1. Place a virtual bot at each spawn point
2. Have it walk random directions using feelers
3. Record where it goes, what it hits, where it falls
4. Build the waypoint graph from this exploration data
5. Run jump probes from ledges to find jump connections

This means the bot **discovers the map's navigation structure from first principles**, the same way a new player would explore. No hand-placed data needed.

### 4.5 Sound-Graph Navigation

BSP provides acoustic properties (some maps have area portals, volume changes). Even without that, we can approximate:

- Weapon fire sounds propagate through open paths
- If bot hears enemy shooting at node X, plan route that FLANKS node X instead of approaching head-on
- Sound → estimated enemy position → tactical route choice

This feeds into Layer 4 ML routing by adding a "stealth cost" to edges near an active enemy.

### 4.6 Predictive Item Timing Routes

Arena FPS item timing is fundamental. Bots can:

- Track when items were last picked up (`mapKnowledge.itemPickupTimes`)
- Know item respawn times from game rules
- Pre-plan routes that arrive at items exactly when they respawn
- Chain item pickups: "Mega health respawns in 5s, red armor in 8s → route: mega → RA"

This is basic for competitive play but rare in bot AI.

### 4.7 Live Gameplay Self-Training ("Autonomous Gym")

**This is potentially the most innovative concept in the entire system.**

Instead of training from pre-recorded demos, bots **learn by playing each other**:

```
┌───────────────────────────────────────────────────────┐
│              Autonomous Training Loop                  │
│                                                        │
│  1. Spawn 2+ bots on map (no humans needed)           │
│  2. Bots play match using current brain weights        │
│  3. Record outcomes per tick:                           │
│     • Position, health, armor, weapon                  │
│     • Action taken (which edge, which weapon, etc.)    │
│     • Result: kill, death, item pickup, damage dealt   │
│  4. After match: run brain.js training on outcomes     │
│  5. Update brain weights                               │
│  6. Start next match with improved brains              │
│  7. Repeat indefinitely (can run overnight)            │
│                                                        │
│  Result: Bots that improve without human involvement   │
└───────────────────────────────────────────────────────┘
```

**Why this is groundbreaking for arena FPS bots:**

- **No demo dependency**: Bots don't need human gameplay recordings
- **Self-play scaling**: 2 bots generate training data at 60 ticks/second = 7,200 data points per minute
- **Adversarial learning**: Bot A forces Bot B to get better, and vice versa (same principle as AlphaGo)
- **Overnight training**: Start a `train` command before bed → wake up to map-aware, combat-skilled bots
- **Map-specific**: Each map produces specialized bots that know ITS layout
- **Difficulty "grows"**: Easy bots become medium, medium become hard — naturally, through experience

**The training data pipeline looks like:**

```
Live Self-Play                Graph Learning              Brain Training
─────────────                ──────────────              ──────────────
Bot movement paths    →      Edge costs adjust           Combat decisions
Kill/death positions  →      Danger heat maps            Weapon selection
Item pickup timing    →      Item route optimization     ADS timing
Damage given/received →      Offensive positions         Movement patterns
```

**Critical connection**: The SWN graph (Layers 1-3) provides the STRUCTURE for learning, while live gameplay provides the DATA. Without the graph, RL has to learn from raw coordinates (slow, unstable). With the graph, RL learns which graph edges to take (fast, stable, discrete action space).

**Implementation approach:**

- `BotTrainer` class manages the training loop
- Runs headless game servers at accelerated tick rate (no rendering = fast)  
- Each match logs a training episode
- brain.js processes episodes in batch after each match
- Updated weights are loaded for the next match
- Training stats tracked: win rate, avg survival time, items/min, damage/min

---

## 5. Build Order (Implementation Phases)

### Phase 1: Immediate — Feelers (Layer 0)

- Add 3-5 ray feeler casts to `StateMachineBrain`
- Steer away from walls, slow down near obstacles
- **Immediate improvement: bot stops face-planting**
- Estimated: ~50 lines of code

### Phase 2: Waypoint Extraction (Layer 1)

- New file: `BotNavGraph.ts`
- Extract waypoints from BSP items + spawns
- Add floor grid sampling for gap filling
- Store as `NavNode[]` array
- Estimated: ~150 lines

### Phase 3: Edge Building (Layer 2)

- Walk edge detection via `isPathClear()`
- Jump edge detection via height difference + collision check
- Fall edge detection (one-way downward drops)
- Store as adjacency list
- Save/load graph as JSON per map (cache)
- Estimated: ~200 lines

### Phase 4: Pathfinding (Layer 3)

- A* implementation on the NavGraph
- Integration with StateMachineBrain states (HUNT, ITEM_RUN, RETREAT)
- Bot follows waypoint-to-waypoint paths
- Feelers (Layer 0) handle micro-corrections during path following
- Estimated: ~300 lines

### Phase 5: Special Traversal  

- Jump pad edge detection from BSP entities
- Teleporter edge detection from BSP entities
- Physics-probed jump arcs for elevation changes
- Estimated: ~200 lines

### Phase 6: Intelligence (Layer 4 — ML)

- Edge cost adjustment from gameplay statistics
- Item timing route planning
- Danger avoidance from death heat maps
- Tactical position awareness
- This is where ML training complements the graph

### Phase 7: Autonomous Gym (Self-Training)

- `BotTrainer` class for managing multi-bot training sessions
- Headless server integration (fast simulation, no rendering)
- Per-match episode recording and brain.js batch training
- Training dashboard: win rate evolution, navigation efficiency, combat stats
- Difficulty curve: save checkpoint weights for easy/medium/hard bot tiers
- Estimated: ~500 lines + training infrastructure

---

## 6. Data Flow

```
BSP File (map geometry + entities)
    │
    ├─── CollisionWorld (traces)
    │        │
    │        └─── Feelers (per-tick wall avoidance)
    │        └─── Edge validation (isPathClear, canSee)
    │
    ├─── MapKnowledgeData (items, spawns)
    │        │
    │        └─── Waypoint nodes (Layer 1)
    │
    └─── BSP Entities (trigger_push, trigger_teleport)
             │
             └─── Special traversal edges (Layer 2)

Waypoints + Edges = NavGraph
    │
    └─── A* Pathfinder (Layer 3)
             │
             └─── StateMachineBrain
                      │
                      ├─── HUNT: Path to patrol waypoints
                      ├─── ITEM_RUN: Path to nearest health/armor
                      ├─── RETREAT: Path away from threat
                      └─── FIGHT: Feelers only (focus on combat)

Live Gameplay ──→ Episode Data ──→ brain.js Training ──→ Updated Weights
     ↑                                                         │
     └─────────────────────────────────────────────────────────┘
                        (Autonomous Gym Loop)
```

---

## 7. Why This Is Different

| Feature | Traditional Bots (Q3/UT) | Modern NavMesh | Our SWN |
|---------|-------------------------|----------------|---------|
| Map data source | Hand-placed waypoints | Pre-baked mesh | BSP-derived auto-extraction |
| Jump/pad handling | Manual link editing | Not handled well | Physics-probed arcs |
| Runtime cost | Low | Medium | Low (sparse graph) |
| Map support | Per-map manual work | Per-map generation | Auto for any BSP map |
| Learning | None | None | Live self-play RL |
| Multi-level | Waypoint IDs only | Full mesh | Physics-validated edges |
| Adapts to changes | No | Re-bake needed | Re-probe on load |
| Gets better over time | No | No | Yes — autonomous training |
| Training data source | N/A | N/A | Self-generated gameplay |

**The innovation**: No one combines BSP collision probing + physics simulation + sparse graph + live self-play reinforcement learning in a single system. Most bots either use hand-placed data OR heavy navmeshes, and NONE of them improve through autonomous gameplay. We use the map's own physics as our navigation oracle, and the bot's own experience as its teacher.

---

## 8. Open Questions

1. **Jump pad detection**: Do our BSP maps use `trigger_push` entities? Need to verify entity data
2. **Graph caching**: Should we save/load pre-built graphs per map, or rebuild each session?
3. **Grid sampling resolution**: 256 units? 384? Too dense = slow build, too sparse = missing paths
4. **Vertical navigation**: Stairs vs ramps vs ledges — different handling needed?
5. **Multi-bot coordination**: Should bots share graph data or learn independently?
6. **Self-training speed**: Can we run game simulation faster than real-time? (headless = no render wait)
7. **Checkpoint strategy**: How often to save training checkpoints? After every match? Every 10?
8. **Difficulty tiers**: Save early weights as "easy" bot, mid training as "medium", final as "hard"?
9. **Cross-map transfer**: Can a bot trained on map A transfer some learning to map B?

---

## 9. BotMovementProfile — Static Movement Knowledge

Like `BotWeaponProfile` provides static weapon knowledge, `BotMovementProfile` will provide **static movement mechanics knowledge**. The bot needs to know HOW each mechanic works (input recipe, effect, restrictions) before ML can learn WHEN to use them in context.

### 9.1 Available InputButtons (from `InputComponent.ts`)

```typescript
// Bit flags the bot can send to the server:
FORWARD:   1 << 0    // Move forward
BACK:      1 << 1    // Move backward
LEFT:      1 << 2    // Strafe left
RIGHT:     1 << 3    // Strafe right
JUMP:      1 << 4    // Jump (hold for auto-hop)
CROUCH:    1 << 5    // Crouch (also triggers crouchslide)
SPRINT:    1 << 6    // Sprint (1.5× speed)
WALK:      1 << 7    // Walk (slow)
FIRE:      1 << 8    // Primary fire
ALT_FIRE:  1 << 9    // ADS / alt fire
```

### 9.2 Movement Mechanics Reference

All values from `MovementVars.ts` — these are the actual game physics:

#### WALK (Base Movement)

```
Input:    FORWARD / BACK / LEFT / RIGHT
Speed:    280 ups (units per second)
Effect:   Standard ground movement. Full weapon control
Can fire: YES
Use for:  Default combat movement, strafing in fights
```

#### SPRINT

```
Input:    SPRINT + FORWARD
Speed:    400 ups (1.5× base)
Effect:   Faster forward movement
Can fire: NO (weapon tilts up, cannot shoot while sprinting)
Use for:  Closing distance, retreating, rushing to items
Note:     Required to build speed for crouchslide (need 375+ ups)
```

#### JUMP / BUNNY HOP

```
Input:    JUMP (hold for auto-hop, sv_autohop = 1)
Height:   320 upward velocity
Gravity:  1000 ups²
Effect:   Airborne, preserves horizontal momentum
Can fire: YES
Use for:  Dodging in combat, reaching ledges, maintaining speed
Chain:    Hold JUMP for continuous bunny hop — preserves/builds speed!
Top speed: 1000 ups (hard cap, acceleration falls off approaching this)
```

#### STRAFE-JUMP (Momentum Building)

```
Input:    JUMP + LEFT/RIGHT + gradual yaw turn into strafe direction
Speed:    Builds to ~550+ ups with technique, up to 1000 cap
Air ctrl: sv_aircontrol = 150, sv_maxairspeed = 30
Effect:   Quake/Warsow-style momentum building. Each jump adds speed
Can fire: YES (but hard to aim while turning)
Use for:  Map traversal at high speed, approaching/escaping fights
Skill:    This is what ML should LEARN to optimize — it's the core FPS skill
Note:     Bot needs to coordinate yaw + strafe direction + jump timing
```

#### CROUCH-SLIDE

```
Input:    CROUCH while moving at speed ≥ 375 ups (sprint first!)
Speed:    Current speed × 1.2 initial boost, decays at 0.5/sec
Duration: Max 800ms
Friction: 0.1 (very low — slides far!)
Cooldown: 1500ms between slides
Can fire: YES — lower profile while sliding!
Use for:  Dodging under projectiles, escape sequences, gaining distance
Bonus:    Jump during slide = 1.3× velocity boost (slide-jump cancel!)
Sequence: SPRINT → build 375+ speed → CROUCH → slide → JUMP to cancel with speed boost
```

#### WALL-JUMP

```
Input:    JUMP while airborne + near wall (within 20 units)
Height:   280 upward velocity
Bounce:   0.8× horizontal velocity preservation
Charge:   0.2s charge time (brief pause on wall)
Boost:    1.2× velocity multiplier after charged jump
Cooldown: 1.0s between wall jumps
Min alt:  Must be 32+ units above ground
Can fire: YES (briefly)
Use for:  Reaching higher platforms, escaping, surprising enemies
Sequence: JUMP (off ground) → approach wall → JUMP again (triggers wall jump)
```

#### LEDGE-GRAB

```
Input:    Move toward ledge while airborne + within reach
Reach:    32 units forward, 64 units above feet
Timeout:  2.0s max hang time, auto-drops
Pull-up:  0.35s, triggered by JUMP or FORWARD while hanging
Can fire: NO (hanging state)
Use for:  Reaching platforms that are slightly too high to jump to
Sequence: JUMP toward ledge → auto-grab → JUMP/FORWARD to pull up
```

### 9.3 Composite Maneuvers (for StateMachineBrain)

These combine basic mechanics into tactical sequences the bot should know:

#### "Escape Sequence" (Disengage from fight)

```
1. Turn 90-180° away from enemy (face open direction)
2. Switch to blade (weapon with speedBonus)
3. SPRINT + FORWARD to build speed
4. At 375+ ups: CROUCH to enter crouchslide
5. Optional: JUMP to cancel slide with 1.3× speed boost
6. Continue strafe-jumping to maintain speed
Result: Rapid disengagement with distance gained
```

#### "Height Advantage" (Reach elevated position)

```
1. Approach wall while sprinting
2. JUMP off ground
3. JUMP again near wall (wall-jump) for 280 upward velocity
4. If ledge detected → auto-grab → JUMP to pull up
Result: Reach positions that would normally be jump-pad only
```

#### "Combat Strafe" (Fight while dodging)

```
1. Alternate LEFT/RIGHT strafe on timer (already implemented)
2. Mix in occasional JUMP (already done — 2% chance/tick)
3. CROUCH briefly during incoming projectile to reduce profile
4. Keep firing throughout
Result: Harder to hit while maintaining pressure
```

### 9.4 Static Profile Data Structure

```typescript
interface MovementMechanic {
    id: string;                    // 'sprint', 'crouchslide', etc.
    inputRecipe: number[];         // Sequence of InputButtons bitmasks
    minSpeedRequired: number;      // 0 for most, 375 for crouchslide
    speedEffect: number;           // Resulting speed multiplier
    canFire: boolean;              // Can you shoot during this move?
    duration: number;              // Max duration (0 = unlimited)
    cooldown: number;              // Time before can use again
    useWhen: MoveContext[];        // Tactical contexts
}

type MoveContext = 
    | 'escaping'       // Disengaging from fight
    | 'approaching'    // Closing distance to enemy
    | 'dodging'        // Evading incoming fire
    | 'traversing'     // Moving between map locations
    | 'reaching'       // Getting to elevated positions
    | 'combat';        // During active fight
```

### 9.5 What's Static vs What's Learned

| Aspect | Static (BotMovementProfile) | Learned (ML Training) |
|--------|---------------------------|----------------------|
| Input recipe | ✅ "SPRINT + CROUCH = slide" | ❌ |
| Speed values | ✅ "slide = 1.2× boost" | ❌ |
| Restrictions | ✅ "can't fire while sprinting" | ❌ |
| WHEN to sprint | ❌ | ✅ "sprint when retreating at low HP" |
| WHEN to slide | ❌ | ✅ "slide past RL doorway" |
| WHEN to wall-jump | ❌ | ✅ "wall-jump here reaches mega health" |
| Strafe-jump technique | ✅ basic inputs | ✅ optimal timing/angles |
| Escape sequence | ✅ step order | ✅ when to abort, re-engage |

---

## 10. TensorFlow.js Neural Network Integration

### 10.1 Why TensorFlow.js (`@tensorflow/tfjs-node`)?

- **Native C++ backend** — `@tensorflow/tfjs-node` links to the TensorFlow C binary, near-native training speed
- **Full training framework** — `model.fit()`, `model.trainOnBatch()`, streaming data support
- **Memory management** — `tf.tidy()` and `tf.dispose()` prevent leaks during long training sessions
- **GPU optional** — `@tensorflow/tfjs-node-gpu` for CUDA acceleration if available
- **Industry standard** — Google-backed, massive ecosystem, first-class TypeScript support
- **Model complexity** — supports dense, LSTM, convolutional, and custom layers
- **Fast inference** — <0.5ms for our network sizes, well within 16ms tick budget

```bash
pnpm add @tensorflow/tfjs-node
```

> **Why not brain.js?** brain.js is pure JavaScript — fine for tiny demos, but training is 100-1000× slower than TF.js's C++ backend. For the autonomous gym (overnight training), brain.js would be impractical.

### 10.2 Architecture: Two Networks, Not One

**Key insight**: A single neural network trying to handle everything (aim, move, shoot, weapon select) would be enormous and slow to train. Instead, we use **two small specialized networks**:

```
┌───────────────────────────────────────────────────────────┐
│                     BotBrain (Hybrid)                      │
│                                                            │
│  ┌──────────────────────┐   ┌──────────────────────────┐  │
│  │  TacticalBrain (NN)  │   │  CombatBrain (NN)        │  │
│  │                      │   │                           │  │
│  │  "WHAT to do"        │   │  "HOW to fight"          │  │
│  │                      │   │                           │  │
│  │  Inputs:             │   │  Inputs:                  │  │
│  │  • Health/armor      │   │  • Enemy distance/angle   │  │
│  │  • Weapon inventory  │   │  • Current weapon profile │  │
│  │  • Nav graph position│   │  • Enemy velocity         │  │
│  │  • Enemy positions   │   │  • Own velocity/state     │  │
│  │  • Item timings      │   │  • Weapon ammo            │  │
│  │                      │   │                           │  │
│  │  Outputs:            │   │  Outputs:                 │  │
│  │  • Target nav node   │   │  • Aim pitch/yaw adjust   │  │
│  │  • Movement mechanic │   │  • Fire/don't fire        │  │
│  │  • Engagement mode   │   │  • ADS on/off             │  │
│  │  • Weapon to switch  │   │  • Movement mechanic      │  │
│  └──────────────────────┘   └──────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  StateMachineBrain (Rule-based, EXISTING)            │  │
│  │                                                      │  │
│  │  Still handles: state transitions, respawn,          │  │
│  │  hunt patrol, basic fallbacks                        │  │
│  │                                                      │  │
│  │  Neural nets ENHANCE decisions, not replace them     │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

**The hybrid approach**: StateMachineBrain stays as the backbone (DEAD → FIGHT → HUNT → RETREAT). Neural networks **augment specific decisions** within each state, not replace the state machine. This means:

- Fresh untrained bots still work (state machine handles everything)
- Training improves specific skills gradually
- No catastrophic failure if network outputs garbage

### 10.3 Neural Network Input Design

**All inputs MUST be normalized to 0.0–1.0** (brain.js requirement).

#### TacticalBrain Inputs (~25 neurons)

```typescript
// Game state → normalized 0-1 values
const tacticalInput = {
    // Self state (5 inputs)
    health: self.health / 200,              // 0-200 → 0-1
    armor: self.armor / 200,                // 0-200 → 0-1
    speed: selfSpeed / 1000,                // 0-1000 → 0-1 (normalized by topspeed)
    isGrounded: self.isGrounded ? 1 : 0,    // boolean → 0/1
    isDead: self.isDead ? 1 : 0,            // boolean → 0/1

    // Current weapon (from BotWeaponProfile — static data as NN input!)
    wpn_isMelee: currentProfile.isMelee ? 1 : 0,
    wpn_isHitscan: currentProfile.isHitscan ? 1 : 0,
    wpn_isProjectile: currentProfile.isProjectile ? 1 : 0,
    wpn_needsADS: currentProfile.needsADS ? 1 : 0,
    wpn_dps: currentProfile.dps / 300,      // normalize by max DPS
    wpn_ammoRatio: currentAmmo / maxAmmo,   // 0-1

    // Best available weapons (3 slots × 2 = 6 inputs)
    // Encodes "what firepower do I have?"
    bestWpn1_dps: bestWeapons[0]?.dps / 300 ?? 0,
    bestWpn1_ammo: bestWeapons[0]?.ammoRatio ?? 0,
    bestWpn2_dps: bestWeapons[1]?.dps / 300 ?? 0,
    bestWpn2_ammo: bestWeapons[1]?.ammoRatio ?? 0,
    bestWpn3_dps: bestWeapons[2]?.dps / 300 ?? 0,
    bestWpn3_ammo: bestWeapons[2]?.ammoRatio ?? 0,

    // Enemy info (4 inputs)
    enemy_distance: Math.min(enemy.distance, 3000) / 3000,
    enemy_relativeAngle: (enemyAngle + Math.PI) / (2 * Math.PI),  // -π..π → 0-1
    enemy_visible: enemy.isVisible ? 1 : 0,
    enemy_confidence: enemyTrack?.confidence ?? 0,

    // Navigation context (from SWN graph)
    nearestHealth_distance: nearestHealth / 3000,
    nearestArmor_distance: nearestArmor / 3000,
    navNode_connections: currentNode.edges.length / 10, // graph connectivity
};
```

#### CombatBrain Inputs (~18 neurons)

```typescript
const combatInput = {
    // Enemy relative position (3 inputs)
    enemy_dist: Math.min(enemy.distance, 3000) / 3000,
    enemy_pitch: (enemyPitch + Math.PI/2) / Math.PI,   // -π/2..π/2 → 0-1
    enemy_yaw: (enemyYawDiff + Math.PI) / (2 * Math.PI),

    // Enemy movement (3 inputs)
    enemy_speedX: clamp(enemy.velocity.x / 500, -1, 1) * 0.5 + 0.5,
    enemy_speedY: clamp(enemy.velocity.y / 500, -1, 1) * 0.5 + 0.5,
    enemy_speedZ: clamp(enemy.velocity.z / 500, -1, 1) * 0.5 + 0.5,

    // Self state (4 inputs)
    self_health: self.health / 200,
    self_speed: selfSpeed / 1000,
    self_isGrounded: self.isGrounded ? 1 : 0,
    self_isSliding: self.isSliding ? 1 : 0,

    // Current weapon profile (5 inputs — from static BotWeaponProfile!)
    wpn_isHitscan: profile.isHitscan ? 1 : 0,
    wpn_projectileSpeed: profile.projectileSpeed / 3000,
    wpn_hasSplash: profile.hasSplash ? 1 : 0,
    wpn_needsADS: profile.needsADS ? 1 : 0,
    wpn_fireMode_auto: profile.fireMode === 'auto' ? 1 : 0,

    // Combat context (3 inputs)
    ammoRatio: currentAmmo / maxAmmo,
    timeSinceDamage: Math.min(ticksSinceDamage, 120) / 120,
    recentlyTookDamage: ticksSinceDamage < 30 ? 1 : 0,
};
```

### 10.4 Neural Network Output Design

#### TacticalBrain Outputs (~8 neurons)

```typescript
// Each output is 0-1, interpreted as probability/preference
const tacticalOutput = {
    // Engagement mode (softmax-like, highest wins)
    mode_fight: 0.8,        // Stay and fight
    mode_retreat: 0.1,      // Disengage, find health
    mode_itemRun: 0.05,     // Go grab items
    mode_hunt: 0.05,        // Patrol / seek enemy

    // Movement mechanic preference
    move_walk: 0.2,         // Normal movement
    move_sprint: 0.1,       // Sprint (can't fire)
    move_crouchslide: 0.6,  // Crouchslide (if fast enough)
    move_jump: 0.3,         // Jump/bunnyhop

    // Weapon selection (index of preferred weapon, encoded)
    // 0 = keep current, 0.33 = best for range, 0.66 = blade for speed, 1.0 = forced switch
    weaponPreference: 0.33,
};
```

#### CombatBrain Outputs (~6 neurons)

```typescript
const combatOutput = {
    // Aim adjustment (relative to current aim)
    aimAdjustPitch: 0.5,    // 0 = nudge down, 0.5 = no change, 1 = nudge up
    aimAdjustYaw: 0.5,      // 0 = nudge left, 0.5 = no change, 1 = nudge right

    // Actions
    shouldFire: 0.9,         // >0.5 = fire
    shouldADS: 0.7,          // >0.5 = ADS
    shouldJump: 0.1,         // >0.5 = jump (dodge)
    shouldCrouch: 0.3,       // >0.5 = crouch (reduce profile)
};
```

### 10.5 How Static Profiles Feed Into Neurons

**This is the critical connection.** Static profiles DON'T replace neurons — they BECOME neuron inputs:

```
BotWeaponProfile                      Neural Network
┌──────────────────┐                  ┌────────────────┐
│ isMelee: true    │──→ 1.0 ─────────│ Input neuron 6 │
│ isHitscan: false │──→ 0.0 ─────────│ Input neuron 7 │
│ needsADS: false  │──→ 0.0 ─────────│ Input neuron 8 │
│ dps: 160         │──→ 0.53 ────────│ Input neuron 9 │
│ projectileSpeed:0│──→ 0.0 ─────────│ Input neuron 10│
└──────────────────┘                  │     ...        │
                                      │  Hidden layers  │
BotMovementProfile                    │     ...        │
┌──────────────────┐                  │                │
│ canSlide: speed≥375──→ computed ───│ Input neuron 14│
│ slideOnCooldown  │──→ 0.0/1.0 ────│ Input neuron 15│
│ wallJumpReady    │──→ 0.0/1.0 ────│ Input neuron 16│
└──────────────────┘                  └────────────────┘
```

The network learns patterns like:

- "When `wpn_isMelee=1` AND `enemy_dist < 0.05` → `shouldFire=HIGH`" (swing blade up close)
- "When `wpn_needsADS=1` AND `shouldFire=HIGH` → `shouldADS=HIGH`" (ADS when firing hipfire-blocked weapon)
- "When `self_health < 0.2` AND `enemy_dist > 0.3` → `mode_retreat=HIGH`" (retreat when low HP)

**The static profiles give the network the VOCABULARY. Training teaches it the GRAMMAR.**

### 10.6 TensorFlow.js Implementation

```typescript
import * as tf from '@tensorflow/tfjs-node';

// Create TacticalBrain model
const tacticalModel = tf.sequential({
    layers: [
        tf.layers.dense({ inputShape: [25], units: 16, activation: 'relu' }),
        tf.layers.dense({ units: 12, activation: 'relu' }),
        tf.layers.dense({ units: 8, activation: 'sigmoid' }), // 0-1 outputs
    ]
});
tacticalModel.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' });

// Create CombatBrain model
const combatModel = tf.sequential({
    layers: [
        tf.layers.dense({ inputShape: [18], units: 12, activation: 'relu' }),
        tf.layers.dense({ units: 8, activation: 'relu' }),
        tf.layers.dense({ units: 6, activation: 'sigmoid' }),
    ]
});
combatModel.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' });

// Training (from collected gameplay data — C++ backend = FAST)
await tacticalModel.fit(inputTensor, outputTensor, {
    epochs: 50,
    batchSize: 32,
    validationSplit: 0.1,
    callbacks: { onEpochEnd: (epoch, logs) => console.log(`Epoch ${epoch}: loss=${logs?.loss}`) }
});

// Inference (every tick, <0.5ms with C++ backend)
const decision = tf.tidy(() => {
    const input = tf.tensor2d([normalizedInputArray]);
    return tacticalModel.predict(input) as tf.Tensor;
});

// Save/load models (built-in file I/O)
await tacticalModel.save('file://./models/tactical_wdm7');
const loaded = await tf.loadLayersModel('file://./models/tactical_wdm7/model.json');
```

**Key advantage: `tf.tidy()`** — automatically disposes intermediate tensors, preventing memory leaks during the thousands of inferences per match.

### 10.7 Hybrid Architecture: StateMachine + Neural Net

```typescript
class HybridBrain extends BotBrain {
    private stateMachine: StateMachineBrain;  // Existing rule-based brain
    private tacticalModel: tf.LayersModel | null;
    private combatModel: tf.LayersModel | null;

    decide(state: BotGameState): BotInput {
        // 1. State machine provides base decision
        const baseInput = this.stateMachine.decide(state);

        // 2. If neural nets are loaded, they ENHANCE the decision
        if (this.tacticalModel) {
            const tactical = tf.tidy(() => {
                const input = tf.tensor2d([this.buildTacticalInput(state)]);
                return (this.tacticalModel!.predict(input) as tf.Tensor).dataSync();
            });
            
            // Override state machine's mode if network is confident
            if (tactical.mode_retreat > 0.7 && state.self.health < 80) {
                // Network says retreat — override fight state
                return this.executeRetreat(state, tactical);
            }
            
            // Apply movement mechanic preference
            if (tactical.move_crouchslide > 0.6 && this.canSlide(state)) {
                baseInput.buttons |= InputButtons.CROUCH;
            }
        }

        if (this.combatModel && this.isInCombat(state)) {
            const combat = tf.tidy(() => {
                const input = tf.tensor2d([this.buildCombatInput(state)]);
                return (this.combatModel!.predict(input) as tf.Tensor).dataSync();
            });
            
            // Refine aim based on network
            if (combat.shouldADS > 0.5) {
                baseInput.buttons |= InputButtons.ALT_FIRE;
            }
            if (combat.shouldFire > 0.5) {
                baseInput.buttons |= InputButtons.FIRE;
            } else {
                baseInput.buttons &= ~InputButtons.FIRE;
            }
        }

        return baseInput;
    }
}
```

**Fallback safety**: If no models are loaded, `HybridBrain` falls back to pure `StateMachineBrain`. Training makes it better, but it's never broken. All tensor ops wrapped in `tf.tidy()` to prevent memory leaks.

### 10.8 Training Data Collection (Per-Tick Episode Recording)

```typescript
interface TrainingFrame {
    tick: number;

    // Inputs (same as NN input format)
    tacticalInput: Record<string, number>;
    combatInput: Record<string, number>;

    // What the bot actually did
    action: {
        buttons: number;
        weaponSlot: number;
        yaw: number;
        pitch: number;
    };

    // Outcome (computed after the fact, or after delay)
    reward: {
        damageDealt: number;      // +reward
        damageTaken: number;      // -reward
        kill: boolean;            // +big reward
        death: boolean;           // -big reward
        itemPickedUp: boolean;    // +reward
        healthGained: number;     // +reward
    };
}
```

Rewards are **delayed** — we don't know if a decision was good until several ticks later. The training pipeline assigns rewards retrospectively:

- Kill at tick 500 → reward flows back to ticks 480-499 (actions that led to the kill)
- Death at tick 500 → penalty flows back to ticks 480-499

### 10.9 Autonomous Training Loop (`BotTrainer`)

```typescript
class BotTrainer {
    async trainOnMap(mapName: string, rounds: number) {
        for (let round = 0; round < rounds; round++) {
            // 1. Start headless game server
            const server = await this.startHeadlessServer(mapName);
            
            // 2. Connect 2+ bots with current weights
            const bots = await this.connectBots(server, 2);
            
            // 3. Play match (time-limited, e.g. 3 minutes)
            const episodes = await this.playMatch(bots, 180_000);
            
            // 4. Compute rewards for each frame
            const trainingData = this.computeRewards(episodes);
            
            // 5. Train models on this match's data (C++ backend = fast!)
            await this.tacticalModel.fit(trainingData.tacticalInputs, 
                trainingData.tacticalOutputs, { epochs: 10, batchSize: 32 });
            await this.combatModel.fit(trainingData.combatInputs, 
                trainingData.combatOutputs, { epochs: 10, batchSize: 32 });
            
            // 6. Log progress
            console.log(`Round ${round}: kills=${stats.kills}, deaths=${stats.deaths}, ` +
                        `items=${stats.items}, avgSurvival=${stats.avgSurvival}s`);
            
            // 7. Save checkpoint every 10 rounds
            if (round % 10 === 0) {
                await this.saveCheckpoint(round);  // tf model.save()
            }
        }
    }
}

// CLI: npm run bot:train -- --map wdm7 --rounds 500
```

### 10.10 Implementation Order

Everything builds on what came before:

```
Phase 1 ─── Static Profiles (DONE ✅)
  └─ BotWeaponProfile (done)
  └─ BotMovementProfile (next) 

Phase 2 ─── Navigation (Layer 0-3)
  └─ Feelers → Waypoints → Edges → A*
  └─ Bot can navigate maps intelligently

Phase 3 ─── TensorFlow.js Setup
  └─ pnpm add @tensorflow/tfjs-node
  └─ HybridBrain class (wraps StateMachineBrain)
  └─ Input normalization → tf.tensor2d
  └─ Output interpretation from prediction tensors
  └─ model.save() / tf.loadLayersModel() for persistence
  └─ tf.tidy() wrappers for memory safety

Phase 4 ─── Training Data Collection
  └─ TrainingFrame recording per tick
  └─ Reward computation (delayed, retrospective)
  └─ Episode serialization (JSON per match)

Phase 5 ─── Autonomous Training
  └─ BotTrainer class
  └─ Headless server integration
  └─ Training loop + checkpoint saving
  └─ npm run bot:train CLI command

Phase 6 ─── Difficulty Tiers
  └─ Save checkpoints as easy/medium/hard
  └─ Bot difficulty selection in lobby
  └─ Fresh untrained = easy, 100 rounds = medium, 1000 = hard
```

### 10.11 Network Sizes (Performance Budget)

| Network | Inputs | Hidden | Outputs | Total Weights | Inference |
|---------|--------|--------|---------|--------------|-----------|
| TacticalBrain | ~25 | 16, 12 | ~8 | ~700 | <0.5ms |
| CombatBrain | ~18 | 12, 8 | ~6 | ~400 | <0.3ms |
| **Total per tick** | | | | **~1100** | **<1ms** |

At 60Hz with 16ms tick budget, <1ms for neural inference leaves 15ms+ for game logic. Easily within budget.

With `@tensorflow/tfjs-node` C++ backend, training a batch of 32 frames takes ~2-5ms. A full 3-minute match (~10,800 frames) trains in ~3-5 seconds. **500 rounds of overnight training = ~25-40 minutes**. This is orders of magnitude faster than brain.js would achieve.

---

## 11. Detailed Implementation Plan

### 11.1 Package Integration

```bash
# TensorFlow.js with native C++ backend
pnpm add @tensorflow/tfjs-node
```

**Key considerations:**

- Goes in `dependencies` (not devDependencies) — bots run in production
- `@tensorflow/tfjs-node` has a native addon — `pnpm install` will compile it
- Package is ~150MB (includes TF C++ binary) — only loaded by bot server, never by browser client
- **ESM compatibility**: The project uses `"type": "module"` in package.json and `vite-node` for CLI tools. TF.js supports ESM: `import * as tf from '@tensorflow/tfjs-node'`
- `vite-node` handles the ESM/CJS bridge for us already (used by `bot:server`, `lobby:server`, etc.)

### 11.2 New File Structure

```
src/bot/
├── BotBrain.ts              # (existing) Abstract base — add reference to HybridBrain
├── BotClient.ts             # (existing) modify: support HybridBrain via factory
├── BotConfig.ts             # (existing) add: model paths config
├── BotGameState.ts          # (existing) keep as-is
├── BotVision.ts             # (existing) keep as-is
├── BotWeaponProfile.ts      # (existing) static weapon knowledge
├── StateMachineBrain.ts     # (existing) keep as-is — still the backbone
│
├── BotMovementProfile.ts    # [NEW] Static movement mechanics knowledge
├── BotInputNormalizer.ts    # [NEW] BotGameState → normalized 0-1 float arrays
├── HybridBrain.ts           # [NEW] StateMachineBrain + TF.js neural enhancement
├── BotTrainer.ts            # [NEW] Autonomous training loop
├── BotEpisodeRecorder.ts    # [NEW] Per-tick frame recording for training data
├── BotRewardComputer.ts     # [NEW] Delayed reward calculation
└── BotNavGraph.ts           # [NEW] Smart Waypoint Network (Phase 2)

models/                      # [NEW] TF.js saved model files
├── tactical_wdm7/
│   ├── model.json
│   └── weights.bin
└── combat_wdm7/
    ├── model.json
    └── weights.bin
```

### 11.3 Data Pipeline (Per-Tick Decision Flow)

```
Every tick (~16ms):

  BotGameState                BotWeaponProfile        BotMovementProfile
  ┌─────────────┐            ┌───────────────┐       ┌────────────────┐
  │ self.health  │            │ isMelee       │       │ canSlide       │
  │ self.armor   │            │ needsADS      │       │ slideOnCooldown│
  │ self.position│            │ dps           │       │ wallJumpReady  │
  │ self.velocity│            │ isProjectile  │       │ isGrounded     │
  │ visiblePlayers│           │ projectileSpd │       └────────────────┘
  │ currentWeapon│            └───────────────┘
  └──────┬──────┘                    │                        │
         │                           │                        │
         └───────────┬───────────────┴────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  BotInputNormalizer   │
         │                       │
         │  Combines all data    │
         │  into Float32Arrays   │
         │  normalized to 0-1    │
         │                       │
         │  tacticalInput[25]    │
         │  combatInput[18]      │
         └──────────┬────────────┘
                    │
                    ▼
         ┌───────────────────────┐
         │  tf.tidy(() => {      │  ← Memory-safe inference
         │    tf.tensor2d(input) │
         │    model.predict()    │
         │    .dataSync()        │  ← Synchronous! Returns Float32Array
         │  })                   │
         └──────────┬────────────┘
                    │
                    ▼
         ┌───────────────────────┐
         │  Output Interpreter   │
         │                       │
         │  mode_fight: 0.8      │──→ State override: stay in FIGHT
         │  move_slide: 0.6      │──→ Add CROUCH to buttons
         │  shouldFire: 0.9      │──→ Add FIRE to buttons
         │  shouldADS: 0.7       │──→ Add ALT_FIRE to buttons
         │  aimAdjustYaw: 0.55   │──→ Nudge yaw right slightly
         └──────────┬────────────┘
                    │
                    ▼
         ┌───────────────────────┐
         │  BotInput             │  ← Same interface as StateMachineBrain
         │  {                    │
         │    direction: {x,y,z} │
         │    pitch, yaw         │
         │    buttons            │
         │    weaponSlot         │
         │  }                    │
         └───────────────────────┘
```

### 11.4 BotInputNormalizer — The Bridge

This is the **critical file** that connects static profiles to neural inputs:

```typescript
// src/bot/BotInputNormalizer.ts
import type { BotGameState } from './BotGameState';
import { getWeaponProfile, selectBestWeapon } from './BotWeaponProfile';
import type { BotVision } from './BotVision';

export function buildTacticalInput(state: BotGameState, vision: BotVision | null): Float32Array {
    const input = new Float32Array(25);
    const self = state.self;

    // Self state [0-4]
    input[0] = self.health / 200;
    input[1] = self.armor / 200;
    input[2] = vec3Length(self.velocity) / 1000;  // speed / topspeed
    input[3] = self.isGrounded ? 1 : 0;           // from server snapshot
    input[4] = self.isDead ? 1 : 0;

    // Current weapon profile [5-10] — FROM STATIC BotWeaponProfile
    const profile = getWeaponProfile(self.currentWeapon);
    if (profile) {
        input[5] = profile.isMelee ? 1 : 0;
        input[6] = !profile.isProjectile ? 1 : 0;  // isHitscan
        input[7] = profile.isProjectile ? 1 : 0;
        input[8] = profile.needsADS ? 1 : 0;
        input[9] = profile.dps / 300;
        input[10] = (self.ammo.get(self.currentWeapon) ?? 0) /
                    (profile.maxAmmo ?? 100);
    }

    // Best weapons inventory [11-16]
    // ... encode top 3 weapons by DPS with ammo ratios

    // Enemy info [17-20]
    const enemy = state.visiblePlayers[0];  // nearest visible
    if (enemy) {
        input[17] = Math.min(vec3Distance(self.position, enemy.position), 3000) / 3000;
        input[18] = computeRelativeAngle(self, enemy);  // 0-1 normalized
        input[19] = 1;  // visible
        input[20] = state.enemyTrackConfidence ?? 0;
    }
    // else: inputs stay 0 (no enemy)

    // Navigation context [21-24]  — FROM BotVision
    if (vision) {
        const healthPos = vision.findNearestItem(self.position, 'health');
        const armorPos = vision.findNearestItem(self.position, 'armor');
        input[21] = healthPos ? Math.min(vec3Distance(self.position, healthPos), 3000) / 3000 : 1;
        input[22] = armorPos ? Math.min(vec3Distance(self.position, armorPos), 3000) / 3000 : 1;
        // navNode connectivity could go in [23-24]
    }

    return input;
}

export function buildCombatInput(state: BotGameState, enemy: VisiblePlayer): Float32Array {
    const input = new Float32Array(18);
    // ... similar pattern, all values 0-1
    return input;
}
```

**Key design decisions:**

- Returns `Float32Array` directly — avoids object allocation per tick
- `getWeaponProfile()` is a `Map.get()` — O(1), zero cost
- Movement profile checks are simple boolean comparisons
- All normalization is division by known max values — no dynamic computation

### 11.5 HybridBrain — Where It All Comes Together

```typescript
// src/bot/HybridBrain.ts
import * as tf from '@tensorflow/tfjs-node';
import { BotBrain, BotInput, BotState } from './BotBrain';
import { StateMachineBrain } from './StateMachineBrain';
import { buildTacticalInput, buildCombatInput } from './BotInputNormalizer';
import type { BotDifficulty } from './BotConfig';
import type { BotGameState } from './BotGameState';
import type { BotVision, VisionResult } from './BotVision';

export class HybridBrain extends BotBrain {
    private _stateMachine: StateMachineBrain;
    private _tacticalModel: tf.LayersModel | null = null;
    private _combatModel: tf.LayersModel | null = null;
    private _recorder: BotEpisodeRecorder | null = null;

    constructor(difficulty: BotDifficulty) {
        super(difficulty);
        this._stateMachine = new StateMachineBrain(difficulty);
    }

    /** Load pre-trained models (optional — works without them) */
    async loadModels(modelDir: string): Promise<void> {
        try {
            this._tacticalModel = await tf.loadLayersModel(
                `file://${modelDir}/tactical/model.json`
            );
            this._combatModel = await tf.loadLayersModel(
                `file://${modelDir}/combat/model.json`
            );
            console.log(`[HybridBrain] Loaded models from ${modelDir}`);
        } catch (e) {
            console.warn(`[HybridBrain] No models found, using pure state machine`);
        }
    }

    decide(state: BotGameState, vision?: BotVision | null, 
           visionResult?: VisionResult | null): BotInput {
        // 1. State machine gives us the base decision
        const baseInput = this._stateMachine.decide(state, vision, visionResult);
        const currentState = this._stateMachine.getState();

        // 2. Record frame for training (if recorder active)
        if (this._recorder) {
            this._recorder.recordFrame(state, baseInput);
        }

        // 3. If no models loaded → pure state machine (perfectly fine!)
        if (!this._tacticalModel) return baseInput;

        // 4. Run tactical model to enhance decision
        const enhanced = tf.tidy(() => {
            const tactInput = buildTacticalInput(state, vision ?? null);
            const tensor = tf.tensor2d([Array.from(tactInput)]);
            const pred = this._tacticalModel!.predict(tensor) as tf.Tensor;
            return pred.dataSync();  // Float32Array — synchronous, fast
        });

        // 5. Interpret tactical outputs → override/enhance base decision
        this._applyTacticalOutput(enhanced, baseInput, state, currentState);

        // 6. Combat model for aim/fire refinement (only during FIGHT)
        if (this._combatModel && currentState === BotState.FIGHT) {
            const enemy = state.visiblePlayers[0];
            if (enemy) {
                const combatOutput = tf.tidy(() => {
                    const cInput = buildCombatInput(state, enemy);
                    const tensor = tf.tensor2d([Array.from(cInput)]);
                    return (this._combatModel!.predict(tensor) as tf.Tensor).dataSync();
                });
                this._applyCombatOutput(combatOutput, baseInput);
            }
        }

        return baseInput;
    }
}
```

### 11.6 BotClient Integration

The only change in `BotClient.ts` — use a brain factory:

```typescript
// In BotClient constructor:
constructor(options: BotOptions) {
    // ...existing code...

    // Create AI brain — HybridBrain wraps StateMachineBrain
    if (options.modelDir) {
        this._brain = new HybridBrain(this._difficulty);
        (this._brain as HybridBrain).loadModels(options.modelDir);
    } else {
        this._brain = new StateMachineBrain(this._difficulty);
    }
}
```

Bot server passes `--models ./models/wdm7` → bots load TF.js models.
No flag → pure state machine. **Zero breaking changes.**

### 11.7 Training Data Lifecycle

```
Match Start
    │
    ├─ BotEpisodeRecorder starts recording
    │   Every tick:
    │   ├─ Capture normalized inputs (Float32Array)
    │   ├─ Capture action taken (buttons, weapon, aim)
    │   └─ Capture raw outcomes (damage, health changes)
    │
Match End
    │
    ├─ BotRewardComputer processes the episode
    │   ├─ Compute per-frame rewards:
    │   │   ├─ kill = +1.0 (flows back 20 ticks with decay)
    │   │   ├─ death = -1.0 (flows back 20 ticks)
    │   │   ├─ damageDealt = +0.01 per HP
    │   │   ├─ damageTaken = -0.01 per HP
    │   │   ├─ itemPickup = +0.2
    │   │   └─ survivalBonus = +0.001 per tick alive
    │   │
    │   └─ Output: Array<{ input: Float32Array, output: Float32Array }>
    │       └─ "output" = reward-weighted optimal action
    │
    ├─ BotTrainer runs model.fit() on the episode
    │   ├─ Convert arrays to tf.tensor2d
    │   ├─ model.fit(inputs, outputs, { epochs: 10, batchSize: 32 })
    │   └─ tf.dispose() all tensors after training
    │
    └─ Save checkpoint if needed
        └─ model.save('file://./models/tactical_wdm7')
```

### 11.8 CLI Commands

```jsonc
// package.json additions:
{
    "scripts": {
        "bot:train": "npx vite-node src/cli/bot-train.ts --",
        // Usage: pnpm bot:train -- --map wdm7 --rounds 500 --bots 2
    }
}

// src/cli/bot-train.ts
// Parses args → creates BotTrainer → runs training loop
// Headless: starts game server subprocess, connects bots, plays matches
```

### 11.9 Model Files Organization

```
models/
├── untrained/              # Fresh model architectures (no weights)
│   ├── tactical.json       # Model topology only
│   └── combat.json
│
├── wdm7/                   # Map-specific trained models
│   ├── tactical/
│   │   ├── model.json      # TF.js format
│   │   └── weights.bin
│   ├── combat/
│   │   ├── model.json
│   │   └── weights.bin
│   └── training.log        # Training stats history
│
├── checkpoints/            # Auto-saved during training
│   ├── wdm7_round_010/
│   ├── wdm7_round_020/    # ← This becomes "easy" difficulty
│   ├── wdm7_round_100/    # ← This becomes "medium"
│   └── wdm7_round_500/    # ← This becomes "hard"
│
└── .gitignore              # Don't commit weight files (large binaries)
```

### 11.10 Gotchas & Things to Watch

1. **`tf.tidy()` is mandatory** — without it, every `tf.tensor2d()` call leaks memory. In a 10-minute match at 60Hz, that's 36,000 leaked tensors → OOM crash

2. **`dataSync()` vs `data()`** — `dataSync()` is synchronous (blocks), `data()` is async. For <1ms inference, `dataSync()` is fine and simpler. If inference ever exceeds ~5ms, switch to `data()`

3. **Float32Array not JavaScript objects** — `model.predict()` expects tensor, not `{ health: 0.5 }`. The normalizer must output arrays with FIXED index positions

4. **Model input shape must match** — if TacticalBrain expects 25 inputs, the Float32Array MUST be exactly 25 elements. Off-by-one = crash. Use constants:

   ```typescript
   export const TACTICAL_INPUT_SIZE = 25;
   export const COMBAT_INPUT_SIZE = 18;
   ```

5. **No NaN/Infinity** — if any input is NaN (e.g., division by zero when no enemy), the entire model output becomes NaN. Guard every division: `dist / 3000 || 0`

6. **vite-node + native modules** — `@tensorflow/tfjs-node` has a native C++ addon. `vite-node` handles this fine because it uses `node:module.createRequire()` for native addons

7. **First inference is slow** — TF.js "warms up" the model on first `predict()` call (~50-100ms). Do a dummy prediction at startup

8. **Model versioning** — if you change input size (e.g., 25 → 27 inputs), old models won't load. Version the model architecture

9. **Training vs serving process** — training can be in the same process OR a separate one. Same process is simpler for the autonomous gym loop. Separate process if training gets heavy
