# Physics System

The SHAG Engine physics system provides Quake 3-compatible collision detection using swappable backends and a unified manager API.

## Architecture

```
CollisionManager (Singleton)
    ├── Backends
    │   ├── SweepCollisionBackend (q3) - Default, full Q3 physics
    │   ├── BrushCollisionBackend (brush) - Pure BSP brush collision
    │   ├── ClipBrushBackend (clipbrush) - Generated clip brushes
    │   └── BabylonPhysicsBackend (babylon) - Babylon.js mesh collision
    ├── trace() - Line/swept box collision test
    ├── slideMove() - Q3-style multi-plane sliding
    └── pointContents() - Content flag lookup
```

## Quick Start

```typescript
import { getCollisionManager } from '@/engine/physics';

// Get singleton
const cm = getCollisionManager();

// Initialize with BSP
await cm.init(bspFile, scene, 'q3');

// Trace from start to end
const result = cm.trace(start, end, { radius: 16, height: 56 });

if (result.fraction < 1.0) {
  console.log('Hit at', result.endPos, 'normal:', result.normal);
}

// Slide move (handles multi-plane clipping)
const move = cm.slideMove(position, velocity, { radius: 16, height: 56 });
position.copyFrom(move.endPos);
```

## Collision Backends

| Backend | Type | Description |
|---------|------|-------------|
| **SweepCollisionBackend** | `q3` | Full Q3 physics with patch/mesh support |
| BrushCollisionBackend | `brush` | Original BSP brush-only collision |
| ClipBrushBackend | `clipbrush` | Generated clip brushes from faces |
| BabylonPhysicsBackend | `babylon` | Babylon.js mesh-based collision |

Switch backends at runtime:
```typescript
cm.setBackend('q3'); // Use Q3-style sweep collision
```

## Trace API

### `trace(start, end, options?): TraceResult`

Performs a collision trace from `start` to `end`.

**Options:**
| Option | Type | Description |
|--------|------|-------------|
| `radius` | number | Trace radius (0 = ray, 16 = player) |
| `height` | number | Capsule height (56 = standing player) |
| `contentMask` | number | Filter by content flags |
| `debug` | boolean | Enable debug logging |

**Result:**
| Field | Type | Description |
|-------|------|-------------|
| `fraction` | 0-1 | How far trace completed (1 = no hit) |
| `endPos` | Vector3 | Final position after collision |
| `normal` | Vector3 | Surface normal at hit point |
| `startSolid` | boolean | Started inside solid geometry |
| `allSolid` | boolean | Entirely inside solid |
| `contents` | number | Content flags at hit point |

### `slideMove(start, velocity, options?)`

Q3-style slide movement with multi-plane clipping.

```typescript
const { endPos, velocity, hitCount } = cm.slideMove(pos, vel, opts);
```

Handles:
- Sliding along walls
- Corner navigation (up to 5 planes)
- Wall-climb prevention
- Depenetration nudging

## Content Flags

```typescript
import { ContentFlags, CollisionMasks, isPlayerSolid } from '@/engine/physics/ContentFlags';

// Check if brush blocks players
if (isPlayerSolid(brush.contentFlags)) { ... }

// Common masks
CollisionMasks.PLAYERSOLID  // SOLID | PLAYERCLIP
CollisionMasks.SHOT         // SOLID only
CollisionMasks.WATER        // WATER | LAVA | SLIME
```

| Flag | Value | Description |
|------|-------|-------------|
| `SOLID` | 0x1 | Blocks everything |
| `PLAYERCLIP` | 0x10000 | Blocks players only |
| `MONSTERCLIP` | 0x20000 | Blocks NPCs only |
| `WATER` | 0x20 | Water volume |
| `DETAIL` | 0x8000000 | No collision |

## Patch/Mesh Collision

The Q3 backend (`SweepCollisionBackend`) supports curved surfaces:

- **Bezier Patches**: Tessellated at LOD 5 for collision
- **Triangle Meshes**: Type-3 BSP faces
- **Swept AABB Test**: `traceTriangleSwept()` with 2D overlap validation

## Console Commands

```
collision_backend <type>  - Switch backend (q3, brush, clipbrush, babylon)
collision_stats           - Show collision statistics
```

## See Also

- [BSP System](./bsp-system.md) - BSP file structure
- [Movement System](./movement-system.md) - Player movement using physics
