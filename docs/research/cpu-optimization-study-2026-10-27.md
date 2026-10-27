# CPU optimization study

Date: October 27, 2026. Status: source review, fresh replay attribution and live
prediction probes. Initial profiling changed no runtime code. The first C3
implementation and its validation are tracked in the
[animation/physics investigation](cpu-animation-physics-investigation-2026-10-27.md).
Repeated clean timing comparisons remain pending.

## Decision

Use the existing profiles to choose investigations. Take new captures before
ranking optimization work or claiming a gain. Rendering also consumes CPU: a CPU
bottleneck does not establish that gameplay code is the main remaining cost.

This study complements the [renderer review](babylon-renderer-new-paths-2026-10-26.md).
The other agent owns post-load lighting/pipeline stalls, weapon material freezing,
map draw reduction, dynamic visibility membership and render-bundle work. Avoid
overlapping those changes or running captures alongside its measurements.

The initial scope is client gameplay, snapshot processing, prediction, collision,
effects, HUD, allocations and idle work. Server simulation and bot AI need separate
process measurements. A browser replay cannot answer their CPU cost.

The [focused animation/physics investigation](cpu-animation-physics-investigation-2026-10-27.md)
adds real-rig counters, a reversible cache-animation experiment and retained
headless reproductions. Its first candidate is stopping constant animations on
hidden pickup-cache sources; ragdoll batching requires more pose-parity work.

## What the existing captures can tell us

Local, gitignored evidence lives at
`public/data/benchmarks/results/2026-10-26-path0-baseline/`. Inspect each backend's
`run.json`, `timedemo.json`, phase summaries and raw `.cpuprofile` files together.
Phase summary files wrap their attribution object in `summary`; do not read
`bySelf` directly from the wrapper.

| Capture | Provenance | Use |
| --- | --- | --- |
| `1-webgl2` | Engine `9e3d812c`, FPS `07593163`; `valid=true`, **`stableSource=false`** | Historical call-path leads; source changed during capture |
| `2-webgpu` | Engine `d1baa695`, FPS `07593163`; **`valid=false`**, `stableSource=true` | Diagnostic leads; playback skipped recorded frames after a stall |

These were single profiled runs on visible Edge, RTX 4070 SUPER, 1280×720,
with 250 µs CPU sampling. Both predate the active renderer work and updated
player-model media. They are neither an accepted current baseline nor a paired
WebGL/WebGPU comparison. See the [original analysis](babylon-classic-frame-floor-2026-10-26.md)
for the full phase table and its limitations. Historical comparisons across
different fixtures or measurement methods do not establish causal improvements.

For a sense of scale, these are selected **inclusive sampled CPU ms per observed
frame** from `fps-gunplay-a`, rounded to three decimals:

| Entry | WebGL2, 1,425 frames | WebGPU, 991 frames | Follow-up |
| --- | ---: | ---: | --- |
| `BinaryProtocol.decodeEvents` | 0.025 | 0.045 | Decode cost versus event density; replay workload only |
| `BinaryProtocol.decodeEntities` | 0.016 | 0.022 | Bytes/entities and allocation pressure |
| `GameEvents.handleServerStateUpdate` | 0.080 | 0.135 | Derived state, downstream listeners and HUD work |
| `GibSystem.update` | 0.033 | 0.031 | Separate active simulation from empty-pool overhead |
| `DamageOverlay.drawTriangles` | 0.018 | 0.015 | Active overlay drawing versus idle scheduling |

These entries are examples, not an exhaustive CPU budget or promised savings.
Inclusive entries overlap and must not be added. The small means do not describe
tail spikes. V8 can attribute work to callers, inline functions or dependency
frames; a low self time does not make a subsystem free.

The same WebGL phase attributed about 2.152 ms/frame inclusive to
`_evaluateActiveMeshes`, far above any individual entry above. The old profiles
therefore support investigating application work, but do not support calling it
the dominant bottleneck. The other agent's renderer changes may alter that split.

Main-thread samples also exclude work running on other browser threads, the GPU,
audio processing threads and Node server/bot processes. `(program)` and unknown
dependency frames must remain unattributed unless their call context establishes
ownership.

## Fresh captures: October 27

The user authorized new captures while the renderer agent continued working.
The two replay captures use the existing dm5 fixture on visible Edge with 250 µs
sampling. Both report complete, valid playback and stable source, with no runtime
exceptions. Both identify engine `7ce7030b` and FPS `ca018d1`, **plus uncommitted
renderer work**. Their runtime/media change fingerprint is
`0f6824ad4756a5b4644b051aea657c6f847955cff3cec2e27155af53303268b1`.
The commits alone do not identify this intermediate build.

Machine: Ryzen 7 7700X, 8 cores / 16 logical processors, RTX 4070 SUPER.
The [extracted evidence](cpu-evidence/2026-10-27-captures.json) retains source
fingerprints, settings, raw-input checksums, phase counters and selected sampled
call costs. Raw profiles and screenshots remain in gitignored local game data:

- `public/data/benchmarks/results/2026-10-27-cpu-study-webgl2/`
- `public/data/benchmarks/results/2026-10-27-cpu-study-webgpu/`

An independent renderer probe started during the WebGPU run. Its timing is
therefore contended. Neither run is a repeated, unprofiled benchmark; **do not
derive backend ratios or optimization gains from them**. Logical replay validity
and stable source are necessary checks, not proof of uncontended measurement.

### Current application work visible in replay

Selected inclusive sampled CPU ms/frame in the WebGL2 `fps-gunplay-a` slice
(1,540 observed slice frames):

| Entry | ms/frame | Interpretation |
| --- | ---: | --- |
| Babylon `_renderForCamera` | 5.021 | Rendering remains a major CPU cost; renderer agent owns that work |
| `DemoService.updatePlaybackFrame` | 0.605 | Broad playback work; includes children below |
| `DemoService.stepDemoPhysics` | 0.198 | Havok stepping and its callbacks deserve active-body attribution |
| `RemotePlayerRenderer.render` | 0.133 | Presentation/interpolation work before downstream scene animation/drawing |
| `BinaryProtocol.decodeSnapshot` | 0.091 | Recorded snapshot decoding, not live prediction |
| `GameEvents.handleServerStateUpdate` | 0.069 | Event/state presentation, including downstream work |
| V8 garbage collector, exclusive | 0.075 | Small average in this slice; does not rule out individual GC spikes |

The table is not additive. Babylon animation evaluation also appears outside
`RemotePlayerRenderer.render`: its small inclusive time does not cover the full
cost of animating and drawing a character. The timedemo's full-run median animation
counter was 0.7 ms, which overlaps scene work and differs from the sampled slice.

The current traces favor investigating animation/physics work and burst costs
before a broad object-pooling rewrite. Across WebGL slices, sampled GC ranged
from roughly 0.046 to 0.103 ms/frame. This is attribution, not allocation volume.

The replay reports still contain transient readiness issues: WebGL2 recorded 16
missing-POV-weapon frames, 20 pending-scene-data frames and 15 shader compilations;
WebGPU recorded 57, 28 and 25 respectively. These are full-run counters, including
phase boundaries. They qualify any proposed steady-state baseline despite the
runner's valid flag. Post-load pipeline/readiness work remains with the renderer
agent. A warmup POV screenshot was visually checked: map, held gun and actor were
present in that frame; it does not certify every frame of the route.

### Live prediction: first controlled workload

A scratch probe starts its own source-based Node game server on `7796`, private
Vite server on `3168`, fresh headless Edge profile and private recording directory.
It connects directly without the user's lobby/accounts database, confirms the
normal FFA loadout dialog, obtains pointer lock, then samples idle and keyboard
movement phases. It uses no bots or artificial packet loss. Both phases send
normal 125 Hz commands; the server reports 62.5 Hz snapshots, its effective rate
when broadcasting every two 125 Hz ticks.

The initial attempt never confirmed the loadout and stayed spectating: rejected.
Attempt 2 confirmed real movement and prediction but its broad source fingerprint
changed: diagnostic only. Attempt 3 records per-file runtime fingerprints and
slices the CPU profile using CDP monotonic metric timestamps. Both phases and the
whole attempt report stable runtime source, fingerprint
`a086309e5e7ba8ec1a17c64c979f5e2044302a1f8e0e9a2f60ee12ac1bd7b530`.
This uses a different fingerprint algorithm from the replay launcher; the hash
strings cannot be compared across those harnesses.

| Attempt 3 phase | Slice seconds | Observed frame-boundary count | Commands | Confirmed snapshots | Reconciliations | Resyncs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Idle | 12.014 | 1,979 | 1,504 | 752 | 0 | 0 |
| Movement | 12.017 | 1,986 | 1,505 | 753 | 0 | 0 |

These counters show that the confirmation fast path is exercised in a quiet
localhost session. They provide no replay-heavy workload and do not justify
prioritizing input-history replacement. Start/end movement position alone does
not characterize route coverage: opposing held keys can return near the start,
and the server chooses a spawn. Later runs also record intermediate positions.

The browser reported WebGL2 through NVIDIA ANGLE, 1256×581 render dimensions,
DPR 1, outlines enabled, pose stepping at 30 Hz, and SSR/glow/day-night disabled.
This is a low-population diagnostic at its recorded dimensions, not an equivalent
resolution/workload comparison with the dm5 replay or production defaults.

Selected inclusive sampled CPU **ms per second of the live slice**:

| Entry | Idle | Movement |
| --- | ---: | ---: |
| `V2NetworkClient.processInput` | 4.930 | 9.254 |
| `MovementProfile.simulate` | 4.191 | 8.379 |
| `SharedCollisionWorld.trace` | 1.555 | 1.743 |
| `BinaryProtocol.decodeSnapshot` | 2.688 | 2.485 |

Again, children overlap parents. The CPU slice and observed frame boundaries are
bracketed by separate CDP calls, so the probe deliberately avoids claiming precise
live CPU ms/frame. Scene-only counters would also miss main-loop work.

Raw attempts are under `public/data/benchmarks/results/2026-10-27-cpu-study-live-webgl2*`.
Scratch harness: `.cache/cpu-study/live-probe.mjs`. It records its own hash, source
and media hashes, debug counters, raw/sliced CPU profiles, browser logs and failures.
Lobby connection-refused messages are expected: the probe points the lobby at an
unused local port. No HTTP 4xx/5xx requests were recorded in attempts 1–3.

### Follow-up candidates grounded in these captures

- **Physics and skeletal evaluation:** correlate `stepDemoPhysics`, Babylon
  animation, skeleton preparation and ragdoll bone synchronization with active
  body/actor counts. [RagdollSystem](../../src/games/fps/client/RagdollSystem.ts)
  already disposes expired bodies and detects rest for fading. Do not assume
  every Havok step is unnecessary or freeze the world globally: other bodies,
  movers and effect timing may depend on it.
- **Pickup observer work:** `FPSPickup.isInView` and procedural pickup updates
  appear in live profiles. [FPSPickup](../../src/games/fps/world/FPSPickup.ts)
  already caches the pickup's BSP cluster, and
  [ProceduralPickupVisual](../../src/games/fps/world/pickups/procedural/ProceduralPickupVisual.ts)
  already gates visibility. Measure remaining per-frame observer/position checks
  before extending invalidation. Coordinate with the renderer agent's membership
  work; these samples do not establish a large saving.
- **Allocation experiments:** preserve existing
  [PlayerModelManager](../../src/engine/animation/PlayerModelManager.ts) locomotion
  clip-group caching and unchanged-animation guard. One-shot groups have their
  own lifecycle; measure transition/one-shot allocation before proposing pooling.
- **Latency stress:** confirmation-dominated localhost results leave a major
  question unanswered. The follow-up below uses a loopback WebSocket proxy with
  100 ms delay in each direction. Its echo check preserved three messages in order,
  forwarded six messages total, and observed a 223 ms round trip. Actual delay
  distributions must accompany results; configured delay is not observed RTT.

### Delayed acknowledgements: measured result

The follow-up used the same WebGL2 live harness with a loopback proxy adding
100 ms in each direction. Runtime fingerprints were identical to attempt 3 and
remained stable across both measured phases. It recorded intermediate movement
positions, normal command generation, and zero proxy errors.

| Phase | CPU slice seconds | Commands | Confirmed snapshots | Reconciliations | Resyncs | Pending inputs, before → after |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Idle | 12.002 | 1,502 | 737 | 0 | 0 | 39 → 29 |
| Movement | 12.058 | 1,510 | 749 | 0 | 0 | 38 → 30 |

The proxy forwarded 10,186 messages across startup and measurement. Forwarding
delay p50 was 101.1 ms and p95 109.3 ms; the aggregate maximum was 1,423.6 ms.
The aggregate includes startup and cannot isolate that outlier to a measured
phase. This is a delayed-ack diagnostic, **not a perfectly constant 200 ms RTT
benchmark**. There was no artificial loss or reordering. Each run used one local
server and one browser on the same machine; the Node server/proxy CPU was not
included in the browser's main-thread sample.

`V2NetworkClient.processInput` sampled about 4.323 CPU ms/second in idle and
8.277 in movement. These are inclusive call costs, not a speed improvement over
the earlier run: spawn, route and scheduling are not controlled as an A/B pair.
The important result is behavioral: the larger input backlog still took the
confirmation fast path. A backlog alone does not establish an expensive replay
loop. Combat impulses, loss/jitter and crowded matches remain untested.

The ready state reported 88 physics bodies and zero ragdolls. Body motion types
were not classified, so this does not prove that all 88 bodies are static or that
the physics step may safely be skipped.

Raw evidence: `public/data/benchmarks/results/2026-10-27-cpu-study-live-webgl2-delay100/`.
It includes the exact capture/proxy harness copies and their checksums. The
summary JSON links the measured intervals to raw and sliced profile checksums.
No runtime optimization follows automatically from these samples.

## Profile after the animation and physics work

A headless sampled profile (250 µs) of 30 s of `washoi_dm5_ffa_20261025_170933`
on WebGL2, taken after the renderer, ragdoll and skin-preparation changes on
this branch, summarized with `scripts/benchmarks/cpu-profile.mjs`. 3,611 frames
at 120 fps; one run, so the figures rank work rather than measure gains.

| Work | Inclusive ms/frame |
| --- | ---: |
| Babylon `_renderForCamera`, all cameras | 5.56 |
| of which drawing the rendering groups | 3.36 |
| of which `_evaluateActiveMeshes` | 1.57 |
| `(program)`: native and driver work outside JavaScript | 1.16 (self) |
| `DemoService.tick` (demo playback only) | 0.54 |
| `SceneMeshCandidates` filters (pay for fewer evaluated meshes) | 0.19 |
| `updateAutosprites` (CPU billboards and their uploads) | 0.18 |
| `Q3SoftParticleDepth` camera observer | 0.135 |
| Skin preparation gate (comparison 0.061 self) | 0.13 |
| Remote player rendering | 0.10 |
| Snapshot decode, `handleServerStateUpdate` | 0.035, 0.073 |
| Garbage collection (self) | 0.032 |

Game and engine JavaScript outside Babylon is now small next to Babylon's
own frame. Two follow-ups came out of it:

- **Soft-particle depth scan, fixed.** Each camera pass walked every scene
  mesh to find the few with a soft material, mostly in the `material` getter.
  Each soft material now keeps Babylon's own `meshMap` (maintained by the mesh
  material setter and disposal once present); the scan reads those lists and
  their instances. The observer's `prepare` fell from 0.102 to 0.029 ms/frame
  in a second profile of the same demo window. Tests cover meshes assigned
  before and after, reassigned away, disposed, instanced and pass-only.
- **Skin gate comparison, left as is.** Comparing all ten values in one
  condition instead of a call per value measured 0.066 against 0.061 ms/frame:
  the cost is reading the node values, not the calls.

- **Sprite billboards, moved to the vertex shader.** `Q3AutospritePlugin`
  (GLSL and WGSL) turns each sprite vertex from per-vertex centre and offset
  attributes toward `vEyePosition`; the CPU billboard remains for materials
  without the plugin and while an effect layer exists. `updateAutosprites` fell
  from 0.177 to 0.011 ms/frame in the same demo window. Paused frames aimed at
  sprites on dm5 and dm2, plugin on, on again and off (CPU), on WebGL2 and
  WebGPU: in every view where an authored-quad control differs (up to 7% of
  pixels), GPU against CPU differs no more than two consecutive GPU captures
  (0.06–0.18% of pixels by more than two levels, from the paused scene's own
  drift); dm2's sprite view is identical. Captures used `engine.readPixels`: a
  2D-canvas copy of a WebGPU canvas does not return the current frame. A
  material plugin cannot be deactivated in Babylon (`_enable(false)` does
  nothing), so the plugin's switch drives its define; frozen sprite materials
  must be unfrozen for a switch to reach their effects. Not seen in a browser:
  sprites of a multi-pass shader. Its later passes are clones with their own
  vertex buffers, which the CPU billboard never updated; they carry the
  attributes and get the plugin, but neither dm5 nor dm2 has one.

The remaining large CPU cost is Babylon drawing about 80 opaque map surfaces a
frame and evaluating active meshes, which the renderer results note leaves to a
material redesign.

### Texture arrays: census before a design

A probe recorded the opaque map meshes the main camera drew over 15 s of demo
playback (WebGL2), with what separates their materials besides the diffuse
image: material class, plugins, normal/specular/emissive textures, lightmap,
vertex colours, culling, alpha test and texture animation, plus diffuse and
normal-map size and format.

| | dm5 | dm2 |
| --- | ---: | ---: |
| Opaque map draws per frame | 92 | 65 |
| PBR share of draws | 41% | 68% |
| With a normal map | 71% | 78% |
| BC7-compressed diffuse / RGBA8 | 72% / 26% | 99% / 1% |
| Diffuse sizes | 22 | 19 |
| Lightmap textures | 2 | 2 |

Spatial cells are off by default (`r_bsp_cellsize 0`), so each mesh is one
texture (and lightmap group) across the whole map, culled by whole-map bounds
and the union of its PVS clusters; most draw on most frames. Merging meshes of
one material signature, each merged mesh drawn whenever any member is visible:

| Merge | dm5 draws | dm2 draws | Geometry drawn |
| --- | ---: | ---: | ---: |
| None | 92 | 65 | 100% |
| Arrays per diffuse and normal-map size and format | 56 | 31 | up to 103% / 107% |
| All diffuse images resampled to shared sizes | 19 | 10 | up to 107% / 114% |

At the measured 10–12 µs of CPU per world draw on WebGL2, that is about 0.4
or 0.8 ms per frame on dm5, before fewer active-mesh evaluations. A merged
material must reproduce per layer: albedo and normal map (both as arrays),
Babylon's PBR sub-plugins, `BspBakedLighting` with per-texture gloss intensity
and exponent, and the fog and detail-map plugins. BC7 layers need their
compressed mip chains uploaded as array layers, which means reading the source
files again: WebGL2 cannot copy a compressed texture into an array on the GPU.
Animated, alpha-tested, two-sided and vertex-lit surfaces stay separate.

### Texture arrays, step 1: Standard materials

Implemented for Standard materials (`BspSurfaceArrays`, `TextureArrays`,
`BspSurfaceArrayPlugin`; see the BSP manual). Measured in the dm5 and dm2 demos:

| | dm5 WebGL2 | dm5 WebGPU | dm2 both |
| --- | ---: | ---: | ---: |
| Surfaces merged / meshes drawing them | 19 / 8 | 23 / 8 | 7 / 1 |
| Opaque map draws per frame, off → on | 93.2 → 84.7 | 93.3 → 81.9 | 66 → 60 |
| `_renderForCamera` ms/frame, off → on (two pairs) | 4.20 → 3.94, 3.90 → 3.76 | 5.69 → 5.67; the second pair ran under outside load | — |

WebGL2 gains about 0.15–0.25 ms a frame; WebGPU shows nothing measurable,
since render bundles already make each draw cheap there. Paused frames at
three demo points per map, map geometry only (players, weapons and effects
hidden: a powerup glow and other wall-clock effects differ between any two
captures), merging on against off, both backends: every difference is within
the off-against-off noise of separate sessions, and most points are identical.
Four map loads in one session (dm5, dm2, amphi1, dm5) on both backends: no
errors, arrays rebuilt per map, the compressed-upload capture released each
time.

Found while validating: some WebGPU textures report one mip level to Babylon
though their mips were generated, so array shapes read the level count from the
GPU texture; Babylon's material-plugin `!` regex rules see the main shader before
includes are expanded, so the normal is perturbed again from the array in
`CUSTOM_FRAGMENT_UPDATE_DIFFUSE` instead of replacing the sample inside
`bumpFragment`; and Babylon sorts opaque draws by material id, so a merged mesh
draws at its first member's place. A coplanar pair of different textures could
in principle resolve its depth tie differently; no case appeared on either map.

Step 2 is PBR, about 40–70% of opaque map draws: albedo instead of diffuse,
the same normal-map path, and Babylon's PBR sub-plugins in the signature.

## Source audit: useful candidates and existing safeguards

All proposed changes below are conditional on new evidence. Source inspected in
the shared `v1.0.0-alpha7-rendering-improvements` checkout; it is an evolving tree,
not a frozen benchmark revision.

| Area and source | Verified behavior | What to measure before changing it |
| --- | --- | --- |
| [Client main loop](../../src/games/fps/client/main.ts) | Calls `player.update(deltaTime)` before `scene.render()` | Whole frame versus scene instrumentation; scene-only timing misses earlier work |
| [Game frame work](../../src/games/fps/Game.ts) | `processSnapshots()` and `renderRemotePlayers()` coordinate state, actors, effects, spectating, announcer and HUD work | Broad update spans first; descend into expensive children only |
| [V2NetworkClient](../../src/games/fps/client/V2NetworkClient.ts) | Buffered snapshot processing, prediction confirmation fast path, bounded reconciliation replay already exist | Confirmed/reconciled snapshot counts, replayed commands and collision queries versus RTT/loss |
| [InputHistory](../../src/games/fps/client/InputHistory.ts) | Bounded 256-entry Map; `getUnacked()` scans and creates an array; ordered pruning already stops early | History occupancy and allocations per actual reconciliation; a ring buffer is a hypothesis, not a requirement |
| [BinaryProtocol](../../src/shared/net/BinaryProtocol.ts) | Shared entity/event decoding appears in replay samples | Time and allocations per byte/entity/event in live and demo paths separately |
| [FrameEffects](../../src/games/fps/client/FrameEffects.ts) and [GibSystem](../../src/games/fps/client/GibSystem.ts) | Frame updates delegate to loaded effect systems | Empty versus active cost, lifetime scans, physics and collision; visibility registry work belongs to the other agent |
| [RemotePlayerRenderer](../../src/games/fps/client/RemotePlayerRenderer.ts) | Has frame pose-budget logic and a single-entry demo entity-sample memo | Animation/interpolation cost versus actor counts and camera targets; distinguish live snapshots from demo sampling |
| [Scoreboard](../../src/games/fps/client/hud/widgets/Scoreboard.ts) | Input identity guard, layout signature and guarded ping writes already exist | Actual DOM mutations and layout/style time; avoid proposing a redundant full cache |
| [Game standings](../../src/games/fps/Game.ts) | `standing()` memoizes scoreboard/team/spectator inputs | Remaining invalidations and downstream work, rather than assuming a fresh ranking calculation every frame |
| [EventBus](../../src/engine/core/EventBus.ts) | Emits with listeners copy subscriptions and create a once-removal array; optional history adds work | Dispatch frequency and allocation attribution by event; retain listener mutation, recursion, once and error behavior |

Do not reduce authoritative simulation frequency, skip commands or weaken
collision/reconciliation correctness to meet a CPU target. Presentation work can
sometimes follow changed state, active occupancy or a lower visual update rate;
camera motion, aiming, interpolation and timed HUD expiry still need their clocks.

## Fresh measurement plan

### 1. Establish an accepted current replay baseline

Wait for the active renderer changes and competing measurements to finish. Use
a stable source snapshot, exact outer/FPS revisions and recorded media hashes.
A private Vite server with HMR disabled isolates reloads, but does not freeze files
that another agent edits; isolate the source snapshot as well when necessary.

Reuse the validated fixture and profiler described in the
[timedemo guide](../manual/guides/timedemo.md). The launcher and flags are in
[profile-timedemo.mjs](../../src/games/fps/scripts/benchmarks/profile-timedemo.mjs),
and its game command is `benchmark:profile`. Example for the existing local dm5
fixture, after checking that fixture remains compatible:

```powershell
npm --prefix src/games/fps run benchmark:profile -- --fixture wdm5-ffa6-v1-f0615d305875-006f520e --backends webgl2,webgpu --port 3143
npm --prefix src/games/fps run benchmark:profile -- --fixture wdm5-ffa6-v1-f0615d305875-006f520e --backends webgl2,webgpu --port 3143 --timing-only
```

These are **planned commands, not runs performed for this study**. Reserve an
unused port without stopping another agent's server. The profiler takes one run
per requested backend per invocation; repeat timing-only invocations at least
three times for each candidate and baseline. Keep sampling runs for attribution
separate from timing-only comparisons. Alternate baseline/candidate order and
use fresh sessions, identical fixtures, settings, dimensions and hardware.

Accept only complete, valid runs with stable source, correct backend, accepted
camera/outline checks, visible tab, expected bodies/weapons and no playback gaps.
Inspect shader compilation and readiness around slow frames. Separate startup
stalls from steady-state samples. Do not use the full load/warmup CPU profile as
the measured gameplay interval.

### 2. Add workloads that replay cannot cover

| Workload | Question | Evidence needed |
| --- | --- | --- |
| Lobby idle and open/closed menus | Is inactive work consuming CPU? | Main-thread busy time, timers, DOM/layout, process CPU over a fixed interval |
| Live FFA at normal latency | What does prediction add beyond replay? | Snapshot decode, fresh prediction steps, replay steps, collision queries and input latency |
| Same live workload with controlled latency/loss | Does reconciliation amplify CPU or allocations? | ACK backlog, replay distribution, corrections and tail frame times |
| Effects-heavy combat | Which costs grow with action density? | Active projectile/gib/effect counts, physics queries and allocation/GC timeline |
| S&D objective state | Is there mode-specific periodic work? | Objective/audio/HUD spans and idle versus active state |
| Repeated join/leave and demo target changes | Does work accumulate across sessions? | Listener/timer counts, retained heap after collection, idle CPU and transition spikes |
| Dedicated server and bots | What constrains authoritative capacity? | Separate Node process profiles, tick p50/p95/p99, overruns, population and AI settings |

Live and server workloads need a dedicated local setup and repeatable inputs.
Do not present replay numbers as live networking, prediction or bot benchmarks.
Server tick/fuzz scripts validate correctness; passing them does not establish
capacity. Server/browser CPU must be reported separately when sharing a machine.

### 3. Measure both efficiency and frame delivery

Record CPU model, browser/build, backend, graphics profile, frame cap, adapter,
power mode, source/media hashes and competing processes. Report:

- Main-thread sampled busy ms/frame and ms/second at a fixed frame cap, plus
  wall-frame p50/p95/p99 and missed budgets. A faster uncapped loop can keep CPU
  usage high while doing more frames; lower CPU percentage alone is not the goal.
- Disjoint exclusive attribution for totals; inclusive spans for call trees,
  explicitly marked as overlapping. Keep playback and pre-scene work visible.
- Allocation bytes/second, collection frequency and slow-frame correlation from
  a separate allocation/GC investigation. CPU samples alone do not measure bytes.
- Actual DOM writes/layout/style work, not just HUD update call counts.
- Work units: entities/events decoded, input/replay steps, collision queries,
  active effects and actors. This distinguishes doing less work from a quieter
  combat recording.

Prefer broad low-overhead spans/counters before adding per-entity timers. Compare
instrumented and uninstrumented runs to expose observer overhead. Keep browser
performance traces for layout/GC questions separate from the clean timing runs.

## Progress and decision matrix

| ID | Investigation | Backend | Status | Gate before implementation |
| --- | --- | --- | --- | --- |
| R0 | Existing capture triage and source audit | Both | Done, historical leads only | Limitations recorded above |
| R1 | Stable-source replay rebaseline | Both | Initial attribution captured; repeated timing-only baseline pending | Requalify after renderer work; exclude contention/readiness transients |
| R2 | Live prediction/reconciliation baseline | Both | WebGL2 direct and delayed-ack diagnostics captured | Expand population, combat, controlled route and loss/jitter; separate server CPU |
| C1 | Snapshot decode and derived-state allocations | Both | Candidate | Significant measured cost or GC correlation; preserve protocol/demo behavior |
| C2 | Prediction history/replay/collision efficiency | Both | Candidate, high risk | Live evidence, exact simulation equivalence and reconciliation behavior |
| C3 | Idle effects and periodic work scheduling | Both | Constant pickup-source clips settle once and stop; animated sources retained | Headless coverage added; renderer regressions and real-media checks recorded in the focused investigation |
| C4 | HUD invalidation and layout work | Both | Candidate | Measured remaining mutations/layout despite existing caches |
| C5 | Event dispatch allocations | Both | Candidate | High-frequency allocation evidence; preserve nested dispatch semantics |
| C6 | Remote animation/interpolation CPU | Both | Batched ragdoll pose implemented: real-rig parity, unchanged Havok trajectories, about 6× cheaper sync per ragdoll | Skin preparation gate implemented: builds 3.7 → 0.75 per frame. Hidden one-shots measured at about 0.0014 ms/frame: not adopted |
| C7 | Server simulation and bot CPU | Server | Separate track | Reproducible process profiles and fixed gameplay workload |
| C8 | Workers, Wasm or data-oriented batches | Both | Numeric pose boundary and transfer costs investigated; no alternate executor built | Packed JS reference first; substantial batch and end-to-end benefit including integration/latency |
| C9 | Baked authored bone animation | Both | Installed API/source reviewed; 17-clip metadata budget estimated | Offline retargeted bake; CPU sockets, death handoff and every render pass validated |
| C10 | GPU-resident procedural pose generation | WebGPU | Later architecture option; compute/readback constraints documented | Large measured workload, direct palette consumption and independent WebGL2 fallback |

Use workload-specific evidence before choosing a runtime optimization. The focused
cache-animation A/B supports C3 as a first small implementation candidate; larger
changes still need the relevant R1/R2 baseline and parity checks. Choose from
measured costs rather than the order of candidate rows. See the
[animation/physics solutions plan](cpu-animation-physics-solutions-2026-10-27.md)
for the staged implementation and alternate-executor decisions.

Workers should be considered for coarse batches with explicit inputs/outputs.
Moving latency-sensitive prediction or tiny per-frame tasks across a worker
boundary is not an automatic improvement. No new worker architecture is proposed
as a prerequisite for this study.

## Validation and limits of the initial profiling round

Completed: stored-profile review, fresh WebGL2/WebGPU replay attribution, live
WebGL2 prediction probes, source review and documented-command verification.
That initial round added research documentation/evidence; executable probe drafts
stay in ignored `.cache/`. Subsequent implementation validation is recorded in
the focused investigation linked above.

Headless checks run before the browser probes, all passed:

```powershell
npm.cmd --prefix src/games/fps run test:simulation
npm.cmd --prefix src/games/fps run test:physics
npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
npm.cmd --prefix src/games/fps run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'
```

The CPU profile helper's tests were also run:

```powershell
node --test scripts/benchmarks/__tests__/cpu-profile.test.mjs
```

All six analysis tests passed. The first sandboxed invocation was blocked by
`spawn EPERM` before tests executed; the permitted rerun completed successfully.
Document links/fences/whitespace and the extracted evidence's raw-run checksums,
stable-source flags and command counters were checked with Node. The probe's
owned servers, browser and proxy were closed, and ports 3167, 3168, 7796 and 7797
were verified free after capture. Existing user/other-agent services were retained.

The indexed BSP check reported 7,475 faces; movement replay completed 91 ticks.
The headless localStorage warning is expected. No fresh build, full test suite,
Biome gate or manual-site build was run: no runtime/manual-site files changed,
and competing renderer measurements must not be disturbed by those jobs.

Not performed: server/bot CPU profiling, allocation tracing, repeated unprofiled
performance comparisons or runtime changes. No optimization gain is claimed. Implementation
will need targeted tests and the repository's full renderer/network regression
set whenever those systems are touched.
