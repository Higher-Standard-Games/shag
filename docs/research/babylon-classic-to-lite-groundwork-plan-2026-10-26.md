# Current-renderer optimization as groundwork for Babylon Lite

Date: October 26, 2026. Status: first cycle, fixed-scale follow-up and matrix-free experiment validated.
The working WebGL2 and Babylon WebGPU paths remain the reference implementations.

**Use small current-renderer improvements to establish reusable data, ownership
rules and comparison fixtures before building a Lite backend.** This is a useful
sequence even if Lite is never adopted: each landed optimization should either
help the current game measurably or deliver a justified, behavior-preserving
boundary with a real current consumer. Future compatibility alone does not
justify a large abstraction or a slower current renderer.

Read the [capability comparison](babylon-classic-optimization-opportunities-2026-10-26.md)
for installed Babylon 9.31.2 APIs, the [groundwork catalog](babylon-lite-groundwork-catalog-2026-10-26.md)
for extraction contracts, and the [native redesign study](babylon-lite-native-performance-2026-10-26.md)
for later Lite-specific adapters. This plan connects them into reviewable work
packages. Research was committed on `staging` at `c63c14b3`, then the owner
authorized independent implementation through the evidence gates. See the
[first-cycle results](babylon-classic-groundwork-results-2026-10-26.md) for the
changes, exact measurements and retained limits. A Lite migration has not begun.

## Feature branch and progress matrix

Branch: **`v1.0.0-alpha6-renderer-groundwork`**, created from the documentation
checkpoint on `staging` in both engine and FPS repositories. The owner explicitly
chose `staging` as the base for this work. Engine rendering changes belong in
the engine repository; matching FPS branch creation does not require a dummy
game commit or submodule re-pin. Integrate back through `staging`; `main` and its
automatic production deployments are outside this feature setup.

Initial scope: preserve current visible behavior and loading reliability while
measuring small current-renderer improvements. No Babylon package upgrade,
Lite dependency, release/version change or production-media conversion is needed.

Status vocabulary: **Complete** requires linked evidence; **Ready** means the
next work can begin, not that it has passed; **Planned** is unimplemented;
**Conditional** needs a measured reason; **Deferred** is outside the first cycle.
Both current backends benefit from the accepted CPU/data work. WebGPU-only
compute/render-bundle work stays separate; a Lite backend is still future work.
See the [fixed-scale follow-up](babylon-classic-fixed-scale-results-2026-10-26.md)
for the next accepted scope, real-map evidence and comparison commands.

Update the matrix in every implementation commit with actual results, changed
scope, commit/test references and remaining gaps. Never mark headless success as
GPU parity or a lower upload counter as a measured frame-time win.

| Order / package | Status | Concrete deliverable | Evidence recorded / exit requirement | Future Lite value |
| --- | --- | --- | --- | --- |
| Research and API/source planning | Complete | Capability review, actual registration paths, ownership and test plan | Historical research snapshots committed at `c63c14b3` | Versioned design rationale and identified native blockers |
| 1 / P0: baseline and fixtures | Complete — scoped | Matched effect/reference and analytic material fixtures; dm5 demo inventory | Real WebGL2/WebGPU GPU captures; 16 live animation entries inventoried; no whole-game FPS claim | Matched comparison workloads and CPU/visual reference |
| 2 / P3: dirty-slot effect uploads | Complete | Existing Voltaic pool uses one bounded interval per stream | 4,608 → 144 submitted bytes/update for one active world slot; identical images on both backends; real WebGL restoration and headless swap/reuse/disposal checks pass | Logical slot changes independent of native packing |
| 3 / P1: pure shader evaluation | Complete | G2 numeric evaluator behind unchanged classic clock/binding | Seven numeric cases plus wrapper phase/disabled-clock and existing texture tests; no per-frame output-object allocation | Reusable authored stage semantics and sampling oracle |
| 4 / P2: texture-assignment guard | Complete | Skip assignments when the actual bound target already matches | Repeated same-frame updates make zero target setter calls; intervening writer restored; base/emission tests pass | Resource selection separated from texture handles |
| Follow-up / fixed-scale entries | Complete — both backends | Retain frozen materials and skip UV writes while all actual targets match | Standard/PBR: 600 → 0 assignments over 120 frames, identical images on WebGL2/WebGPU; seven real dm5 registrations stay frozen with zero writes across 60 frames; full gates and regressions pass | Actual ownership checks and constant-vs-live behavior before native adoption |
| Follow-up / matrix-free effects | Experiment validated; gameplay adoption deferred | Reproducible isolated source adapter and draw/resource/lifecycle comparison | 18 matched images on WebGL2/WebGPU; four matrix columns, 3,584 CPU bytes and 7,168 GPU bytes removed; forced-draw scene statistics undercount, so the normal renderer is retained | Explicit count, bounds, records and lifecycle contracts without inheriting classic thin storage |
| 5 / P4: GPU single-scroll, then simple RGB wave | Complete — experiment only | Narrow GLSL/WGSL adapter and 60 matched pixel comparisons | Standard/PBR, negative rates/time, later time and frozen candidates pass with at most one channel level difference; gameplay CPU registration retained | One authored plan realized by separate backend sinks |
| 6 / P5: broader analytic stages or shared clock UBO | Deferred by findings | Expand only where a real workload justifies it | dm5 mostly uses fixed scales, rotation, emissive/frame and mixed stages outside the narrow candidate; no evidence for a broad route/UBO change | Avoid premature native packing/binding assumptions |
| Review and integration preparation | Complete — feature branch | Result record, manuals/changelog and regression evidence | Typecheck, build, full tests and required server/map checks passed; docs/gate status recorded in results; no merge/deployment | Trusted bounded reference work before any Lite prototype |
| VAT, graph/culling and worker redesign | Deferred | Separate experiment proposal if baseline/results warrant it | No implementation promised by this first cycle | Later investigations retain their own correctness gates |

Default implementation sequence is **P0 → P3 → P1 → P2 → P4**, then reassess.
P3 is a contained first optimization because the pool, geometry, clocks and
shaders stay intact. P1/P2 need not wait for P3 technically, but separate patches
make attribution and rollback easier. If P0 shows effect uploads are negligible,
record that result and narrow or skip P3 rather than force a speculative win.
Do not make any package a prerequisite merely to fill a progress row.

### Backend coverage and follow-up opportunities

| Optimization | Backend | Decision |
| --- | --- | --- |
| Dirty effect slots, numeric evaluator and frame-assignment guard | WebGL2 + WebGPU | Implemented and validated in the first cycle |
| Unchanged fixed-scale entries | WebGL2 + WebGPU | Narrow follow-up; matched GPU results and shared-wrapper checks recorded |
| Analytic scroll/sine material expressions | WebGL2 + WebGPU | Experiment validated; normal content keeps its existing registration route |
| Analytic rotation/stretch and additional material families | WebGL2 + WebGPU | Conditional; establish pivots, composition, emission and phase semantics first |
| Shared animation-time uniform buffer | WebGL2 + WebGPU | Deferred until a sufficiently large eligible workload exists |
| Shader-selected texture-array frames | WebGL2 + WebGPU | Deferred; dimensions, formats and mip compatibility need an asset plan |
| Matrix-free analytic effect draws | WebGL2 + WebGPU | Experiment validated; gameplay adoption deferred until forced-draw statistics and broader pass coverage are resolved |
| Selective baked skeletal animation | WebGL2 + WebGPU | Later experiment; actor pose, sockets and existing animation LOD are constraints |
| Draw-list/visibility scheduling | WebGL2 + WebGPU | Proposed next after an attributed frame-floor baseline: PVS-driven retained candidates ([review](babylon-renderer-new-paths-2026-10-26.md)); retain existing PVS and batching as the reference |
| Shared main-pass depth for halos and water | WebGPU | Proposed: attribute the post-load sampled/attached depth conflict; interim single union capture |
| Compute/storage-buffer algorithms | WebGPU | Future backend-specific investigation |
| Cached WebGPU render bundles | WebGPU | Existing non-compatibility-mode experiment; no default change |

The owner accepts work-count and correctness evidence without requiring FPS
comparisons on high-end development hardware. Record concrete work removed,
preserve images/lifetimes and identify remaining costs; do not infer a quantified
frame-rate gain from counters. After the fixed-scale follow-up, reassess material
work before choosing the next effect or shader experiment.

The [matrix-free experiment](babylon-classic-matrix-free-effects-2026-10-26.md)
preserves normal gameplay code and records why its successful image/resource
comparison is not sufficient for adoption. Next, inventory the workload and
ownership of additional analytic material families before expanding their GPU
route; do not force the matrix-free prototype into 1.0 through private storage
workarounds.

### First implementation slice

1. Select a representative loaded map plus a controlled effect fixture; record
   exact assets, backend, quality and event/camera sequence. Capture active
   animated materials and effect occupancy before choosing a shader candidate.
2. Use existing `perf` captures and add only the missing diagnostic counters
   needed to isolate effect upload/material update cost. Preserve and dispose
   observers/wrappers; keep diagnostic overhead visible in the results.
3. If the measurements support P3, add logical dirty ranges to existing Voltaic
   streams, preserve their separate beam/impact consumers and retain a full
   refresh path. Validate empty/reused slots, swaps and warmup before GPU checks.
4. Record the first result in this matrix and the acceptance record below.
   Then choose the shader extraction/texture guard slice. Implementation starts
   on the feature branch; this setup commit contains research and planning only.

No new player-facing performance toggle is planned. An isolated comparison
harness may select reference/candidate paths while evaluating an experiment;
only an accepted result becomes the normal implementation. Keep alternatives
out of the settings UI unless they solve a demonstrated product need.

## What would actually carry forward?

| Artifact learned or built on current Babylon | Future Lite reuse | What stays backend-specific |
| --- | --- | --- |
| Authored shader descriptors and a CPU reference evaluator | Same stage meanings, supported subsets and expected samples | GLSL/WGSL code emission, plugin hooks, material binding and pipeline keys |
| Explicit animation-time inputs and reset/phase cases | Same playback/registration semantics and fixture timeline | Scene observer or Lite frame-host wiring; GPU uniform/storage layouts |
| Slot identity, capacity and dirty-range decisions | Same changed logical records and swap-removal behavior | Babylon thin buffers versus Lite vertex/storage buffers and count synchronization |
| Effect seeds, event sequences, bounds intent and reference images | Same visuals tested under both backends | Draw geometry layout, transparency/depth integration and GPU culling |
| Performance fixtures and recorded workload metadata | Matched baseline for a future native experiment | Instrumentation, timer-query availability and native profiler adapters |
| Session/resource lifetime and readiness test cases | Same ownership and observable success/failure outcomes | Babylon texture/material disposal versus Lite GPU retirement and build ownership |

These are contracts and fixtures, not a universal `Mesh`/`Material` facade. Keep
current Babylon objects in current adapters. Do not pass Babylon enum integers,
`Vector3` objects, material plugins or thin-buffer handles as neutral contracts.
Likewise, typed arrays are not automatically a common GPU buffer ABI.

## New source findings that affect the first experiments

### Follow the actual material registration path

In [BspMeshBuilder](../../src/engine/loader/bsp/BspMeshBuilder.ts), the normal
StandardMaterial route defines `registerBaseAnimation` and `registerGlowAnimation`.
The generated PBR route invokes both with its replacement PBR material; the
Standard route also invokes the applicable registrations. Base registration
passes primary-stage tcMods, RGB/alpha generators, frame textures and a selected
diffuse/emissive target to `ShaderAnimationSystem`.

The shine route can clone an additive overlay, disconnect the original emission,
and register the shine material. A logical authored surface therefore does not
always correspond to one material or one stage owner. Registration and disposal
must follow the final material, not the discarded StandardMaterial placeholder.

The special `glow_overlay` factory branch occurs earlier, sets metadata and
continues before those later registrations. Its presence and `needsAnimation`
metadata do not prove it is part of that CPU animation loop. The
[Q3ShaderMaterialFactory](../../src/engine/loader/shader/Q3ShaderMaterialFactory.ts)
comment mentions a complex NodeMaterial route, but its reviewed switch falls
back to StandardMaterial for the default case. An `rg` scan of `src/**/*.ts`
found `Q3NodeMaterialBuilder` only in its own definition, export and comments,
not a direct construction/call. This is a source-scan finding, not proof that
external or computed consumers cannot exist. Do not optimize that builder first
and assume the live scene benefits.

[MD3Loader](../../src/engine/loader/model/MD3Loader.ts) has another current
consumer: it loads stage frames, registers primary/glow targets and attaches
material disposal cleanup. A change to shared stage evaluation must preserve
that consumer even if the first GPU adapter supports only BSP surfaces.

**First GPU fixture candidate:** a confirmed Standard/PBR base registration
with a single scroll, fixed texture, opaque queue and no stateful operations.
Add a separate deterministic RGB wave fixture after the contribution semantics
are proved. Inventory a real loaded map before choosing an asset; no map is
asserted here to exercise that exact subset.

### Keep clocks distinct until their behavior is accepted

[ShaderAnimationSystem](../../src/engine/loader/shader/ShaderAnimationSystem.ts)
uses its own `performance.now` accumulation, time scale and enable flag. A
disabled update returns before sampling `lastTime`. [GameTimer](../../src/engine/core/GameTimer.ts)
has separate pause/speed behavior and caps real delta at 100 ms. They are not
interchangeable time sources. Replacing the shader clock with `GameTimer` would
combine a behavior change with a rendering optimization.

For the first extraction, keep the existing scene observer and clock policy in
`ShaderAnimationSystem`; pass numeric delta/elapsed/RNG into the extracted code.
Document observed disable/resume jumps with fixtures. A later approved clock
correction can change that policy explicitly. A seekable future Lite/demo clock
needs the same explicit decision; it should not inherit a hidden wall clock.

Registration phase also matters. UV state starts at registration, while RGB
waves use the system's accumulated time. GPU scroll cannot simply multiply the
global elapsed time if a material registered midway through the session.

## Proposed file structure: only introduce the next needed boundary

Paths below are relative to `src/engine/` and are **proposals, not created files**.

```text
loader/shader/
  Q3ShaderTypes.ts                    existing authored types; reuse
  Q3StageEvaluation.ts                proposed G2 extraction + stage-plan types
  ShaderAnimationSystem.ts           existing clock/registration/classic binding
  Q3AnalyticAnimationPlugin.ts        proposed narrow GLSL/WGSL adapter
  __tests__/
    Q3StageEvaluation.test.ts         proposed pure reference/phase fixtures
    TextureTransforms.test.ts         existing binding/ownership reference

rendering/
  data/DirtySlotRanges.ts             proposed only when the first pool needs it
  RendererPerformanceCapture.ts       existing metrics; scoped counters if needed

weapon/voltaic/
  VoltaicEffectRenderer.ts            existing slots/presentation and classic sink

test fixtures / isolated diagnostic harness
  authored stage cases + timed effect events + camera/quality/asset metadata
  reusable semantic expectations; separate GPU image references per accepted path
```

Use the catalog's **G2 `Q3StageEvaluation.ts`** as the first canonical module.
The earlier opportunity review sketched a `StageAnimationDescriptor` file and
separate clock; those are optional future splits, not another implementation to
create alongside G2. Keep a small `Q3StagePlan` type with its evaluator until
size or real consumers justify splitting it. Do not start with a new global
surface-clock singleton or a backend interface spanning the entire engine.

## Work packages and decision gates

Each package should be independently reviewable and revertible. The owner
authorized progressing independently through this sequence; evidence determines
whether the next optional scope is justified. Measurements determine
whether an optional optimization expands, remains a diagnostic experiment or
is removed. Shared groundwork can still be useful without a measurable speedup,
but must not be reported as a performance win.

| Package | Current-renderer result | Future Lite groundwork | Boundary / exit evidence |
| --- | --- | --- | --- |
| P0: baseline and behavior record | Identify active material families, effect occupancy and costly updates | Equivalent workload and correctness oracle | Actual registration trace, stable capture procedure and missing counters identified |
| P1: pure shader evaluation | Same CPU behavior through a numeric evaluator, with existing binder retained | Authored stage semantics and time/RNG contract | Headless sample/state parity; no Babylon import in the pure module; no frame-copy/observer growth |
| P2: redundant frame assignment guard | Avoid repeated assignments when the animation still selects the same image | Texture-selection decisions separated from resource handles | Base/emission ownership, registration and multi-stage overrides unchanged |
| P3: sparse Voltaic uploads | Existing pool/shader uses dirty slot intervals | Stable logical changes separated from GPU packing | Swap/count/reuse tests and actual reduced bytes or calls without worse tails |
| P4: narrow GPU map animation | Single-scroll, then deterministic wave in current GLSL/WGSL adapters | One authored plan implemented by CPU reference and GPU sinks | Equivalent images, alpha/lightmap/freeze behavior and accepted CPU/GPU cost |
| P5: measured expansion | Additional analytic operations or shared clock UBO only where worthwhile | Better packing/lifetime experience and broader fixture suite | Same clocks and visuals; bounded compile/resource costs; no prerequisite for Lite |
| Matrix-free effects experiment; VAT, graph/culling and workers deferred | Matrix-free comparison is recorded separately; other higher-risk experiments need their own justification | Native design evidence after smaller contracts are proven | Independent resource/actor/camera/loading gates from the previous studies |

After P0, P1/P2 and P3 are separate implementation tracks; neither needs to be
combined with the other in one patch. P4 depends on the shader semantics and
baseline, not on finishing the effect work. Avoid a long refactor chain before
the first measurable result.

### P0: instrumentation with a bounded scope

Use the existing [PerfCommand](../../src/engine/console/commands/PerfCommand.ts)
and [RendererPerformanceCapture](../../src/engine/rendering/RendererPerformanceCapture.ts).
The developer console can run `shader anim status` after `developer 1`; ordinary
`perf capture 10` and `perf shaders 10` are valid bounded captures. `perf` itself
does not declare a developer gate. These are browser console commands, not
headless shell commands and not a deterministic replay driver by themselves.

The report has p50/p95 renderer metrics; it does not isolate shader-animation
CPU or upload bytes, and its `animationsMs` is Babylon animation instrumentation,
not a proven total for arbitrary before-render callbacks. Add scoped diagnostics
only for the question being tested: entry/stage/family counts, CPU evaluation and
bind time, attempted/changed texture selections, dirty slots/ranges, submitted
bytes/calls and resource counts. Distinguish requested API writes from actual
driver work, because Babylon already has caches.

Keep counters behind a diagnostic capture or an isolated harness. Avoid expensive
per-frame string keys, logs, GL queries or permanent monkey patches that distort
the result. If a diagnostic wraps a binding/upload method, preserve its original
behavior and always restore it on stop, error and scene disposal. Uploaded-byte
accounting is submitted payload size, not measured bus traffic or GPU time.

Record browser/GPU/backend, core version, quality/resolution, assets, fixture seed,
camera timeline, warm/cold state, actor/effect counts and capture coverage. Compare
separate current WebGL2 and WebGPU baselines; record NCM mode if used. GPU timing
may be unavailable. First load, context/device recovery and steady rendering are
different measurements. Repeated matched runs need enough samples to support
the reported percentile; do not manufacture p99 from the existing p95 report.

### P1-P2: keep evaluation and binding separate

Reuse `Q3ShaderTypes` and the existing resolved primary/glow stage data. Preserve
RNG call order, negative modulo behavior, registration-time static scale and
ordered mutable tcMods. The first CPU evaluator returns decisions, not resources.
Use caller-owned state/output in a hot loop instead of allocating a new object
graph for every frame.

```text
// PSEUDOCODE: proposed G2 functions and contracts, not existing APIs.
plan = classifyStage(authoredStage);           // once at registration
state = initializeLegacyStage(plan, initialValues);

onExistingAnimationTick(deltaSeconds, elapsedSeconds, rng) {
  stepStageInto(state, plan, { deltaSeconds, elapsedSeconds, rng }, output);
  applyToExistingClassicStage(output);        // Babylon handles stay here
}

// A later Lite sink consumes the same plan/time contract or numeric decisions.
// It does not call this classic binder or copy its texture/material handles.
```

The P2 guard must compare the **actual currently bound target**, not only a
stage's cached frame index. Several stages/registrations may write a material
property. Skipping a write because "my index did not change" can miss another
stage's intervening write and change the final image. Preserve original order
and last-writer behavior first; claiming a target for one owner is a separate
registration-policy change. Also preserve the StandardMaterial special emissive
texture-level modulation versus PBR's color multiplication.

Fixtures: two successive ticks in one frame interval, a frame transition/wrap,
registration after elapsed time, base plus emissive textures, shared texture
wrappers, multiple writers, dispose/unregister, clear/rejoin and time-scale
changes. Do not redefine currently unusual behavior during a mechanical split.

### P3: dirty slots are a data decision, uploads are an adapter decision

[VoltaicEffectRenderer](../../src/engine/weapon/voltaic/VoltaicEffectRenderer.ts)
already distinguishes beam and impact dirty streams. Dynamic muzzle-anchor
refresh only dirties the beam start stream; impacts use its unchanged seed.
Preserve that optimization and existing position epsilon. Upsert and swap-removal
mark all relevant streams; interval tracking must cover each consumer's payload.

Define ranges as logical **half-open slot intervals `[first, end)`**, with bounds
and capacity checked by the pool. Keep stride, float/byte offsets and alignment
out of the generic range module. A classic numeric partial update uses element
count/index; a future Lite sink packs ranges according to its actual buffer
layout and alignment. The classic count setter and Lite count-only setter have
different invariants; do not put either behind a falsely identical neutral API.

```text
// PSEUDOCODE: application-owned records/ranges; exact Classic API shown.
onSlotChanged(stream, slot) {
  writeAuthoritativeCpuPayload(stream, slot);
  stream.dirty.mark(slot, slot + 1);
}
flushClassic(stream, mesh, attributeName) {
  for (const range of stream.dirty.coalescedRanges()) {
    mesh.thinInstancePartialBufferUpdate(attributeName,
      range.end - range.first, range.first);   // numeric overload: slots, not bytes
  }
  clearRangesAfterSuccessfulSubmission(stream);
}
```

That sketch omits multi-consumer ownership: a stream used by two draws cannot
clear shared dirtiness after only the first draw's submission. Use per-sink
dirty state or commit after all required sinks succeed. "Submitted" does not
mean GPU-completed; context/device loss still follows session recovery rules.

For swap-removal, update the moved entity's id-to-slot mapping and all copied
payloads at the destination. Tail removal may require only a draw-count change;
removal to empty must suppress draws, and a subsequent spawn must dirty reused
slots. Preserve least-recently-touched eviction and seed/counter behavior.
Keep an updatable full-refresh path for restoration and high-occupancy/scattered
changes. Measure coalescing versus whole active/capacity updates; no fixed
range-count threshold is justified before the workload is known.

Extend the existing [Voltaic tests](../../src/engine/weapon/__tests__/VoltaicEffectRenderer.test.ts)
with meaningful upload-range/state assertions. Test actual adapter offsets in
headless mode where possible, then real GPU draws. Future Lite can use the same
semantic event/slot fixture, with different expected upload layout.

### P4-P5: one authored plan, several implementations

First accepted subset: one scroll, fixed image, known texture-space composition,
opaque state, supported material family. CPU oracle and GLSL/WGSL expressions
consume the same rate and registration-phase meaning. Do not classify arbitrary
ordered tcMod sequences as analytic just because every individual operation
looks simple. An authored transform can overwrite accumulated state.

Keep CPU stateful stages active; support mixed materials without evaluating a
stage on both CPU and GPU. A classification record should include route and
fallback reason. Unknown combinations keep the classic route rather than silently
dropping features. Route selection is load-time/registration-time work, not a
new program decision on every frame.

Use the same accepted time policy for both comparison modes. Phase rebasing for
long sessions must maintain continuity. Stateless RGB waves can be added with
exact modulation position and clamp behavior. Opacity waves, turbulence, noise,
texture arrays and complete arbitrary tcMod composition stay outside the first
subset. Alpha queues, UV2 lightmaps, texture orientation, negative rates, frozen
material binding and per-camera values are part of the pixel fixture.

Create plugins/defines before relevant shader compilation/readiness. The existing
[MapLoader](../../src/engine/loader/map/MapLoader.ts) warms effects and then waits
for scene GPU readiness before reflection work; a new map-material variant must
participate in that readiness path. Do not move a required compile to the first
interactive draw, weaken timeouts or recompile per time value to make a benchmark
look faster. Rejoin/cancellation/disposal and background/resume remain acceptance
cases because startup reliability is part of this project's purpose.

Start with the simplest correct time binding. Shared UBOs can reduce repeated
data uploads, but resource/layout/frozen-bind complexity may exceed savings for
a few materials. Keep native data packing out of the authored plan. The Lite
adapter later implements that plan using native shader layouts, without an
existing Babylon plugin as a dependency.

## Acceptance record for each implemented package

Keep a short research result alongside its patch, with these fields:

1. Exact source revision, changed files and supported feature subset.
2. Why this live path matters: measured occupancy/counts and baseline cost.
3. Preserved semantics and separately accepted behavior changes, if any.
4. Headless checks and GPU image/lifecycle fixtures with actual outcomes.
5. Matched before/after CPU, GPU, uploads, frame tails, loading and memory data;
   include missing measurements and diagnostic overhead.
6. Reusable outputs and backend-specific code that should not be shared.
7. Decision: land as a measured improvement, retain as justified groundwork,
   narrow the experiment, or discard it. A counter reduction alone is insufficient.

Set acceptance criteria from baseline variability before selecting a winner;
do not invent a universal speedup target. Preserve enough metadata to compare
classic WebGPU with Lite later. Correctness comes first, then meaningful runtime
or maintenance value, then breadth of future applicability.

## What to defer

Defer a full renderer facade, a FrameGraph rewrite, universal clock replacement,
global array-texture conversion, whole-engine OffscreenCanvas migration and a
new GPU particle system. None is required to learn from the initial work.
Matrix-free analytic draws and selective baked animation remain useful isolated
experiments, but both have larger shader/pose/lifetime gates. Native Lite's actor
factory, layered materials and non-abortable build ownership are still unresolved
even after successful classic optimizations. This plan does not declare those
blockers solved.

The first cycle completed P0/P3/P1/P2 and the bounded P4 experiment. P5 was
evaluated and deferred, rather than broadening normal material selection without
an eligible measured workload. No broad rendering architecture change was
needed. Future proposals should use the results record and name the additional
real content/cost they address before expanding the route.

## Validation scope

This documentation pass checks source facts, links, evidence snapshots and the
manual build. It does not execute proposed optimizations or prove a speedup.
The extended installed-version evidence retains selected source/API hashes;
source scans are not exhaustive runtime reachability proofs.

For a future runtime patch, the repository's regression procedure requires the
following commands from the outer root, in addition to focused tests:

```powershell
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build
npm.cmd --prefix src/games/fps run test:simulation
npm.cmd --prefix src/games/fps run test:physics
npm.cmd --prefix src/games/fps run server:tick
npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000
npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
```

Those gameplay scripts live in the FPS package. These are **future validation
requirements**, not commands claimed as run for this research. Headless checks
precede GPU/browser verification. Current manual/changelog changes accompany
any implemented visible behavior. Preserve indexed asset loading and release
media; this plan requires no changes to production `public/data/`.

### Completed documentation checks

Exact files changed in this round:

- `docs/research/babylon-classic-to-lite-groundwork-plan-2026-10-26.md`
- `docs/research/babylon-classic-optimization-opportunities-2026-10-26.md`
- `docs/research/babylon-lite-groundwork-catalog-2026-10-26.md`
- `docs/research/babylon-lite-native-performance-2026-10-26.md`
- `docs/research/babylon-lite-renderer-investigation-2026-10-25.md`
- `docs/research/babylon-lite-evidence/audit-current-renderers.mjs`
- `docs/research/babylon-lite-evidence/current-renderer-summary-2026-10-26.json`
- `docs/changelog/v1.0.0-alpha.6.md`

Commands actually run for this documentation pass:

```powershell
node --check docs/research/babylon-lite-evidence/audit-current-renderers.mjs
node docs/research/babylon-lite-evidence/audit-current-renderers.mjs
node .cache/babylon-lite-research/validate-api-plan.mjs
npm.cmd run docs:build
npm.cmd run gate:biome
git diff --check
```

All passed. The evidence producer records 24 installed-package files and now
29 reviewed SHAG owners; the regenerated current-renderer snapshot matched.
Combined checks covered nine research documents and 110 relative links, balanced
fences, whitespace, source hashes and the existing 20 distinct published-native
pseudocode export names. The cached combined validator is a local research
helper, not a project test command. Manual build passed; Biome remained at its
existing baseline of 0 errors and 47 warnings. No runtime optimization, GPU
fixture or performance claim has been validated by these documentation checks.
