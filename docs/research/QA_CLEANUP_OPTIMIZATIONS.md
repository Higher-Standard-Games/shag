# QA & Cleanup Optimizations

**Branch:** `feature/qa-cleanup-optimizations`  
**Target:** v0.8.11  
**Goal:** Polish existing functionality, improve UX, fix minor issues

---

## 1. Loading Screen Status Display

### Problem
- User has no feedback about what's happening during load
- PK3 indexing runs silently
- No indication of loading stages (textures, shaders, map geometry)

### Solution
- Add status text on **left side** of loading screen (matching version font on right)
- Display current operation:
  - "Indexing packages..."
  - "Loading shaders..."
  - "Loading textures..."
  - "Building geometry..."
  - "Initializing scene..."

### Files to Modify
- `src/engine/ui/LoadingScreen.ts` - Add status text element
- `src/engine/loader/pk3/PK3Index.ts` - Emit indexing status
- `src/engine/loader/map/MapLoader.ts` - Emit loading stages

---

## 2. Scene Clearing Command

### Problem
- Using `map` command after game start doesn't fully clear old scene
- Old renderings stay on screen
- Sometimes requires full page refresh to fix

### Solution
- Add `scene_clear` console command for explicit scene cleanup
- Makes debugging easier - can run manually to verify cleanup works
- Can be called before `map` command or standalone

### Console Command
```
scene_clear    - Clears all scene objects, materials, textures, resets state
```

### Files to Modify
- `src/engine/GameScene.ts` - Add `clearScene()` method
- `src/engine/debug/EngineCommands.ts` - Add `scene_clear` command
- `src/engine/loader/shader/ShaderAnimationSystem.ts` - Ensure clear on map change

### Checklist
- [ ] Dispose all meshes
- [ ] Dispose all materials  
- [ ] Dispose all textures
- [ ] Clear shader animation registrations
- [ ] Clear Q3 shader registry cache
- [ ] Reset camera position/rotation
- [ ] Clear any entity references

---

## 3. Camera Auto-Spawn at Spawn Point

### Problem
- Some BSP maps don't start at origin (0,0,0)
- Freefly camera spawns at origin, ends up "out of bounds"
- User has to manually navigate to find the map

### Solution
- After map load, automatically spawn camera at first `info_player_deathmatch` or similar spawn entity
- Use existing `bsp_spawn` command functionality internally
- Apply this for freefly mode by default

### Files to Modify
- `src/engine/GameScene.ts` or `MapLoader.ts` - Auto-position camera after load
- `src/engine/loader/bsp/BspEntityHandlers.ts` - Reference spawn entity handling

---

## 4. Better Default Settings

### Problem
- `freefly_collision` is off by default - user falls through floors
- `pvs` (potentially visible set) culling is off - performance not optimal

### Solution
- Enable `freefly_collision 1` by default
- Enable `pvs on` by default
- Both can still be toggled via console

### Files to Modify
- `src/engine/camera/controllers/FreeflyController.ts` - Default collision on
- `src/engine/loader/bsp/PVSCuller.ts` - Default enabled
- Or wherever these defaults are stored

---

## 5. Additional Polish Ideas (Optional)

### Quick Wins
- [ ] Console command `clear` or `cls` to clear console output
- [ ] Show FPS counter toggle via command
- [ ] Better error messages when map fails to load

### Future Consideration
- [ ] Map load progress bar (percentage)
- [ ] Thumbnail preview in map selection
- [ ] Recent maps history

---

## Implementation Order

1. **Loading screen status** - High visibility, quick win
2. **Default settings** - Simple config changes
3. **Camera auto-spawn** - Improves first-time experience
4. **Scene clearing** - Most complex, save for last

---

## Testing

After implementation:
1. Fresh page load → should show loading status
2. `map wdm1` → camera should spawn at spawn point
3. `map wdm2` → old map should fully clear, new map loads clean
4. Freefly should have collision by default
5. PVS culling should be active by default
