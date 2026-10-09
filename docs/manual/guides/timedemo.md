# Timedemo benchmarks

`timedemo` replays a local combat recording with a saved camera schedule. Measurement
needs no game server, lobby connection or bot AI. The first recipe is ten-player FFA
on `wdm2`: 45 measured seconds alternating freefly and first-person bot spectating,
after five seconds of pre-roll. Spectator priorities are randomized with seed 927
when creating the fixture, then saved. Dead/absent bots are skipped in that order.

## Create or regenerate the fixture

From the repository root:

```powershell
npm run benchmark:fixture -- --dry-run
npm run benchmark:fixture -- --bot-control ws://127.0.0.1:9100
```

The second command creates a separate `wdm2` match on port 7787, borrows ten bots
from the existing local bot manager, records 120 seconds and releases only those
bots. It uses the existing local bot secret; it never prints it. Change the port
with `--port 7788` if necessary. Omit `--bot-control` to own in-process bots instead.
Ctrl+C requests graceful cleanup. An occupied port fails without replacing a server.

The checked-in [recipe](../../../benchmarks/recipes/wdm2-ffa10.json) and
[launcher](../../../scripts/benchmarks/create-fixture.mjs) preserve the sequence.
FFA's authoring score limit is disabled so a fast bot cannot end recording early.
The match itself remains ordinary FFA; ten is a population baseline, not a team setup.

To freeze an existing suitable recording:

```powershell
npm run benchmark:fixture -- --demo public/data/demos/<recording>.shagdemo
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
The final report is also available as `window.timedemoReport` for a future runner.

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

For the experimental WebGPU render-bundle mode, compare fresh sessions using
`?renderer=webgpu&ncm=0` and `?renderer=webgpu&ncm=1`. Alternate at least three
repetitions of each with the same fixture/profile and export each report. The
normal mode remains the default; this comparison does not change saved settings.

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
current implementation has headless validation; hardware/visual acceptance remains
pending. See the [research status](../../research/v0.9.27-webgpu.md).

## CPU profiling in Edge

The [profiling runner](../../../scripts/benchmarks/profile-timedemo.mjs) starts a
private localhost Vite server with HMR and file watching disabled, then a fresh
visible Edge profile for each backend. It does not use your normal browser profile.
Run from the repository root with the local benchmark fixture installed:

```powershell
npm run benchmark:profile -- --dry-run
npm run benchmark:profile
```

It defaults to one WebGL2 run followed by one WebGPU compatibility-mode run, the
ten-player `wdm2` fixture, the fixture's required settings, and
`cl_player_pose_hz 30`. Options include `--backends webgpu`, `--ncm 1`,
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

Each raw sample's `frameAtMs` is a page-clock timestamp at the frame hook before
playback. Its `wallMs` interval ends there. The runner maps these timestamps to the
CPU clock and summarizes same-phase first-person intervals at or above that phase's
p95. These summaries include all main-thread work and waiting inside the selected
wall intervals; they are not proof that the largest sampled function caused a stall.
