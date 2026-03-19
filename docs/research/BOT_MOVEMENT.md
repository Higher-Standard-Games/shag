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
```

---

## 7. Why This Is Different

| Feature | Traditional Bots (Q3/UT) | Modern NavMesh | Our SWN |
|---------|-------------------------|----------------|---------|
| Map data source | Hand-placed waypoints | Pre-baked mesh | BSP-derived auto-extraction |
| Jump/pad handling | Manual link editing | Not handled well | Physics-probed arcs |
| Runtime cost | Low | Medium | Low (sparse graph) |
| Map support | Per-map manual work | Per-map generation | Auto for any BSP map |
| Learning | None | None | ML edge cost adjustment |
| Multi-level | Waypoint IDs only | Full mesh | Physics-validated edges |
| Adapts to changes | No | Re-bake needed | Re-probe on load |

**The innovation**: No one combines BSP collision probing + physics simulation + sparse graph + ML learning in a single system. Most bots either use hand-placed data OR heavy navmeshes. We use the map's own physics as our navigation oracle.

---

## 8. Open Questions

1. **Jump pad detection**: Do our BSP maps use `trigger_push` entities? Need to verify entity data
2. **Graph caching**: Should we save/load pre-built graphs per map, or rebuild each session?
3. **Grid sampling resolution**: 256 units? 384? Too dense = slow build, too sparse = missing paths
4. **Vertical navigation**: Stairs vs ramps vs ledges — different handling needed?
5. **Multi-bot coordination**: Should bots share graph data or learn independently?
