# WebGPU performance, November 2026

Started November 3, 2026 on `feature/webgpu-perf` (both repositories, from
`main` at the v1.0.0-beta release, outer `4ffb6980`). Goal from the owner: make
WebGPU the fastest renderer and aim to double its frame rate. At the start it
ran slower than WebGL2 on the same recorded fights.

## Method

- **Workload.** `washoi_dm2_ffa_20261023_185048.shagdemo` (four-player FFA on
  `washoi_dm2`, the workload of the
  [rendering audit](render-perf-audit-2026-11-02.md)) and
  `washoi_dm5_ffa_20261101_190121.shagdemo`.
- **Browser.** Headless Edge on the RTX 4070 SUPER, vsync and the frame limit
  off. The frame is limited by the browser main thread on both renderers: it
  runs at the same rate at 1600×900 and at 3416×1301.
- **The machine's speed drifts** by up to 2× between minutes when other
  processes are busy, so a reload-based comparison of a few rounds can rank
  the same build either way. Two methods hold:
  - **Toggle bench:** the change is switched on and off in the same page every
    500 ms for 30 s, and frame times are pooled per state. A no-op toggle
    measures the noise (×0.95–1.05).
  - **Interleaved rounds** in one browser, reloading between variants, compared
    by median, when the change cannot be toggled live.
- **Attribution.** CDP CPU profiles (100 µs sampling) compared per frame
  between renderers; in-page timers around `Mesh.render` by mesh kind; sampled
  allocation profiles (HeapProfiler).
- **Correctness.** Paused-demo screenshots with a change off, off again and on:
  the change's pixel difference must match the baseline difference (animated
  surfaces, particles), and difference maps are checked by eye. Fixed free-camera
  views for water, moved lights and camera positions the replay never recorded.

## Starting point

Interleaved, quiet machine, 1600×900: WebGPU 295 fps median against WebGL2
388 (WebGL2 1.31× faster). The CPU profiles had the same shape on both, but
WebGPU spent 3.89 ms of main-thread time per frame against 2.78.

| Upper bound (toggle bench, WebGPU, dm2 FFA) | Speed-up |
| --- | ---: |
| Map surfaces not drawn at all | ×1.32 |
| Weapon camera removed | ×1.08 |
| Clustered light container off | ×1.05 |

Per draw, a map surface cost about 27 µs of JavaScript on WebGPU even though
non-compatibility mode replays a cached render bundle for 98% of draws: the
cost is selection, material/light/mesh binding, uniform-buffer upload and the
bundle validity check that come before the replay.

## Changes

| # | Change | Measured | Commit |
| --- | --- | --- | --- |
| 1 | **World bundle replay.** Static map surfaces leave the main camera's selection, rejoin its active meshes when visible, and their recorded bundles are added to the pass before the draw phase when every uniform/storage buffer they bind is still current; others draw normally and re-record, one per frame in turn | dm2 ×1.21–1.22, dm5 ×1.25 (toggle bench); 36 and 53 surfaces replayed per frame | `f1ad0ee1` |
| 2 | **Block-compressed textures on WebGPU.** The device asked for no optional feature; KTX2 transcoded to RGBA8. Now `texture-compression-bc/astc/etc2` are requested | dm2: 0 → 231 BC7 textures and 30 BC7 arrays; frame rate unchanged on this GPU (CPU-bound) | `1aa78fbd` |
| 3 | **Trail ribbons without copies.** Trails no longer copy and re-read their vertices each frame | Sampled allocation 192 → 150 KB per frame | `967d8c57` |

After 1–3, interleaved: WebGPU 449 fps median, WebGPU with the replay off
(`?worldbundles=0`) 380, WebGL2 465. Under the profiler the two renderers spend
the same main-thread time per frame (2.47 ms each).

## World bundle replay in detail

`src/engine/rendering/WorldBundleReplay.ts`. Eligible surfaces: frozen
material, frozen world matrix, rendering group 0, one submesh, opaque and not
alpha-tested, no instances, no `onBeforeRender` observers, and only material
plugins known to bind constant values (`BspBakedLighting`, `BspSurfaceArray`,
`BspVertexLighting`, `AtmosphericFog`, Babylon's PBR sub-plugins,
`DetailMap`). Animated Quake stages (`Q3AnalyticAnimation`), autosprites and
stage colours stay on the normal path.

A replayed bundle is current when the draw wrapper still holds the same
bundle, effect and material, the wrapper is ready and not forced to rebind
(`Material.markDirty` clears both, which is how frozen materials pick up light
and fog changes), and each recorded binding is still the GPU buffer its source
uses now: `Scene`, `Mesh`, `LightN` (a light's uniform buffer), and
`tileMaskBufferN` (the clustered container's storage buffer). `Internals` and
`LeftOver` are engine-owned per draw context. A binding of any other name
takes the surface off replay for good.

Babylon notifies a rendering group's observers only when the group has
content, so the replay runs from `onBeforeDrawPhaseObservable` rather than at
group 0. The clustered container's camera-dependent uniforms (`vSliceData`,
`vSliceRanges`) are refreshed before the replay, as Babylon refreshes them for
FAST snapshot mode.

Render targets with no explicit list (water depth, water refraction,
soft-particle depth) draw from `scene.getActiveMeshes()`, so taking surfaces out
of selection without adding them back would remove the walls from those
passes. A first version that only intercepted `render` kept them there but
gained only ×1.13.

The test `WorldBundleReplay.test.ts` checks the eligibility rules, the
selection and active-mesh behaviour on a NullEngine, and that every Babylon
private member the replay reads is still where Babylon 9.31 keeps it, so an
upgrade that moves one fails a test instead of the frame.

## Findings not acted on

| Finding | Detail | Why not |
| --- | --- | --- |
| Render passes | About 9.4 passes a frame on WebGPU: a canvas clear nothing draws into, the light tile mask for each camera, the post-process target split by the scene depth capture, and a canvas restart (multisample load, store and resolve) for each of the weapon view's three depth clears (camera, group 1, group 2) | About 25 µs of CPU per pass. A full-viewport scissor turns the clears into in-pass quads, but the weapon camera's 64×64 tile-mask target then fails validation; GPU bandwidth is not the limit on this machine |
| GPU timing | `timestamp-query` enables on the device, but Babylon's WebGPU timestamp counter produced no samples | Not needed while frames are CPU-bound; `perf capture` still reports WebGPU GPU time as unavailable |
| Weapon view | 10 draws, 0.23 ms, and its own camera pass | Its materials change in play (muzzle flash, charge glow, ammo counter), so they cannot be frozen or replayed |
| Allocation | 150 KB per frame remains, mostly Babylon internals (iterators, define strings for the light proxy's readiness check, Havok wire types) and demo playback's presentation clock (20 KB) | Spread thin |

## Reproduction

The probes live outside the repository (session scratch). Their essentials:
start the private Vite server (`browser-probe` skill), open
`?renderer=webgpu`, play the demo, and for a toggle bench alternate
`getWorldBundleReplay(scene).enabled` every 500 ms while timing
`requestAnimationFrame`. `?worldbundles=0` turns the replay off for a session.

## Whole-frame snapshot: the path to 2×

Second round, same day. What remains after the world bundle replay is
Babylon's per-mesh path for everything else: selection, binding and the bundle
check for each moving or animated draw, the weapon camera's own pass, and the
render-target passes. Only Babylon's FAST snapshot mode removes all of it: it
records every render pass of a frame once and replays the bundles, skipping
mesh selection and every bind.

| Measurement (WebGPU, dm2 FFA demo, toggle bench) | Result |
| --- | --- |
| Whole frame replayed, nothing updated (ceiling, wrong picture) | ×4.7 (1.27 ms against 5.97 ms per frame) |
| Prototype: culling off, skeletons prepared and moved meshes' matrices written each frame, a visibility signature forcing a normal frame and a re-record on any change | ×1.18–1.26 overall |
| Same prototype, frames that replay | 1.28 ms against 4.0 ms for a normal frame: ×3.1, including 0.25 ms of skeleton and matrix updates for 44 meshes |
| Frames that render normally or re-record | 36% |

So the replayed frame is three times faster than today's, and the gain is
lost to frames whose draw list changed. With culling off (the recording must
contain everything that may come into view), the draw list changes in about
half of all frames, from these sources (per second, dm2 FFA):

| Source | Changes |
| --- | ---: |
| Effect batches changing instance count (explosion sparks, rays, fireballs, impact sparks, wall marks) | 94 |
| Projectile meshes and trail ribbons shown and hidden | 23 |
| View-weapon parts shown, hidden, created and disposed (weapon switches) | 15 |
| Dropped weapons shown and hidden | 8 |
| Tracers, transient fragments and flashes, teleport bursts | 7 |
| Players and ragdolls created or disposed | under 1 |

With culling on, 20% of frames change the list (PVS and frustum add map
surfaces, players and items).

### What a stable draw list needs

1. **Instance counts through indirect draws.** A draw context with
   `enableIndirectDraw` set records `drawIndexedIndirect`; writing the instance
   count each frame (`setIndirectData`) changes what a replayed bundle draws
   without a re-record. Covers every effect batch.
2. **Hiding as data, not as a draw-list change.** Pooled meshes (projectiles,
   trails, tracers, dropped weapons, effect pools) stay enabled and in the
   recording; hiding writes a collapsed world matrix to their mesh uniform
   buffer. This changes every game system's show/hide code.
3. **No culling while recorded.** The whole map and every pooled object draw
   each frame. The GPU then does the culling's work; on this GPU the frame is
   CPU-bound with large headroom, but weaker GPUs pay for it. GPU-driven
   culling (a compute pass writing the indirect counts per PVS cluster and
   frustum) gives it back.
4. **Per-frame data in place.** Skeletons (`prepare`), moved meshes (mesh
   uniform buffer), and materials whose values change (muzzle flash, glow,
   animated Quake stages, water, sky scroll) rebound into the recorded
   `LeftOver` slot, as Babylon's snapshot helper does for morph targets. A
   material that binds a different texture (animated texture maps) forces a
   re-record.
5. **A stable pass structure.** Passes that come and go (scene depth capture,
   water targets, the weapon view's clears) shift Babylon's replay of bundle
   lists by pass index: the prototype hit "attachment state not compatible"
   errors. The controller must detect a changed pass sequence and re-record.

### Other avenues considered

- **Rendering in a worker (OffscreenCanvas).** Moves the same work to another
  thread without reducing it; the scene graph, game state and Babylon would all
  have to live in the worker. A real gain only comes from splitting game
  simulation (demo or network decode, physics, prediction) from rendering, a
  large rewrite with a smaller prize (about 0.3–0.5 ms a frame).
- **Compute shaders.** Most useful as GPU-driven culling for the stable draw
  list above, and for vertex animation textures (Babylon's baked vertex
  animation) to take skeleton evaluation (about 0.2 ms a frame) off the CPU.
