# Babylon Lite: native redesigns worth measuring

Date: October 26, 2026. Status: source investigation and proposed experiments.
No renderer, media, dependency or application code changes are included.

This extends the [API audit](babylon-lite-api-coverage-2026-10-26.md) and
[integration sketch](babylon-lite-integration-sketch-2026-10-26.md). The question
here is which SHAG responsibilities could use native Lite designs to avoid
work, rather than reproduce every classic Babylon object behind a wrapper.
All performance benefits below are hypotheses; none has been measured in SHAG.

**Most of these algorithms are also possible in the existing Babylon renderers.**
The [current-renderer opportunity review](babylon-classic-optimization-opportunities-2026-10-26.md)
compares each route against installed Babylon 9.31.2, including WebGL2 shader
animation, partial instance uploads, baked animation and FrameGraph. Read it
before treating an optimization here as a reason to wait for Lite. General
compute and render bundles need WebGPU, which classic Babylon also provides.

The [staged current-to-Lite groundwork plan](babylon-classic-to-lite-groundwork-plan-2026-10-26.md)
defines how to gather that experience: baseline the live path, extract accepted
semantics, improve small current adapters and retain fixtures/data contracts for
later native experiments. Successful classic work does not close native
integration blockers automatically.

## Evidence and interpretation

Native implementation reads target the **published `@babylonjs/lite@1.36.0`**,
git head `5241e29f5a88ff23534a11d3114ac8ea983c5961`. The API audit's
[reproducible evidence](babylon-lite-evidence/published-api-summary-2026-10-26.json)
records package integrity, exported-name probes and selected implementation
hashes. Do not silently substitute later master behavior. Primary source entry
points are the [pinned upstream tree](https://github.com/BabylonJS/Babylon-Lite/tree/5241e29f5a88ff23534a11d3114ac8ea983c5961)
and [published package files](https://unpkg.com/@babylonjs/lite@1.36.0/?meta).
Shipped implementation paths in this document are relative to that package.

SHAG references below identify actual source owners. Proposed files are additions
under the isolated Lite paths from the migration map; they are not requests to
change the working WebGL or Babylon WebGPU paths. `Native.*` in pseudocode denotes
a checked published export. Other names and all algorithms are proposed SHAG
contracts. The sketches are incomplete and not runnable code.

The reference renderer must retain existing PVS/lightmap batching, analytic
effects, animation LOD, cached reflections and weapon-camera optimizations where
supported. Reducing image quality, omitting gameplay effects or comparing against
an unoptimized reference would answer a different question.

## Candidate transformations

| Existing owner | Native candidate | Work potentially avoided | New responsibility or risk |
| --- | --- | --- | --- |
| BSP mesh construction, PVS and `WeaponCameraCandidates` | Stable explicit task lists, material/spatial cohorts and deliberate bundle lifetime | Held-view traversal of unrelated world objects; unnecessary binding-list rebuilds | More cohorts mean more draws; visibility still invalidates bundles |
| Repeated rigid pickups/props | Fixed-capacity thin pools, optionally native hierarchy pools | Per-object wrappers and repeated draw setup | Entity-to-slot identity, hierarchy cost, count changes and culling bounds |
| `VoltaicEffectRenderer`, `ExplosionBatchRenderer` | Raw render draws with custom instance/storage payloads | Unused identity-matrix attributes; broad dirty-stream uploads | WGSL layout, transparency, depth, multi-view and bounds maintenance |
| `PlayerModelManager` | Native pose scheduling; selective baked bone-matrix animation | CPU pose evaluation/uploads for suitable distant actors | Memory, procedural aim, attachments, seek, independent instances |
| Material/Quake surface compilation | Stable native material recipes with separate static and dynamic data | Repeated pipeline/define creation and unchanged parameter writes | Layered lightmap/tcMod composition remains an unresolved proof |
| Water/depth/held-view rendering | Explicit owned render products and due-only capture tasks | Global scene mutation during captures; accidental duplicate products | Camera, format, size, samples, lighting and disposal dependencies |
| Pure parsing/mesh preparation | Bounded worker jobs plus a dependency-aware load schedule | Main-thread stalls and independent work serialized unnecessarily | Transfer ownership, memory peaks, cancellation and stale results |
| Optional large effect/instance workloads | GPU culling, native LOD buckets or compute/indirect draws | CPU filtering/compaction at sufficiently large counts | Dispatch and synchronization overhead can exceed savings |

## 1. Stable render work, with explicit invalidation

Source owners: [spatial batching](../../src/engine/loader/bsp/mesh/spatialBatching.ts),
[weapon camera candidates](../../src/engine/rendering/WeaponCameraCandidates.ts).
Native evidence: `lib/frame-graph/render-task-base.js`,
`lib/frame-graph/render-task-transaction.js`, `lib/scene/visibility.js`.

Use separate world and held-view task lists. `createRenderTask` accepts
`autoMirror: false`; `addMeshToTask` supplies membership explicitly. Keep a small
held list rather than letting a second camera mirror all scene renderables.
Capture lists should contain exactly their static-world inputs. Registration
belongs to load/topology changes, not the frame loop.

This is not a promise of zero per-frame work. The shipped render-task loop
visits opaque, direct and transparent bindings' optional update callbacks before
draw-time visibility checks. Individual callbacks may have their own guards.
`setMeshVisible` also sets descendant visibility and bumps a global visibility
epoch when a flag changes; cached opaque bundles observe that epoch. Calling a
setter with the same value does nothing, but genuine PVS transitions can cause
bundle re-recording across tasks. Several changes before a frame are not proof
of a separate rebuild per call, nor of no rebuild at all.

Proposed experiment variants:

1. Whole-world explicit list plus existing PVS flags: simplest correct baseline.
2. Stable material/spatial cohorts, changing visibility only on actual PVS-set
   transitions. Measure global bundle invalidation and binding callback visits.
3. Different partition sizes, then optional GPU culling for suitable instances.
   Do not rebuild the graph every camera movement or invent a public batch
   visibility API absent from the pinned package.

SHAG's spatial batching experiment assigns whole faces by bounds-center cell;
it does not clip triangles to cells. Its normalized default cell size is zero
(disabled). Preserve face/lightmap/PVS membership and use actual union bounds,
not cell bounds, when testing native batches. A single enormous material batch
may save draws while destroying useful culling.

Proposed file: `rendering/lite/world/LiteWorldDrawSet.ts`. It owns persistent
membership, PVS transition application and diagnostic counters. Geometry,
material and texture owners retain their resources; a task list is not a second
resource cache.

```text
class LiteWorldDrawSet {                       // proposed
  build(engine, scene, worldTarget, worldCamera, cohorts) {
    this.task = Native.createRenderTask({
      name: "world", rt: worldTarget, cam: worldCamera, autoMirror: false
    }, engine, scene);
    for (const cohort of cohorts) Native.addMeshToTask(this.task, cohort.mesh);
    // Session owner registers graph execution and owns task/target cleanup.
  }
  applyPvs(nextSet) {
    for (const change of diffVisibility(this.previousSet, nextSet))
      Native.setMeshVisible(change.mesh, change.visible);
    this.previousSet = nextSet;
    // Count changes and measure bundle invalidation; hidden is not free.
  }
}
```

Acceptance: identical PVS behavior, held FOV and overlays; fewer relevant binding
visits or lower render CPU time; stable resource counts over map switches. Reject
partitioning that improves a draw counter but worsens frame tails or GPU time.

## 2. Rigid pools: useful native APIs with count-update traps

Native evidence: `lib/mesh/thin-instance.js`, `lib/mesh/thin-instance-gpu.js`,
`lib/mesh/hierarchy-instance-pool.js`. Relevant APIs are `setThinInstances`,
`setThinInstanceMatrix`, `setThinInstanceDrawCount`,
`enableThinInstanceDynamicDrawCount` and `createHierarchyInstancePool`.

For repeated rigid geometry, allocate capacity once behind the loading screen,
keep a stable entity-id/slot map and update only changed transforms/colors.
Separate pools where material, visibility cohort, animation behavior or sorting
actually differs. Do not combine independently animated player rigs into a
rigid hierarchy pool.

The distinction between native setters matters:

| Operation in the shipped implementation | Consequence for the proposed pool |
| --- | --- |
| `setThinInstances` replaces capacity/data and dirties the active range | Use for setup, not every frame |
| `setThinInstanceMatrix` extends one min/max dirty span | Two distant slot changes can upload the intervening range; not a disjoint-range tracker |
| `setThinInstanceCount` dirties the entire active matrix range | Convenience count updates can erase sparse-upload savings |
| `setThinInstanceDrawCount` changes count without dirtying matrices/colors | Requires existing synchronized GPU buffers and versions; throws if the pool is dirty when count changes |
| `enableThinInstanceDynamicDrawCount` arranges indirect arguments at normal sync | Enable before registration/warmup to absorb first-transition bundle invalidation |
| Hierarchy pool count changes use `setThinInstanceCount` for descendant bindings | Convenient native hierarchy batching still incurs full active-range dirtiness on count changes |

Hierarchy pools snapshot descendant transforms and expand a root transform into
each child mesh's matrix pool. One pooled hierarchy is not automatically one
draw: its constituent meshes/materials/passes remain relevant. Compare native
hierarchy convenience with flat pools before selecting either.

Proposed file: `rendering/lite/instances/LiteRigidPool.ts`. Begin with the
conservative count setter and measure it. A count-only optimization needs a
proved schedule: establish and synchronize full capacity before exposing the
pool, validate integer count bounds, publish count while versions are clean,
then mark newly exposed or moved slots before the next draw. Never illustrate
the unsafe order "dirty a matrix, then call count-only". Multiple mutations
within one frame should be consolidated into one commit; a pending dirty frame
needs a conservative fallback or a separately proved synchronization boundary.

Acceptance fixture: spawn/remove/swap slots, change count and transform together,
hide/show, exceed planned capacity, change camera and resize. Verify entity
identity for picking, demo reconstruction and effects after swap-removal. Log
actual uploaded bytes and allocations, including hierarchy descendants.

## 3. Custom effect payloads instead of dummy transforms

Source owners: [Voltaic batches](../../src/engine/weapon/voltaic/VoltaicEffectRenderer.ts),
[explosion layers](../../src/engine/weapon/explosion/ExplosionBatchRenderer.ts).
These are already batched, analytically animated GPU effects. Preserve that
design and its hero/remote distinctions; do not replace it with individual
particle objects or a per-particle CPU simulation.

Voltaic supplies a static identity matrix stream (16 floats per slot), four
custom vec4 streams and an extra normal vec4 for impacts. Its dirty mask selects
whole attribute streams for `thinInstanceBufferUpdated`; swap-removal marks all
streams dirty. Explosion layers similarly write spawn data and animate from
time, with slot movement at expiry. These are specific places to test a more
direct data layout.

Native high-level thin instances support matrix/color, not our arbitrary named
streams. Use the lower-level `RenderShader`/`RenderDraw` route already identified
in the API audit. Two experiments are plausible:

- Explicit instance vertex layouts containing only payload the WGSL consumes.
  Removing an unused float32 identity matrix avoids a **64-byte per-slot stream**
  and its allocation/vertex input, not necessarily 64 bytes of upload every frame:
  the existing matrix stream is static.
- A storage-buffer payload indexed by instance id, with explicit dirty byte
  intervals. This can share spawn records across beam/impact draws, but storage
  fetches, alignment and shader complexity may offset the benefit. Compare both.

Retain bounded slots, source event seeds, effect lifetime and the same game/demo
clock. Endpoint changes for a live beam still require writes. Expiry and
swap-removal must update every affected record and its stable-id mapping.
Coalesce nearby dirty ranges when extra write calls cost more than a modest
over-upload. GPU culling must include beam endpoints and shader displacement,
not only the base quad's bounds.

Proposed files: `rendering/lite/effects/LiteAnalyticBatch.ts` and per-family
WGSL modules. Semantic extraction candidates remain in the groundwork catalog.

```text
class LiteAnalyticBatch {                     // proposed; storage variant
  initialize(engine, byteCapacity) {
    this.engine = engine;
    this.buffer = Native.createStorageBuffer(engine, byteCapacity, "effect-slots");
    // Fixed geometry, WGSL/bindings, draws and buffer disposal are separate owners.
  }
  apply(event) {
    updateBoundedSlotsAndStableIds(event);     // spawn/change/expire, no frame objects
    markChangedByteIntervals(event);           // include swap destination
  }
  flush(clock) {
    for (const span of coalesceAlignedDirtyIntervals())
      Native.updateStorageBufferRange(this.engine, this.buffer, span.bytes, span.offset);
    publishEffectClock(clock);                 // same playback/simulation time
    publishDrawCountsAndBounds();              // proposed, raw draw path
    clearDirtyIntervalsAfterSuccessfulWrites();
  }
}
```

Acceptance: visually equivalent beams/impacts/explosions from local, spectated
and demo views; world-depth intersection; transparency ordering; no per-frame
allocation growth. Measure attribute/storage bytes, write calls, CPU time and
GPU vertex time independently. Fewer bytes alone do not establish faster frames.

## 4. Native animation: selective baking rather than universal replacement

Source owner: [PlayerModelManager](../../src/engine/animation/PlayerModelManager.ts).
SHAG already pauses hidden animation and steps distant poses on a reduced
schedule while maintaining phase and overriding LOD for relevant one-shots.
Compare native animation against this behavior, not every actor evaluating
every pose every frame. Preserve one simulation/demo clock and root-motion rules.

The native alternative is more capable than a simple "no attachment" dead end:
`prepareVat`/`prepareVatMany` evaluate clips on CPU without creating a GPU
texture; `createVatBakeResult(s)` upload prepared data. `attachVat` then replaces
live skeleton updates for that mesh with baked bone-matrix sampling. This is
bone-matrix VAT, not a full baked vertex-position texture. Native evidence:
`lib/vat/vat-baker.js` and published `VatHandle`/`VatBakeOptions` declarations.

`VatHandle.setInstancesBlend` accepts two clips per instance (eight floats,
32 bytes), with blend weight and clip rates. Clip B reuses A's time offset. This
offers a gait crossfade path, not arbitrary independent layer timing or a full
replacement for SHAG's aim/recoil/additive/procedural bone stack. The setter
uploads the supplied parameter array; fine-grained updates are not implied.
The native `setVatInstanceStorage` and `setVatTime` exports offer a custom-material
route for shared authoritative animation data used by derived mesh passes;
they still require a verified storage layout and matching shaders.

Requested bone origins and skinning matrices can also be captured during bake.
Origins are in skin-output space; world position needs instance and mesh world
transforms. A captured skinning matrix is not automatically a joint's attachment
transform: inverse bind pose, authored prop coordinates, interpolation and clip
blend must agree. That creates an investigation route for weapons/sockets, not
an already working SHAG attachment solution. Independent actor construction is
still an open blocker from the integration sketch.

Memory is a major tradeoff. The shipped bake uses a `rgba32float` texture of
width `4 * boneCount` and height `frameCount`: **64 * bones * frames bytes** of
raw texel data, excluding overhead and any retained CPU copy. A hypothetical
65-bone, 600-frame bake is 2,496,000 bytes (about 2.38 MiB) before optional socket
captures, geometry, other skins and instance parameters. These are illustrative
counts, not a measurement of a SHAG character. Captured origins add 12 bytes
per requested bone/frame; matrices add 64. The sibling upload helper can share
byte-identical payload textures within its upload call; it is not evidence of
a global persistent bake cache.
Check texture dimensions against the chosen device limits before upload and
budget all clip rows and sibling meshes. Retiring prepared CPU arrays after
successful upload can reduce retained memory only if no cache, socket sampler
or pending job still owns them. Allocation and disposal need explicit owners.

Proposed files: `rendering/lite/actors/LiteActorPoseScheduler.ts`,
`LiteBakedActorPool.ts`, and a future isolated asset-preparation tool. Begin with
live native rigs and the existing pose-budget decisions. Test baked rendering
only for actor categories whose complete visible behavior it can represent.
Keep local held weapons, close watched actors and procedural poses on the live
route until parity is proved. Avoid representation changes every frame; any
switch needs phase, transform, attachment and resource ownership continuity.

Offline prepared payloads could move bake cost out of joining a match. A future
sidecar must key the exact source asset/clip hashes, skeleton mapping, bake rate,
coordinate convention, captures and algorithm version. Load it through the
indexed asset service. Do not mutate release media or make a game load depend
on an experimental bake. Preparation needs a disposable loaded rig, not a
gameplay rig being posed concurrently.

Acceptance: two independent actors with different clips/phases, crossfade,
weapon attachments, team tint, shadows/depth/outline and repeated disposal.
Demo seek, pause, rewind and target switching must reconstruct absolute phase.
Report CPU pose time saved, GPU sampling cost, bake/load time and peak memory.

## 5. Materials and render products: share work at the correct boundary

Source owners: [material pattern routing](../../src/engine/loader/shader/Q3ShaderMaterialFactory.ts),
[animated stages](../../src/engine/loader/shader/ShaderAnimationSystem.ts),
[frozen world material invalidation](../../src/engine/rendering/FrozenWorldMaterials.ts).
Classic world materials already avoid repeated work through freezing, with a
scene-state signature to refresh affected materials when lighting changes.
The reference must retain that optimization.

Material recipes should distinguish pipeline features (vertex layout,
blend/depth state, shader composition and target signature) from dynamic values
(time, tcMod state, tint, effect parameters). Cache by content/feature identity
and keep mutable values with explicit versions. Audit the chosen native
material's actual upload behavior before claiming that an unchanged SHAG value
avoids a native write. Render-task scene uniforms and optional binding update
callbacks still run; a recipe cache alone does not eliminate them.

The layered Quake/lightmap route remains a proof task. A faster opaque PBR demo
without our lightmap, water, transparency and animated shader semantics is not
a comparable renderer. Avoid per-actor material clones where native instance
data represents the difference, but preserve ordering and shared-texture
ownership. Stable topology matters more than wrapping every setter.

### A specific native rewrite: time-driven map shaders

`ShaderAnimationSystem` has a centralized observer, but its registered material
entries still run per frame: animated entries are unfrozen, frame textures are
selected, UV state is updated, and wave color/alpha values are written. It uses
an accumulated `performance.now` clock and scale. A native surface compiler
could put immutable stage parameters in a recipe and evaluate simple periodic
functions in WGSL from one shared clock, rather than mirror these mutations.
This is an alternative for those animated-stage paths, not evidence that every
SHAG custom material does its animation on the CPU.

| Stage operation | Candidate native representation | Required distinction |
| --- | --- | --- |
| Constant scale/transform | Precomputed UV coefficients in immutable stage data | Preserve compressed-texture orientation, UV2 lightmap separation and transform order |
| Scroll/rotate | Initial phase, rate and bounded shared time in WGSL | Match wrapping, pause/resume and long-session precision; initialize to the same phase |
| Deterministic wave color/alpha/stretch | Recipe coefficients and shader evaluation | Preserve clamp/order/negative-phase behavior; evaluate per vertex or fragment only as needed |
| Animated texture frames | Shader-selected array layer when assets are compatible | Dimensions, format, mip/sampler state and asset ownership must match; otherwise update bindings only on frame-index changes |
| Turbulence/noise | Retain a small CPU state path until semantics are decided | Existing turbulence integrates offsets using delta time; noise calls `Math.random` per evaluation |

Do not replace integrated turbulence with a pure sine offset or per-evaluation
randomness with a seeded time hash and label it an equivalent port. Those may
be worthwhile separate behavior changes, but need explicit acceptance. Likewise,
the existing affine-transform adapter approximates shear through decomposition;
an exact native UV matrix can change the image and needs its own comparison.

Proposed file: `rendering/lite/materials/LiteAnimatedStageCompiler.ts`, fed by
the catalog's extracted stage/sampling data. It classifies analytic and stateful
stages once at load. One proposed `LiteSurfaceClock` publishes time; stateful
stages retain bounded CPU records. Use a session-clock contract explicitly
covering demo seek and backgrounding rather than accidentally running two time
sources. No new native method is implied by these class names.

Moving arithmetic into a heavily overdrawn fragment shader can cost more than
updating a few CPU materials. Benchmark animated-material count, parameter and
binding writes, CPU update time and GPU pass time. Start with static/analytic
operations and use an equal-image fixture; keep the conservative CPU adapter
available in the isolated experiment for operations without a proved mapping.

### Captures and depth products

Source owners: [WaterProbeCache](../../src/engine/rendering/water/WaterProbeCache.ts),
[MapLoader](../../src/engine/loader/map/MapLoader.ts). Room cubemaps are already
budgeted cached captures, including six static-world renders, rather than live
six-face work every frame. A native capture task can use explicit static lists
instead of temporarily enabling world meshes and excluding transient lights
through scene mutation. The benefit is narrower ownership and predictable
invalidation, not inventing reflection caching that SHAG already has.

Proposed file: `rendering/lite/captures/LiteCaptureScheduler.ts`. Each capture
records geometry/material/lighting revision and output signature. Execute only
when invalid or deliberately scheduled. Mandatory warmup captures must finish
before declaring load success. Ambient sky lighting precedes water/cubemap
capture in SHAG because wrong ordering caches black results; parallelizing that
dependency would be a regression.

Depth products may be shared only when projection, viewport, size, sample
count, format and lifetime match. World and held cameras have different
projection/depth needs. Explicit tasks do not make those interchangeable.
Prevent read/write feedback loops by declaring distinct sampled and attached
resources with their ownership and resize order, as in the integration sketch.

## 6. Workers and GPU-driven work: choose the expensive stage first

Pure BSP/MD3 parsing, patch construction, visibility preprocessing and pixel
work are worker candidates after the catalog's data contracts exist. Transfer
owned arrays once rather than converting objects every frame. Do not detach
cached arrays still used by the classic adapter, and cap concurrent work to
bound peak decoded/upload memory. Worker results need load-generation identity
and deterministic cleanup when the originating map load is cancelled.

Overlap independent package/decode/geometry work through the loading dependency
graph. A bounded CPU queue and GPU preparation budget are preferable to launching
everything at once. Shader preparation still needs the correct device,
materials, vertex variants and targets. A worker does not automatically solve a
GPU-driver stall, missing readiness signal or stale load completion. Whole-engine
OffscreenCanvas migration is a separate project with input/UI/device-lifecycle
costs, not a prerequisite for Lite.

Lite also has native compute tasks, indirect draw support, opt-in thin-instance
GPU frustum culling and near/far LOD partners. They are experiment routes for
large pools, not a requirement to convert modest analytic effects to compute.
GPU culling can reduce rendered instance/vertex work under the relevant workload;
it does not by itself remove every host-side update callback or upload.
Maintain entity-id/source-index identity through compaction and camera-specific
buckets, including capture/held/shadow tasks. Include shader displacement in bounds.

Proposed order: direct fixed analytic draws, then measure; compare native
frustum culling/LOD on large rigid pools; add custom compute only if a measured
CPU stage dominates and the dispatch/readback-free design saves more than it
costs. Keep gameplay collision, hit authority and demo state on their existing
deterministic path. No GPU visibility result should drive authoritative rules.

## Proposed experiment order and file ownership

These are optional future experiments after the integration plan's correctness
gates, not a new implementation commitment or permission to modify classic code.

| Order | Proposed addition | Main question | Stop condition |
| --- | --- | --- | --- |
| 1 | `experiments/lite-viewer/` diagnostics and explicit world/held fixtures | Is render CPU submission actually the bottleneck, with equal images? | Missing features invalidate timing comparison |
| 2 | `rendering/lite/world/LiteWorldDrawSet.ts` and instance pool fixture | Which draw/culling partition reduces total frame tails? | Global invalidation or extra draws erase gains |
| 3 | `rendering/lite/effects/LiteAnalyticBatch.ts` plus WGSL | Does payload/range specialization beat existing analytic batches? | Storage fetch/write overhead outweighs savings |
| 4 | Native material recipe and capture scheduler owners | Can equivalent materials/passes stay stable and readiness be explicit? | Layered/depth/lifecycle correctness fails |
| 5 | Actor scheduler, then isolated baked-actor fixture | Does selective VAT help beyond existing animation LOD? | Pose/attachment parity, memory or instancing independence fails |
| 6 | Bounded worker preparation and optional compute variants | Which preparation/simulation stage remains expensive? | Copying, memory peaks or dispatch overhead dominate |

Existing source changes, when separately authorized, should be small pure-data
extractions listed in the groundwork catalog, followed by adapters preserving
classic behavior. New native owners use those data boundaries; they do not
expand one cross-backend scene facade with hundreds of Babylon-shaped methods.

## Measurements required for a useful result

Record renderer/package revision, browser/GPU/device limits, fixture seed,
camera route, quality/resolution, asset hashes and workload counts. Compare
classic WebGL, classic WebGPU and native Lite separately with the same visible
features. Report isolated native timings and integrated adapter overhead; both
matter. Browser/driver variation is a test dimension, not a backend win.

| Metric | Why it matters |
| --- | --- |
| Total frame CPU and render submission CPU, p50/p95/p99 | Shows whether wrapper/traversal savings affect actual responsiveness |
| GPU task durations and whole measured interval | Distinguishes vertex/culling work from fill, bandwidth and postprocessing |
| Binding visits, draw/bundle builds and invalidation reasons | Explains whether stable task topology survives PVS and pool changes |
| Bytes and write calls per stream, allocation/retirement counts | Separates sparse changes from whole-pool uploads and lifetime churn |
| Cold/warm download, decode, build, GPU-ready and visible-frame times | Prevents moving frame work into an unreliable loading stall |
| Peak CPU/GPU memory and resources after repeated loads | Exposes VAT, pool capacity, worker overlap and abandoned-session costs |
| Visual/parity results including demos, resize and device loss | A quick frame with incorrect or missing effects is not accepted |

The native `setRenderTaskGpuTimingEnabled`/`getRenderTaskGpuTimings` path exposes
unsupported, disabled, pending, available and error states. Timestamp-query
absence is unavailable data, not zero GPU milliseconds. Use the profiler's
whole measured interval; summing task durations can overcount overlapping GPU
intervals. Report dropped tasks/readback errors. Enabling timing is asynchronous
and instrumentation itself has overhead. The native overdraw-cost probe repeats
work deliberately and belongs in a controlled diagnostic run, not every frame.

No fixed speedup, compatibility percentage or go/no-go verdict follows from
this document. The most promising early work is stable pass membership and
specialized effect/pool data, because their avoided work can be counted. VAT and
GPU-driven culling have real native paths but larger correctness/memory gates.
Existing renderer defaults and 1.0 release scope stay unchanged.

## Validation of this research pass

Files changed in this pass (earlier uncommitted groundwork remains separate):

- `docs/research/babylon-lite-native-performance-2026-10-26.md`
- `docs/research/babylon-lite-renderer-investigation-2026-10-25.md`
- `docs/research/babylon-lite-migration-map-2026-10-25.md`
- `docs/research/babylon-lite-api-coverage-2026-10-26.md`
- `docs/research/babylon-lite-integration-sketch-2026-10-26.md`
- `docs/research/babylon-lite-evidence/audit-published-api.mjs`
- `docs/research/babylon-lite-evidence/published-api-summary-2026-10-26.json`
- `docs/changelog/v1.0.0-alpha.6.md`

The evidence utility checks archive integrity and declaration/runtime export
names without executing downloaded code. Its source hashes include the native
implementations named above. Relative source/document links, pseudocode export
vocabulary, fences and whitespace are checked separately; documentation build
and the Biome gate validate repository documentation/tooling integration.

Completed commands:

```powershell
node --check docs/research/babylon-lite-evidence/audit-published-api.mjs
node docs/research/babylon-lite-evidence/audit-published-api.mjs
node .cache/babylon-lite-research/validate-api-plan.mjs
npm.cmd run docs:build
npm.cmd run gate:biome
git diff --check
```

The regenerated evidence matched the tracked snapshot. Checks covered seven
documents and 71 relative links, balanced fences, whitespace and 20 distinct
`Native.*` names matched against both declarations and runtime exports. Both
tarballs passed their recorded SHA-512 integrity checks. All 459 importer hashes,
10 focused SHAG performance-source hashes and 18 selected native implementation
hashes matched; eight compat source-map-content hashes remain recorded.
The manual build passed after retrying an environment process-spawn restriction;
Biome passed at its existing baseline of 0 errors and 47 warnings. The cached
validator is a local research check, not an installed project test command;
the tracked audit utility is the repeatable package/source evidence producer.

Unverified: actual native rendering, GPU timings, visual equivalence, resource
retirement under stress, actor factories, custom WGSL layouts, worker scheduling
and any performance gain. These require future authorized executable fixtures.
