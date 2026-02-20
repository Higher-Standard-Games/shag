# Server-Side PVS Culling Research

Research into integrating the existing BSP Potentially Visible Set (PVS) culler into the server networking layer to reduce bandwidth by not sending entity updates to clients that cannot see those entities.

## Current State

### PVS Culler (Client-Side Only)

The engine already has a fully functional PVS system in `src/engine/loader/bsp/PVSCuller.ts`, currently used only for **rendering optimization** — hiding meshes the camera can't see.

**Key primitives** (in `BspLoader.ts`):

```typescript
// Pure function — BSP tree traversal, no Babylon dependency
findLeafForPoint(point: [x, y, z], nodes, leafs, planes): BspLeaf | null

// Single bit-check in vis data array — O(1)
isClusterVisible(visData, clusterA, clusterB): boolean
```

Both functions are **pure** — they take raw BSP arrays as input, no Babylon.js dependency. They can run on the server as-is with zero modification.

### Server Snapshot Broadcasting

In `GameServer.broadcastSnapshot()`:

```
tick() → broadcastSnapshot() → toGameState() → MessageCodec.encodeSnapshot()
```

**Current behavior:**

1. `toGameState()` builds a **single `GameState`** containing ALL entities (players, projectiles, items)
2. `broadcastSnapshot()` iterates over all clients and sends the same `GameState` to each
3. Per-client differentiation is limited to delta compression baseline and `ackedInputSeq`
4. **No spatial filtering** — every client receives every entity, every snapshot

### Server BSP Loading

In `headless-netserver-v2.ts`, the server already calls `BspLoader.load(bspBuffer)` which parses the full BSP including `visData`. However, the `BspData` interface only extracts:

- `collision: CollisionWorld`
- `spawnPoints`
- `pickupItems`

The BSP tree structures (`nodes`, `leafs`, `planes`, `visData`) are **discarded** after collision extraction. They need to be retained and passed to `GameServer` for PVS queries.

---

## Proposed Integration

### Architecture

```
Server tick:
  1. Process inputs
  2. Run simulation
  3. For each client:
     a. Get client's player position
     b. Find client's BSP cluster via findLeafForPoint()
     c. Get visible cluster set via getVisibleClusters()
     d. Filter entities: include only those in visible clusters
     e. Build per-client GameState with filtered entities
     f. Delta-encode and send
```

### Changes Required

#### 1. Retain BSP PVS Data on Server

**File:** `headless-netserver-v2.ts` + `GameServer.ts`

Expand `BspData` to include PVS-relevant arrays:

```typescript
interface BspData {
    collision: CollisionWorld;
    spawnPoints: Vec3[];
    pickupItems: PickupItem[];
    // NEW: PVS data for server-side visibility culling
    pvs?: {
        nodes: BspNode[];
        leafs: BspLeaf[];
        planes: BspPlane[];
        visData: BspVisData | null;
    };
}
```

Add `GameServer.setPVSData(pvs)` to store the PVS arrays.

#### 2. Create Server-Side PVS Helper

**File:** `src/engine/server/ServerPVS.ts` [NEW]

Lightweight wrapper around the pure BSP functions — no `PVSCuller` class (that has Babylon.js mesh management we don't need):

```typescript
import { findLeafForPoint, isClusterVisible } from '../loader/bsp/BspLoader';
import type { BspNode, BspLeaf, BspPlane, BspVisData } from '../loader/bsp/BspLoader';

export class ServerPVS {
    constructor(
        private nodes: BspNode[],
        private leafs: BspLeaf[],
        private planes: BspPlane[],
        private visData: BspVisData | null
    ) {}

    /** Check if position B is visible from position A */
    isVisible(fromPos: Vec3, targetPos: Vec3): boolean {
        if (!this.visData) return true; // No PVS = everything visible

        const fromCluster = this.getCluster(fromPos);
        const targetCluster = this.getCluster(targetPos);
        
        if (fromCluster < 0 || targetCluster < 0) return true; // Outside BSP = visible
        
        return isClusterVisible(this.visData, fromCluster, targetCluster);
    }

    /** Get cluster ID for a world position (Babylon Y-up → Q3 Z-up) */
    getCluster(pos: Vec3): number {
        const q3Pos: [number, number, number] = [pos.x, pos.z, pos.y];
        const leaf = findLeafForPoint(q3Pos, this.nodes, this.leafs, this.planes);
        return leaf?.cluster ?? -1;
    }
}
```

#### 3. Per-Client Entity Filtering in broadcastSnapshot()

**File:** `GameServer.ts`

Change `broadcastSnapshot()` from building one `GameState` to building per-client filtered states:

```typescript
private broadcastSnapshot(): void {
    if (this.clients.size === 0) return;

    const fullState = this.toGameState();
    const tick = fullState.tick;
    this.snapshotHistory.set(tick, fullState);
    // ... prune old snapshots ...

    for (const client of this.clients.values()) {
        // Build per-client filtered state
        const clientState = this.pvs 
            ? this.filterStateForClient(fullState, client)
            : fullState;

        clientState.ackedInputSeq = client.lastInputSeq;
        const baseline = client.lastAckedTick > 0
            ? this.snapshotHistory.get(client.lastAckedTick)
            : undefined;

        const snapshotBytes = MessageCodec.encodeSnapshot(clientState, baseline);
        client.connection.sendDatagram(snapshotBytes);
    }
}

private filterStateForClient(state: GameState, client: ClientInfo): GameState {
    const clientEntity = this.simulation.getState().getEntity(client.entityId);
    if (!clientEntity?.transform) return state; // No position = send everything

    const filtered = state.clone(); // Shallow clone
    filtered.entities = new Map();

    for (const [id, entity] of state.entities) {
        // Always include: own player, global state, events
        if (id === `player_${client.entityId}`) {
            filtered.entities.set(id, entity);
            continue;
        }

        // PVS check for spatial entities
        const pos = entity.getComponent('position');
        if (pos && !this.pvs!.isVisible(clientEntity.transform.position, pos)) {
            continue; // Culled — not visible from client's position
        }

        filtered.entities.set(id, entity);
    }

    // Always include ALL players (scoreboard), ALL events (kill feed, etc.)
    filtered.players = state.players;
    filtered.events = state.events;

    return filtered;
}
```

---

## Edge Cases & Considerations

### Always-Visible Entities

Some entities must ALWAYS be sent regardless of PVS:

- **Own player** — always visible to self
- **Player states** — scoreboard data (name, score, ping)
- **Events** — kill feed, match state, combat_state (health/armor)
- **Audio cue entities** — footsteps, weapon sounds may travel beyond PVS

### Cluster Boundary Issues

- Entities near cluster boundaries may "pop in" as clients cross clusters
- **Mitigation:** Expand visible set by 1-2 clusters or use bounding box overlap checks
- Q3 mitigated this with PHS (Potentially Hearable Set) which is a superset of PVS

### Delta Compression Interaction

- Per-client filtering changes which entities appear in each snapshot
- When an entity leaves PVS, it disappears from the client's state → delta encodes as "removed"
- When it re-enters PVS, it appears as a "new" entity → full state sent (no delta)
- This is functionally correct but wastes some bandwidth on PVS boundary oscillation
- **Mitigation:** Hysteresis — keep entities in snapshot for N ticks after leaving PVS

### Sound Propagation

- In Q3, `SV_AddEntitiesVisibleFromPoint` uses PHS for sound sources
- PHS = "if visible from any cluster that is visible from client" (two-hop visibility)
- We could compute PHS or simply always send entities with active sounds

### Performance Impact

- `findLeafForPoint()`: BSP tree traversal, ~10-20 node visits per query
- `isClusterVisible()`: single array lookup + bit check — O(1)
- For 16 players + 50 projectiles + 20 items × 16 clients = ~1,376 visibility checks per snapshot
- At 60 Hz snapshot rate: ~82,560 checks/sec — trivially fast for Node.js

### Map Compatibility

- Not all BSP maps have PVS data. Some have `visData: null`
- System must gracefully fallback to "send everything" when PVS is unavailable
- The `ServerPVS.isVisible()` already handles this: `if (!visData) return true`

---

## Bandwidth Impact Estimate

On a typical arena map (wdm7) with 8 players:

| Scenario | Entities per client per snapshot | Relative bandwidth |
|----------|:---:|:---:|
| **Current (no PVS)** | All ~80 entities | 100% |
| **With PVS culling** | ~30-50 entities (visible) | ~40-60% |
| **Savings** | 30-50 entities culled | **40-60% reduction** |

The actual savings depend heavily on map layout:

- **Open maps** (single large room): minimal savings — most entities visible
- **Complex maps** (corridors, multiple rooms): significant savings — 50%+ culled
- **Layered maps** (multi-floor): highest savings — only same-floor entities visible

---

## Implementation Priority

| Task | Effort | Impact |
|------|--------|--------|
| 1. Retain BSP PVS data in server loader | Small | Prerequisite |
| 2. Create `ServerPVS` helper class | Small | Core feature |
| 3. Per-client entity filtering in `broadcastSnapshot()` | Medium | Primary benefit |
| 4. Always-visible entity whitelist | Small | Correctness |
| 5. PVS boundary hysteresis | Small | Polish |
| 6. PHS for sound entities | Medium | Nice-to-have |
| 7. Metrics/diagnostics | Small | Observability |

**Total estimated effort:** 1-2 sessions

---

## Q3 Reference

Quake 3's `SV_AddEntitiesVisibleFromPoint()` in `sv_snapshot.c`:

- Gets client's cluster via `CM_LeafCluster(CM_PointLeaf(origin))`
- For each entity: checks if any of the entity's leaf clusters are PVS-visible
- Entities with `SVF_BROADCAST` flag skip PVS check (always sent)
- Sound entities use PHS instead of PVS (wider audibility range)
- Area portal traversal gates visibility between connected areas

Our implementation follows the same pattern with TypeScript equivalents.

---

## Conclusion

Server-side PVS culling is **highly feasible** with our existing codebase:

1. **PVS primitives are server-ready** — pure functions with zero Babylon.js dependency
2. **BSP data is already loaded** — just needs to be retained past collision extraction
3. **Integration point is clear** — per-client filtering in `broadcastSnapshot()`
4. **Performance cost is negligible** — bit-check operations, sub-millisecond total
5. **Bandwidth savings are significant** — 40-60% on complex maps

This would make SHAG the only browser-based FPS engine with server-side PVS culling — matching a Q3 feature that most modern engines have abandoned in favor of brute-force bandwidth.
