# Known Bugs - Network & Spawn System

This document tracks known issues with the multiplayer networking and spawn systems.

## 🔴 Critical: Player Stuck in Walls on Network Spawn

**Status:** Unresolved  
**Severity:** Critical  
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

### Suspected Causes

1. **Client-side collision different from server**: Despite using same `FPSMovementProfile`, client BSP collision may interpret geometry differently
2. **Spawn point inside brush**: Some spawn points may be too close to walls/floors
3. **Timing issue**: Player physics may run before collision world is fully injected
4. **Patch collision variance**: Curve/patch surfaces may have different tessellation client vs server

### Fixes Attempted

| Fix | Result |
|-----|--------|
| Wait for server position before FPSController init | ✅ Prevented re-initialization bug, but stuck issue persists |
| Floor trace at spawn to adjust Y | ✅ Correct Y-level, doesn't fix stuck |
| Inject BSP collision into client prediction | ✅ Collision works, but still stuck |

### Workarounds

- **Noclip**: Use `noclip` console command to move out of stuck position
- **Respawn**: Disconnect and reconnect to get new spawn point

### Related Files

- `src/engine/camera/controllers/FPSController.ts` - Client movement controller
- `src/games/fps/client/V2NetworkClient.ts` - Client prediction
- `src/games/fps/simulation/FPSMovementProfile.ts` - Shared movement physics
- `src/cli/headless-netserver-v2.ts` - Dedicated server

---

## 🟡 Medium: FPSController Re-initialization on Pointer Lock

**Status:** Fixed  
**Severity:** Medium  
**Fixed In:** v0.9.0 (commit pending)

### Issue
When mouse pointer was captured (click to play), FPSController would re-initialize physics position from stale `camera.position` instead of using server-provided spawn position.

### Fix
Modified `FPSController.ts` to wait for `V2NetworkClient.hasValidPosition()` before initializing in network mode.

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
