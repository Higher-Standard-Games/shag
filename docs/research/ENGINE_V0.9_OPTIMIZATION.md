# Engine v0.9 Optimization Audit

Tracked on branch `feature/optimizations`. Golden rule: **no functionality changes**.

## Easy Gains — Dead Code & Cleanups

| # | Description | File(s) | Status |
|---|-------------|---------|--------|
| 1 | Delete dead `FPSGame.ts` skeleton | `games/fps/FPSGame.ts`, `index.ts` | ✅ Done |
| 2 | Remove dead `airAccelerate` stub | `FPSMovementProfile.ts` | ✅ Done |
| 3 | Fix broken `FPSPhysicsSystem→CharacterPhysicsSystem` import | `server-replay.ts`, `FPSServerGame.ts` | ✅ Done |
| 4 | Clean all TS6133 unused-variable errors | 18 files | ✅ Done |
| 5 | Remove dead `_checkGrounded` method (56 lines) | `FPSMovementProfile.ts` | ✅ Done |
| 6 | Remove dead `_moveWithCollision` method (55 lines) | `FPSMovementProfile.ts` | ✅ Done |
| 7 | Remove dead `_createGlowLight` method (32 lines) | `Pickup.ts` | ✅ Done |
| 8 | Remove dead `setPickupImmunity` method + field | `Pickup.ts` | ✅ Done |
| 9 | Remove dead fields: `_lastUpdateTick`, `_startPos`, `lastAckedSeq`, etc. | `LagCompensation.ts`, `Pickup.ts`, `V2NetworkClient.ts` | ✅ Done |
| 10 | Remove dead fields: `_traceDebugCount`, `_stepSlideMoveDebugCount` | `SweepCollisionBackend.ts` | ✅ Done |
| 11 | Remove dead constants: `_PLAYER_RADIUS`, `_PLAYER_HEIGHT`, `_SLIDE_PITCH_TILT`, `_ledgeGrabGraceTime` | `FPSMovementProfile.ts` | ✅ Done |
| 12 | Remove write-only fields: `events`, `_reliableWriter`, `_myPlayerId` | `WebSocketTransport.ts`, `WebTransportTransport.ts`, `server-integration.ts` | ✅ Done |
| 13 | Remove dead `PICKUP_RADIUS` constant | `PickupSystem.ts` | ✅ Done |
| 14 | Remove unused imports: `Color3`, `tickNumber` | `Pickup.ts`, `server-game.ts` | ✅ Done |
| 15 | Remove stale diagnostics in `onServerStateUpdate` | `FPSGameManager.ts` | ✅ Done |
| 16 | Remove dead debug vars/logs in `BspCollision` | `BspCollision.ts` | ✅ Done |
| 17 | Strip verbose init logs from `FPSSimulation` | `FPSSimulation.ts` | ✅ Done |
| 18 | Clean unused imports in `BspCollision` | `BspCollision.ts` | ✅ Done |
| 19 | Strip 32+ verbose `dropToGround` debug logs | `Pickup.ts` | ✅ Done |
| 20 | Strip verbose model-loading debug logs | `Pickup.ts` | ✅ Done |
| 21 | Fix TS2564 uninitialized `numberEl`/`fillEl` | `FPSHud.ts` | ✅ Done |
| 22 | Strip verbose debug logs from `PickupSystem` (6 logs) | `PickupSystem.ts` | ✅ Done |
| 23 | Strip verbose debug logs from `SweepCollisionBackend` | `SweepCollisionBackend.ts` | ✅ Done |
| 24 | Strip verbose debug logs from `DroppedWeaponSystem` | `DroppedWeaponSystem.ts` | ✅ Done |
| 25 | Strip verbose debug logs from `CollisionManager`/`PhysicsSystem` | `CollisionManager.ts`, `PhysicsSystem.ts` | ✅ Done |
| 26 | Strip verbose debug logs from `WeaponSystem`/`CombatSystem` | `WeaponSystem.ts`, `CombatSystem.ts` | ✅ Done |
| 27 | Strip verbose debug logs from network layer init | `NetworkManager.ts`, `ClockSync.ts` | ✅ Done |
| 28 | Strip verbose debug logs from loader subsystems | `ModelLoader.ts`, `TextureLoader.ts`, `BspMeshBuilder.ts` | ✅ Done |

## Medium Gains — Refactors

| # | Description | File(s) | Status |
|---|-------------|---------|--------|
| 1 | Extract `calcAccelFalloff()` (3× duplicated) | `FPSMovementProfile.ts` | ✅ |
| 2 | Replace `Date.now()` with deltaTime accumulators | `FPSMovementProfile.ts` | ✅ |
| 3 | Avoid `{ ...cmd.direction }` spread in hot loop | `FPSSimulation.ts` | ✅ |
| 4 | Break up 335-line `onServerStateUpdate` | `FPSGameManager.ts` | 🔲 Deferred |
| 5 | Replace `JSON.stringify` in binary event encoding | `BinaryProtocol.ts` | 🔲 Deferred |
| 6 | Pre-allocate larger `BinaryEncoder` buffer | `BinaryProtocol.ts` | ✅ |
| 7 | Replace `Array.from()` with `[...keys]` | `FPSGameManager.ts` | ✅ |
| 8 | Cache `getComponent<T>()` per entity per tick | `FPSSimulation.ts` | 🔲 Deferred |
| 9 | Split 2400-line `FPSHud.ts` into widget files | `FPSHud.ts` | 🔲 Deferred |
| 10 | Reduce init-time console.log spam engine-wide | Multiple | ✅ |

## Hard Gains — Advanced (Deferred)

| # | Description | File(s) | Status |
|---|-------------|---------|--------|
| 1 | Mutating vec3 helpers for hot paths | `FPSMovementProfile.ts` | ✅ |
| 2 | ECS: indexed slots instead of string keys | Engine ECS | 🔲 Deferred |
| 3 | Pool `SnapshotBuffer` Maps | `SnapshotBuffer.ts` | 🔲 Deferred |
| 4 | Encode-once server broadcast | Server snapshot pipeline | 🔲 Deferred |
| 5 | Pool `TraceResult` objects | `CollisionWorld.ts` | 🔲 Deferred |
| 6 | Pre-alloc scratch vectors in `stepSlideMove` | `SweepCollisionBackend.ts` | ✅ |
| 7 | Batch entity interpolation sampling | `FPSGameManager.ts` | — Skipped |
| 8 | Skip weapon sync when state hash unchanged | `FPSGameManager.ts` | — Skipped |
| 9 | Build-time CSS injection | `WashikiTheme.css` | — Skipped |
| 10 | Scope event listeners to canvas | `FPSController.ts` | ✅ |

## v0.9+ Performance Pass

| # | Description | File(s) | Status |
|---|-------------|---------|--------|
| 1 | PK3Loader: O(1) file lookup via pre-built `zipFileIndex` Map | `PK3Loader.ts` | ✅ |
| 2 | PK3Loader: track and revoke Blob URLs to prevent memory leaks | `PK3Loader.ts` | ✅ |
| 3 | Q3ShaderRegistry: cache `resolveMaterialProps()` results by texture name | `Q3ShaderRegistry.ts` | ✅ |
| 4 | AssetPreloader: parallel batch model loading (4 concurrent) | `AssetPreloader.ts` | ✅ |
| 5 | TextureLoader: parallel HEAD probes via `Promise.allSettled` | `TextureLoader.ts` | ✅ |
| 6 | SweepCollisionBackend: pool TraceState + scratch tuples | `SweepCollisionBackend.ts` | ✅ |
| 7 | SweepCollisionBackend: pre-filter clip brushes at init | `SweepCollisionBackend.ts` | ✅ |
| 8 | RenderVars: material-level dedup in `applyToScene` | `RenderVars.ts` | ✅ |
| 9 | Frozen Material Mode: `material.freeze()` after BSP load | `MapLoader.ts` | ✅ |

### Legend

- ✅ Done
- 🔄 In Progress
- 🔲 Not Started
