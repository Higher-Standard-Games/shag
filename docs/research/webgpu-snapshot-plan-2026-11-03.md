# Plan: a stable draw list and whole-frame snapshots on WebGPU

November 3, 2026. Goal: double WebGPU's frame rate on recorded and live fights,
measured against `washoi_dm2_ffa_20261023_185048.shagdemo` with the world
bundle replay off (`?worldbundles=0`), the starting point of
[the WebGPU performance work](webgpu-perf-2026-11-03.md).

## Why this approach

After the world bundle replay, WebGPU and WebGL2 spend the same main-thread
time per frame (2.47 ms on the dm2 FFA demo). What is left is Babylon's
per-mesh path for everything that moves or animates: selecting each mesh,
binding its material, lights and uniforms, checking its recorded bundle, plus
the weapon camera's pass and the render-target passes. Making that path
cheaper per mesh gains perhaps a third. Removing it is what Babylon's FAST
snapshot mode does on WebGPU: the frame's render passes are recorded once and
their bundles replayed, with no mesh selection and no bind.

Measured on the dm2 FFA demo (toggle bench, in-page A/B):

| Case | Result |
| --- | --- |
| Whole frame replayed, nothing updated (ceiling) | ×4.7 |
| Prototype frames that replay, with skeletons and moved meshes updated | 1.28 ms against 4.0 ms: ×3.1 |
| Prototype overall | ×1.18–1.26 |
| Prototype frames that render normally or re-record | 36% |

A replay is valid only while the frame issues the same draws in the same
passes with the same bindings. The prototype re-recorded on every change, and
with culling off the draw list changes in about half of all frames. The whole
plan is about making it stop changing.

## Sources of change (dm2 FFA, culling off, per second)

| Source | Changes | Remedy |
| --- | ---: | --- |
| Effect batches changing instance count: explosion sparks, rays, fireballs, impact sparks, wall marks, gibs | 94 | Indirect draws (stage 2) |
| Projectile meshes and trail ribbons shown and hidden | 23 | Hidden in place (stage 3) |
| View-weapon parts shown, hidden, created and disposed | 15 | Re-record on switch; parked parts hidden in place (stage 3) |
| Dropped weapons shown and hidden | 8 | Hidden in place (stage 3) |
| Tracers, transient fragments and flashes, teleport bursts | 7 | Hidden in place or batched (stage 3) |
| Players and ragdolls created or disposed | under 1 | Re-record |
| Map surfaces, players and items entering or leaving PVS and the frustum | (culling on) | No culling while replaying (stage 1), GPU culling later (stage 5) |

## Stages

Each stage is measured with the toggle bench and checked with paused-frame
pixel comparisons against normal rendering, on dm2, dm5 (water) and an S&D
map, before the next begins. The whole path stays behind `?snapshot=1` until
stage 4 is done and the pixel checks pass on every pool map; then it becomes
the WebGPU default, with `?snapshot=0` to turn it off.

### Stage 1: the frame controller

An engine module, `SnapshotFrames`, owns `engine.snapshotRendering`:

- **Switches only between frames**, from the scene's after-render hook.
  Switching mid-frame breaks Babylon's draw path.
- **Records with culling off:** PVS paused and every enabled mesh selected, so
  moving the camera never changes the recording. World bundle replay steps
  aside while snapshots run.
- **Writes per-frame data in place** before each replayed frame:
  - skeletons (`prepare`);
  - the mesh uniform buffer of every mesh whose world matrix changed (compared
    by the matrix's update flag, not recomputed by force);
  - materials whose values change, rebound into the recorded `LeftOver` slot
    of their draw context, as Babylon's snapshot helper does for morph
    targets; the clustered light container's camera-dependent values.
- **Detects change and re-records:**
  - a draw-list signature over enabled, visible meshes and their instance
    buffers;
  - a texture or sampler change found while rebinding a material (its material
    context's update id moves);
  - a change in the frame's pass sequence (the scene depth capture, water
    targets and the weapon view's clears come and go): the prototype hit
    "attachment state not compatible" validation errors from replaying a
    bundle list into the wrong pass;
  - resize, map load, render-scale and MSAA changes;
  - a device validation error, which also turns snapshots off for the session
    and reports it.
  A changed frame renders normally; the next one records.
- **Reports** replayed, normal and recording frames in `perf capture`.

Exit: the controller runs with no validation errors on the three test maps
and pictures match normal rendering in paused frames, whatever the speed.

### Stage 2: instance counts through indirect draws

Every thin-instanced batch in the recording gets `enableIndirectDraw` on its
draw context before recording, so its bundle records `drawIndexedIndirect`.
Each replayed frame writes the current instance count with
`setIndirectData`. A batch whose instance buffer was reallocated (capacity
grown) forces a re-record; batches keep a fixed capacity.

Exit: effect batches no longer appear among re-record causes.

### Stage 3: hiding in place

Show and hide for pooled objects stops changing the draw list. A pooled mesh
stays enabled and visible to Babylon; hiding writes a collapsed world matrix
into its mesh uniform buffer, and showing writes its real one. One engine API
does this, so game code calls it instead of `setEnabled` or `isVisible`:

- projectiles and their trail ribbons, tracers;
- dropped weapons (already parked per weapon);
- transient fragments and flashes, teleport bursts;
- view-weapon parts: one weapon switch is one re-record, which is acceptable,
  but parts parked between switches are hidden in place rather than disposed.

Outside snapshots (WebGL2, `?snapshot=0`) the API keeps today's behaviour, so
WebGL2 draws nothing it does not draw now.

Exit: re-records under 2% of frames in a fight.

### Stage 4: correctness sweep

Every material whose values change during play is rebound per frame or
re-recorded: muzzle flash, charge glow, ammo counter, player tints and powerup
glow, outlines, water (time), sky scroll, animated Quake stages, explosions
fading, the HUD's 3D elements. Pixel checks on every pool map, demos and a live
bot match. Then snapshots become the WebGPU default.

### Stage 5: give the GPU its culling back

With culling off, the GPU draws the whole map and every pooled object each
frame. On the owner's GPU the frame is CPU-bound with headroom; weaker GPUs
pay. A compute pass writes the indirect instance counts per PVS cluster and
frustum test, so culling returns without touching the recording.

## Expected result

Replayed frames measured 1.28 ms against 4.0 ms. With re-records under 2% of
frames, the average frame would land near 1.4 ms: about ×2.8 on the starting
point, ×2.3 on today's WebGPU. Live play has its own non-render work (network
decode and prediction instead of demo playback), so live gains will be
measured separately.

## Risks

- **Stale data.** Anything that changes and is not written or detected shows
  up as a frozen value or a stale object. Pixel checks per stage, and the
  `?snapshot=0` escape, cover this; correctness beats speed at every stage.
- **Babylon internals.** The controller relies on private members of
  Babylon 9.31 (snapshot recording, draw contexts, uniform buffer slots). A
  test asserts they exist, as for the world bundle replay.
- **GPU cost without culling** until stage 5.
- **Frame-time spikes on re-record**: a recording frame costs a normal frame
  plus bundle creation (7.3 ms in the prototype, against 4.0 for a normal
  frame). Rare by design after stage 3.

## Not pursued

- **Rendering in a worker** (OffscreenCanvas): the same work on another
  thread. A real gain needs the game simulation split from rendering, a large
  rewrite for about 0.3–0.5 ms a frame.
- **A custom renderer replacing Babylon.** The snapshot path keeps Babylon's
  materials, shaders and loaders and removes its per-frame cost, which is the
  part that matters.
