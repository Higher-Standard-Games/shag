# Known Bugs - Network & Spawn System

This document tracks known issues with the multiplayer networking and spawn systems.

## 🔴 Critical: Player Stuck in Walls on Network Spawn

**Status:** Partially fixed — needs live repro  
**Severity:** Critical (if still occurs)  
**First Observed:** v0.9.0 development  
**Affected:** Multiplayer mode (dedicated server)

### Symptoms

- Player connects to server and receives correct spawn position
- Client shows correct spawn coordinates in reconciliation logs
- Despite 0.0 reconciliation error, player cannot move
- Player appears to be stuck inside geometry at spawn point

### Investigation Findings

1. **Spawn position is correct**: Server sends valid spawn coordinates (e.g., `-798.0, 448.0, -368.0`)
2. **Floor detection works**: Server correctly adjusts Y to floor level (`spawnY=448.0 → floorY=423.9`)
3. **Client receives position**: V2NetworkClient receives and processes first snapshot correctly
4. **Reconciliation passes**: `[Reconcile] Error: 0.0 units` confirms client-server sync

### Fixes Since Last Assessment

| Fix | Source |
|-----|--------|
| `V2NetworkClient.resetForRespawn()` — clears all death-period state (input history, skip counters, visual offset) | `V2NetworkClient.ts:492-525` |
| `V2NetworkClient.forceTeleport()` — snaps camera on next snapshot (respawn/teleport) | `V2NetworkClient.ts:472-478` |
| `SharedCollisionWorld` — single shared implementation for client and server (eliminates physics divergence) | `SharedCollisionWorld.ts` |
| Reconciliation skip during ledge grab / walljump (prevents correction-induced jitter) | `V2NetworkClient.ts:284-308` |
| `FPSController` waits for server position before physics init | `FPSController.ts:735-751` |

### Remaining Risk: Async Collision Injection Timing

The most plausible remaining cause is a race between collision world injection and the first physics tick:

- `FPSController.ts:828-838` injects BSP collision via `initializeLocal().then(...)` — this is async
- `V2NetworkClient.setCollisionWorld()` (line 157) can be called after the client has already started processing inputs
- If the first few ticks run with `collision = null`, the player moves in no-collision mode, then collision appears mid-frame and the player is inside geometry

### Unverified Hypotheses

- **Spawn point inside brush** — spawn points may be too close to walls/floors. The ledge grab code now does a full hull clearance check (`LedgeGrab.ts:228-234`), but spawn point selection does not.
- **Patch collision variance** — curve/patch tessellation could differ between client and server if the `SweepCollisionBackend` handles patches differently on each side.

### Workarounds

- **Noclip**: Use `noclip` console command to move out of stuck position
- **Respawn**: Disconnect and reconnect to get new spawn point

### Related Files

- `src/engine/camera/controllers/FPSController.ts` — Client movement controller
- `src/games/fps/client/V2NetworkClient.ts` — Client prediction
- `src/games/fps/simulation/MovementProfile.ts` — Shared movement physics
- `src/shared/collision/SharedCollisionWorld.ts` — Shared collision (client + server)
- `src/cli/headless-netserver-v2.ts` — Dedicated server

---

## ~~🟡 Medium: FPSController Re-initialization on Pointer Lock~~

**Status:** ✅ Fixed (verified in source)  
**Severity:** Was Medium  
**Fixed In:** v0.9.0

### Issue

When mouse pointer was captured (click to play), FPSController would re-initialize physics position from stale `camera.position` instead of using server-provided spawn position.

### Fix

`FPSController.ts:735-751` — `smoothingInitialized` guard calls `gameManager.processSnapshots()` then `gameManager.getLocalPlayerPosition()` before setting physics position. If server position is not yet available, the frame returns early without initializing. In local mode, camera position is still used (acceptable).

---

## 🟡 Medium: LightGrid Dimension Mismatch

**Status:** Known, Low Priority  
**Severity:** Low  
**Affected Maps:** Various FBSP maps (Warsow)

### Symptoms

```
[BspLoader] LightGrid Counts: Predicted=10880, Actual=10822
[BspLoader] LightGrid dimension mismatch!
```

### Impact

Model lighting may be slightly incorrect near map edges.

---

## 🟡 Medium: Ledge Grab Micro-Shake with +forward Input

**Status:** Open (cosmetic — grab is functional)
**Severity:** Minor
**First Observed:** v0.9.7 development

### Symptoms

Holding W (+forward) + Jump near a ledge while airborne causes a subtle 2–3 frame camera shake at the moment the ledge grab initiates. Releasing +forward before the grab triggers results in a perfectly smooth grab.

### Investigation & Fixes Applied

Five issues were identified and fixed, each reducing shake but not fully eliminating it:

| Layer | Issue | Fix |
|-------|-------|-----|
| `LedgeGrab.ts` cancel logic | Sprint and directional input (`pushingAway` dot product) could cancel grabs at angles → detection→cancel oscillation | Only Crouch cancels now |
| `LedgeGrab.ts` detection tick | Velocity not zeroed on frame 0 of grab | `vel.x/y/z = 0` on detection |
| `V2NetworkClient.visualOffset` | Reconciliation corrections smoothed over ~50ms during grab | Snapped to zero when `ledgeGrabState !== 'none'` |
| `NetworkGameHost.reconcilePrediction` | Smooth correction applied during grab | Reconciliation skipped during grab |
| `FPSController.smoothedY` | Camera Y lerped at 15%/frame during grab | Snapped when `ledgeGrabState !== 'none'` |

### Remaining Cause (Suspected)

The residual shake likely comes from:

- **Collision response before detection** — Air accel from +forward pushes into wall collision (step-slide-move clips position) on the tick before detection, creating a sub-unit position jerk that gets frozen
- **Input replay FP drift** — V2Client replays unacked inputs from server position; accumulated floating point differences cause the replayed grab to trigger at a slightly different position
- **Detection timing sensitivity** — Waist trace (`ledgeReach = 32u`) fires at varying distances depending on exact sub-unit position

### Potential Future Approaches

1. **Pre-emptive detection** — Increase `ledgeReach` so grab triggers before wall contact
2. **Deterministic grab position** — Snap to a computed wall-relative position instead of freezing at current position
3. **Reconciliation-aware grab** — Force replayed grabs to trigger at the same sequence as original prediction

### Related Files

- `src/games/fps/simulation/LedgeGrab.ts`
- `src/games/fps/simulation/MovementProfile.ts`
- `src/games/fps/client/V2NetworkClient.ts`
- `src/engine/network/client/hosts/NetworkGameHost.ts`
- `src/engine/camera/controllers/FPSController.ts`

---

## 🟡 Medium: No Momentum Preservation on 45° Slopes

**Status:** Open  
**Severity:** Medium  
**First Observed:** v0.9.5 development  
**Affected:** All modes

### Symptoms

- Player loses all speed when hitting a 45° ramp surface
- In Warsow, players can slide along ramps maintaining momentum (surf-style)
- Speed is killed on contact despite velocity clipping working correctly

### Investigation So Far

- `MIN_WALK_NORMAL` raised from 0.7 to 0.75 — makes 45° surfaces non-walkable (cos45°=0.707 < 0.75)
- Ramp velocity detection added to `SharedCollisionWorld` — if slideMove redirects velocity upward >30 u/s, override grounded=false
- Issue persists: at ramp/floor junctions, ground trace still finds flat floor below the player, reporting grounded=true before the ramp check fires
- Friction in `Acceleration.applyFriction()` kills horizontal speed on the first grounded frame before the airborne override can take effect

### Suspected Root Cause

The ground detection architecture traces DOWN from the player's end position. At ramp/floor junctions, this always finds the flat floor (not the ramp), causing false grounding. A possible fix is to use the slideMove hit normals directly for ground detection instead of a secondary downward trace.

### Related Files

- `src/shared/collision/SharedCollisionWorld.ts` — ground detection
- `src/games/fps/simulation/MovementProfile.ts` — ground plane clipping, slope physics
- `src/games/fps/simulation/Acceleration.ts` — friction, ground/air acceleration
- `src/engine/physics/SweepCollisionBackend.ts` — slideMove, clipVelocity

---

## 🟡 Medium: Intermittent Texture Loading Failure (Race Condition)

**Status:** Open  
**Severity:** Medium  
**First Observed:** v0.9.7 development  
**Affected:** Map loading (BSP textures)

### Symptoms

- Map loads but some/all textures appear missing or black
- Happens intermittently — most loads succeed, but occasionally fails
- Game is otherwise functional (collision, networking, HUD all work)
- Reloading the page usually fixes it

### Console Evidence

```
WebGL: INVALID_OPERATION: texImage2D: ArrayBufferView not big enough for request
[KTX1Loader] Truncated KTX: mip 8 needs 65408 bytes at offset 262272, but buffer is only 262281 bytes
[KTX1Loader] Uncompressed texture: textures/scifi_interior/covenant2.ktx (512x512)
```

### Suspected Cause

Race condition in async texture loading pipeline. Multiple textures are loaded concurrently via `PK3TextureLoader`, and KTX1 software decoding + `updateRawTexture` may conflict when:

1. Multiple KTX1 textures are decoded simultaneously and share buffer state
2. Texture ArrayBufferView is partially overwritten before WebGL upload
3. PK3 extraction yields truncated data under concurrent reads

### Key Observation

The `ArrayBufferView not big enough for request` error suggests the raw pixel data buffer doesn't match the expected texture dimensions, pointing to either truncated PK3 extraction or a shared buffer being reused before upload completes.

### Related Files

- `src/engine/loader/pk3/PK3Loader.ts` — PK3 archive extraction
- `src/engine/loader/pk3/PK3TextureLoader.ts` — Texture loading from PK3
- `src/engine/loader/mesh/KTX1Loader.ts` — KTX1 software decoding
- `src/engine/map/BspMeshBuilder.ts` — Material/texture assignment
