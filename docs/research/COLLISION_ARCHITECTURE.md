# Collision System Architecture

**Status**: ✅ Production  
**Last Updated**: 2026-01-10

## Design Philosophy

**Primary System**: Babylon.js Native Collision (`camera._collideWithWorld`)

**BSP Data Augmentation**: Use BSP brush data to enhance Babylon collision

### Strategy

1. **ADD collision points**: Generate Babylon meshes for non-rendered BSP brushes
   - **Fullclip** (`textures/common/fullclip`): Invisible barriers
   - **Playerclip** (`textures/common/playerclip`): Player-only barriers
   - **Caulk** (`textures/common/caulk`): Structural sealing brushes

2. **REMOVE collision points**: Exclude detail brushes from collision
   - **Detail brushes**: Marked with `ContentFlags.DETAIL` (0x8000000)
   - Visual-only geometry that shouldn't affect gameplay
   - Filtered in all collision systems

### Why This Architecture

- ✅ **Reliable**: Babylon collision is fast, well-tested, and stable
- ✅ **Semantic**: BSP data provides gameplay information (clip types, detail flags)
- ✅ **Hybrid**: Babylon handles most collision, BSP fills semantic gaps
- ✅ **Performance**: Only generate meshes for non-rendered brushes (~2000 in wdm2)
- ✅ **Maintainable**: Clear separation of concerns

## Implementation

### Collision Mesh Generation

**Location**: `src/engine/loader/map/MapLoader.ts:buildClipBrushMeshes()`

**Process**:
1. Iterate through all BSP brushes
2. Detect clip brushes by texture name and content flags
3. Skip detail brushes (`ContentFlags.DETAIL`)
4. Calculate brush bounds from planes
5. Generate invisible box mesh at brush center
6. Set `checkCollisions=true` for Babylon collision
7. Store metadata (brush index, texture name)

**Detection Logic**:
```typescript
// Fullclip: by texture name
isFullclip = texName === 'textures/common/fullclip'

// Playerclip: by texture name OR content flag
isPlayerclip = texName === 'textures/common/playerclip' || (contentFlags & 0x10000)

// Caulk: by texture name AND solid flag
isCaulk = texName === 'textures/common/caulk' && (contentFlags & 0x1)

// Detail: exclude from collision
isDetail = contentFlags & 0x8000000
```

### Native Collision

**Location**: `src/engine/camera/controllers/FreeflyController.ts:nativeCollisionMove()`

**Process**:
1. **Babylon Collision** (Primary)
   - `camera._collideWithWorld(movement)` checks all meshes with `checkCollisions=true`
   - Includes rendered BSP geometry
   - Includes generated clip brush meshes (fullclip, playerclip, caulk)
   - Excludes detail brushes (filtered in `shouldSkipCollision`)

2. **BSP Clamp Pass** (Secondary/Optional)
   - Runs after Babylon collision
   - Trace A: `clipTexturesOnly=true` checks fullclip/playerclip
   - Trace B: `nodrawSolidsOnly=true` checks caulk/structural
   - Adjusts position if BSP collision detected
   - Provides safety net for edge cases

### Detail Brush Filtering

**Locations**:
- `BspCollision.isContentsSolid()`: Checks `ContentFlags.DETAIL`, returns false
- `FreeflyController.shouldSkipCollision()`: Checks mesh metadata for DETAIL flag
- `BabylonPhysicsBackend.init()`: Filters meshes with DETAIL flag
- `MapLoader.buildClipBrushMeshes()`: Skips brushes with DETAIL flag

## Results

**Tested on wdm2**:
- 2000 collision meshes generated
  - ~10 playerclip meshes
  - ~135 fullclip meshes
  - ~1866 caulk meshes
- All meshes have `checkCollisions=true`
- Detail brushes properly excluded
- Solid, reliable collision

## Future Optimizations

**Potential improvements** (if needed):
1. Merge nearby clip brushes into larger collision volumes
2. Remove redundant Trace A from BSP clamp pass (fullclip/playerclip already have meshes)
3. Spatial partitioning for clip brush mesh lookup
4. Profile and optimize if 2000 meshes causes performance issues

## References

- Design document: `docs/research/COLLISION_NATIVE_MODE.md`
- Implementation: `src/engine/loader/map/MapLoader.ts`
- Usage: `src/engine/camera/controllers/FreeflyController.ts`
- BSP collision: `src/engine/physics/BspCollision.ts`
