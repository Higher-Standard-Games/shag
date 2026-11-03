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

## Progress

All of this runs only with `?snapshot=1`; without it the game renders as
before.

### Stages 1–3, November 3

`src/engine/rendering/SnapshotFrames.ts` holds the controller. What the first
measurements taught, in the order they came up:

- **A recording must start with a frame.** The last pass of a frame ends
  after `onAfterRender`, so a recording switched on there began one pass late;
  it now starts in the next frame's `onBeforeRender`.
- **A replayed frame runs different passes unless helped.** Babylon notifies a
  rendering group only when it has meshes, and in FAST replay every group is
  empty, so the weapon view's group depth clears and the scene depth capture's
  group hook never ran. The controller notes each camera's occupied groups
  while recording and marks them occupied (with their lists emptied) in
  replayed frames. Groups are shared by the cameras and never reset in FAST
  mode, so every camera sets every group.
- **Pass keys come from the ending pass's label.** The engine's current
  target already describes the next pass when `endRenderPass` runs.
- **Effect batches draw indirectly.** Forced on in the recording frame, their
  count is written each replayed frame; this removed most re-records.
- **Hidden in place, learned.** A mesh shown and hidden twice is forced into
  recordings and collapsed while hidden. A mesh hidden by a disabled ancestor
  is not forced: enabling a pool root showed every model template under it.
- **Released buffers and textures stop the replay.** A player outline's
  uniform slot was released without any mesh, material or texture disposal
  and destroyed after the frame, and the next replayed frame failed WebGPU
  validation. Releases happen in about 2% of frames.
- **Culling stays on outside the recording frame.** With it off in every
  non-replayed frame, those frames cost three times a normal frame.
- **Only drawn skeletons are prepared, unforced.** Forcing every skeleton,
  templates included, cost 0.5 ms a frame.

Measured on the dm2 FFA demo during a slow machine period (normal WebGPU at
100–180 fps instead of 250–300):

| Measurement | Result |
| --- | --- |
| Frames replayed | 88% |
| Draw-list changes | about 6 a second |
| Main-thread time per frame (CPU profile, back to back) | 6.78 ms against 9.50 ms: ×1.40 |
| In-page toggle bench, snapshots on against off | ×1.28 (no-op control ×0.97–1.00) |
| Paused-frame pixels | Match normal rendering, except the plasma gun's animated glow (stage 4) |

### Motion in replayed frames, November 3

Playtesting showed players, projectiles and beams freezing. A motion check
(pause a demo, seek a few frames forward so things move while the draw list
holds, then compare a replayed frame with a normal one of the same state)
found four sources of stale data. All four were in Babylon's per-draw or
per-frame state, not in the meshes' world matrices, which were already right:

- **Per-draw matrices.** Outline passes and shader materials keep `world`,
  `view`, `projection`, `viewProjection`, `worldView`, `worldViewProjection`
  and `cameraPosition` in each draw's own uniform slot, which only a material
  bind writes. Replayed frames now write them into the recorded slot, with
  the camera that sees the mesh's layer. A mesh hidden in place gets a
  collapsed world matrix there too.
- **Lights.** Babylon writes a light's direction, position and colour while
  binding a material. The blade's light is parented to the weapon camera, so
  its lighting stayed at the recording frame's angle. Replayed frames now
  write every enabled light's uniforms into each of its buffers. The
  clustered light container refreshes its own in FAST mode.
- **Collapsing at the end of a recording.** Meshes hidden in place were
  collapsed right after the recording frame drew them. That second write in
  one frame goes to a new uniform buffer, so the recorded draws kept the real
  matrix, and a plasma trail that had just ended stayed on screen. The
  collapse now happens at the start of the next frame.
- **Hidden meshes in per-draw slots.** These were skipped instead of
  collapsed, leaving pooled shader-material meshes drawn where they were last
  shown.

After the fixes, replayed frames match normal frames pixel for pixel in every
paused window checked on the dm2 and dm11 demos. Where the paused scene still
animates (the plasma gun's spinning barrels, effects), two replayed frames
differ as much as two normal frames do. One rare case may remain: the plasma
trail reproduction showed once in eleven runs after the collapse fix, and not
at all in the last six.

| Measurement (dm2 FFA demo) | Result |
| --- | --- |
| Frames replayed | 87% |
| In-page toggle bench, snapshots on against off | ×1.51 (no-op control ×1.03) |

### Material values in replayed frames (stage 4), November 3

A listing of every draw's uniform slot over ten seconds of normal frames, on
dm2, dm5, dm7, dm11, dm12, dm14, amphi1 and snd1, found what changes from frame
to frame. All of it lives in per-draw slots; no shared material buffer
changed:

| Values | Where |
| --- | --- |
| `uTime`, `atmFogEye`, water's `uCameraPosition` and `uCameraForward` | Effect and water shader materials, decal blends |
| `diffuseMatrix`, `emissiveMatrix`, `vDiffuseInfos` | Scrolling and pulsing Quake stages, plasma bolts, grenades |
| `vDiffuseColor`, `vEmissiveColor` | Fades and tints: teleport ghosts, gib trails, pickups, the view weapons' glow |
| `q3RampCamera`, `q3SoftView` | The Quake sprite plugins, which follow the camera |

The controller learns these materials instead of listing them. In each frame
Babylon draws itself, a recorded draw whose slot holds values other than the
last such frame left there (the matrices replay writes anyway aside) marks
its material. In replayed frames, each draw of a marked material that draws
something now gets the material bound again through Babylon's own
`bindForSubMesh`, aimed at the recorded slot and pass. Three details matter:

- **The slot's CPU copy.** Babylon's draws compare a slot against its CPU
  copy to skip uploads, and `update()` keeps that copy only while the buffer
  has more than one slot. Writes from the controller update it themselves, or
  the next normal frame could skip a needed upload.
- **The scene's uniforms stay untouched.** A bind ends by writing the eye
  position into the scene's uniforms. In a replayed frame that write started
  a third scene buffer, and the weapon view, recorded against the second,
  drew with the wrong camera. The binds run with that write switched off.
- **Only draws that draw.** Effect batches switched off and outline passes
  (which bind their own effect) are skipped: 7 binds in a typical dm2 frame
  instead of 19.

After this, the listing over replayed frames matches the one over normal
frames, and paused-demo checks stay pixel-exact where the scene holds still.
Where it animates, two replayed frames differ as much as two normal ones.
The binds cost about 4% of a replayed frame (toggle bench ×1.04 without
them); snapshots measured ×1.34 overall in the same session.

### What is left

- **Frames that do not replay** (12%) cost a normal frame or more each and
  are about 0.6 ms of the average frame. Their causes: meshes created and
  disposed in play (gun model clones on weapon switches, transient fragments
  and flashes, teleport bursts, new gib batches, ammo counters), which need
  pooling in the game code, and buffer releases.
- **The controller's own work** is about 0.5 ms a frame beyond what Babylon
  would do anyway, most of it the draw-list signature over every mesh.
- **Texture changes in replayed frames.** A Quake stage that cycles images
  (`animMap`) swaps the texture, which a recorded draw cannot follow; none
  showed in the listing above, so none of the measured maps relies on one in
  view.
- **The checks on every pool map** before snapshots can become the default.
