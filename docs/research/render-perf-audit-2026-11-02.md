# Rendering performance audit, November 2026

Started November 2, 2026 on `feature/perf-audit` (both repositories, branched
from `staging` at outer `e9c27512`). Goal: a steady 165 fps with the Balanced
preset in a three-bot FFA on `washoi_dm2`, on the owner's machine (RTX 4070
SUPER, 3440×1440 at 164 Hz, Chrome). The owner reports 30–60 fps in fights,
where it used to hold close to 165.

## Method

- **Workload.** Playback of `washoi_dm2_ffa_20261023_185048.shagdemo`, a
  four-player FFA on `washoi_dm2` seen from a fighting player. The same fights
  replay every run. A live three-bot match through a scratch lobby confirms
  results (bots auto-connected to the practice server `map washoi_dm2 ffa`
  starts).
- **Browser.** Headless Edge (Chromium) on the real GPU through ANGLE/D3D11,
  vsync and the frame-rate limit off (`--disable-gpu-vsync
  --disable-frame-rate-limit`), so frame time is the cost of a frame rather
  than the refresh interval.
- **CPU-bound.** The demo runs at the same rate at 1600×900 and at
  3416×1301 (the owner's window), so the frame is limited by the main thread,
  not the GPU. Most measurements use 1600×900.
- **Comparison.** Commits are compared in interleaved rounds (A, B, A, B, …),
  each round a fresh private Vite server and browser, 40 measured seconds. The
  machine's speed drifts by 20% or more between minutes, so only interleaved
  pairs are compared.
- **Attribution.** CPU profiles (CDP sampling, 100–200 µs) and in-page timers
  around Babylon's selection, rendering-group, per-mesh and observer calls.

## Baseline

| Measurement (1600×900 unless noted) | Value |
| --- | --- |
| Mean fps, demo, 3416×1301 | 159–182 |
| p95 / p99 frame | 10–11 / 13–15 ms |
| Frames over 6.06 ms (165 Hz budget) | 34–47% |
| Main camera active-mesh selection | 1.02 ms/frame |
| Main camera draw | 1.73 ms/frame |
| Weapon camera selection + draw | 0.29 + 0.57 ms/frame |
| Animation | 0.25 ms/frame |
| Game observers (`onBeforeRender`) | about 0.4 ms/frame |
| Frames over 14 ms in 40 s of demo | 203 |
| Draw calls per frame | about 130 (≈110 world, 22 weapon) |
| Scene meshes / enabled | 561 / about 170 |

**No regression between releases on this workload.** The same demo on
alpha.5, alpha.7, alpha.8, alpha.9.1 and the branch base, two interleaved
rounds, gave 105–161 fps with no release faster than the base. The drop the
owner sees is not explained by client rendering code on this demo; the
browser, GPU selection (the machine also has an AMD integrated GPU) or the
live load are open questions.

## Optimization matrix

| # | Area | Change | Status | Measured effect | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | Selection | Skip disabled meshes for every camera in the candidate provider, before Babylon's loop does vertex and readiness work on each. Two thirds of the scene's meshes are disabled model templates and parked pool members. | Done | Main camera selection 1.02 → 0.58 ms; weapon camera 0.28 → 0.21 ms | `afc6215c` |
| 2 | Selection | Remove the pooled-candidate registry, test, QA fixture and benchmark script: nothing used it, and (1) covers it | Done | Simplification | `afc6215c` |
| 3 | Lighting | Disable the moon light on BSP maps instead of holding it at intensity 0; an enabled light is bound and evaluated by every lit material | Done | One light fewer per dynamic mesh draw | `afc6215c` |
| 4 | Death camera | Wall clamp traces the collision brushes instead of ray-picking every map triangle each frame | Done | About 3% of a frame while a watched player is dead | fps `69d5aa7` |
| 1–4 | Batch | Base `e9c27512` against `afc6215c`, 3 interleaved rounds | Measured | 127–133 → 148–152 fps (+15%); p99 24 → 16–17 ms | |
| 5 | Audio | Positioned sounds created with `spatialAutoUpdate: false`: each playing sound had its own `requestAnimationFrame` loop re-applying a fixed position, about 11 extra callbacks a frame | Done | 1,488 → about 129 rAF callbacks a second | `9cd1dae6` |
| 6 | Hitches | Third-person guns parked per weapon and re-attached instead of cloned on every switch, death and respawn; model recycler in `disposeModelResources` | Done | Remote gun clones in 40 s 53 → 9, barrel clones 31 → 1 | fps `82978ba`, `9cd1dae6` |
| 7 | Hitches | Dropped weapons parked per weapon once assembled, reused by the next drop | Done | Dropped barrel clones 23 → 8; with (6), frames over 14 ms in 40 s 203 → 22 | fps `82978ba` |
| 1–7 | Batch | Base `e9c27512`, `afc6215c`, `9cd1dae6`, 3 interleaved rounds (a faster machine minute) | Measured | 196–202 → 225–234 → 233–239 fps; frames over 6.06 ms 27–29% → 12–15% → 11–12%; p95 8.8–9.0 → 7.1–7.7 ms | |
| 8 | Hitches | One third-person gun of each kind assembled, compiled and parked behind the loading screen (`waitForModels`); gun loading, mesh preparation and assembly split out of `updateWeaponModel` | Done | A player's first switch to a gun no longer reads its GLB or uploads textures mid-fight (up to 10 ms a texture) | fps `6e06133` |
| 9 | Hitches | Asset preloader takes every weapon's world model, not only placed pickups: a weapon a player spawned with is dropped on death | Done | First drop of an unplaced weapon (the machine gun on dm2) no longer loads its model mid-fight | `5413bd12` |
| 10 | Hitches | Model clones take their source's bounds (`CloneBounds`) instead of Babylon CPU-skinning every vertex to bound the copy | Done | Voltaic clone 8.0 → 2.0 ms, Electrobolt 8.3 → 4.0, plasmagun 5.4 → 3.8, barrel 2.0 → 1.5; covers the local view weapon's switch. Culling unchanged (449 vs 455 parts outside the weapon frustum over 600 frames) | `ffb74056` |
| 11 | Correctness | Gib, pellet and wall-mark batches set their thin-instance count before uploading, and upload only live instances: a new instance drew a frame of stale data | Done | Fewer bytes per upload; no stale first frame | fps `c3a27d3`, `612a07fb` |
| 12 | Animation | A rig that changed on 8 frames in a row builds the next 8 without the pose comparison | Done | Removes most of the gate's comparison cost for running players; static rigs keep the gate | `612a07fb` |
| 8–12 | Batch | `9cd1dae6` against `612a07fb`, 3 interleaved rounds | Measured | Mean unchanged (221–240 against 232–241 fps); worst frame 41–47 → 26–30 ms in every round, p99 9.3–10.6 → 8.9–9.7 ms | |
| 13 | Diagnostics | `perf capture` reports the GPU the browser draws with and the render size | Done | A report from a machine with two GPUs shows which one ran | `d08fa279` |

## Current state

`perf capture 30` during the FFA demo at 3416×1301 on `d08fa279` (headless
Edge, vsync off): frame p50 3.3 ms, p95 5.5 ms; GPU frame p50 2.8 ms, p95
4.8 ms; 96–163 draw calls. The p95 frame fits the 6.06 ms budget of 165 Hz on
this machine. The GPU, at p95 4.8 ms, is close behind the CPU at that size.
The frame has one full-screen pass (image processing) and no render targets
or depth renderers.

A live three-bot match measured 195–279 fps mean in two runs at 3416×1301
(p95 5.4–8 ms). Live runs vary with what the camera sees, so they confirm
rather than compare.

The owner's 30–60 fps in Chrome is four to eight times slower than these
frames. Before more code changes, `perf capture 10` during a fight in that
browser should show which GPU it draws with and whether the frame or the GPU
is the limit.

## Findings not acted on (yet)

| Finding | Detail | Why not now |
| --- | --- | --- |
| Per-draw cost | About 15–20 µs of CPU per draw (material bind, lights, textures, bone texture), 130 draws | Babylon's per-draw floor; fewer draws or frozen materials are the levers |
| Mesh merging | Only 3 of 46 live non-map meshes share parent, material and skeleton | Each weapon part has its own material; merging saves almost nothing |
| Outlines | Babylon draws an outlined mesh three times (shell, mesh, shell depth); player outlines cost about 0.04 ms a frame, weapon outlines did not measurably change the weapon camera | The depth pass keeps later geometry off the outline; not redundant |
| Map draws | 41 map draws, 0.95 ms: 9 already texture arrays, 21 opaque surfaces are not | Texture-array grouping depends on asset sizes/formats |
| View weapon on switch | The local view weapon still clones its model, barrels and ammo counter on each switch; (10) halved the clone | Its setup is interleaved with view state; parking it is a separate change |
| `alwaysSelectAsActiveMesh` | Held third-person weapons skip frustum culling | Their player is PVS-culled as a whole; small |
| Frozen weapon materials | Freezing `models/weapons` materials saves about 0.08 ms a frame | Rejected in alpha.7: muzzle flash, charge glow, weapon light and ammo counter change them or their lights |
| Ragdoll physics | Havok step 0.19–0.33 ms a frame with one to three ragdolls (15 dynamic bodies each), 0.05 ms with none | Ragdolls already last at most 5 s; fewer bodies would change how corpses fall |
| Shared candidate list | One enabled-mesh list for both cameras would halve the provider loop | `MuzzleFlashRenderer` enables its mesh per camera; a shared list would be wrong |
| DOM | Style, layout and paint: about 0.1 ms a frame | Not a cost worth chasing |
| Barrel sources | View, third-person and dropped weapons each load their own barrel source, so a barrel GLB is parsed up to three times | One shared barrel source per scene would remove two loads per barrel |
