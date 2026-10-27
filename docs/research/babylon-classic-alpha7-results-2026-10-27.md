# Renderer improvements in alpha.7: results

Date: October 27, 2026. Branch: `v1.0.0-alpha7-rendering-improvements` in both
repositories, from `staging` at the alpha.6 release (`7ce7030b`). Babylon
9.31.2. Measurements: headless Edge on the development machine (RTX 4070
SUPER), `washoi_dm5` FFA demo unless stated, private no-HMR Vite server.
Another agent was running CPU work on the same machine for part of the night,
so timings are indicative and every comparison was made A/B in one session or
in matched demo windows.

This note answers the five items in the
[frame-floor note's "What to do next"](babylon-classic-frame-floor-2026-10-26.md#what-to-do-next).

## Status matrix

| # | Item | Backend | Status | Result |
| --- | --- | --- | --- | --- |
| 1 | WebGPU stall after map load | WebGPU | Shipped (`0854753e`) | Pipelines built in play 105 → 6–7; first two seconds 5/7 fps → 62/74 fps; loading +0.8–2.8 s |
| 1a | Light order of frozen world materials | Both (errors on WebGPU) | Fixed (`648715d3`) | dm5 → dm2 → amphi1 → dm11: 530 validation errors per session → 0 |
| 2 | Freeze weapon part materials | Both | Measured, not adopted | World weapon draws 27 → 16 µs, about 0.08 ms/frame; muzzle-flash, charge and lighting writers make it unsafe for that gain |
| 3 | Map draw count | Both | Partly shipped (`aa83a30d`) | Additive sprites batched: dm5 76 → 42 meshes, dm2 62 → 4, dm11 62 → 37; shared materials across cells measured useless |
| 4 | Candidate selection (path 5) | Both | Shipped (`3d502293`), registry not built | Weapon camera selection 1.0 → 0.15 ms (WebGL2), 0.55 → 0.09 ms (WebGPU); skipping disabled meshes saves nothing |
| 5 | WebGPU render bundles on a CPU-limited machine | WebGPU | Default after owner QA (`89941638`) | `?ncm=1` 9–14% faster per frame at 2×/4× CPU throttle; images match; map changes clean after 1a |

## 1. WebGPU stall after map load

The frame-floor note blamed shader recompiles from a changed light layout.
Tracing effect creation and `GPUDevice.createRenderPipeline` per frame showed
otherwise. Only 3–5 effects were created after the loading overlay closed, but
about 105 render pipelines were, and the long frames (0.2–2.4 s) followed the
pipeline bursts. WebGPU pipelines are keyed on effect, vertex layout, render
states and target formats and are built at first draw; the browser compiles
each one before the frame completes. Surfaces revealed by PVS and the demo
camera drew for the first time in play.

Two causes, two changes:

- **Warm pass.** `warmRenderPipelines` (`src/engine/rendering/PipelineWarmup.ts`)
  draws two frames with `scene.skipFrustumClipping` before PVS starts, then waits
  for `queue.onSubmittedWorkDone` (bounded). WebGPU only; skipped in a hidden
  tab. It built 38 pipelines on dm5 in 2.6 s, 17 on dm2 in 0.8 s, 17 on dm11 in
  2.8 s, 21 on amphi1 in 1.6 s.
- **Stencil masks in the pipeline key.** With the warm pass alone, a run still
  rebuilt 80 pipelines at once just after the overlay, including world materials
  it had already built. Babylon's cache key state differed in one slot: the
  stencil write mask, 255 during warm-up, 4 in play. `OutlineRenderer` sets mask
  4 for its stencil-only draw of an outlined mesh behind a transparent material,
  and `WebGPUStencilStateComposer.apply()` returns early once stencil is off,
  leaving the mask in every later key. Our depth target (`depth32float`) has no
  stencil. `WebGPUStencilKey.ts` resets both masks to 0xff while stencil is off.

| Measure (dm5 FFA, WebGPU) | Before | After |
| --- | ---: | ---: |
| Pipelines created after the overlay closes | 105 | 6–7 |
| Worst frame after the overlay | 0.5–2.4 s, until about 5 s | 0.35–0.4 s, first 0.5 s only |
| FPS in seconds 1 and 2 | 5, 7 | 62, 74 |

Other maps after the change: worst frame after the overlay 151 ms (dm2),
234 ms (dm11), 279 ms (amphi1). WebGL2 is unchanged (99–157 fps from the first
second).

Residual: the two remaining slow frames build first-person weapon pipelines
(`bgra8unorm`, 4× MSAA) and upload the weapon's textures; the view model loads
when the spectated player spawns, after the warm pass.

### 1a. Frozen world materials and light order

Multi-map sessions found a WebGPU failure: after dm5 → dm2 → amphi1, every frame
was rejected (`moonLight` uniform buffer of 80 bytes bound where the pipeline
needs 96). `bsp_tex_85`'s frozen material was compiled with lights
HEMI, DIR, DIR, HEMI, CLUST while its mesh listed HEMI, CLUST, DIR, DIR, HEMI:
the same lights, reordered. Babylon appends a re-enabled light to each mesh's
list and re-sorts every list into scene order when any light is added, even a
model's scoped light. `FrozenWorldMaterials` compared only the scene's
world-reaching lights and their enabled state, and frozen materials never
re-check on their own. World surfaces also differ: lightmapped ones receive only
the clustered container.

The watcher now hashes each tracked surface's light list in order.
`markDirty(true)` on the stale material cleared the errors at once (32/s → 0).
The warm pass made the mismatch constant by compiling before the sky's lights
settled; alpha.6 code hit it once in the same sequence (a missing
`lightDataTexture4`, one exception). After the fix: three four-map sessions
(two default WebGPU, one `?ncm=1`) without errors, and no watcher re-check
during 20 s of play on dm5 or dm2.

## 2. Weapon part materials

Same-session A/B on WebGL2, freezing every `models/weapons` material at
runtime: world weapon draws 26.7–28.1 µs → 16.1–16.2 µs, 0.19 → 0.11 ms per
frame. The demo's view model did not draw in those windows, so the weapon
camera was not measured. About 0.08 ms is not worth the risk: the muzzle-flash
light, charge glow, weapon lighting and ammo counter all change these materials
or their lights, and a frozen material ignores light changes (see 1a).

## 3. Map draw count

A census of world draws per frame on dm5 (WebGL2, 786 frames): 46.9 opaque
Standard (1,294 triangles each), 34.1 opaque PBR, 16.4 sprites (2 triangles
each), 6.6 blended Standard, 3.9 extra shader passes, 3.3 blended shader
materials, 3.0 alpha-tested. 239 world meshes use 239 materials over 142 base
textures.

- **Shared materials across spatial cells: no gain.** Only 11 textures span more
  than one cell; reassigning one material per texture left the per-draw cost at
  10.5–12.3 µs either way.
- **Sprite batching: shipped.** Every autosprite face had its own mesh, material
  and per-frame vertex upload. Additive sprites of one texture, whose every
  resolved shader pass also adds, now share a mesh; alpha-blended sprites keep a
  mesh each in face order. dm5 sprite draws per frame fell from 17.8/6.3 to
  11.3/5.6 and billboard uploads from 0.28/0.22 to 0.19/0.12 ms in matched
  windows. `audit:pvs` passes on dm2/dm5/dm11 with unchanged geometry hashes.
  Frames aimed at sprites (demo paused, world only, old and new builder): six
  views on WebGL2, three on WebGPU, identical except two views whose difference
  equals same-build noise from the dm2 teleporter's animated shader.

The opaque map draws (about 80 a frame) remain the largest renderer cost.
Fewer of them means drawing several textures in one draw (texture arrays or
atlases with per-vertex layer), which is a material-system redesign and the
natural Lite boundary, not an overnight change.

## 4. Candidate selection

Census of active-mesh candidates per camera (dm5, WebGL2): the main camera
evaluated 641 a frame and drew about 167; the weapon camera evaluated 672 to
draw 1–8. About 300 candidates were disabled, mostly cached weapon models.

- **Weapon camera.** `r_weapon_candidates` already filtered by layer before
  Babylon's readiness, matrix and LOD work, but defaulted to 1 only in Firefox
  and never applied on WebGPU (no recorded reason). Off/on in one session:
  1.0 → 0.14–0.18 ms per frame on WebGL2, 0.48–0.60 → 0.08–0.10 ms on WebGPU.
  Paused frames off/on/off at three demo points on WebGL2, WebGPU and
  `?ncm=1`: identical pixels and identical active counts for both cameras. Now
  1 everywhere; 0 remains for diagnostics.
- **Disabled candidates.** A temporary filter dropping every disabled mesh from
  the main camera changed its selection by nothing measurable (1.16 vs 1.14 ms,
  1.04 vs 1.08 ms). Babylon's readiness check on a disabled mesh is a cached
  read. The idle-object registry the renderer review proposed (path 5) is not
  worth building; the pooled-gib owner stays as it is.

## 5. WebGPU render bundles on a CPU-limited machine

Chrome's `Emulation.setCPUThrottlingRate` slows the page's main thread (the GPU
process is not throttled). Two 8-second windows at 30% and 60% of the dm5 demo,
fresh session per configuration, two sessions per configuration at 4×:

| Throttle | WebGL2 median | WebGPU median | WebGPU `?ncm=1` median |
| --- | ---: | ---: | ---: |
| 4× (session 1) | 54.5 / 50.3 ms | 64.2 / 68.8 ms | 56.9 / 55.1 ms |
| 4× (session 2) | 50.0 / 56.7 ms | 67.1 / 65.1 ms | 58.1 / 57.5 ms |
| 2× | 18.8 / 17.4 ms | 21.3 / 22.6 ms | 19.3 / 20.5 ms |

Render bundles recover most of WebGPU's CPU gap: 12–14% faster than default
WebGPU at 4×, about 9% at 2×. WebGL2 stays fastest. Images: world-only aimed
frames identical; full-scene paused frames identical at two of three points;
at the third, differences are confined to wall-clock-animated objects (pickup
tint, weapon sway). Map changes in bundle mode are clean after 1a.

Recommendation: make `?ncm=1` the WebGPU default after one owner QA session in
a live lobby match (weapons, effects, outlines, map rotation), since
non-compatibility mode disables `separateCullingPass` and water occlusion
queries. The owner played a session with `?ncm=1` on October 27 without
problems, and render bundles became WebGPU's default (`89941638`); `?ncm=0`
turns them off for a session.

## Validation

```powershell
npm.cmd run typecheck
npm.cmd run gate:biome
npm.cmd run test:run -- --silent
npm.cmd run build
npm.cmd run docs:build
npm.cmd --prefix src/games/fps run test:simulation
npm.cmd --prefix src/games/fps run test:physics
npm.cmd --prefix src/games/fps run server:tick
npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000
npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
npm.cmd run audit:pvs -- washoi_dm5
```

All of these passed on the branch tip. The owner playtested the branch build
on October 27 and reported no problems. The browser probes were
throwaway scripts in the session scratchpad; each is described above with its
method, and the reusable parts are the browser-probe skill's `cdp.mjs`.

## Not established

- Real low-end hardware; CPU throttling slows JavaScript only, not the driver
  or GPU process.
- Live matches, lobby flows and device loss in render-bundle mode.
- GPU time; all numbers are CPU frame or selection time.
