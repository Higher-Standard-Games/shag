# Optimization Findings (0.8.17)

This document captures a QA-style optimization audit checklist and prioritized areas to investigate for **memory usage**, **speed/frame time**, and **architectural clarity**.

Scope assumptions:
- Rendering/runtime is driven by Babylon.js.
- Maps/levels are loaded/unloaded (BSP/PK3 pipeline) and gameplay switches scenes.
- Engine uses service singletons and scene/game lifecycle hooks.

---

## Goals

- **Reduce frame time variance** (stutter) and improve average FPS.
- **Reduce memory high-water mark** (especially across map transitions).
- **Prevent leaks** during repeated load/unload cycles.
- **Increase clarity of ownership** (who creates/disposes what; what lives per-app vs per-scene vs per-game).

---

## Measurement First (QA Workflow)

Before changing code, collect baseline metrics.

### A) Repro/benchmark scenarios

- **Scenario 1: Idle in a map**
  - Let it run for 60s in a representative area.
  - Record FPS, frame time distribution.

- **Scenario 2: Interaction-heavy**
  - Trigger build placement / click picking / UI interactions.
  - Watch for spikes (picking, allocations).

- **Scenario 3: Map transition / reload loop**
  - Load/unload or switch maps ~10 times.
  - Compare heap snapshots and GPU resource counts before/after.

### B) What to capture

- **Browser Performance tab**
  - Flame graph focusing on scripting time, GC pauses.

- **Memory snapshots**
  - Heap snapshot before/after map reload loop.
  - Look for retained Babylon resources and engine singletons holding references.

- **Scene statistics**
  - Mesh count, material count, texture count.
  - Draw calls / active lights / postprocess pipelines.

---

## Speed Hotspots (Frame Time)

### 1) Per-frame allocations (GC churn)

**Symptoms**
- Periodic stutters even when camera is not moving.
- Frequent minor GCs.

**What to look for**
- New arrays, objects, `Vector3`/`Matrix` allocations inside:
  - `scene.onBeforeRenderObservable` callbacks
  - camera controller update loops
  - shader animation systems
  - culling systems

**Typical fixes**
- Reuse temp vectors/matrices.
- Preallocate arrays used every frame.
- Avoid closures created inside per-frame functions.

**Likely areas to audit**
- `src/engine/camera/controllers/*`
- systems with `onBeforeRenderObservable.add(...)`
- shader animation/effect systems

---

### 2) Picking / input costs

Babylon picking can become expensive with many meshes, especially with `multiPick`.

**What to look for**
- Too many meshes flagged `isPickable`.
- Using `multiPick` over dense scenes.
- Trigger/build-zone meshes that are pickable but not optimized.

**Typical fixes**
- Ensure only interactables are pickable.
- Use dedicated layers/groups for pick targets.
- Consider a simplified pick proxy mesh or utility layer.

**Likely areas to audit**
- `GameInputHandler` click flow
- camera controller pointer handlers

---

### 3) Draw calls / overdraw

**Symptoms**
- GPU-bound frames, low FPS despite low scripting time.

**What to look for**
- Too many unique materials.
- Many transparent overlays/decals causing overdraw.
- Small meshes that could be instanced.

**Typical fixes**
- Use `thinInstance` / instancing for repeated objects.
- Merge static meshes where safe.
- Reduce transparent surfaces and optimize decal rendering.

**Likely areas to audit**
- BSP mesh building and material creation
- decal/overlay systems

---

## Memory Pressure (Leaks + High Water Mark)

### 1) Scene/map lifecycle leaks

The most common leak source is: **scene unloaded, but a singleton/service still retains references**.

**What to look for**
- Singletons that store `scene`, `engine`, `canvas`, `mesh`, `material`, `texture` references.
- `Observable.add(...)` subscriptions not removed.
- DOM event listeners not removed.
- Physics/collision resources not disposed.

**Typical fixes**
- Explicit `dispose()` methods for scene-bound services.
- A single authoritative “map unload” path that calls dispose hooks.
- Ensure `scene.onDisposeObservable` is used to clean up.

---

### 2) Materials/textures caches without bounds

Caches improve speed but can balloon memory.

**What to look for**
- Material/texture registries that grow indefinitely.
- Duplicate loads for the same asset path.

**Typical fixes**
- Add bounded caches (LRU / max entries).
- Clear caches on map unload if assets are map-scoped.
- Normalize keys (lowercase, slash normalization) to avoid duplicates.

---

## Architectural Clarity

### 1) Service lifetime taxonomy

To improve clarity and reduce leaks, classify services by lifetime:

- **App lifetime**: exists once for app session (e.g., config, logging)
- **Scene lifetime**: recreated per map/scene (must dispose)
- **Game lifetime**: recreated per save slot/new game (must reset)

**Recommendation**
- If a singleton touches Babylon `Scene`, it should implement:
  - `init(scene)`
  - `dispose()` (or `resetSceneState()`)

---

### 2) Explicit init order

Hidden init order causes inconsistent states and intermittent bugs.

**Recommendation**
- Centralize init order in one place (already partly done via `ServiceLocator`).
- Avoid “lazy init on first use” for core systems.

---

## Quick Wins (Highest ROI)

### A) Leak hunt via map reload loop

- Run a 10x map reload/switch loop.
- Take heap snapshots before/after.
- Fix anything retained that should be scene-scoped.

### B) Pickability audit

- Default `isPickable = false` for world meshes.
- Only enable pickable on explicit interaction targets.

### C) Allocation audit

- Use Performance tab to find allocation-heavy per-frame code.
- Reuse temp objects.

---

## Concrete Findings (Codebase Scan)

This section lists **specific, actionable targets** (with file references) discovered during a quick scan.

### 1) Scene lifecycle: leaked global listeners / subscriptions

- **EngineScene resize handler** was created inline and could not be removed on dispose.
  - File: `src/engine/EngineScene.ts`
  - Impact: repeated scene creation could accumulate `resize` listeners.
  - Status: **fixed** (store handler, remove on `dispose()`).

- **EngineScene EventBus subscriptions** for `map:loaded`, `app:state_change`, `app:back_button` were not unsubscribed.
  - File: `src/engine/EngineScene.ts`
  - Impact: multiple scenes -> multiple handlers firing; retained closures -> memory leaks.
  - Status: **fixed** (store `unsubscribe*` functions; call on dispose).

- **GameScene performance setting listener** was added via an inline lambda and could not be removed.
  - File: `src/games/default/GameScene.ts`
  - Impact: leaks across returning to main menu / new game.
  - Status: **fixed** (store handler and remove on dispose).

### 2) Scene disposal completeness

- **EngineScene.dispose() previously only disposed the Babylon scene.**
  - File: `src/engine/EngineScene.ts`
  - Impact: scene-scoped singletons can keep DOM listeners and Babylon resources alive.
  - Status: **fixed** (stop render loop; dispose/clear scene-scoped systems).
  - Now disposing:
    - `InputSystem.getInstance().dispose()`
    - `CameraSystem.getInstance().dispose()`
    - `SpriteManager.getInstance().clear()`
    - `WorldIndicatorSystem.getInstance().clearAll()`

### 3) Map unload / reload loop risks

- **Map clearing relies on naming conventions**.
  - File: `src/engine/MapRenderer.ts` (`clearMap(scene)`)
  - Risk: if a new map entity creates meshes/nodes without the expected prefixes/metadata, they will not be disposed.
  - Recommendation:
    - Ensure all map-created nodes tag `metadata.mapOwned = true` (or similar) and clear by that.
    - Or centralize creation through a factory that marks ownership.

- **Map ownership tagging implemented (preferred disposal path)**.
  - File: `src/engine/MapRenderer.ts`
  - Approach:
    - `renderEntities(entities, scene, mapName?)` tags created objects with:
      - `metadata.mapOwned = true`
      - `metadata.mapName = <mapName>`
    - `clearMap(scene, mapName?)` disposes primarily by this metadata (with the old prefix-based logic as fallback).
    - Instanced meshes created via `InstancedMeshManager` are removed via `removeInstance(instanceId)`.
    - `ClusteredLightContainer` is stored on `scene.metadata.clusteredLightContainer` and disposed on map clear.
  - Call sites updated:
    - `src/engine/EngineScene.ts` passes `mapName` into `MapRenderer.renderEntities` and passes `previousMap` into `clearMap`.
    - `src/games/default/MainMenu.ts` passes menu map name into `MapRenderer.renderEntities`.

- `MapRenderer.clearMap()` currently calls `TextureManager.getInstance().clearCache()`.
  - File: `src/engine/MapRenderer.ts`
  - Recommendation:
    - Decide which caches are per-map vs global.
    - Bound caches (LRU / max entries) instead of clearing everything (avoid reload stutter).

### 4) Input/picking overhead

- Input is updated every frame via scene observables.
  - File: `src/engine/input/InputSystem.ts`
  - Good: centralized per-frame input state update.
  - Risk: heavy per-frame work or allocations in `updateActionStates()` (audit with Performance tab).

- Picking can easily become the biggest scripting spike if too many meshes are pickable.
  - File: game input handler(s) (e.g. default game click handling)
  - Recommendation:
    - Ensure `isPickable=false` for world geometry and only true for interactables.
    - Consider a dedicated picking layer/proxy meshes for triggers/build zones.

### 5) Camera system churn / camera recreation

- Controller switching can create and dispose cameras.
  - File: `src/engine/camera/CameraSystem.ts`
  - Risk:
    - camera recreation can cause spikes (GC + Babylon internal allocations).
    - disposal order matters when other systems retain camera references.
  - Recommendation:
    - Minimize camera recreation; reuse a single ArcRotateCamera where possible.
    - Ensure systems that bind to camera (postprocess, sprites) rebind on camera changes.

### 6) Background scene / menu scene lifecycle

- Main menu creates its own Babylon scene and has a delayed disposal (timeout).
  - File: `src/games/default/MainMenu.ts`
  - Risk: overlap where both scenes exist (expected) but verify resources are released:
    - scene disposed
    - render loop stopped
    - references cleared

### 7) Bundle/load-time optimization signal

- Vite build warning indicates dynamic imports are currently defeated by static imports.
  - Example warning: modules dynamically imported but also statically imported by `src/main.ts`.
  - Impact: worse initial load time, larger JS bundle, more memory on startup.
  - Recommendation:
    - Make "optional" systems truly lazy (remove static imports in the main path).
    - Consider a dedicated chunk for debug/console-only tooling.

---

## Leak Hunt Procedure: Map Reload Loop (QA)

Goal: detect leaks by repeatedly switching maps and verifying memory and resource counts stabilize.

### Step 1: Prepare baseline

- Start dev build.
- Open Chrome DevTools:
  - Performance tab (for spikes)
  - Memory tab (heap snapshot)

Capture baseline:
- heap snapshot A
- record:
  - `scene.meshes.length`
  - `scene.materials.length`
  - `scene.textures.length`

### Step 2: Reload loop

- Perform ~10 map switches/reloads.
  - Use existing console/map commands (`map <name>`) or in-console helper (`loadMap(name)` if exposed).

### Step 3: Compare

- Take heap snapshot B and compare to A:
  - Look for retained arrays of meshes/materials/textures.
  - Look for retained closures referencing previous scenes.

### Step 4: Triage checklist

If counts grow, check for:
- Unremoved `window.addEventListener` / `document.addEventListener`
- Unsubscribed `EventBus.on` handlers
- Systems storing `scene`/`camera` references across reload
- Postprocess pipelines not disposed/rebound on camera changes
- Meshes created without map ownership tags (missed by `MapRenderer.clearMap`)

Additional leak fix applied:
- `BillboardSprite` now removes its `onBeforeRenderObservable` observer in `dispose()`.
  - File: `src/engine/sprites/BillboardSprite.ts`


---

## Suggested Instrumentation (Optional but Valuable)

Use the console system to expose internal metrics so QA can validate improvements.

### Candidate commands

- `stats`
  - mesh/material/texture counts
  - FPS
  - draw calls (if available)

- `mem`
  - sizes of caches (shader registry, texture cache, pk3 index)
  - scene resource counts

- `profile start|stop`
  - toggles simple frame timing collection and logs avg/95p

---

## Notes / Next Actions

- This is a **living document**: as hotspots are confirmed with profiling, add file-level findings and concrete changes here.
- Prefer changes that reduce allocations and clarify disposal responsibility before micro-optimizations.
