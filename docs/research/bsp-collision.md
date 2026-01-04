# BSP Collision Detection Research

## Q3/Warsow Collision System Overview

### Data Structures Available in BSP

| Lump | Purpose |
|------|---------|
| **Planes** | Infinite planes defined by normal + distance |
| **Brushes** | Convex volumes for collision (firstSide, numSides, shaderIndex) |
| **BrushSides** | Each side references a plane (planeIndex, shaderIndex) |
| **LeafBrushes** | Indices linking leafs to brushes for spatial lookup |
| **Nodes/Leafs** | BSP tree for fast point-in-leaf queries |
| **Textures** | Contains `contentFlags` and `surfaceFlags` |

### Content Flags (from Q3 source)

```c
// Solid types
CONTENTS_SOLID          = 0x1      // Completely solid
CONTENTS_PLAYERCLIP     = 0x10000  // Blocks players only
CONTENTS_MONSTERCLIP    = 0x20000  // Blocks monsters only

// Non-solid
CONTENTS_WATER          = 0x20     // Water volume
CONTENTS_FOG            = 0x40     // Fog volume
CONTENTS_AREAPORTAL     = 0x8000   // Area portal
CONTENTS_DETAIL         = 0x8000000 // Detail brush (NO collision in Q3!)

// What blocks players
MASK_PLAYERSOLID = CONTENTS_SOLID | CONTENTS_PLAYERCLIP
```

### Surface Flags (relevant ones)

```c
SURF_NODRAW     = 0x80    // Invisible (but can still be solid!)
SURF_SKY        = 0x4     // Sky surface
SURF_NONSOLID   = 0x4000  // Not solid (explicitly non-blocking)
```

## Collision Algorithm

### 1. Point-in-Leaf (Already Implemented!)
```
findLeafForPoint(point, nodes, leafs, planes) -> BspLeaf
```
Walk BSP tree using plane tests to find which leaf contains the point.

### 2. Trace (Ray/Box vs World)
Q3 uses **brush tracing**:
1. Find starting leaf using point-in-leaf
2. Collect all brushes in that leaf (via leafBrushes)
3. For each brush with SOLID contentFlags:
   - Test ray/box against all brush planes
   - Find closest intersection
4. If trace crosses leaf boundaries, repeat for adjacent leafs

### 3. Brush Test (Convex Volume Intersection)
Each brush is a convex volume defined by planes:
```
For each plane in brush:
  - Calculate signed distance from point/ray to plane
  - Track enter/exit distances
  - If enterDist > exitDist: no collision
  - Otherwise: collision at enterDist
```

## Efficient Approaches

### Option A: BSP Tree Trace (Q3 Style)
**Pros:**
- Most efficient for large maps
- Handles complex geometry
- Natural spatial partitioning

**Cons:**
- Complex to implement
- Need to handle swept box (not just ray)

### Option B: Babylon.js Built-in Collision
**Pros:**
- Already implemented
- Works with existing mesh geometry

**Cons:**
- Uses triangle mesh collision (slower)
- Need to build collision mesh from brushes
- May miss clip brushes (no rendered geometry)

### Option C: Hybrid Approach (Recommended)
1. **Use BSP for broad phase:**
   - Find leaf containing player
   - Get brushes in that leaf
   
2. **Simple plane tests for narrow phase:**
   - Test player AABB against brush planes
   - Much simpler than full trace

3. **Build collision mesh for special cases:**
   - func_door, func_plat need mesh collision
   - Use Babylon's collision system for dynamic objects

## Brush Types to Handle

| Type | ContentFlags | Behavior |
|------|--------------|----------|
| **Solid** | CONTENTS_SOLID | Full collision |
| **PlayerClip** | CONTENTS_PLAYERCLIP | Invisible wall for players |
| **Detail** | CONTENTS_DETAIL | NO collision (visual only) |
| **Water** | CONTENTS_WATER | Special (swimming) |
| **Trigger** | CONTENTS_TRIGGER | Touch detection only |

## Implementation Plan

### Phase 1: Basic Ground Detection
1. Cast ray downward from player
2. Find leaf at player position
3. Test brushes in leaf for floor plane
4. Return ground height

### Phase 2: Wall Collision
1. Expand player as AABB (e.g., 32x56x32)
2. Test movement vector against nearby brushes
3. Slide along walls (project velocity onto plane)

### Phase 3: Clip Brushes
1. Check brush shaderIndex → texture contentFlags
2. Filter to CONTENTS_SOLID | CONTENTS_PLAYERCLIP
3. Skip CONTENTS_DETAIL brushes

### Phase 4: Dynamic Objects
1. func_door brushes need separate collision
2. Update collision when door moves
3. Consider simplified AABB for doors

## Your Quirks/Notes

(Add any specific quirks you remember from Warsow!)

---

## Quick Win: Use Babylon Collision on World Mesh

The simplest approach to get started:
```typescript
// Enable collision on world mesh
worldMesh.checkCollisions = true;

// Enable camera/player collision
camera.checkCollisions = true;
camera.ellipsoid = new Vector3(16, 28, 16); // Player size

// Set gravity
scene.gravity = new Vector3(0, -9.81, 0);
camera.applyGravity = true;
```

This won't handle clip brushes but will give basic collision immediately!
