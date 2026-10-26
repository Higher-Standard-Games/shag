# WebGPU render bundles: rebuild attribution after alpha6

Date: October 26, 2026. Branch: `v1.0.0-alpha6-renderer-groundwork`, engine
`445ae85a` (after PVS candidate pruning and WebGPU shared depth), Babylon
9.31.2. Path 2 of the [renderer review](babylon-renderer-new-paths-2026-10-26.md#2-attribute-webgpu-bundle-rebuilds).
The original investigation changed no runtime code. The later
[water-query follow-up](#reproducible-probe-and-water-query-follow-up) adds a
scoped guard; non-compatibility mode stays opt-in (`?renderer=webgpu&ncm=1`).

## Summary

**The bundle churn that made NCM useless in v0.9.27 is gone.** v0.9.27 measured
about 94 bundles created and 236 reused per frame, with rebuilds on 99.9% of
frames. On washoi_dm5 demo playback now, about 3 are created and 160–200
reused per frame: 98.5% of draws replay a cached bundle. Two of the three
come from one Babylon-internal source, described below.

**NCM still shows no clear frame-time gain.** Two alternating sessions per mode
measured frame p50 10.1 / 9.6 ms in compatibility mode and 8.5 / 9.6 ms with
NCM. The ranges overlap; more runs or a CPU-bound device are needed before
calling it a win. NCM also triggers WebGPU validation errors from water
occlusion queries (below), so it is not ready as a default either way.

## Today's changes do not explain the drop

One NCM session, toggled in place (PVS pruning by patching
`PVSCuller.prototype.canSkipCandidate`, shared depth by patching
`SceneDepthCapture.prototype.supports`), 8 s per segment, Babylon's own
`engine.countersLastFrame`:

| Segment | Bundles created / frame | Reused / frame | Draws / frame |
| --- | ---: | ---: | ---: |
| PVS pruning + shared depth | 2.9 | 187.5 | 190.5 |
| No PVS pruning | 3.4 | 204.8 | 208.1 |
| No shared depth | 3.4 | 232.8 | 236.0 |
| Neither | 3.6 | 340.1 | 344.6 |
| Both again | 3.2 | 162.0 | 165.2 |

Creation stays at about 3 per frame in every configuration. Today's changes
remove draws (345 → 165–190); the rebuild sources were already fixed between
v0.9.27 and alpha5 (material sharing, light-cap recompiles, batched effects and
other mid-fight work). The workloads also differ: v0.9.27 used the dm2 10-bot
timedemo, this the dm5 FFA demo.

## What still rebuilds

The probe wraps `engine._draw` and records why each creation happened: a
changed buffer identity on the draw context (`setBuffer`), a changed texture or
sampler on the material context, a reset context, or a first draw. Owners map
draw contexts back to submesh/material/pass, with the current effect and render
target as the fallback.

| Per frame | Source | Cause |
| ---: | --- | --- |
| 2.00 | Clustered lights' tile mask (`lightProxy` effect into `TileMaskTexture`) | `Scene` uniform buffer identity changes |
| ~0.4 | First draws of new contexts (post-process target, outlines, pickups) | Expected once per context |
| ~0.3 | Context resets (shine overlays, teleport bursts, player and weapon parts) | Material or mesh changes |
| ~0.02 | Water `uLightVisibility` texture swaps | Material texture change |

The tile mask is the only steady source. `ClusteredLightContainer` renders its
mask once per camera that sees clustered lights (world and weapon), through one
proxy mesh and one draw context. Each pass binds that camera's scene uniform
buffer, so the context alternates between two buffers and rebuilds twice a
frame. This is Babylon's design; two small bundles a frame are not worth a
workaround.

## NCM blocker: water occlusion queries

Each NCM session logged two WebGPU validation errors: "The occlusionQuerySet in
RenderPassDescriptor is not set", while beginning an occlusion query in the
`PostProcessRTT-imageProcessing` render pass. Each invalidates that frame's
command buffer. The source is [LiquidSurfaceSystem](../../src/engine/rendering/water/LiquidSurfaceSystem.ts),
which sets `OCCLUSION_TYPE_STRICT` on water surfaces; it was added after
v0.9.27's NCM audit, which found no occlusion queries. Babylon documents
occlusion queries as incompatible with NCM. Compatibility mode logged no errors.

If NCM is pursued, water must skip occlusion queries when
`engine.compatibilityMode === false` (or use another visibility test there).

## For Babylon Lite

Lite's cached opaque bundles are invalidated through a global visibility epoch
and by changed bindings, like Babylon's per-draw-context checks here. The
sources to design around are therefore: a draw shared by several cameras with
per-camera uniform buffers (keep one draw context per pass, or make camera data
a dynamic offset rather than a different buffer), per-frame material texture
swaps, and context churn from short-lived effects. The visible-set churn that
dominated in v0.9.27 is no longer present on this content.

## Reproduction

Private no-HMR server, then the probes (kept outside the repository; they patch
live instances in the page and restore them):

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3141
# attribution by cause/owner, 10 s:
node bundle-probe.mjs 3141 10
# in-session A/B of PVS pruning and shared depth:
node bundle-ab.mjs 3141 8
# alternating compatibility/NCM sessions with `perf capture 20`:
node ncm-ab.mjs 3141 20 2
```

Headless Edge, RTX 4070 SUPER, 1280×720, `washoi_dm5_ffa_20261025_170933.shagdemo`.
GPU frame time is unavailable in these runs. The `perf capture` "CPU render"
value (0.4–0.5 ms) comes from Babylon's `renderTimeCounter` and covers only part
of the frame; frame p50/p95 is the comparison used above.

## Not established

- A frame-time benefit from NCM: four sessions are too few, and this machine is
  not CPU-bound on this content.
- Bundle behaviour in live matches, other maps or the dm2 10-bot timedemo.
- Whether the remaining resets come from avoidable material changes; at about
  0.3 per frame they are not worth chasing before NCM shows a benefit.

## Reproducible probe and water-query follow-up

A second investigation independently confirmed the clustered-light binding
cycle and added a repository-owned driver, actual-gate sampling, headless tests
and a bounded water-query fix. The first accepted run was at `445ae85a` with a
clean tracked source diff; the fix captures use `9e3d812c` plus the recorded
water/test diff. Exact source and dependency hashes are retained in the
[follow-up evidence](renderer-evidence/2026-10-26-webgpu-bundle-followup.json).
The FPS submodule remains unchanged.

### Dependency provenance and current baseline

Installed Babylon 9.31.2 already enables owner-keyed uniform-buffer slots. This
is a published upstream feature, not a local dependency experiment. The
[official package metadata](https://registry.npmjs.org/@babylonjs/core/9.31.2)
identified source commit `f8424957ec0c98b40068b149e66cef95f1f37547`.
The downloaded tarball matched its published SHA-512 integrity. Five relevant
installed files were byte-identical to the package: `webgpuEngine.pure.js`,
`webgpuDrawContext.js`, `webgpuMaterialContext.js`, `uniformBuffer.js` and
`drawWrapper.js`. No dependency files were modified.

In the initial accepted 960 × 540 headless Edge capture, 180 playing frames
created 490 bundles and reused 29,833; 180 paused frames created 360 and reused
29,832. All 360 recurring paused creations were `ProxyMesh` / `ProxyMaterial`,
split equally across world and weapon cameras, each recording a changed
`Scene` buffer and a dirty draw context. Paused `bsp_` rows created zero and
reused 21,780. This supports the small recurring proxy target; it does not
attribute a precise historical improvement to a particular SHAG change or
establish a current FPS benefit.

The optional `legacy-slots` control turns off the installed engine's private
owner-slot path only in the temporary probe page. It does not recreate Babylon
9.17. Its pre-fix run created 984 / reused 29,781 during playback, but hit the
occlusion-query validation error and is **rejected**. Its counts are diagnostic
observations, not a successful performance or visual comparison. Both the first
accepted record and this rejected control are preserved in the evidence.

### Why sample inside the draw?

The engine binds internal/leftover UBOs and sets up vertex pulling before its
fast-bundle decision. The probe intercepts the first draw-context `isDirty` call
inside `engine._draw`, after those binds. Entry-only sampling can miss the
actual dirty state. Creation/reuse deltas reconcile with Babylon's frame
counters. Unmapped draws remain explicit, and a 2,000-row limit rejects overflow.

Flags are independent and can overlap: draw dirty, material version mismatch,
material dirty and forced external-texture binding. They must not be summed as
exclusive percentages. Buffer names record identity changes since the previous
draw, not a caller stack or proof of incorrect contents. A first-observed empty
context does not prove a new allocation. Temporary hooks restore inherited
methods correctly and preserve a later foreign replacement. No hook is installed
by normal gameplay.

### Water guard

`LiquidSurfaceSystem` now disables liquid queries when the engine is WebGPU and
`compatibilityMode === false`, both at claim time and in its per-frame policy.
It also clears `isOccluded` so an old query answer cannot leave the surface
hidden. WebGL and compatibility-mode WebGPU retain strict queries outside the
surface bounds. Normal visibility and frustum selection still apply in NCM;
the fallback can submit additional water/depth work behind walls.

This is a correctness fallback, not a bundle-count optimization. In the first
fixed capture water now submitted a draw every frame, with material dirty/version
flags, alongside the two clustered-light proxy creations per frame. Paused
creations rose from 360 to 540 over 180 frames while the water remained eligible.
The viewpoints are not synchronized, so these numbers do not establish exact
before/after cost. They explain why fewer bundles alone would be the wrong
acceptance criterion for this fix.

The fixed default and completed-driver `legacy-slots` runs both completed
playing/paused phases with no GPU or HTTP errors. The latter also asserts the
loaded liquid mesh has query type NONE and `isOccluded === false` at the start
of both sampled phases. NCM remains opt-in: this guard does not establish broad
NCM reliability, visual parity or a frame-time gain.

### Commands and changed files

Start a private server, then run one capture at a time from another shell:

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3123
node scripts/benchmarks/webgpu-bundles.mjs 3123 default
node scripts/benchmarks/webgpu-bundles.mjs 3123 legacy-slots
node --test --test-isolation=none scripts/benchmarks/__tests__/bundle-probe.test.mjs
```

The driver requires local `washoi_dm5_ffa_20261025_170933.shagdemo` media. JSON
and PNGs are written under `.cache/renderer-groundwork/webgpu-bundles-*`.
It records dependency/runtime hashes, engine and Babylon versions separately,
source stability, before-probe GPU reports, playing/paused frame bounds and
liquid query state. GPU errors, enabled liquid queries, overflow or unreconciled
counts reject the run. The backend API version is 1; it is not the Babylon
package version.

Files changed in this follow-up:

- `src/engine/rendering/water/LiquidSurfaceSystem.ts`.
- `src/engine/__tests__/LiquidSurfaceSystem.test.ts`.
- `scripts/benchmarks/bundle-probe.mjs`.
- `scripts/benchmarks/webgpu-bundles.mjs`.
- `scripts/benchmarks/__tests__/bundle-probe.test.mjs`.
- `docs/manual/guides/render-variables.md`.
- `docs/manual/guides/shader-system.md`.
- `docs/changelog/v1.0.0-alpha.6.md`.
- `docs/research/babylon-classic-to-lite-groundwork-plan-2026-10-26.md`.
- `docs/research/babylon-classic-webgpu-bundles-2026-10-26.md` (this report).
- `docs/research/renderer-evidence/2026-10-26-webgpu-bundle-followup.json`.

Targeted checks pass: 32 water/PVS tests and four Node probe tests. The first
water test attempt failed because NullEngine's compatibility setter forces
`true`; the corrected fixture explicitly supplies the fake backend capability.
Production policy was not changed to accommodate that test. An earlier full
suite before the water edit also passed (738 files, 5,745 passed, one skipped);
the final source is gated again below.

| Exact validation command | Final result |
| --- | --- |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run test:run -- --silent=true` | Pass: 738 files, 5,747 passed, one skipped |
| `npm.cmd run test:run -- src/engine/__tests__/LiquidSurfaceSystem.test.ts src/engine/__tests__/PvsMeshCandidates.test.ts --silent=true` | Pass: 32 tests |
| `node --test --test-isolation=none scripts/benchmarks/__tests__/bundle-probe.test.mjs` | Pass: four tests |
| `node --check scripts/benchmarks/webgpu-bundles.mjs` | Pass |
| `npm.cmd run gate:biome` | Pass: zero errors, 47 baseline warnings |
| `npm.cmd run build` | Pass; existing externalization/chunk warnings |
| `npm.cmd run docs:build` | Pass |
| `npm.cmd --prefix src/games/fps run test:simulation` | Pass |
| `npm.cmd --prefix src/games/fps run test:physics` | Pass: spawn Y maintained |
| `npm.cmd --prefix src/games/fps run server:tick` | Pass: repeat checksum 2768943778 |
| `npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000` | Pass: repeat checksum 4198575176 |
| `npm.cmd --prefix src/games/fps run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'` | Pass: 7,475 faces |
| `npm.cmd --prefix src/games/fps run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'` | Pass: 91 ticks |

The two fixed GPU commands above passed; the preserved pre-fix legacy command
failed with the query error as documented. Raw outputs use
`.cache/renderer-groundwork/bundle-*.log`. The production build ran after the
full suite, avoiding generated-media writes during compiler tests.

Assumptions and limits: current dm5 POVs on one headless Edge GPU, no synchronized
playing tick across sessions, real-time effects can expire while paused. This
does not cover live matches, other maps, broad browser/mobile GPUs, multi-map
NCM load loops or compatibility-mode image equivalence. The conservative guard
does not remove the need for those checks before any future default change.
