# Demo player investigation (v0.9.18)

**Status:** investigation plus incremental fixes — WO-DP1 through WO-DP7 are implemented in the current uncommitted worktree  
**Investigated:** 2026-07-14  
**Scope:** normal and cinematic demo playback, followed-player camera, player/viewmodel animation, transport, seeks, transient events, and demo overlays

## Executive summary

The demo format already contains enough state to reconstruct the movement that currently looks wrong. Real v0.9.18 recordings contain position, angles, velocity, grounded, crouch, slide, wall-jump, weapon, combat, and event data. The principal problem is that playback is driven by several unrelated clocks:

- `DemoViewer` advances recorded frames from its own accumulator.
- `SnapshotBuffer` timestamps received demo frames with `performance.now()` and interpolates/extrapolates in wall-clock time as if they were live network packets.
- Babylon animation groups and remote-player one-shots run in wall-clock time.
- weapon/view effects, chat expiry, and several combat effects also run in wall-clock time.
- the followed camera consumes the latest raw demo state through its own smoothing path rather than the same sampled state used by the player model.

This makes translation, animation, camera motion, and effects disagree at any speed other than a stable 1x. It also permits presentation to continue briefly while paused and leaves stale state around seeks. The first-person walk bob has a simpler immediate cause: it is explicitly not wired for demos. `WeaponViewManager.updateBob()` is currently a no-op, and the demo path does not feed followed-player movement into the normal viewport-effects pipeline.

There is also a concrete base-speed error. A 125 Hz server asked for 60 snapshots/s records every two simulation ticks, so the effective rate is 62.5 snapshots/s. The file header retains the requested value `60`, and `DemoViewer` schedules every frame at `1000 / 60`. A nominal 1x replay is consequently about **4.17% slow**. Recorded tick values should be the playback time source; `snapshotRate` should not be treated as exact frame spacing.

At the investigation baseline, first-person walk bob was explicitly not wired: `WeaponViewManager.updateBob()` was a no-op and the demo path did not feed followed-player movement into the viewport-effects pipeline. WO-DP3 now reconstructs camera and weapon bob from the recorded-tick clock and consumes the recorded crouch transition offset.

At the investigation baseline, the requested HUD toggle did not exist. WO-DP5 now provides `H` and `demoplay hud <on|off|toggle>`, covering the active normal/cinematic HUD and the demo event/chat overlay.

## Current pipeline

```text
.shagdemo header/index/frame stream
              |
              v
         DemoViewer -------------------- recorded-tick transport / frame stepping
              |
              +--> DemoEntityTimeline --> models + followed camera
              |
              +--> DemoPovState --> camera + viewmodel bob
              |
              +--> event policy --> persistent state / forward-only effects
              |
              +--> DemoEventTimeline --> tick-expiring event/chat overlay
              |
              +--> DemoOverlayController --> normal or cinematic HUD visibility
```

Relevant code:

- `src/games/fps/client/DemoViewer.ts` — load, play/pause, seek, speed, and frame delivery.
- `src/games/fps/client/DemoService.ts` — map/session lifecycle and all playback presentation wiring.
- `src/games/fps/client/RemotePlayerRenderer.ts` — entity interpolation and third-person animation selection.
- `src/engine/network/client/SnapshotBuffer.ts` — live-network wall-clock buffering reused by demos.
- `src/engine/camera/controllers/SpectatorController.ts` — followed-player camera.
- `src/engine/weapon/WeaponViewManager.ts` — first-person demo weapon and the no-op demo bob entry point.
- `src/engine/viewport/effects/WalkBobEffect.ts` — live movement-derived view/weapon bob.
- `src/games/fps/client/DemoViewerHUD.ts` and `CinematicHUD.ts` — existing overlay implementations.
- `src/games/fps/client/CinematicDemoPlayer.ts` — cinematic reel sequencing and programmatic seeks.

## What is already working

The current player is substantially ahead of the older v0.9.16 review. These should be preserved while changing the timing architecture:

- demos load their map locally and tear down the live game session;
- independent/full demo frames decode correctly;
- cold-start first-person viewmodels work;
- remote players carry visible weapons;
- team data reaches the demo player list;
- normal timeline seeks flush remote-player interpolation;
- demo chat, weapon fire, projectiles, projectile impacts, and a subset of combat effects play;
- followed-player health, armor, ammo, weapon, velocity, and score data are reconstructed;
- normal and cinematic transport both use the same underlying demo file reader.

## Recording evidence

Three existing recordings were inspected. The detailed movement counters matter more than the exact totals: they prove that the animation inputs are present in real files.

| Demo | Frames | Recorded duration | Effective frame cadence | Movement evidence |
|---|---:|---:|---:|---|
| `wdm2_duel_20260714_202917.shagdemo` | 2,416 | 38.658 s | 62.5 Hz | 4,224 moving samples, 2,158 grounded, 2,299 airborne, 368 crouch, 120 slide, 31 wall-jump |
| `wdm2_duel_20260714_092559.shagdemo` | 37,501 | about 10 min | 62.5 Hz | locomotion state present throughout |
| `wdm12_duel_20260712_205119.shagdemo` | 16,429 | about 4.4 min | 62.5 Hz | locomotion state present throughout |

For the short recording, the first-to-last tick distance is 4,830 ticks at 125 Hz, or 38.640 seconds. Scheduling 2,415 intervals at the header's requested 60 Hz takes about 40.25 seconds. This independently reproduces the approximately 4.17% slow playback.

The same recording also contained repeated `combat_state`, `weapon_state`, and `match_state` state events plus weapon fire, projectile spawn/impact, damage, death, and award events. Missing presentation is therefore not generally evidence that the server failed to record the event.

## Findings

### D1 — Playback uses the requested snapshot rate instead of recorded ticks (high)

**Implementation status (2026-07-14): completed in the current uncommitted worktree.** Normal playback now schedules, seeks, and reports progress from recorded server ticks. Cinematic analysis windows, segment/replay durations, overlap buffers, speed-keyframe offsets, and camera-path inputs now use the server tick rate as well. Long-stall catch-up keeps the tick playhead authoritative and delivers only the newest four due full frames.

At the investigation baseline, `DemoViewer.update()` computed a constant interval from `header.snapshotRate`. The server takes an integer number of simulation ticks between snapshots, so requested and effective rates need not match. It is also unsafe to assume every adjacent stored frame has identical spacing if capture or future formats allow gaps.

Baseline effects:

- 125/60 recordings play about 4.17% slow at nominal 1x;
- the displayed elapsed time is derived from frame-index percentage rather than the current tick;
- cinematic calculations that convert ticks using the requested snapshot rate inherit the same approximation.

Recommended direction: use `(frame.tick - firstTick) / header.tickRate` as the canonical timestamp. Advance a playhead in recorded time and deliver every frame whose tick-time is at or before the playhead.

### D2 — Demo transport and presentation use different clocks (critical)

**Implementation status (2026-07-14): entity/model phase completed in the current uncommitted worktree.** A demo-only DemoEntityTimeline now interpolates current/lookahead full frames by the continuous recorded playhead tick, never uses packet receive time, and never extrapolates beyond recorded state. DemoViewer exposes lookahead plus a discontinuity generation for seeks/restarts. Remote models and the spectator target provider consume the same sampled position/yaw; looping locomotion animation rate is multiplied by playback speed and freezes at pause. Live multiplayer continues to use the unchanged SnapshotBuffer. Coverage added for interpolation, irregular frame timing, pause, lookahead, teleport discontinuities, seek generations, and no-extrapolation behavior. Validation: 10 demo test files / 123 tests passed, TypeScript and production build passed, simulation/server tick/server fuzz passed. Map-based physics and CLI BSP checks remain asset-blocked.

Changed in this phase: DemoEntityTimeline.ts, DemoViewer.ts, DemoService.ts, RemotePlayerRenderer.ts, DemoViewer.test.ts, and DemoEntityTimeline.test.ts.

Demo chase-camera base movement now bypasses spectator render-time smoothing because it already receives a tick-interpolated sample. WO-DP4 moved recorded player-model one-shots to demo time, and WO-DP6 moved demo-owned event UI, gibs, and damage numbers to demo time. Low-level shared weapon/projectile particles and non-bob viewmodel recovery still use renderer time by explicit forward-only policy.

`RemotePlayerRenderer` inserts decoded frames into the live `SnapshotBuffer`. That buffer assigns wall-clock receive times, estimates jitter, samples at `performance.now() - delay`, and can extrapolate for up to 200 ms. Those are useful live-network policies, but demo frames already have authoritative recorded timestamps.

At 0.25x, models translate slowly while animation groups still run in real time with a speed ratio derived from the full recorded velocity. At 2x/4x, several frames can be delivered during one render call and receive nearly identical wall-clock timestamps. At pause, the viewer stops delivering frames but the snapshot buffer can continue extrapolating and animation groups keep advancing.

The camera has yet another path: it reads the most recently delivered raw state and performs spectator smoothing in render time. It therefore need not coincide with the sampled remote-player model.

Recommended direction: create a demo-specific timeline/sample path. Do not make deterministic demo playback depend on network jitter estimation. One playback clock should supply the playhead, demo delta, speed, paused state, and discontinuity generation to entity sampling, animation, camera, viewmodel, and transient effects.

### D3 — Pause and catch-up semantics are incomplete (high)

**Implementation status (2026-07-14): partial.** Recorded entity transforms, chase-camera base motion, camera/weapon walk bob, looping locomotion, player-model one-shots, demo event UI, gibs, damage numbers, and snapshot-driven dropped items now freeze exactly with the demo playhead, and catch-up retains the correct playhead. Shared low-level particles, projectile trails, viewmodel recoil recovery, and cinematic reel elapsed UI still retain renderer-time behavior.

At the investigation baseline, pausing only prevented `DemoViewer` from advancing. Entity sampling, looping locomotion, followed-player bob, and blade attack one-shots are now demo-time aware. Recoil recovery/other viewmodel effects and real-time transient expiry still continue.

`DemoViewer` also advances at most four frames per render update. When it reaches that cap it discards accumulated time without moving the playhead/index to the corresponding recorded position. A long browser stall therefore makes playback lose time rather than catch up deterministically.

A playback-clock implementation should define:

- pause as zero demo-time advancement everywhere;
- whether a long stall catches up fully, skips presentation-only transients, or pauses behind real time;
- a bounded delivery policy that retains playhead correctness even if rendering cannot show every intermediate frame.

### D4 — First-person walk bob is explicitly unwired (high)

**Implementation status (2026-07-14): completed in the current uncommitted worktree.** `DemoPovState` now consumes the same tick-interpolated entity sample as the remote model and reconstructs the live `WalkBobEffect` formulas with recorded demo delta. The live effect exposes its shared CVar registration, while demo phase/lean evolution remains tick-time based rather than inheriting its render-call-based inactive decay. DemoPovState passes the shared bob phase, grounded state, velocity, and reconstructed landing velocity to `WeaponViewManager.updateDemoBob()`; the normal render loop applies this stored weapon-bob state without advancing it in wall time. Pause supplies zero demo delta, while seeks and target changes reset the cosmetic phase.

The camera now uses the live FPS standing viewheight (34 rather than the spectator path's stale 26), adds the recorded `movementState.crouchViewOffset` (including its server-simulated transition), applies camera-local walk sway/up-down bob/lean/roll, suppresses walk bob during slides, and snaps to the already-interpolated demo sample instead of applying a second wall-time smoothing layer. Cinematic chase target changes are synchronized back into DemoService so the POV state and viewmodel follow the camera target.

Reconstructed camera bob obeys the same `cg_bob`, `cg_bobamplitude`, `cg_bobfrequency`, `cg_bobroll`, and `cg_boblean` CVars as live play. Weapon bob continues to obey the existing `cl_gunbob*` movement CVars. This is deterministic reconstructed presentation, not a bit-exact copy of the recording client's cosmetic phase/CVar values. Slide pitch and other client-only camera effects remain unrecorded and are not invented here.

Changed in this phase: `DemoPovState.ts`, `DemoService.ts`, `DemoEntityTimeline.ts`, `RemotePlayerRenderer.ts`, `SpectatorController.ts`, `SnapshotBuffer.ts`, `WalkBobEffect.ts`, `WeaponViewManager.ts`, `DemoPovState.test.ts`, `DemoEntityTimeline.test.ts`, and `SpectatorController.test.ts`.

Validation: all 15 demo/spectator test files passed (165 tests), TypeScript passed, and the production build passed with existing chunk warnings only. Simulation, server tick, and server fuzz passed with zero errors and deterministic checksums. The fuzz script still interpreted the requested `--ticks 1000` invocation as its default 10,000 ticks. Physics and BSP CLI commands exited zero but remain functionally asset-blocked by missing wdm7/wdm2 PK3 data and `public/engine.json`. Browser playback remains unverified.

At the investigation baseline, `DemoService` computed followed-player horizontal speed and called `WeaponViewManager.updateBob()`, but that method was an intentional no-op. Its comment stated that live `WeaponBob.update` needed a tracked bob cycle and delta time from the live FPS controller.

The normal viewmodel update instead consumed `ViewportEffectsManager` state. Demo playback did not supply followed-player movement to that manager, so the state could be neutral on a cold start or stale after leaving a live session. The spectator camera also used a fixed 26-unit eye offset and ignored crouch/slide eye height. It applied no walk bob, landing response, or movement roll.

Recommended direction:

1. derive a `DemoPovState` from the followed entity's sampled transform, velocity, grounded, crouch, slide, wall-jump, combat, and weapon state;
2. update it with demo delta time, not render delta time;
3. feed that state to both camera presentation and `WeaponViewManager`;
4. reset/reseed bob phase on target changes and seeks;
5. derive phase deterministically from accumulated traveled distance or demo tick-time so pause, speed changes, and seeks behave predictably.

This will be reconstructed presentation, not a bit-exact replay of the original player's local camera. The demo does not record the original client's cosmetic bob phase or all client CVars.

### D5 — Third-person animations are not demo-time aware (high)

**Implementation status (2026-07-14): completed for currently recorded player-model animations in the current uncommitted worktree.** Looping locomotion and blade attack groups scale with demo speed and use zero speed at pause. `DemoAnimationTimeline` measures one-shot deadlines in recorded ticks, clears active overlays on discontinuities, and suppresses one-shots delivered on the seek landing frame. Live multiplayer retains its existing wall-clock behavior.

Remote animation selection uses recorded velocity and movement flags, which is the right input set. At the investigation baseline, animation groups advanced in wall-clock time, and attack/other one-shots used `performance.now()` deadlines. Demo playback now supplies the recorded playhead, tick rate, playback speed, pause state, and discontinuity generation to the renderer. `PlayerModelManager` exposes explicit one-shot duration, time-scale, active-state, and stop controls so the demo path can drive Babylon animation groups without changing the live path.

Persistent `combat_state.dead` is also reconstructed after every delivered viewer frame. Dead remote models are removed, the followed player's viewmodel is hidden, and alive/respawn state restores presentation. WO-DP6 adds the forward-only death feed and demo-time gib presentation; ragdolls and the live death camera remain intentionally omitted.

Changed in this phase: `DemoAnimationTimeline.ts`, `DemoAnimationTimeline.test.ts`, `RemotePlayerRenderer.ts`, `DemoService.ts`, and `PlayerModelManager.ts`.

Validation: all 16 demo/spectator test files passed (182 tests), TypeScript passed, and the production build passed with existing chunk warnings only. Simulation, deterministic server tick, and server fuzz passed; the fuzz script again interpreted the requested 1,000-tick invocation as its default 10,000 ticks. Physics exited zero but could not find `wdm7`; the BSP CLI exited zero but could not initialize local game paths or find `map_wdm2.pk3`. Browser playback remains unverified.

Required behavior:

- base animation rate multiplied by playback speed;
- zero animation advancement while paused;
- deterministic/reasonable phase reset on seek and target discontinuity;
- one-shot lifetime based on demo time;
- no several-times-per-render phase jumps when multiple snapshots are delivered during fast playback.

### D6 — Seek cleanup is attached to one UI callback, not the transport (high)

**Implementation status (2026-07-14): completed for the demo-owned presentation path in the current uncommitted worktree.** The shared discontinuity generation now clears player-model one-shots, demo event UI, gibs, floating damage numbers, charge glows, and projectile sync state for normal, cinematic, and programmatic seeks. Events delivered on the landing frame cannot start recoil, fire/impact effects, chat, death cosmetics, damage, awards, charge, drop impulses, or pickup notices. Persistent combat, pickup, dropped-item, and weapon state is rebuilt from the landed frame.

Normal timeline dragging wraps `viewer.seek()` with `_isSeeking`, projectile clearing, and `RemotePlayerRenderer.flushInterpolation()`. Programmatic seeks do not automatically receive that policy. In particular, cinematic segment changes call `seekToTick()` directly and can bypass cleanup, instant weapon loading, and recoil suppression.

Even normal seeks leave gaps:

- spectator camera smoothing is not reset when the entity id stays the same;
- chat and other time-expiring overlays are not rebuilt or cleared;
- transient effects can survive from the old time;
- frame events at the landing point can be mistaken for forward-play one-shots.

All seek entry points should go through one service-level discontinuity operation. Persistent state should be reconstructed from the landed frame; transient state should be cleared; forward-only events should be suppressed during the seek delivery.

### D7 — There is no user-facing demo HUD toggle (high, small implementation)

**Implementation status (2026-07-14): completed in the current uncommitted worktree.** `DemoOverlayController` now owns one visibility policy for the active normal/cinematic HUD and replay chat. `DemoService` exposes get/set/toggle methods, `H` toggles while playback is active, and `demoplay hud <on|off|toggle>` provides the console path and completions. The listener ignores repeats, modifiers, and text-entry targets, and `stopAll()` removes it.

The default is visible for a newly started playback. Visibility is independent of pause and is preserved when an active playback transitions between normal and cinematic mode. It deliberately does not hide the weapon viewmodel or world-space effects.

Changed in this phase: `DemoOverlayController.ts`, `DemoService.ts`, `DemoViewerHUD.ts`, `Chat.ts`, `DemoPlayCommand.ts`, `DemoOverlayController.test.ts`, `DemoViewerHUD.test.ts`, `CinematicHUD.test.ts`, and `DemoPlayCommand.test.ts`. User documentation was updated in the engine command reference and FPS demo guide.

Validation: all 20 demo/spectator/HUD test files passed (188 tests), TypeScript and Biome checks passed, and the production build passed with existing chunk warnings only. Simulation, deterministic server tick, and server fuzz passed; the fuzz script again ran its default 10,000 ticks. Physics exited zero but could not find `wdm7`; the BSP CLI exited zero but lacked `public/engine.json` and `map_wdm2.pk3`. Browser playback remains unverified.

### D8 — Existing HUD collapse has two state bugs (medium)

**Implementation status (2026-07-14): completed in the current uncommitted worktree.** Collapse now keeps its own expand button reachable, hides spectator stats and the player list, and restores both from retained state without requiring a roster/signature change. Collapse remains independent of global demo-overlay visibility. A jsdom regression test covers collapse, expansion, global show/hide, and disposal.

### D9 — Cinematic HUD and cinematic time are not integrated (medium)

**Implementation status (2026-07-14): partial.** `DemoService` now creates, updates, visibility-controls, and disposes `CinematicHUD`; segment changes populate its highlight card, and cinematic mode hides the normal transport HUD. Lifecycle and visibility have jsdom coverage.

`CinematicDemoPlayer` still advances its reel elapsed value from render delta while segment boundaries are expressed in ticks and viewer speed can ramp. Converting cinematic progress to the canonical demo clock remains separate clock work; this phase wires the existing value without claiming tick-time parity.

### D10 — Demo event presentation is only a subset of live play (medium)

**Implementation status (2026-07-14): completed by explicit policy in the current uncommitted worktree.** The 15 binary-protocol events used by `GameEvents` now have an explicit demo policy:

| Event | Demo policy | Current presentation |
|---|---|---|
| `combat_state` | persistent state | followed HUD plus dead/alive model and viewmodel reconstruction |
| `match_state` | persistent state, deferred UI | player/score data comes from frames; live match-phase widgets are intentionally not mounted in spectator playback |
| `weapon_state` | persistent state | followed viewmodel/ammo plus remote held weapons |
| `weapon_fire` | forward-only transient | shared fire effects and followed recoil; suppressed on seek landing |
| `weapon_charge` | forward-only edge | capped player charge glows; cleared on seek because no persistent charge bit is recorded |
| `projectile_spawn` | entity state plus forward edge | projectile definition and snapshot-driven flight; cleared/rebuilt at discontinuities |
| `projectile_impact` | forward-only transient | shared explosion presentation; suppressed on seek landing |
| `item_pickup` | intentionally redundant | ignored; `pickupActiveMask` is the authoritative seek-reconstructible source |
| `weapon_drop` | persistent entity plus optional edge | `item_*` entities drive lifecycle/position; demo mode uses snapshot transforms instead of wall-clock Havok |
| `damage` | forward-only transient | followed incoming damage notice and outgoing world-space damage numbers |
| `death` | persistent state plus forward transient | `combat_state.dead` owns reconstruction; kill feed and deterministic demo-time gibs are forward-only |
| `award` | forward-only transient | global award feed plus followed-player banner |
| `weapon_chain` | forward-only transient | shared lightning arcs; suppressed on seek landing |
| `chat` | forward-only demo-time UI | cleared on discontinuity rather than reconstructing history |
| `pickup_notify` | forward-only transient | shown only for the followed player |

Ragdolls and the live death camera are intentionally not reused: Havok ragdolls advance in render/physics time and cannot be reconstructed after a seek. Demo death cosmetics use the manually advanced gib system instead. The live directional damage vignette and hit-confirm crosshair are also omitted in favor of spectator-safe notices and damage numbers.

Changed in this phase: `DemoEventTimeline.ts`, `DemoEventOverlay.ts`, `DemoEventTimeline.test.ts`, `DemoEventOverlay.test.ts`, `DemoService.ts`, `DroppedWeaponRenderer.ts`, `DamageNumbers.ts`, and `GibSystem.ts`.

### D11 — Repeated playback can retain a stale spectator target (medium)

**Implementation status (2026-07-14): completed in the current uncommitted worktree.** `stopAll()` now unhides the followed remote entity, clears both the spectator target and the demo-owned target-provider closure, and switches an active spectator controller to neutral freefly. It also clears the followed/dead/POV/weapon identity, event timelines, charge state, renderer-owned effects, all active normal/cinematic HUD roots, and the global `H` listener.

`WeaponViewManager.resetDemoPlayback()` now cancels transient weapon state and asynchronous load ownership, disposes the current viewmodel, weapon camera/root/lights, and removes its Babylon scene observer. The singleton becomes uninitialized so either the next followed demo target or the next live join recreates the infrastructure against the correct camera. Same-scene `init()` also releases any previous infrastructure before adding its replacement.

`DemoServiceLifecycle.test.ts` seeds a complete normal-playback ownership generation, transitions to a complete cinematic generation, then stops it. It verifies both generations dispose their viewers, renderers, HUDs, DOM roots, effects, hidden entity, target/provider state, and overlay listener. `WeaponViewManagerLifecycle.test.ts` uses Babylon's `NullEngine` to verify observer/camera/root/light disposal and clean reinitialization against a second camera. `SpectatorController.test.ts` verifies that clearing the provider releases its closure.

Changed in this phase: `DemoService.ts`, `SpectatorController.ts`, `WeaponViewManager.ts`, `WeaponSwitchAnim.ts`, `DemoServiceLifecycle.test.ts`, `WeaponViewManagerLifecycle.test.ts`, `SpectatorController.test.ts`, and the FPS demo guide.

### D12 — Chat and other transients use wall time (medium)

**Implementation status (2026-07-14): completed for demo-owned event UI and manually advanced world effects.** `DemoEventTimeline` expires chat, kill feed, awards, banners, pickup notices, and damage notices against playhead ticks. Pause freezes them, playback speed changes only their wall-clock display duration, and a discontinuity clears them before suppressing its landing-frame events. Demo-owned gibs and damage numbers receive demo tick delta, and dropped weapons use authoritative snapshot transforms so physics cannot continue while paused.

The existing low-level shared hitscan, lightning, explosion, projectile-trail, and viewmodel recoil implementations still contain renderer-time animation internally. They are classified as forward-only cosmetics: starts are suppressed on a landing frame and projectile sync is cleared on discontinuity, but already spawned shared particles do not support rewind or full pause reconstruction. Converting those shared renderer systems to an injectable clock remains outside WO-DP6.

## Proposed architecture

```text
DemoPlaybackClock
  playheadTick / playheadMs / speed / paused / discontinuityId
        |
        +--> DemoViewer frame delivery by recorded tick timestamp
        +--> DemoEntityTimeline.sampleAt(playheadTick)
        |       +--> remote models + animation phase
        |       +--> followed camera + DemoPovState + viewmodel
        +--> forward-event dispatcher (suppressed on discontinuity)
        +--> demo-time transient/effect updates
        +--> normal or cinematic overlay progress
```

Suggested boundaries:

- **`DemoPlaybackClock`** owns transport time and speed. UI calls it; renderers consume it.
- **`DemoEntityTimeline`** stores state with recorded tick timestamps and samples at the current playhead. Prefer a demo-specific component over changing live networking behavior inside `SnapshotBuffer`.
- **`DemoPovState`** reconstructs followed-player eye height, movement bob/roll/landing state, recoil inputs, and weapon presentation.
- **`DemoDiscontinuity`** centralizes seek, target switch, demo restart, and stop cleanup.
- **`DemoOverlayController`** owns visibility for normal HUD, cinematic HUD, chat, and future demo-only overlays.
- **event policy table** classifies every recorded event as persistent, forward transient, seek-history, or omitted.

## Suggested work order

### WO-DP1 — Canonical recorded-tick playback clock (implemented, uncommitted)

- schedule frames from tick deltas and `tickRate`;
- report elapsed/duration from ticks;
- make 0.25x/1x/2x/4x deterministic;
- replace the four-frame time-discard behavior with an explicit catch-up policy;
- update cinematic segment/progress math to consume the same clock.

### WO-DP2 — Demo-specific entity sampling and discontinuities (entity/model phase implemented, uncommitted)

- stop using wall-clock network jitter policy for demo entities;
- sample models and followed camera from the same playhead;
- freeze exactly on pause;
- centralize all normal/cinematic/programmatic seeks;
- clear/reseed camera, animation, projectile, transient, and interpolation state.

### WO-DP3 — Followed-player POV reconstruction (implemented, uncommitted)

- implement crouch/slide eye height;
- connect locomotion to view bob and weapon bob;
- use demo delta and reset phase on discontinuities;
- keep recoil and weapon switching synchronized with the same state;
- decide/document which cosmetic CVars govern reconstructed POV.

Completed as described in D4. Remaining client-only slide pitch, damage/landing camera effects beyond weapon landing bob, and exact original-client phase are explicitly outside the recorded data available to this pass.

### WO-DP4 — Demo-time animation and one-shots (implemented, uncommitted)

- scale locomotion and attack animations with playback speed;
- freeze on pause;
- make seek/target-change phase behavior deterministic;
- add explicit death/respawn model state.

Completed as described in D5. The implementation covers the looping locomotion and blade attack animations currently driven by recorded entity/event data, plus persistent dead/alive presentation reconstructed from `combat_state`. WO-DP6 now supplies the complementary forward-only death and transient presentation.

### WO-DP5 — HUD visibility and cinematic overlay (implemented, uncommitted)

- add `DemoService` overlay visibility API;
- add `H` and `demoplay hud <on|off|toggle>`;
- include demo chat and the active normal/cinematic HUD;
- wire and destroy `CinematicHUD` correctly;
- fix collapse restoration and add DOM/lifecycle tests.

Completed as described in D7-D9. Cinematic elapsed/progress calculation remains a D9 clock issue rather than part of the visibility/lifecycle patch.

### WO-DP6 — Event parity by policy (implemented, uncommitted)

- build an event classification table against `GameEvents`;
- implement death/damage/award/charge/drop/pickup presentation in priority order;
- use state frames for seek reconstruction and suppress one-shots on landing;
- move recorded transient expiry to demo time.

Completed as described in D6, D10, and D12. Persistent pickup and dropped-item presentation converges from state frames; forward-only event starts are suppressed on every discontinuity landing frame; demo-owned UI/gibs/damage numbers use recorded time. Shared low-level particles retain the explicitly documented forward-only renderer-time policy.

Validation: all 21 demo/spectator/event test files passed (213 tests), TypeScript and Biome checks passed, and simulation plus deterministic server tick passed. The required 1,000-tick direct fuzz run passed with zero errors and matching checksums. Physics remains asset-blocked by missing `wdm7`; the BSP CLI remains asset/config-blocked by missing `public/engine.json` and `map_wdm2.pk3`. Browser playback remains unverified.

### WO-DP7 — Lifecycle and integration coverage (implemented, uncommitted)

- test repeated demos and return to live play;
- test normal ↔ cinematic transitions;
- verify all listeners, DOM roots, scene observers, hidden entities, targets, and viewmodels are cleaned up.

Completed as described in D11. Automated coverage exercises normal → cinematic → stop ownership, repeated viewmodel initialization on the same Babylon scene, and spectator provider release. The next playback/live join is represented by reinitializing the viewmodel against a second camera; a real interactive browser return to live multiplayer remains unverified.

Validation: all 27 demo/spectator/lifecycle test files passed (230 tests), TypeScript passed, and the production build passed with existing chunk warnings only. Simulation, deterministic server tick, the required fuzz invocation, and a direct true 1,000-tick fuzz run passed with zero errors and matching checksums. The npm fuzz wrapper still interprets `-- --ticks 1000` as its default 10,000 ticks. Physics remains asset-blocked by missing `wdm7`; the BSP CLI remains asset/config-blocked by missing `public/engine.json`, the game data path, and `map_wdm2.pk3`.

## Validation plan for implementation

### Automated

- 125 Hz / requested 60 Hz fixture completes at tick-derived duration at 1x.
- Irregular tick gaps retain correct playhead time.
- 0.25x, 1x, 2x, and 4x advance the same tick sequence over corresponding demo time.
- Pause leaves transforms, camera, animation phase, bob phase, one-shots, chat, and projectiles unchanged.
- Normal HUD seek and cinematic/programmatic seek emit the same discontinuity cleanup.
- Backward seek does not fire weapon, impact, chat, or award one-shots at the landing frame.
- Followed camera and hidden remote model sample the same entity state.
- HUD toggle covers normal HUD, cinematic HUD, and chat; key listeners are cleaned up.
- Collapse expands the unchanged player list correctly.
- Demo A → stop → Demo B does not retain Demo A's target or presentation state.

### Browser/manual matrix

Use a recording with long grounded runs, jumps, crouch/slide, wall-jumps, weapon switches, projectile combat, damage, and death:

1. Compare 1x transport duration with recorded tick duration.
2. At 0.25x and 4x, verify feet/locomotion, camera, bob, recoil, weapon fire, and effects stay together.
3. Pause during running, attack, projectile flight, and chat; nothing gameplay-recorded should advance.
4. Seek backward/forward while following a player; verify no glide from the old camera position and no stale transient effects.
5. Switch targets while moving/crouched/dead.
6. Toggle HUD with `H` and the console in normal and cinematic playback.
7. Start and stop multiple demos, then return to live play.

If implementation changes shared networking/interpolation or renderer-sensitive code, run the project-required regression suite in addition to targeted tests:

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
```

## Investigation validation performed

Targeted tests were run without modifying gameplay code:

```bash
npx vitest run src/engine/__tests__/DemoViewer.test.ts src/engine/__tests__/SnapshotBuffer.test.ts src/engine/__tests__/DemoReaderBrowser.test.ts src/games/fps/client/__tests__/CinematicDemoPlayer.test.ts src/games/fps/server/__tests__/DemoRecorder.test.ts src/games/fps/server/__tests__/DemoRecordingCapture.test.ts src/games/fps/server/__tests__/DemoHighlightPipeline.test.ts
```

Result: **7 test files passed, 76 tests passed**.

These tests validate the isolated reader/viewer/buffer/cinematic/recorder pieces, but they do not cover `DemoService` integration, browser rendering, animation/bob phase, HUD visibility, pause semantics across presentation systems, repeated-demo lifecycle, or transient behavior on seek. No interactive browser playback was performed during this investigation.

## Assumptions and decisions still needed

- The demo is an authoritative world-state replay, while first-person camera bob is reconstructed cosmetic presentation.
- `H` is the implemented default demo HUD key and only acts while demo playback owns its listener.
- “HUD off” includes demo transport, spectator stats/list, demo chat, and cinematic overlay, but not the weapon viewmodel or world-space effects.
- Network `SnapshotBuffer` behavior should remain unchanged unless a later implementation deliberately broadens its API and runs networking regressions.
- Exact animation phase parity with the recording client is not possible without recording more client presentation state; deterministic, seekable reconstruction is the target.
