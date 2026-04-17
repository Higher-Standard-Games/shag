# Demo Player Improvements

**Branch:** `feature/random-improvements`  
**Status:** Planning

---

## Current Architecture (Quick Summary)

```
DemoViewer          — frame delivery (load / play / seek / speed)
DemoService         — singleton wiring: viewer ↔ RemotePlayerRenderer ↔ DemoViewerHUD
SpectatorController — Babylon FreeCamera that follows an entity's position from GameState
RemotePlayerRenderer— renders ALL players as 3D remote models (hitbox + PlayerModelManager)
WeaponViewManager   — singleton, renders first-person weapon via separate weaponCamera
                      parented to the live FPS camera
DemoViewerHUD       — transport controls DOM overlay (timeline, play/pause, speed, player list)
```

On demo start (`loadAndPlayNormal`):
1. `ensureRuntimeWiring` — wires `viewer.onFrame → remoteRenderer.pushSnapshot + refreshHudPlayerList`
2. `ensureCinematicControllers` — registers SpectatorController with a `targetProvider` that reads `latestState`
3. First `refreshHudPlayerList` call: if no target, calls `setController("spectator")` and picks first player

---

## Issues and Fixes

### Issue 1 — Camera Inside Player Model (P0)

**Symptom:** First-person view is obstructed by the followed player's own mesh geometry
(see screenshot: glossy dark shape in center = back/inside of player model).

**Root cause:**  
`RemotePlayerRenderer` renders all players including the followed one.
`SpectatorController` correctly places the camera at `entity.y + EYE_HEIGHT_OFFSET (26)` —
the eye height math is correct for Q3 coordinates (origin at waist, Q3 viewheight = 26).
But with no entity hidden, the camera sits at eye level *inside* the player's mesh.

**Fix:**  
Add `setHiddenEntity(entityId: string | null)` to `RemotePlayerRenderer`.
When called, it disables mesh rendering for that entity (`mesh.setEnabled(false)` +
model root visibility off). When a new target is selected, restore the old entity and hide
the new one.

Call site: `DemoService.onPlayerSelect` and `refreshHudPlayerList` (initial auto-select).

```typescript
// RemotePlayerRenderer
setHiddenEntity(entityId: string | null): void
  // find hitbox by entityId, set mesh + model visibility

// DemoService — onPlayerSelect callback:
this.remoteRenderer?.setHiddenEntity(entityId);
```

---

### Issue 2 — Player Button Click Doesn't Change POV (P0)

**Symptom:** Clicking a player name button in the HUD does nothing visually.

**Root cause:**  
`onPlayerSelect` calls `CameraSystem.setController("spectator")` even when already in
spectator mode. This triggers `detach()` → `attach()` on the controller:
- `detach()` removes the render observer and nulls `camera` / `scene`
- `attach()` receives CameraSystem's original camera (not the SpectatorController's own
  `FreeCamera` — that was created locally in the controller and never synced back to
  CameraSystem's `this.camera`)
- If the original camera is not a `FreeCamera`, `attach()` creates a **new** `FreeCamera`
  at the original (lobby) camera position
- The snap to the new entity may fail if `targetProvider` returns null before the next
  frame is delivered to `latestState`

**Fix:**  
In `onPlayerSelect`, only call `setController("spectator")` if the camera is not already
in spectator mode. When already following, `setSpectateTarget` alone is sufficient — the
existing render observer picks up the new `targetEntityId` immediately.

```typescript
// DemoService — onPlayerSelect:
this.demoHud.onPlayerSelect((entityId) => {
  const cam = CameraSystem.getInstance();
  const spectator = cam.getController("spectator") as SpectatorControllerLike | null;
  spectator?.setSpectateTarget?.(entityId);
  if ((cam.getActiveController() as ICameraController | null)?.type !== "spectator") {
    cam.setController("spectator");
  }
  this.remoteRenderer?.setHiddenEntity(entityId); // from Issue 1 fix
});
```

Also apply `setHiddenEntity` here so entity hiding tracks the target switch.

---

### Issue 3 — First-Person Weapon Viewmodel (P1)

**Symptom:** Demo POV shows no weapon in hand — just the world geometry.

**Desired behaviour:** Following a player should show their held weapon as a first-person
viewmodel with correct animations (idle, fire, switch) and recoil/bob, mirroring what a
live player sees.

---

#### Snapshot data available (investigated)

`weapon_state` is emitted **every snapshot** unconditionally for every player entity
(`SnapshotBuilder.ts` lines 332–344 — no change-guard, runs in the entity loop every tick).

Shape per frame:
```typescript
{
  type: "weapon_state",
  entityId: "player_<id>",   // always present
  currentWeapon: string,     // e.g. "rocketlauncher", "railgun"
  weapons: string[],         // full inventory
  ammo: Record<string, number>,
  reloading: boolean,
  lastFireTick: number,
}
```

`weapon_fire` events are **per-event** (only when fired), containing origin, direction, and
`weaponId`. Currently used only for remote tracer/FX — recoil is NOT triggered for remote
players in `handleRemoteWeaponFire`. For 1st-person spectator, we need to intercept these
for the followed entity and call `weaponRecoil.fire()`.

**Conclusion on "on change is enough":** Yes — since `weapon_state` is in every frame, a
simple `if (currentWeapon !== lastKnown)` comparison per frame is sufficient and reliable.
No risk of missed transitions even across seeks or fast-forward playback.

---

#### How WeaponViewManager works

`WeaponViewManager.init(scene, camera: FreeCamera)`:
- Creates `weaponCamera` (separate FOV, `minZ = 0.1`) and sets `weaponCamera.parent = camera`
- Masks the main camera to NOT see the weapon layer
- Adds both cameras to `scene.activeCameras = [mainCamera, weaponCamera]`
- Registers a `onBeforeRenderObservable` loop for bob/recoil/update

`WeaponBob.update(hSpeed, velocityY, landingVelocity)` — sinusoidal sway from movement.  
`WeaponRecoil.fire(recoilScale, adsProgress)` — kick triggered on fire event.  
Both feed offsets into `WeaponViewManager.update()` each frame.

---

#### Demo-specific gap

`SpectatorController` creates its own `FreeCamera("spectatorCamera")` inside `attach()`.
`WeaponViewManager` is parented to the live FPS camera — it does not follow the spectator
camera. The weapon layer is invisible during demo playback because `weaponCamera.parent`
points to the wrong camera.

Additionally, `SpectatorController` has no `getCamera()` method — there is no way to
retrieve the `FreeCamera` it created from outside the controller.

---

#### Fix plan

**Step 1 — Expose SpectatorController's FreeCamera**

Add to `SpectatorController`:
```typescript
getCamera(): FreeCamera | null {
  return this.camera;
}
```

**Step 2 — Add `attachToCamera` / `restoreToFPSCamera` to WeaponViewManager**

```typescript
// WeaponViewManager
attachToCamera(camera: FreeCamera): void {
  // Re-parent weaponCamera and weaponRoot to the given camera
  // Update this.mainCamera reference
  // Ensure scene.activeCameras includes new spectator cam + weaponCamera
  // Remove old main camera from activeCameras (add back on restore)
}

restoreToFPSCamera(): void {
  // Re-parent back to this.initCamera (stored at init() time)
  // Restore scene.activeCameras to [initCamera, weaponCamera]
}
```

**Step 3 — Wire weapon data in DemoService**

Add to `DemoService`:
```typescript
private _followedEntityId: string | null = null;   // track current spectate target
private _lastDemoWeapon: string | null = null;      // last weapon seen for that entity
private _lastDemoPos: { x: number; y: number; z: number } | null = null; // for bob
```

In **both** `onPlayerSelect` AND `refreshHudPlayerList` auto-select: set `_followedEntityId`.
The auto-select path is easy to miss — it only sets `setSpectateTarget` but does not set
`_followedEntityId`, so `_updateDemoWeapon` and `_updateDemoRecoil` would silently do
nothing until the user manually clicks a player button.  
Reset `_lastDemoWeapon = null` on target switch so next frame triggers a weapon load.

In `viewer.onFrame` callback:
```typescript
viewer.onFrame((state) => {
  this.latestState = state;
  this.remoteRenderer?.pushSnapshot(state, "");
  this.refreshHudPlayerList();
  this._updateDemoWeapon(state, /*isSeeking*/ false);   // new
  this._updateDemoRecoil(state);                         // new
});
```

Seeking also triggers `onFrameCallback`. Pass an `isSeeking` flag (or expose a setter
`setIsSeeking(v: boolean)` toggled around `DemoViewer.seekToProgress` calls) so
`_updateDemoWeapon` can choose `loadWeapon` (instant, no animation) instead of
`switchWeaponAnimated` during seeks. Animated weapon switches during scrubbing are jarring.

```typescript
private _updateDemoWeapon(state: GameState, isSeeking: boolean): void {
  if (!this._followedEntityId) return;
  const wvm = getWeaponViewManager();
  if (!wvm.isInitialized()) return;
  for (const event of state.events) {
    if (event.type !== "weapon_state") continue;
    if (event.entityId !== this._followedEntityId) continue;
    if (event.currentWeapon === this._lastDemoWeapon) return; // no change
    this._lastDemoWeapon = event.currentWeapon;
    if (isSeeking) {
      wvm.loadWeapon(event.currentWeapon).catch(() => {}); // instant — no animation during seek
    } else {
      wvm.switchWeaponAnimated(event.currentWeapon).catch(() => {});
    }
    return;
  }
}

private _updateDemoRecoil(state: GameState): void {
  if (!this._followedEntityId) return;
  const wvm = getWeaponViewManager();
  if (!wvm.isInitialized()) return;
  for (const event of state.events) {
    if (event.type !== "weapon_fire") continue;
    if (event.entityId !== this._followedEntityId) continue;
    // Trigger viewmodel recoil — same as local fire, ADS = 0 for spectator
    wvm["weaponRecoil"]?.fire(1.0, 0);
  }
  // Weapon bob from position delta
  const entity = state.entities.get(this._followedEntityId);
  const transform = entity?.getComponent("transform") as
    { position?: { x: number; y: number; z: number }; velocity?: { x: number; y: number; z: number } } | undefined;
  if (transform?.position) {
    const vel = transform.velocity ?? { x: 0, y: 0, z: 0 };
    const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    wvm["weaponBob"]?.update(hSpeed, vel.y, 0);
    this._lastDemoPos = transform.position;
  }
}
```

Note: `wvm["weaponRecoil"]` and `wvm["weaponBob"]` access private fields — consider adding
a `triggerRecoil(scale: number)` and `updateBob(hSpeed: number, velY: number)` façade to
`WeaponViewManager` to avoid private access.

**Step 4 — Show/hide around demo lifecycle**

⚠️ **Timing caveat:** `SpectatorController.getCamera()` returns `null` until after
`setController("spectator")` is called, which only happens during the first
`refreshHudPlayerList` call (triggered by first frame delivery). Calling `attachToCamera`
immediately after `ensureCinematicControllers` would always receive a null camera.

**Correct call site:** call `attachToCamera` inside `refreshHudPlayerList` at the point of
initial auto-select (same place `setController("spectator")` is called for the first time),
after `setController` returns:

```typescript
// In refreshHudPlayerList — initial auto-select branch only:
if (isFirstAutoSelect && firstEntityId) {
  cam.setController("spectator");                    // creates FreeCamera
  const spectatorCam = spectatorCtrl?.getCamera?.();
  if (spectatorCam && getWeaponViewManager().isInitialized()) {
    getWeaponViewManager().attachToCamera(spectatorCam);
    getWeaponViewManager().setVisible(true);
  }
}
```

Do **not** add weapon wiring in `loadAndPlayCinematic` — cinematic mode uses
`FreeflyController`, not `SpectatorController`, so there is no spectator camera to
attach to and the weapon layer should stay hidden.

In `DemoService.stopAll()`:
```typescript
const wvm = getWeaponViewManager();
wvm.setVisible(false);
wvm.restoreToFPSCamera();
this._followedEntityId = null;
this._lastDemoWeapon = null;
this._lastDemoPos = null;
```

**WVM initialization guard:** `WeaponViewManager.init()` may never have been called if the
user opens a demo without first loading into a live FPS match. Both the `attachToCamera`
call site and `_updateDemoWeapon`/`_updateDemoRecoil` must check `wvm.isInitialized()` (or
equivalent guard) and bail out silently if not ready. Add an `isInitialized(): boolean`
method to `WeaponViewManager` backed by a simple `private _initialized = false` flag set in
`init()`.

---

#### scene.activeCameras ordering note

Babylon renders `activeCameras` in array order — `weaponCamera` must come after the main
spectator camera so depth writes don't clobber world geometry. `attachToCamera` must
maintain `[spectatorCam, weaponCamera]` order.

---

**Risk:** Medium. `WeaponViewManager` is tightly coupled to camera/layer setup. The
`attachToCamera` method needs careful handling of the `scene.activeCameras` array — if the
live FPS camera is still in that array while spectating, weapon geometry may render in the
wrong view. Test with `scene.activeCameras` logging before and after.

Recommend finishing Issues 1 & 2 first and validating POV before adding the weapon layer.

---

### Feature — HUD Minimize / Expand (P2)

**Motivation:** Screen recording without the transport controls HUD visible.

**Design:**  
Add a `▼` toggle button on the right side of the controls row. Clicking collapses the HUD
to a single 3px timeline bar at the bottom of the screen (no controls, no player list,
just the scrubber). Clicking `▲` on that slim bar restores full controls.

**Implementation:**  
All internal to `DemoViewerHUD`:
- Add `private collapsed = false` state
- `private collapseBtn: HTMLButtonElement`
- On collapse: hide `controlsRow`, `playerList`; shrink container padding; show slim bar
- On expand: restore all
- No changes needed in `DemoService` or `DemoViewer`

---

## Implementation Order

| # | Item                          | Files                                      | Risk   |
|---|-------------------------------|--------------------------------------------|--------|
| 1 | Fix player switching          | `DemoService.ts`                           | Low    |
| 2 | Hide target entity model      | `RemotePlayerRenderer.ts`, `DemoService.ts`| Low    |
| 3 | HUD minimize button           | `DemoViewerHUD.ts`                         | Low    |
| 4 | Weapon viewmodel in demo      | `WeaponViewManager.ts`, `DemoService.ts`   | Medium |
| 5 | Weapon bob/recoil in spectator| `WeaponBob.ts`, `WeaponRecoil.ts`          | Low    |

Items 1–3 are independent and can be done in one pass.  
Item 4 depends on Item 1 being stable (correct camera before adding weapon layer).  
Item 5 is a polish pass after Item 4.

---

## Resolved Questions

- **`weapon_state` event frequency:** ✅ Every snapshot, unconditionally. Simple
  `currentWeapon !== lastKnown` comparison per frame is sufficient — no missed transitions.

- **SpectatorController FreeCamera reference:** ✅ Confirmed missing. Add
  `getCamera(): FreeCamera | null` to `SpectatorController`. Used by `DemoService` to
  hand the spectator camera to `WeaponViewManager.attachToCamera()`.

- **Entity visibility on target change:** ✅ In `setHiddenEntity(newId)`: restore old
  entity visibility first, then hide the new one. Store previous as `_hiddenEntityId` in
  `RemotePlayerRenderer`.

- **`weapon_fire` recoil for spectated player:** ✅ `handleRemoteWeaponFire` only fires
  tracers/FX — it does NOT trigger viewmodel recoil. Must intercept `weapon_fire` events
  in `_updateDemoRecoil` and call `weaponRecoil.fire()` directly for the followed entity.

- **`attachToCamera` timing:** ✅ `SpectatorController.getCamera()` returns null until after
  `setController("spectator")` is called (happens in `refreshHudPlayerList` first frame).
  Correct call site: inside `refreshHudPlayerList` auto-select, immediately after
  `setController("spectator")` returns. Not in `loadAndPlayNormal` setup.

- **`_followedEntityId` in auto-select path:** ✅ Must be set in both `onPlayerSelect` AND
  the auto-select branch in `refreshHudPlayerList`. Missing it in the auto-select path
  silently breaks weapon state tracking until user clicks a button.

- **Cinematic mode exclusion:** ✅ `loadAndPlayCinematic` uses `FreeflyController` — no
  spectator camera, no weapon layer. Weapon wiring is `loadAndPlayNormal` only.

- **Seek vs animated weapon switch:** ✅ `switchWeaponAnimated` during scrubbing is
  jarring. Pass `isSeeking` flag to `_updateDemoWeapon`; use `loadWeapon` (instant) when
  seeking, `switchWeaponAnimated` during normal playback.

- **WVM initialization guard:** ✅ If demo is opened before a live match loads,
  `WeaponViewManager.init()` may never have been called. Add `isInitialized(): boolean`
  to `WeaponViewManager` and guard all demo-side WVM calls behind it.

- **`reloading` state (out of scope for now):** `weapon_state` includes a `reloading`
  boolean. Could drive a reload animation on the viewmodel. Not planned — add as polish
  after weapon viewmodel is working.
