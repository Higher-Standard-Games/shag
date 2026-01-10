# Next-Generation Collision System Architecture

**Date**: 2026-01-10  
**Goal**: Design the best collision system for BSP-based games

---

## Requirements

### Must Have
- ✅ Works flawlessly with BSP maps
- ✅ Supports fullclip, playerclip brushes (invisible barriers)
- ✅ Makes caulk brushes solid
- ✅ Un-solids hint brushes (rendering hints, no collision)
- ✅ Un-solids detail geometry in BSPs (visual-only, no collision)
- ✅ Light on CPU (performance optimized)
- ✅ No camera jitter when colliding
- ✅ Easily debuggable (clipviz-style visualization)

### Nice to Have
- Support for .map file brushes (Babylon mesh collision)
- Sliding along walls (not just stopping)
- Step-up for small obstacles
- Gravity and ground detection

---

## Research Summary

### Babylon.js Collision Options

1. **`mesh.moveWithCollisions(velocity)`**
   - Ellipsoid-based collision
   - Checks against meshes with `checkCollisions=true`
   - Performance issues with many meshes (1-6ms per call with 2000 meshes)
   - Not designed for BSP-style brush collision

2. **`scene.pickWithRay()`**
   - Ray casting against mesh geometry
   - Good for simple checks (ground detection, aiming)
   - Not suitable for swept box collision

3. **Physics Engines (Havok, Cannon.js)**
   - Full physics simulation
   - Heavyweight, designed for dynamic objects
   - Overkill for BSP-style collision

4. **`mesh.intersectsMesh()`**
   - AABB or OBB intersection test
   - Good for trigger volumes
   - Not suitable for swept collision

### Quake 3 BSP Collision Approach

The Q3 approach is well-documented and proven:

1. **BSP Tree Traversal**
   - Start at root node
   - Check point against splitting plane
   - Recurse into front/back child
   - Reach leaf nodes with brush references

2. **Swept Box Trace**
   - Trace AABB from start to end position
   - Check against brush planes in each leaf
   - Calculate closest collision point (fraction)
   - Handle sliding along surfaces

3. **Content Flags**
   - SOLID (0x1) - blocks movement
   - PLAYERCLIP (0x10000) - blocks players
   - DETAIL (0x8000000) - visual only, skip collision

**Key Insight**: The Q3 algorithm is O(log n) for BSP traversal, making it very efficient even for large maps.

---

## Architecture Decision

### Chosen Approach: Pure BSP Collision with Babylon Integration

**Why not Babylon native collision?**
- Performance issues with many meshes
- Not designed for BSP brush semantics
- Difficult to integrate content flags

**Why BSP collision?**
- Proven algorithm (used by Quake, Half-Life, Source Engine)
- O(log n) BSP tree traversal
- Native support for brush content flags
- Already partially implemented in our codebase

**Babylon Integration**
- Use Babylon for .map file brush collision (regular meshes)
- Use BSP collision for BSP maps
- Unified interface for both

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CollisionSystem                          │
│  - Unified interface for all collision operations           │
│  - Handles coordinate conversion (Babylon ↔ Q3)             │
│  - Provides debug visualization (clipviz)                   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  BspCollider    │ │ MeshCollider    │ │  TriggerSystem  │
│  (BSP maps)     │ │ (.map brushes)  │ │  (volumes)      │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ BSP Tree        │ │ Babylon Meshes  │ │ AABB Volumes    │
│ Brush Planes    │ │ Octree          │ │ ActionManager   │
│ Content Flags   │ │ BVH             │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Core Components

#### 1. CollisionSystem (Main Interface)

```typescript
class CollisionSystem {
  // Configuration
  private bspCollider: BspCollider | null;
  private meshCollider: MeshCollider;
  
  // Movement with collision
  move(entity: CollisionEntity, velocity: Vector3): MoveResult;
  
  // Ray/box tracing
  trace(start: Vector3, end: Vector3, options?: TraceOptions): TraceResult;
  traceBox(start: Vector3, end: Vector3, mins: Vector3, maxs: Vector3): TraceResult;
  
  // Ground detection
  isOnGround(entity: CollisionEntity): boolean;
  getGroundNormal(entity: CollisionEntity): Vector3 | null;
  
  // Debug visualization
  setDebugMode(mode: 'none' | 'clipviz' | 'traces'): void;
}
```

#### 2. BspCollider (BSP Map Collision)

```typescript
class BspCollider {
  constructor(bsp: BspFile);
  
  // Core trace function (Q3-style)
  trace(start: Vector3, end: Vector3, options: BspTraceOptions): TraceResult;
  
  // Swept box trace
  traceBox(start: Vector3, end: Vector3, mins: Vector3, maxs: Vector3, 
           contentMask: number): TraceResult;
  
  // Content flag helpers
  isContentSolid(flags: number, mask: number): boolean;
  isClipBrush(texture: BspTexture): boolean;
  isDetailBrush(texture: BspTexture): boolean;
}
```

#### 3. MoveResult & TraceResult

```typescript
interface TraceResult {
  fraction: number;      // 0.0 = start, 1.0 = end (no collision)
  endPos: Vector3;       // Final position after collision
  startSolid: boolean;   // Started inside solid
  allSolid: boolean;     // Entire trace inside solid
  plane: Plane | null;   // Collision plane (for sliding)
  contents: number;      // Content flags of hit brush
  surfaceFlags: number;  // Surface flags of hit surface
}

interface MoveResult {
  position: Vector3;     // New position after move
  grounded: boolean;     // On ground after move
  hitWall: boolean;      // Collided with wall
  hitCeiling: boolean;   // Collided with ceiling
  velocity: Vector3;     // Remaining velocity (for sliding)
}
```

---

## Content Flag System

### Flags (Q3/Warsow Compatible)

```typescript
enum ContentFlags {
  SOLID       = 0x1,        // Structural solid
  LAVA        = 0x8,        // Lava (damage)
  SLIME       = 0x10,       // Slime (damage)
  WATER       = 0x20,       // Water
  FOG         = 0x40,       // Fog volume
  PLAYERCLIP  = 0x10000,    // Blocks players only
  MONSTERCLIP = 0x20000,    // Blocks monsters only
  ORIGIN      = 0x1000000,  // Origin brush (removed at compile)
  DETAIL      = 0x8000000,  // Detail (visual only, NO collision)
  STRUCTURAL  = 0x10000000, // Structural (collision)
  TRANSLUCENT = 0x20000000, // Translucent
  TRIGGER     = 0x40000000, // Trigger volume
}

enum SurfaceFlags {
  NODAMAGE    = 0x1,        // No damage on contact
  SLICK       = 0x2,        // Slippery surface
  SKY         = 0x4,        // Sky (no draw, no collision)
  NODRAW      = 0x80,       // Don't draw (caulk, clip)
  HINT        = 0x100,      // Hint brush (BSP split hint)
  SKIP        = 0x200,      // Skip surface
  NONSOLID    = 0x4000,     // Non-solid surface
}
```

### Collision Rules

| Brush Type      | ContentFlags       | Should Collide? |
|-----------------|-------------------|-----------------|
| Structural      | SOLID             | ✅ YES          |
| Fullclip        | SOLID + NODRAW    | ✅ YES          |
| Playerclip      | PLAYERCLIP        | ✅ YES          |
| Caulk           | SOLID + NODRAW    | ✅ YES          |
| Detail          | DETAIL            | ❌ NO           |
| Hint            | HINT              | ❌ NO           |
| Trigger         | TRIGGER           | ❌ NO (use trigger system) |
| Water           | WATER             | ❌ NO (swim through) |

---

## Movement System

### Core Move Algorithm

```typescript
function move(entity: CollisionEntity, velocity: Vector3): MoveResult {
  const result: MoveResult = {
    position: entity.position.clone(),
    grounded: false,
    hitWall: false,
    hitCeiling: false,
    velocity: velocity.clone()
  };
  
  // Step 1: Try full movement
  const trace = this.traceBox(
    entity.position,
    entity.position.add(velocity),
    entity.mins,
    entity.maxs,
    ContentFlags.SOLID | ContentFlags.PLAYERCLIP
  );
  
  if (trace.fraction >= 1.0) {
    // No collision, move full distance
    result.position = trace.endPos;
  } else {
    // Collision detected
    result.position = trace.endPos;
    
    // Step 2: Slide along surface
    if (trace.plane) {
      const remaining = velocity.scale(1.0 - trace.fraction);
      const slideVelocity = this.slideMove(remaining, trace.plane);
      
      // Try slide movement
      const slideTrace = this.traceBox(
        result.position,
        result.position.add(slideVelocity),
        entity.mins,
        entity.maxs,
        ContentFlags.SOLID | ContentFlags.PLAYERCLIP
      );
      
      result.position = slideTrace.endPos;
      result.velocity = slideVelocity.scale(slideTrace.fraction);
    }
    
    // Determine collision type
    if (trace.plane) {
      if (trace.plane.normal.y > 0.7) {
        result.grounded = true;
      } else if (trace.plane.normal.y < -0.7) {
        result.hitCeiling = true;
      } else {
        result.hitWall = true;
      }
    }
  }
  
  return result;
}
```

### Slide Move (No Jitter)

```typescript
function slideMove(velocity: Vector3, plane: Plane): Vector3 {
  // Project velocity onto plane (remove component into surface)
  const backoff = Vector3.Dot(velocity, plane.normal);
  
  const slide = velocity.subtract(
    plane.normal.scale(backoff * 1.001) // Slight overcompensation
  );
  
  return slide;
}
```

### Stair Stepping

```typescript
function tryStepUp(entity: CollisionEntity, velocity: Vector3): Vector3 | null {
  const STEP_HEIGHT = 18; // Q3 step height
  
  // Step 1: Move up
  const upTrace = this.traceBox(
    entity.position,
    entity.position.add(new Vector3(0, STEP_HEIGHT, 0)),
    entity.mins, entity.maxs,
    ContentFlags.SOLID | ContentFlags.PLAYERCLIP
  );
  
  if (upTrace.fraction === 0) return null; // Can't step up
  
  // Step 2: Move forward
  const forwardTrace = this.traceBox(
    upTrace.endPos,
    upTrace.endPos.add(velocity),
    entity.mins, entity.maxs,
    ContentFlags.SOLID | ContentFlags.PLAYERCLIP
  );
  
  // Step 3: Move down
  const downTrace = this.traceBox(
    forwardTrace.endPos,
    forwardTrace.endPos.add(new Vector3(0, -STEP_HEIGHT, 0)),
    entity.mins, entity.maxs,
    ContentFlags.SOLID | ContentFlags.PLAYERCLIP
  );
  
  if (downTrace.fraction === 1.0) return null; // No ground
  
  return downTrace.endPos;
}
```

---

## Coordinate System

### Babylon.js
- Right-handed
- Y-axis up
- Position: (x, y, z) where y = height

### Quake 3
- Right-handed
- Z-axis up
- Position: (x, y, z) where z = height

### Conversion Functions

```typescript
function babylonToQ3(v: Vector3): [number, number, number] {
  return [v.x, v.z, v.y]; // Swap Y and Z
}

function q3ToBabylon(v: [number, number, number]): Vector3 {
  return new Vector3(v[0], v[2], v[1]); // Swap Y and Z
}
```

---

## Debug Visualization (ClipViz)

### Visualization Modes

1. **Clip Brushes**
   - Fullclip: Green wireframe
   - Playerclip: Red wireframe
   - Caulk: Blue wireframe

2. **Trace Visualization**
   - Trace line: Yellow
   - Collision point: Red sphere
   - Slide direction: Cyan arrow

3. **Content Flags**
   - Show content flags on hover
   - Highlight solid vs non-solid

### Implementation

```typescript
class ClipVizDebugger {
  private clipMeshes: AbstractMesh[] = [];
  
  visualizeClipBrushes(bsp: BspFile, scene: Scene): void {
    for (const brush of bsp.brushes) {
      const texture = this.getBrushTexture(brush, bsp);
      if (!texture) continue;
      
      const isFullclip = this.isFullclip(texture);
      const isPlayerclip = this.isPlayerclip(texture);
      const isCaulk = this.isCaulk(texture);
      
      if (isFullclip || isPlayerclip || isCaulk) {
        const mesh = this.createBrushMesh(brush, bsp, scene);
        mesh.material = this.getMaterial(isFullclip, isPlayerclip, isCaulk);
        this.clipMeshes.push(mesh);
      }
    }
  }
  
  visualizeTrace(trace: TraceResult, scene: Scene): void {
    // Draw trace line
    // Draw collision point
    // Draw slide direction
  }
}
```

---

## Performance Optimizations

### 1. BSP Tree Traversal (O(log n))
- Already optimal for spatial queries
- No changes needed

### 2. Brush Caching
- Cache brush bounds for AABB early-out
- Skip brushes that can't possibly collide

### 3. Temporal Coherence
- Remember last leaf for moving entities
- Start search from last known position

### 4. Content Mask Early-Out
- Skip brushes with wrong content flags immediately
- Don't compute plane distances for irrelevant brushes

### 5. Axis-Aligned Plane Optimization
- Special case for axis-aligned planes (common in Q3 maps)
- Skip full dot product for axial planes

---

## Implementation Plan

### Phase 1: Fix Current BSP Collision (Day 1)
1. Fix contentMask bug (playerclip not blocking)
2. Verify coordinate conversion is correct
3. Test with headless mode

### Phase 2: Clean Up Collision System (Day 1-2)
1. Remove broken Babylon collision mesh generation
2. Simplify FreeflyController movement code
3. Use single trace call with correct contentMask

### Phase 3: Implement Slide Movement (Day 2)
1. Add slide movement algorithm
2. Test wall sliding
3. Verify no jitter

### Phase 4: Debug Visualization (Day 2-3)
1. Improve clipviz to show all brush types
2. Add trace visualization
3. Add content flag display

### Phase 5: Polish & Testing (Day 3)
1. Test on multiple maps (wdm2, wdm11, etc.)
2. Performance testing
3. Documentation

---

## Files to Modify

| File | Changes |
|------|---------|
| `BspCollision.ts` | Fix contentMask, add slide calculation |
| `FreeflyController.ts` | Simplify movement, use single trace |
| `CollisionManager.ts` | Clean up backends |
| `MapLoader.ts` | Remove collision mesh generation |
| `ClipViz.ts` | Improve visualization |

---

## Testing Strategy

### Headless Tests

```typescript
// Test 1: Wall collision
const trace = collision.traceBox(start, end, mins, maxs, SOLID);
assert(trace.fraction < 1.0, "Should hit wall");

// Test 2: Playerclip collision
const trace = collision.traceBox(start, end, mins, maxs, PLAYERCLIP);
assert(trace.fraction < 1.0, "Should hit playerclip");

// Test 3: Detail brush (no collision)
const trace = collision.traceBox(start, end, mins, maxs, SOLID);
assert(trace.fraction === 1.0, "Should pass through detail");

// Test 4: Slide movement
const move = collision.move(entity, velocity);
assert(move.velocity.length() > 0, "Should have remaining velocity");
```

### In-Game Tests

1. Walk into walls - should stop and slide
2. Walk through playerclip - should be blocked
3. Walk through detail brushes - should pass through
4. Fall onto floor - should land, not fall through
5. Stand at spawn - should not be stuck

---

## Summary

This architecture provides:

1. **Rock-solid BSP collision** using proven Q3 algorithm
2. **Proper content flag handling** for all brush types
3. **Smooth movement** with slide physics (no jitter)
4. **Easy debugging** with clipviz visualization
5. **High performance** with O(log n) BSP traversal
6. **Clean integration** with Babylon.js coordinate system

The key insight is to **trust the BSP collision system** and fix the bugs in our current implementation rather than trying to use Babylon's native collision for BSP maps.
