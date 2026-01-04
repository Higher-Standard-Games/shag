# BSP Collision System

## Overview

Full BSP-based collision detection using brush volumes and plane math. This approach provides:
- O(log n) spatial lookup via BSP tree
- Native support for clip brushes (invisible collision)
- Full control for authentic Quake/Warsow-style movement
- No dependency on rendered geometry

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    BspCollision                         │
├─────────────────────────────────────────────────────────┤
│  tracePoint(start, end)        → TraceResult           │
│  traceBox(start, end, mins, maxs) → TraceResult        │
│  pointContents(point)          → ContentFlags          │
├─────────────────────────────────────────────────────────┤
│                    Internal                             │
├─────────────────────────────────────────────────────────┤
│  traceBrush(start, end, brush) → TraceResult           │
│  traceLeaf(start, end, leaf)   → TraceResult           │
│  traceNode(start, end, node)   → TraceResult (recurse) │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│                   BSP Data (BspFile)                    │
├─────────────────────────────────────────────────────────┤
│  planes[]      - Normal + distance                      │
│  brushes[]     - Convex volumes (firstSide, numSides)   │
│  brushSides[]  - Plane references per brush             │
│  leafBrushes[] - Brush indices per leaf                 │
│  nodes[]       - BSP tree nodes                         │
│  leafs[]       - BSP tree leaves                        │
│  textures[]    - contentFlags per brush                 │
└─────────────────────────────────────────────────────────┘
```

## Data Structures

### TraceResult

```typescript
interface TraceResult {
  fraction: number;      // 0.0 = immediate hit, 1.0 = no hit
  endPos: Vector3;       // Final position after trace
  plane: BspPlane | null; // Surface hit (for sliding)
  startSolid: boolean;   // Started inside solid
  allSolid: boolean;     // Entire trace in solid
  contents: number;      // Content flags at end position
}
```

### Content Flags

```typescript
const enum ContentFlags {
  SOLID       = 0x1,        // Completely solid
  LAVA        = 0x8,        // Lava (damage)
  SLIME       = 0x10,       // Slime (damage)
  WATER       = 0x20,       // Water (swimming)
  FOG         = 0x40,       // Fog volume
  PLAYERCLIP  = 0x10000,    // Blocks players only
  MONSTERCLIP = 0x20000,    // Blocks monsters only
  DETAIL      = 0x8000000,  // Detail brush (NO collision)
}

// What blocks players
const MASK_PLAYERSOLID = ContentFlags.SOLID | ContentFlags.PLAYERCLIP;

// What blocks all movement
const MASK_ALL = ContentFlags.SOLID | ContentFlags.PLAYERCLIP | ContentFlags.MONSTERCLIP;
```

## Core Functions

### 1. traceBrush(start, end, brush)

Test a ray against a single convex brush volume.

**Algorithm:**
```
enterFrac = -1
leaveFrac = 1
hitPlane = null

for each side in brush:
  plane = planes[side.planeIndex]
  
  // Distance from start/end to plane
  startDist = dot(start, plane.normal) - plane.dist
  endDist = dot(end, plane.normal) - plane.dist
  
  if startDist > 0 and endDist > 0:
    return NO_HIT  // Both outside this plane
  
  if startDist <= 0 and endDist <= 0:
    continue  // Both inside, check other planes
  
  // Ray crosses plane
  if startDist > endDist:
    // Entering brush
    frac = (startDist - EPSILON) / (startDist - endDist)
    if frac > enterFrac:
      enterFrac = frac
      hitPlane = plane
  else:
    // Leaving brush  
    frac = (startDist + EPSILON) / (startDist - endDist)
    if frac < leaveFrac:
      leaveFrac = frac

if enterFrac > leaveFrac:
  return NO_HIT  // Missed brush

return { fraction: max(0, enterFrac), plane: hitPlane }
```

### 2. traceLeaf(start, end, leaf)

Test ray against all solid brushes in a leaf.

```
bestResult = { fraction: 1.0, plane: null }

for i in range(leaf.firstLeafBrush, leaf.firstLeafBrush + leaf.numLeafBrushes):
  brushIndex = leafBrushes[i]
  brush = brushes[brushIndex]
  
  // Check if brush is solid
  texture = textures[brush.shaderIndex]
  if not (texture.contentFlags & MASK_PLAYERSOLID):
    continue  // Skip non-solid brushes
  
  result = traceBrush(start, end, brush)
  if result.fraction < bestResult.fraction:
    bestResult = result

return bestResult
```

### 3. traceNode(start, end, node) [Recursive]

Walk BSP tree, testing leafs along the ray path.

```
function traceNode(start, end, nodeIndex):
  if nodeIndex < 0:
    // It's a leaf
    leafIndex = -(nodeIndex + 1)
    return traceLeaf(start, end, leafs[leafIndex])
  
  node = nodes[nodeIndex]
  plane = planes[node.planeIndex]
  
  startDist = dot(start, plane.normal) - plane.dist
  endDist = dot(end, plane.normal) - plane.dist
  
  if startDist >= 0 and endDist >= 0:
    // Both in front
    return traceNode(start, end, node.front)
  
  if startDist < 0 and endDist < 0:
    // Both behind
    return traceNode(start, end, node.back)
  
  // Ray crosses plane - must check both sides
  if startDist < endDist:
    side1 = node.back
    side2 = node.front
  else:
    side1 = node.front
    side2 = node.back
  
  // Calculate split point
  frac = startDist / (startDist - endDist)
  mid = lerp(start, end, frac)
  
  // Check near side first
  result1 = traceNode(start, mid, side1)
  if result1.fraction < 1.0:
    return result1  // Hit something on near side
  
  // Check far side
  result2 = traceNode(mid, end, side2)
  return result2
```

### 4. traceWorld(start, end)

Entry point - starts trace at root node.

```
function traceWorld(start, end):
  return traceNode(start, end, 0)  // Node 0 is root
```

## Box Trace (Future Enhancement)

For AABB/octagon collision, expand each brush plane by the box extents:

```
// For axis-aligned box with half-extents (hw, hh, hd):
expandedDist = plane.dist + abs(plane.normal.x) * hw
                         + abs(plane.normal.y) * hh
                         + abs(plane.normal.z) * hd
```

This effectively "shrinks" the world by the player size, then traces a point.

**Note:** Warsow uses octagon hitbox for more accurate netcode hit detection. For now, we use point trace + ground plane detection. Octagon can be added later if needed.

## Collision Response (SlideMove)

After tracing, apply sliding along hit surfaces:

```
function slideMove(origin, velocity, deltaTime):
  timeLeft = deltaTime
  numBumps = 0
  planes = []
  
  while timeLeft > 0 and numBumps < 4:
    end = origin + velocity * timeLeft
    trace = traceWorld(origin, end)
    
    if trace.fraction > 0:
      origin = trace.endPos
      timeLeft *= (1 - trace.fraction)
    
    if trace.fraction == 1.0:
      break  // No collision
    
    if trace.plane:
      planes.push(trace.plane)
      
      // Clip velocity to plane
      velocity = clipVelocity(velocity, trace.plane.normal)
      
      // Clip to all previous planes too
      for prevPlane in planes:
        if dot(velocity, prevPlane.normal) < 0:
          velocity = clipVelocity(velocity, prevPlane.normal)
    
    numBumps++
  
  return { origin, velocity }

function clipVelocity(velocity, normal):
  backoff = dot(velocity, normal)
  return velocity - normal * backoff
```

## File Structure

```
src/engine/physics/
├── BspCollision.ts      # Core trace functions
├── ContentFlags.ts      # Content/surface flag constants
├── PlayerMove.ts        # SlideMove, gravity, jumping
└── index.ts             # Public API
```

## Usage Example

```typescript
import { BspCollision } from './physics/BspCollision';

// Initialize with loaded BSP
const collision = new BspCollision(bspFile);

// Trace from player position
const start = player.position;
const end = start.add(player.velocity.scale(deltaTime));

const trace = collision.tracePoint(start, end);

if (trace.fraction < 1.0) {
  // Hit something - move to collision point
  player.position = trace.endPos;
  
  // Slide along surface
  player.velocity = collision.clipVelocity(player.velocity, trace.plane.normal);
} else {
  // No collision - move full distance
  player.position = end;
}
```

## Performance Characteristics

| Operation | Complexity | Typical Cost |
|-----------|------------|--------------|
| Find leaf | O(log n) | ~10-15 plane tests |
| Test brush | O(sides) | ~6 plane tests |
| Full trace | O(log n + k) | ~20-50 plane tests |

Where n = nodes in BSP, k = brushes in path.

**Memory:** No additional allocation per trace - reuse result objects.

## Coordinate System Note

BSP uses Q3 coordinates (Z-up). Convert to Babylon (Y-up) at boundaries:
- Input: Convert Babylon → Q3 before trace
- Output: Convert Q3 → Babylon in result

Or: Store collision in Q3 coords, convert only for rendering.
