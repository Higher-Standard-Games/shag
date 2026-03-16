# Optimization Audit — Pre-1.0 Cleanup

> **Date**: 2026-03-16  
> **Goal**: Identify legitimate optimization targets without breaking compatibility or logic  
> **Scope**: `src/engine/` (main repo) + `src/games/fps/` (submodule)

---

## Critical — Needs to be Fixed

### 1. `BinaryProtocol.encodeCommand` uses JSON.stringify on every input tick

**File**: [BinaryProtocol.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/network/protocol/BinaryProtocol.ts#L90-L98)  
**Impact**: At 60+ ticks/sec, every player command is JSON-stringified, allocating strings on every frame.  
**Fix**: Encode commands as structured binary (direction floats, button bitmask, pitch/yaw). The data is already well-defined. This also reduces packet size.

### 2. `BinaryEncoder` allocates 16KB ArrayBuffer per encode call

**File**: [BinaryProtocol.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/network/protocol/BinaryProtocol.ts#L518-L521)  
**Impact**: Every `encodeSnapshot()` and `encodeCommand()` calls `new BinaryEncoder()` which creates `new ArrayBuffer(16384)`. That's per-client-per-snapshot on the server and per-tick on the client.  
**Fix**: Pool or reuse `BinaryEncoder`. Add a `reset()` method that sets offset to 0 instead of allocating new buffers.

### 3. `BspCollision.traceLeaf` creates Vector3 objects on every leaf visit

**File**: [BspCollision.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/physics/BspCollision.ts#L676-L679)  
**Impact**: `new Vector3` allocations inside `traceLeaf()` and `traceLeafBox()` create GC pressure. Each collision trace traverses multiple leaves per tick, per entity.  
**Fix**: Pre-allocate scratch Vector3s (like `SweepCollisionBackend` already does), reuse on every call.

### 4. `BinaryProtocol.decodeEntities` creates inline closures per entity per snapshot

**File**: [BinaryProtocol.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/network/protocol/BinaryProtocol.ts#L237-L260)  
**Impact**: Every decoded entity gets fresh `serialize()`, `deserialize()`, `clone()` function objects. With 10+ entities at 20 snapshots/sec, that's 600+ function allocations/sec.  
**Fix**: Define shared no-op functions once at module scope and reference them.

### 5. `BinaryProtocol.encodeEvents` uses JSON.stringify for events  

**File**: [BinaryProtocol.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/network/protocol/BinaryProtocol.ts#L453-L460)  
**Impact**: Events like `weapon_fire`, `damage`, `kill` are JSON-stringified each snapshot. Events fire frequently during combat.  
**Fix**: Type-specific binary encoding for known events. `JSON.stringify` can remain as fallback for unknown event types.

---

## Not Critical — Works, but Could be Improved

### 6. Duplicated collision code between `BspCollision.ts` and `SweepCollisionBackend.ts`

**Files**: [BspCollision.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/physics/BspCollision.ts) (1151 lines) + [SweepCollisionBackend.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/physics/SweepCollisionBackend.ts) (1407 lines)  
**Impact**: Both files duplicate `FaceCollisionGeometry`, `processFaces()`, `buildMeshFace()`, `getBrushTexture()`, and BSP tree traversal. Content flags constants duplicated vs `ContentFlags.ts`.  
**Improvement**: Extract shared BSP traversal and face processing into a common base. `SweepCollisionBackend` should import `ContentFlags` from `ContentFlags.ts` instead of re-declaring them.

### 7. `FPSGameManager.ts` is 1885 lines — god-class

**File**: [FPSGameManager.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/games/fps/FPSGameManager.ts)  
**Impact**: Mixed responsibilities: network init, local init, input handling, snapshot processing, remote player rendering, projectile rendering, weapon sync, kill events, camera switching, scoreboard. Hard to maintain and reason about.  
**Improvement**: Extract `FPSNetworkManager` (network init + snapshot handling), `FPSRemotePlayerManager` (remote player/projectile rendering), `FPSWeaponSync` (weapon state sync). Keep `FPSGameManager` as the coordinator.

### 8. `GameServer.ts` is 1310 lines with mixed concerns

**File**: [GameServer.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/games/fps/server/GameServer.ts)  
**Impact**: Combines transport handling, client management, snapshot broadcasting, PVS filtering, bot management, gametype management. Several methods exceed 100 lines.  
**Improvement**: Extract `ClientManager`, `SnapshotBroadcaster`, and `BotManager` classes. Keep `GameServer` as the orchestrator.

### 9. `WeaponViewManager.loadWeapon` is 447 lines (lines 269-716)

**File**: [WeaponViewManager.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/weapon/WeaponViewManager.ts#L269-L716)  
**Impact**: Single method handling asset loading, mesh setup, material processing, tag positioning, barrel config, and idle animation — all in one function.  
**Improvement**: Break `loadWeapon()` into `loadAsset()`, `configureMesh()`, `setupBarrels()`, `startIdleAnimation()`.

### 10. `FPSController.ts` (1501 lines) and `FreeflyController.ts` (1112 lines) duplicate update logic

**Files**: [FPSController.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/camera/controllers/FPSController.ts) + [FreeflyController.ts](file:///c:/Users/sundf/Desktop/wash/shag/src/engine/camera/controllers/FreeflyController.ts)  
**Impact**: Both controllers have duplicated view bob, camera shake, and network update logic.  
**Improvement**: Extract shared camera update logic into a `CameraUpdateMixin` or base class.

---

## Summary

| # | Category | Area | Type |
|---|----------|------|------|
| 1 | Critical | Network | Per-tick JSON stringify for commands |
| 2 | Critical | Network | 16KB buffer allocation per encode |
| 3 | Critical | Collision | Vector3 allocations in hot trace path |
| 4 | Critical | Network | Inline closure allocations per entity per snapshot |
| 5 | Critical | Network | JSON stringify for events |
| 6 | Improve | Collision | Code duplication between two collision backends |
| 7 | Improve | Game | FPSGameManager god-class (1885 lines) |
| 8 | Improve | Game | GameServer mixed concerns (1310 lines) |
| 9 | Improve | Engine | WeaponViewManager.loadWeapon 447-line method |
| 10 | Improve | Engine | FPSController/FreeflyController duplication |

> [!NOTE]
> Items 1-5 are performance-impacting and should be addressed for 1.0.  
> Items 6-10 are code quality improvements that reduce maintenance burden but don't affect runtime behavior.
