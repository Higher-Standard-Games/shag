# Collision System Redesign - Rock Solid Implementation

**Date**: 2026-01-10  
**Goal**: Build a working collision system from scratch using BSP data

---

## Current Issues (Root Cause Analysis)

### Issue 1: Playerclip Not Blocking
**Console output**: `contentFlags=0x20010000 contentMask=0x1 passes=false`

**Root cause**: 
- Playerclip brushes have contentFlags `0x20010000` (TRANSLUCENT | PLAYERCLIP | SOLID)
- We're checking with contentMask `0x1` (SOLID only)
- The check `(contentFlags & contentMask) !== 0` passes (has SOLID bit)
- BUT we're also checking `clipTexturesOnly` which filters to only fullclip/playerclip textures
- The contentMask is wrong - should be `0x1 | 0x10000` to include PLAYERCLIP

### Issue 2: Can Fly Through Floor
**Root cause**: Babylon's `_collideWithWorld` not working correctly
- No collision meshes generated (disabled for testing)
- Rendered BSP geometry should have collision but doesn't
- `_collideWithWorld` might not be the right API

### Issue 3: Stuck at Spawn in wdm11
**Root cause**: False positive collision detection
- Claims fullclip collision where there is none
- Likely coordinate system mismatch or trace parameters wrong

---

## New Architecture: Pure BSP Collision

### Design Philosophy

**ABANDON**: Babylon.js native collision system
- Too complex to integrate with BSP semantics
- Requires generating 2000+ collision meshes
- Doesn't work reliably with BSP coordinate system

**ADOPT**: Pure BSP collision using existing BspCollision backend
- Already has swept box collision (traceBox)
- Already understands BSP brush data
- Already handles fullclip, playerclip, caulk
- Just needs proper integration with camera movement

### Architecture

```
Camera Movement
    ↓
Calculate desired position
    ↓
BSP Swept Box Collision
    ↓
    ├─ Check rendered geometry (structural brushes)
    ├─ Check fullclip brushes
    ├─ Check playerclip brushes
    └─ Check caulk brushes
    ↓
Return safe position (fraction * movement)
    ↓
Apply to camera
```

### Key Components

1. **BspCollision.traceBox()** - Already implemented ✅
   - Swept box collision through BSP tree
   - Checks brush planes
   - Returns fraction (0.0 = blocked, 1.0 = free)

2. **Content Mask System** - Needs fixing ❌
   - SOLID (0x1) - structural geometry
   - PLAYERCLIP (0x10000) - player barriers
   - Must check ALL relevant flags

3. **Coordinate System** - Needs verification ❌
   - Babylon: (x, y, z) where y=up
   - Q3: (x, y, z) where z=up
   - BspCollision already handles conversion

---

## Implementation Plan

### Phase 1: Fix BspCollision Content Mask ✅ NEXT

**Problem**: Playerclip brushes filtered out due to wrong contentMask

**Fix**:
```typescript
// Current (WRONG):
const clipTraceA = cm.trace(start, end, {
  clipTexturesOnly: true,
  contentMask: 0x1 | 0x10000,  // This is correct
});

// But isContentsSolid checks:
return (contentFlags & contentsMask) !== 0;

// Playerclip has: 0x20010000 (TRANSLUCENT | PLAYERCLIP | SOLID)
// contentMask: 0x10001 (PLAYERCLIP | SOLID)
// (0x20010000 & 0x10001) = 0x10000 (non-zero, should pass!)
```

**Wait, the contentMask IS correct!** The issue must be elsewhere.

Let me check the actual filtering logic...

Looking at console output:
- `contentFlags=0x20010000` ✅
- `contentMask=0x1` ❌ WRONG! Should be `0x10001`

**The bug**: We're passing `contentMask: 0x1` in trace B, but playerclip needs `0x10001`!

### Phase 2: Simplify Collision System

**Remove**:
- Babylon collision mesh generation
- `_collideWithWorld` usage
- Dual trace system (A and B)

**Keep**:
- Single BSP traceBox call
- Proper contentMask for all brush types

**New movement code**:
```typescript
private bspCollisionMove(movement: Vector3): void {
  if (!this.camera) return;
  
  const cm = getCollisionManager();
  cm.setBackend('brush');
  
  const start = this.camera.position.clone();
  const end = start.add(movement);
  
  // Single trace with correct contentMask
  const trace = cm.traceBox(start, end, this.mins, this.maxs, false, 
    0x1 | 0x10000,  // SOLID | PLAYERCLIP
    false,  // not clipTexturesOnly
    false   // not nodrawSolidsOnly
  );
  
  // Apply collision result
  if (trace.fraction < 1.0) {
    this.camera.position.copyFrom(trace.endPos);
  } else {
    this.camera.position.copyFrom(end);
  }
}
```

### Phase 3: Test in Headless Mode

Create test script to verify collision:
1. Load wdm2
2. Get spawn position
3. Test movement in all directions
4. Verify collision with walls, fullclip, playerclip
5. Print results

### Phase 4: Integrate and Test In-Game

1. Replace nativeCollisionMove with bspCollisionMove
2. Test in wdm2 and wdm11
3. Verify all collision types work
4. Remove old collision mesh generation code

---

## Testing Strategy

### Test Cases

1. **Wall Collision** (structural brushes)
   - Walk into wall → should stop
   - Walk parallel to wall → should slide

2. **Fullclip Collision** (invisible barriers)
   - Walk into fullclip → should stop
   - Visible in clipviz as green boxes

3. **Playerclip Collision** (player-only barriers)
   - Walk into playerclip → should stop
   - Visible in clipviz as red boxes

4. **Floor Collision** (structural brushes)
   - Fall onto floor → should stop
   - Should not fall through

5. **Spawn Position** (wdm11)
   - Should not be stuck at spawn
   - Should be able to move freely

### Headless Test Script

```typescript
// test-collision.ts
import { BspCollision } from './src/engine/physics/BspCollision';
import { Vector3 } from '@babylonjs/core';

async function testCollision() {
  // Load map
  const bsp = await loadBsp('wdm2');
  const collision = new BspCollision(bsp);
  
  // Test 1: Wall collision
  const start = new Vector3(-184, 224, 288);  // spawn
  const end = new Vector3(-184, 224, 200);    // move into wall
  
  const trace = collision.traceBox(start, end, 
    new Vector3(-16, -28, -16),  // mins
    new Vector3(16, 28, 16),     // maxs
    true,  // debug
    0x1 | 0x10000  // SOLID | PLAYERCLIP
  );
  
  console.log(`Wall test: fraction=${trace.fraction} (expect < 1.0)`);
  console.log(`End pos: ${trace.endPos}`);
  
  // Test 2: Playerclip collision
  // Find playerclip brush position from clipviz
  // Test movement into it
  
  // Test 3: Free movement
  // Test movement in open space (expect fraction=1.0)
}
```

---

## Next Steps

1. ✅ Identify root cause (contentMask bug in trace calls)
2. ⏳ Fix contentMask in FreeflyController
3. ⏳ Test with current system
4. ⏳ If still broken, implement pure BSP collision
5. ⏳ Remove Babylon collision code
6. ⏳ Document final working solution
