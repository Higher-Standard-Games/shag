# Timedemo benchmarks

`timedemo` replays a local combat recording with a saved camera schedule. Measurement
needs no game server, lobby connection or bot AI. The first recipe is ten-player FFA
on `washoi_dm2`: 45 measured seconds alternating freefly and first-person bot spectating,
after five seconds of pre-roll. Spectator priorities are randomized with seed 927
when creating the fixture, then saved. Dead/absent bots are skipped in that order.

## Create or regenerate the fixture

From the repository root:

```powershell
npm --prefix src/games/fps run benchmark:fixture -- --dry-run
npm --prefix src/games/fps run benchmark:fixture -- --bot-control ws://127.0.0.1:9100
```

The second command creates a separate `washoi_dm2` match on port 7787, borrows ten bots
from the existing local bot manager, records 120 seconds and releases only those
bots. It uses the existing local bot secret; it never prints it. Change the port
with `--port 7788` if necessary. Omit `--bot-control` to own in-process bots instead.
Ctrl+C requests graceful cleanup. An occupied port fails without replacing a server.

The checked-in [recipe](https://github.com/Higher-Standard-Games/shag/blob/main/benchmarks/recipes/wdm2-ffa10.json) and
[launcher](https://github.com/Higher-Standard-Games/shag/blob/main/src/games/fps/scripts/benchmarks/create-fixture.mjs) preserve the sequence.
FFA's authoring score limit is disabled so a fast bot cannot end recording early.
The match itself remains ordinary FFA; ten is a population baseline, not a team setup.

To freeze an existing suitable recording:

```powershell
npm --prefix src/games/fps run benchmark:fixture -- --demo public/data/demos/<recording>.shagdemo
```

The generator checks map, roster, timeline, camera schedule and watched-bot gunfire.
It writes a hash-named directory containing `demo.shagdemo` and `manifest.json`, plus
`public/data/benchmarks/index.json`. These local binary fixtures live under gitignored
game data. Existing fixture directories are immutable; regenerating from changed
combat or recipe bytes produces a new ID. Formats/gameplay can change: rerun the
recipe to produce a current-format candidate rather than editing a broken recording.

The generated freefly route follows a saved recorded player track with an upward
collision trace limiting camera height. It needs visual clearance/coverage review,
especially across teleports and target cuts. Generation alone does not accept a route
as a reference performance workload.

## Run in the browser

Use a fresh browser session at `http://localhost:3000/?renderer=webgl2` or
`http://localhost:3000/?renderer=webgpu`. Optional `&benchmarkLabel=<revision>` is
saved in reports; use it to identify the tested build. Confirm the actual backend.
In the game console, set the recipe's required profile values explicitly:

```text
r_ssr 0
r_glow 0
r_daynight 0
cl_player_outline 1
timedemo list
timedemo <fixture-id> --mode realtime --repeats 3
```

Use an ID returned by `timedemo list`. The runner temporarily fixes the render buffer
at 1280×720 and FOV at 90°. It checks settings; it does not save quality overrides.
Close the console during warmup, keep the tab visible, and leave input alone during
measurement. Each repetition performs a complete warmup replay and a fresh measured
replay: approximately 100 seconds plus loading per repetition.

Starting playback takes over the current client session using the ordinary demo
pipeline. On completion/abort it stops presentation, restores render dimensions and
controller enable states, and leaves freefly on the loaded benchmark map. It does
not reconnect the previous match or restore its map/camera position.

After completion:

```text
timedemo report
timedemo export
```

`timedemo abort` or Escape cancels. Input while measuring invalidates the attempt;
opening the console to inspect progress during measurement therefore interrupts it.
The final report is also available as `window.timedemoReport` for automation.

## Interpret results

Reports include raw samples and per-phase p50/p95/p99 wall/scene/playback/animation
timing, draw/triangle/actor counts, shader compiles, gun/scene readiness diagnostics
and frames over the 120 Hz budget. Living/loaded body counts describe playback
actors, not a claim that all ten bodies are visible in every view.

Skipped recorded events, missing bodies, missing phases or a completely missing
first-person gun mark a run invalid. Hidden tabs, renderer failures, replacement
playback, changed required settings/dimensions and cancellation stop the run with a
reason. Transient gun loading and pending scene-data counts remain visible in raw
samples and summaries; inspect them before accepting a reference fixture.

Scene readiness is checked before and after measurement, not every frame:
`scene.isReady()` scans meshes and can prepare materials, changing the workload
being measured. Current samples therefore set `sceneReady: null` and record the
passive `pendingSceneData` count instead. `sceneReadinessObservedFrames` distinguishes
unobserved readiness from a ready scene; pending data does not establish shader
readiness. Older reports with boolean readiness remain readable.

GPU timing uses fresh asynchronous counter results when supported. It reports
`unavailable` rather than inventing a zero and does not attribute delayed GPU samples
to individual camera phases. Scene CPU excludes work before the scene hook;
playback CPU is reported separately. Wall times are refresh-paced real-time results,
so they are not an uncapped throughput score. `--mode fixed` is explicitly rejected
until presentation clocks/effects can follow a validated logical clock.

To measure WebGPU render bundles, compare fresh sessions using
`?renderer=webgpu&ncm=0` and `?renderer=webgpu&ncm=1`. Alternate at least three
repetitions of each with the same fixture/profile and export each report.
Render bundles are WebGPU's default; `ncm=0` turns them off for that session only
and does not change saved settings.

Under `ncm=1`, each sample's `bundles` records created/reused bundle submission
counts for that engine frame. Run and phase summaries include totals, counts per
frame, creation share (`created / (created + reused)`) and the percentage of
sampled frames with any creation. Those percentages answer different questions;
totals also depend on how many frames rendered, so compare normalized counts.
Counters are collected after Babylon publishes the completed engine-frame values,
so a phase cut does not receive the preceding frame's totals. They cover world,
first-person gun and enabled auxiliary passes together, rather than individual
meshes or a GPU-time percentage.

WebGL2/compatibility-mode counters are `null` (not applicable), and missing or
malformed NCM observations remain `null` and invalidate counter coverage. A true
zero is kept as zero; creation share is undefined when there were no submissions.
Rendering a second measured scene before the engine frame ends stops the capture
because per-phase attribution would be ambiguous. Bundle reuse alone does not
establish a speedup: inspect timing, body/effects coverage and pixels as well.

For comparisons, use the same fixture ID, quality settings, dimensions, browser,
adapter and power state. Run three repetitions per actual backend in a quiet headed
browser, export both reports and inspect camera/gun/body/effects checkpoints. The
runner is validated headlessly; acceptance on real hardware is still to be done. See
the [WebGPU research notes](https://github.com/Higher-Standard-Games/shag/blob/main/docs/research/v0.9.27-webgpu.md).

## CPU profiling in Edge

The [profiling runner](https://github.com/Higher-Standard-Games/shag/blob/main/src/games/fps/scripts/benchmarks/profile-timedemo.mjs) starts a
private localhost Vite server with HMR and file watching disabled, then a fresh
visible Edge profile for each backend. It does not use your normal browser profile.
Run from the repository root with the local benchmark fixture installed:

```powershell
npm --prefix src/games/fps run benchmark:profile -- --dry-run
npm --prefix src/games/fps run benchmark:profile
```

It defaults to one WebGL2 run followed by one WebGPU compatibility-mode run, the
ten-player `washoi_dm2` fixture, the fixture's required settings,
`cl_player_pose_hz 30` (unless the fixture explicitly requires another pose rate)
and `developer 0`. Development diagnostics are explicitly
disabled and their before/after state is saved in each `run.json`.
Options include `--backends webgpu`, `--ncm 1`,
`--interval 1000` (microseconds), `--browser <executable>`, `--port 3117`,
`--fixture <id>` and `--out <new-workspace-directory>`.

Keep the desktop unlocked and leave the visible benchmark window alone. Avoid
other tests, builds and profiling sessions during capture. The runner saves the
timedemo report, complete main-thread `.cpuprofile`, per-phase CPU slices and
summaries, first-person slow-frame summaries, warmup screenshots, and source/browser metadata under
`public/data/benchmarks/results/` by default. Edge and the private server close
afterward; raw results and the temporary browser data under `node_modules/.cache/`
remain local.

CPU sampling and polling add overhead. These captures explain hotspots; their
frame times are not an unprofiled benchmark score. Profiling stays continuous
through the measured tour and stops only afterward, avoiding expensive profiler
serialization at camera cuts. Per-phase CPU slices retain the interior between
observed same-phase playheads, excluding uncertain cut edges. Clock calibration,
observed frames and workload-invalid reasons are saved alongside the profiles.
Self times are exclusive; inclusive entries overlap and must not be added together.

The sampler starts before issuing timedemo, so profiler initialization cannot
interrupt an advancing demo. `profiling-start.json` records that boundary and
its wall duration. The full raw CPU capture includes setup, loading and warmup;
the phase/slow-frame summaries still use only measured playheads.

Each raw sample's `frameAtMs` is a page-clock timestamp at the frame hook before
playback. Its `wallMs` interval ends there. The runner maps these timestamps to the
CPU clock and summarizes same-phase first-person intervals at or above that phase's
p95. These summaries include all main-thread work and waiting inside the selected
wall intervals; they are not proof that the largest sampled function caused a stall.

For a diagnostic capture of readiness work, add `--trace-readiness`. This wraps
Babylon's public scene readiness/pending-data methods in the owned browser and
saves `readiness-trace.json` with registration stacks, actual checks and observed
pending-resource lifetimes. It initiates no extra readiness checks and restores
the methods after collection. Entries registered before installation are not
individually tracked; bounded traces report dropped records. Method wrappers and
stack capture add overhead, so use this option to investigate callers rather than
to compare benchmark scores.

Add `--trace-playback` to record long `DemoViewer.update` calls and the first
increase of its skipped-frame counter, including during pre-roll. The saved
`playback-trace.json` includes the supplied delta, update CPU duration, page
timestamps, before/after playheads and skips, and the preceding update. Records
are retained for the first update of each viewer, when the supplied delta exceeds 100 ms, the update takes over
25 ms, frames are skipped, or the original update throws. The bounded trace
reports drops and restores the original method after collection. It preserves
the delta, callback delivery, exceptions and the 250 ms catch-up policy.

```powershell
npm --prefix src/games/fps run benchmark:profile -- --trace-readiness --trace-playback --interval 1000
```

Trace wrappers add diagnostic overhead. A long incoming delta can include native
rendering or waiting between calls; it is not all CPU work in `update`. Correlate
the recorded gap and skipped transition with the CPU profile instead of resetting
pre-roll skips to make a workload appear valid.

## Compare player outlines

```powershell
npm --prefix src/games/fps run benchmark:outlines -- --dry-run
npm --prefix src/games/fps run benchmark:outlines -- --prepare-only
npm --prefix src/games/fps run benchmark:outlines -- --repeats 5 --out public/data/benchmarks/results/my-outline-series
```

The [comparison script](https://github.com/Higher-Standard-Games/shag/blob/main/src/games/fps/scripts/benchmarks/outline-comparison.mjs) derives
two immutable fixtures from the same saved recording, route and spectator schedule.
Only the required `cl_player_outline` value changes (0/1); derived identities include
the base manifest hash. It verifies the demo bytes, preserves existing fixtures,
registers the variants in `timedemo list`, and saves the complete comparison plan.
Recreating these variants needs no server or new recording.

The default series alternates variant and backend order across five attempts per
variant/backend: 20 fresh visible sessions, about 35–45 minutes including loading.
Every attempt warms up and replays the same 45-second measured interval. CPU
sampling and trace wrappers are disabled; production timedemo counters and 400 ms
progress polling remain. `--repeats 1` is a pilot, not a reliable timing comparison.
`--backends webgpu` limits the series to one backend; `--fixture <id>` selects a
different installed base. Output directories must be new and inside the workspace.

Raw reports and rejected attempts are retained. Summaries report valid/rejected
counts and the median/min/max of run-level p95 values, rather than pooling frames.
Changed source/browser/profile/route or failed workload gates exclude an attempt
from comparisons. Fewer valid runs than requested produces exit 1; a bounded
series does not silently rerun or discard stalls. Inspect body/gun/event coverage
and spread before attributing a timing difference to outlines. Outline-off is a
quality diagnostic, not an accepted optimization or a proposed default change.
Powerup/weapon outlines may remain through their separate gameplay styling path.

For separate pass attribution, use a derived outline-on fixture ID:

```powershell
npm --prefix src/games/fps run benchmark:profile -- --fixture <outline-on-id> --trace-outlines --interval 1000
```

`outline-trace.json` separates engine submissions for body colour/alpha/depth and
outline colour/depth/stencil/overlay by camera. It retains mesh names, vertices,
readiness attempts, actual engine draw API calls and inclusive outline CPU duration.
It restores the diagnostic wrappers after capture and reports bounded trace drops.
These counts are not native driver commands or GPU vertex invocation counts;
render-bundle replay can bypass the wrapped API. Use compatibility mode for the
first attribution capture. The wrappers/CPU clocks add overhead, so do not use
their frame times as the primary comparison score.

The Edge runner also accepts `--timing-only` for one unprofiled session
per requested backend. This option rejects trace wrappers and saves reports and
warmup screenshots without CPU profiles.

Manual timedemo playback anchors its clock at the first frame hook, with a zero
initial advance. Setup/waiting before that hook is not playback time. Subsequent
updates use the actual elapsed wall time, and skips during pre-roll or measurement
still invalidate the workload. The regular demo player's catch-up policy is unchanged.

## Fixed player crowd benchmark

```powershell
npm --prefix src/games/fps run benchmark:crowd -- --dry-run
npm --prefix src/games/fps run benchmark:crowd -- --repeats 1 --counts 0,10
npm --prefix src/games/fps run benchmark:crowd -- --repeats 5 --out public/data/benchmarks/results/my-crowd-series
```

The [saved recipe](https://github.com/Higher-Standard-Games/shag/blob/main/benchmarks/recipes/player-crowd-v1.json) builds a fixed
0/2/5/10-player scene through the production player manager, with independent rigs,
normal FFA styling and a 30 Hz run pose driven by fixed 60 Hz presentation ticks.
There is one near actor and a staggered distant group. No map, network connection,
bot AI, weapons or game simulation runs. This isolates player drawing; its numbers
are not gameplay FPS. Ten clones stay loaded across all cases, and the requested
prefix of actors is enabled.

The [runner](https://github.com/Higher-Standard-Games/shag/blob/main/src/games/fps/scripts/benchmarks/crowd-benchmark.mjs) opens fresh private
Edge sessions for each backend, repeats outline-on/off cases in alternating order,
and records raw samples, run-level p95 summaries, assets/source hashes, browser/GPU
metadata and warmup screenshots. It expects two background draws plus one ordinary
and, when enabled, two outline draws per opaque body primitive. Missing active
bodies, unexpected draws, shader compilation during measurement, renderer failure,
hidden tabs or changed sources invalidate results. Actual pixel visibility and
outline quality still require screenshot/manual acceptance.

Each case warms 120 frames and measures 240; the default has 40 cases per backend.
Animation content is fixed by tick rather than wall time, so refresh rate changes
playback speed. CPU timing covers pose updates and `scene.render`; GPU samples are
fresh asynchronous counters and may include the end of that case's warmup.
Unavailable GPU timing remains null. Refresh-paced wall frames may hide GPU/CPU
cost reductions when both cases fit inside the display budget. There is no CPU
sampler; 250 ms status polling and passive draw/GPU counters remain.

To inspect it manually, start `npm run dev`, then open
`http://localhost:3000/benchmarks/crowd/index.html?renderer=webgpu&repeats=1&counts=0,10`
(or `renderer=webgl2`). Escape stops the test; completion retires its scene/engine.
The standalone page loads PK3 packages from `/data/`, independent of its nested URL.
This is a development-server benchmark entry, not a separate game mode or a
default production page. It needs `player_model_vanguard.pk3` in `public/data/`
(see [Model loading](./model-loading.md#packaged-player-model)); no recorded demo
or server is needed. The JSON
recipe is sufficient to rebuild the scene after model changes, with new asset
hashes recorded for every series. Outline-off is a quality diagnostic, not a
proposed gameplay setting change.

### Experimental outline geometry comparison

```powershell
npm --prefix src/games/fps run benchmark:outline-proxy:build
npm --prefix src/games/fps run benchmark:crowd -- --outline-proxy --repeats 1 --counts 0,10
npm --prefix src/games/fps run benchmark:crowd -- --outline-proxy --visual --repeats 5 --out public/data/benchmarks/results/my-outline-proxy-series
```

The [proxy recipe](https://github.com/Higher-Standard-Games/shag/blob/main/benchmarks/recipes/player-outline-proxy-v1.json) and
[generator](https://github.com/Higher-Standard-Games/shag/blob/main/src/games/fps/scripts/benchmarks/build-outline-proxy.mjs) recreate a local
outline-only GLB from Vanguard. UVs/tangents are removed, identical retained
vertices welded, and triangles simplified to a target 25% with a 1% model-radius
error limit. Original normals and skin weights are retained; rig hierarchy,
joint order and bind matrices are checked. The generator saves provenance beside
the GLB under ignored `public/data/benchmarks/outline-proxy/`. Re-run it after
changing the source asset. It uses the repository's installed glTF Transform and
Meshoptimizer dependencies. This is lossy geometry, requiring visual acceptance.

`--outline-proxy` alternates full/proxy geometry inside every outline-on/off case
(80 cases per backend at five repetitions). Both modes load the same proxy
resources. Ordinary body geometry remains full detail; only the two opaque body
outline passes use the proxy and live skeleton. Draw count stays unchanged.
Measured samples expose `proxyPasses` and `proxyIndices`; unexpected pass coverage
or full-geometry fallback invalidates the case. Unsupported alpha, instancing,
morph and baked-animation paths retain normal outlines.

`--visual` also captures overview, near and foreground-occluded views at identical
pose tick 30, after measurement, without CPU sampling. Those captures change the
camera temporarily and are outside the timing samples. Prefer them over warmup
screenshots for visual comparisons, since warmup screenshots can show different
poses. The runner advances each static capture automatically; do not use
`visual=1` for unattended manual browsing without the runner. Ordinary manual
experiments can append `&outlineProxy=1` to the crowd-page URL.

### Player outline proxy in gameplay and timedemo

After `npm --prefix src/games/fps run benchmark:outline-proxy:build`, the game console accepts:

```text
cl_player_outline 1
cl_player_outline_proxy 1
```

`cl_player_outline_proxy` defaults to **0** and is not saved to configuration.
It switches outline geometry in the shared live/demo player model path, retaining
full body geometry, player colours and both outline passes. It also follows new
spawns, corpse ownership and water-reflection bodies; held weapons are excluded.
One source/adapter is shared per scene, and the last owning manager retires it.
Turning it off retains prepared sources until their managers retire, allowing
cheap subsequent toggles. Missing/mismatched assets keep full outlines with a
warning; regenerate the proxy and reload the map to retry a failed import.

To create immutable full/reduced profiles and run paired map timedemos:

```powershell
npm --prefix src/games/fps run benchmark:outlines -- --proxy --dry-run --repeats 3
npm --prefix src/games/fps run benchmark:outlines -- --proxy --repeats 3
```

The saved combat and camera schedule stay identical; both profiles require
`cl_player_outline 1`. The runner uses alternating fresh Edge sessions without
CPU sampling. Reports include per-phase proxy pass/index coverage and source/
proxy asset hashes. Unready/missing proxies, rejected rigs or unexpected shader
fallback invalidate the reduced-geometry run. Transparent/unsupported passes
deliberately use the original path and are reported separately, including fading
corpses. Skipped gameplay events and the existing workload gates still invalidate
runs. This remains experimental and off by default; neither the crowd experiment
nor enabling the CVar alone establishes an FPS improvement or visual acceptance.

### Weapon-camera candidates

`r_weapon_candidates` filters the registered first-person weapon camera's
mesh candidates by its current layer mask before Babylon's readiness, world-matrix
and LOD work. Other cameras retain their existing provider. Meshes with action
managers remain candidates for intersection processing, and custom LOD selectors
use the original provider. Membership is checked every pass, including new meshes
and changed masks. Live and demo views share one scene provider with separate
camera ownership; disposal restores the previous provider when still owned.

The setting defaults to **1** on every backend, is not persisted, and can be
set to 0 by an immutable fixture for an off/on comparison. On the `washoi_dm5`
FFA demo it cuts the weapon camera's evaluation from about 1.0 ms to 0.15 ms a
frame on WebGL2 and from about 0.55 ms to 0.09 ms on WebGPU, with identical
pixels and active sets in paused frames (WebGL2, WebGPU and `?ncm=1`). Keep pose rate 30, normal outlines 1
and outline proxy 0 in both profiles.

For diagnostic attribution, add `--trace-cameras` to `benchmark:profile`.
`camera-trace.json` records inclusive active-mesh evaluation CPU, candidate counts,
matching layers and active meshes per camera. Sampling, clocks and counting add
overhead; use separate `--timing-only` captures for FPS. The runner rejects mixing
timing-only mode with diagnostic wrappers.

### Material-clone setup comparison

`r_material_clone_batch` defaults to **1** and is not persisted. Setting it to
`0` uses per-material clone setup instead, for an A/B profile. The model-instance
cache and player visibility-material clones batch fresh native PBR property
copies and the managed scene's light policy. StandardMaterial, custom clone
methods and unsupported MultiMaterial children use the original path. Each
batch is synchronous, covers only newly constructed materials, and releases
its per-material dirty block before returning. Later mutations remain enabled.

Use immutable profiles requiring `r_material_clone_batch 0` or `1`, holding
`r_weapon_candidates 0`, normal outlines 1, proxy 0 and pose rate 30 in both.
Profiled CPU captures attribute setup work; separate timing-only pairs are
required before reporting an FPS improvement.

`benchmark:profile` captures save `graphics.json` and include that data in
`run.json`: Babylon's backend adapter description and Edge's GPU inventory.
Descriptions may be privacy-limited or unavailable. A machine having two GPUs
does not prove which one the backend used. For an integrated-GPU series, record
the selected adapter and driver, keep source/fixture/settings fixed, and use a
fresh output directory. Keep results separate from discrete-GPU captures.
