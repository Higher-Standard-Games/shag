# Asset loading follow-up review — 2026-10-25

This reviews the [implemented loading improvements](asset-loading-implementation-2026-10-25.md),
after the [initial audit](asset-startup-review-2026-10-25.md) and
[performance investigation](asset-startup-reliability-performance-2026-10-25.md).

Baseline: engine `29fe2cb1`, FPS `bee7c92`, branch
`v1.0.0-alpha.5-tuning`. Those commits preserve the validated implementation.
Concurrent WebP packaging/texture-resolution edits remain outside this review's
commits. Recommendations here do not claim those edits' size or speed benefits.
This review changed research documentation only. Implementation follow-up:
[repairs and validation](asset-loading-followup-fixes-2026-10-25.md).

## Assessment

The new GPU observation, archive sharing and water acceleration are useful foundations.
The next highest-value work is to make the whole operation own its lifetime and
completion contract. Some earlier audit findings remain outside the implemented
scope, and the new persistence cap introduces a reproducible durability gap.

Four isolated fault probes reproduced defects. They assert the undesired behavior;
a passing fault probe is evidence of a bug, not a passing reliability requirement.
Existing targeted regressions also passed: six files, 43 tests.

## Findings in priority order

### 1. P1 — Pickup preparation can still block cancellation and republish after clear

Sources: `src/engine/loader/AssetPreloader.ts:67`, `:76`, `:135`, `:184`;
`src/engine/loader/map/MapLoader.ts` pickup-preload phase and `disposeCurrentMap`.

`preloadFromBsp` has no signal, generation or deadline. GLB imports, MD3 loads
and their texture promises are awaited directly. Clearing its cache does not
invalidate pending imports. A late completion can insert its old model again.
Its cache is keyed by model path without checking the requested scene.

The map queue serializes replacement/disposal behind the active load. That is
correct for scene mutation, but a never-settling pickup await can hold the queue
forever even after its map signal is aborted. The new GPU waits cannot help an
operation which has not reached them.

**Reproduced:** hold one pickup-model load, clear the cache, complete the load;
`hasModel(path)` becomes true again. This is a cache ownership reproduction,
not a claim to have reproduced Opera GX's original session.

**Repair:** scene/generation ownership on pickup sources, per-consumer cancellable
waiting, bounded import/texture preparation, and explicit late-result disposal.
Keep scene mutations serialized until stale completions are safe. Apply the same
ownership checks to entity hooks/handlers before making them concurrent.

### 2. P1 — An old match releases the new match's overlay hold

Sources: `src/games/fps/client/MatchMapLoader.ts:71`, `:73`, `:77`, `:251`;
`src/engine/ui/MapLoadingOverlay.ts` holds, `cancel`, loading-event handlers.

Every match uses the same `fps:postload` string. Holds are a global Set rather
than owned leases. A cancelled match can finish later and its `finally` releases
that name while a newer match is using it. `cancel()` clears every hold and
hides the global overlay. Loading events also do not identify their operation.

**Reproduced:** hold the old match's map promise; cancel it; start the next match;
complete the old promise. Its `finally` removes the next match's hold. The mock
retains the real MatchMapLoader control flow and isolates overlay bookkeeping.

**Repair:** operation IDs on start/progress/completion, plus unique leases whose
release functions are idempotent and release only their owner. The overlay must
ignore obsolete events. A required preparation watchdog should fail that load
with retry/disconnect, rather than reveal an unprepared game.

Cancellation does have an indirect production path: `Game.ts:711` calls
`mapLoader.cancel()` on session end and asynchronously calls `unloadClientMap()`.
It would be inaccurate to say core loading is never cancelled. However, the
match signal is not passed into `loadClientMap`; cancellation depends on separate
cleanup, and unguarded imports/postload callbacks still need ownership checks.
Demo start has generation checks but likewise does not pass a signal into its
map load. Consolidate these lifetimes without letting an old unload cancel a
newly requested map.

### 3. P1 — GPU deadlines count hidden time before visibility is awaited

Sources: `src/engine/loader/map/GpuPreparation.ts:7`;
MapLoader's warmup, scene-readiness and subsequent visibility-recovery phases.

The helper's deadline is wall time. Warmup and required scene readiness run
before `waitForMapVisibility`. A hidden tab whose GPU work is deferred can fail
required readiness before reaching the existing visibility gate. On resume,
expired timers and readiness work can race. The same policy affects held-model
preparation when visibility changes later in postload.

**Reproduced:** with `document.hidden=true` and a not-ready condition, the GPU
helper times out while the document stays hidden. Source order establishes why
the later visibility wait does not protect this stage. This is not browser GPU
throttling emulation.

**Repair:** count visible active time for GPU preparation; suspend the stage
explicitly while hidden and keep cancellation effective. On resume, check actual
resource/context health before deciding to recompile. Preserve independent,
generous network limits. Real device/context loss needs a distinct failure or
restoration transition; hiding a tab does not prove texture loss. Browser page
freezing can suspend timers and fetch callbacks too, so no in-page watchdog can
guarantee execution while frozen. See [Chrome's lifecycle documentation](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).

### 4. P1 — The persistence cap silently drops packages from durable caching

Source: `src/engine/loader/pk3/PackageStore.ts:287` and the memory-hit path.

When two writes are pending, a third validated package returns without being
queued for persistence or recorded as needing a later write. A later memory hit
does not repair that omission. This keeps play responsive and memory bounded,
but does not guarantee reuse by the next page/store instance.

**Reproduced:** block the first `cache.put`, acquire three small SHA-verified
archives, then release writes. Exactly two archives are persisted. Reacquiring
the third in the same store hits memory without repairing disk; a new store
calls fetch for it. A real browser may satisfy that fetch from its HTTP cache,
so this does not prove a full wire download on every join.

**Repair:** track persistence debt and retry opportunistically while its bytes
remain owned, using a byte budget and separate disk scheduling. Expose acquired
versus durably cached states in diagnostics. If bytes are evicted first, state
that limitation rather than claiming durable completion. Do not make foreground
play wait on an unbounded disk queue.

The one-second storage deadline also treats legitimately slow storage as failed.
Repeated `caches.open`/read waits can tax multiple downloads; use a short-lived
storage circuit breaker and measure latency before choosing read/write policies.
Cache writes can finish after an outer timeout, so the budget is not a hard cap
on underlying browser work. Persistence deletes an existing entry before its
replacement `put`; prefer retaining a valid entry until replacement succeeds.

### 5. P2 — Optional KTX2 work can still delay required texture loading

Sources: `src/engine/loader/pk3/PK3TextureLoader.ts` resolver,
`getKTX2Manifest`, `loadKTX2Sidecar`; `KTX2DecoderRuntime.ts`.

The ten-second sidecar deadline starts after manifest acquisition and decoder
initialization. Resolver calls await those first. A stalled manifest can consume
the asset header/body deadlines per search path before an ordinary source image
is attempted. Decoder module imports are also outside the sidecar callback timer.
This path is awaited within material application without the map's signal.

**Repair:** give the complete optional attempt one budget and consumer lifetime,
start manifest/decoder preparation early, and circuit-break repeated failures.
Do not race every source and sidecar unconditionally: that would duplicate
downloads and uploads. Distinguish shared decode ownership from a caller that
has stopped waiting. Probe late decoder/upload completion after texture disposal
before claiming that timeout cancels the GPU work.

Sidecar manifest/cache keys also lack the ordinary textures' package-content
identity. The generator has source signatures but runtime trusts its manifest.
Tie generated variants to source/manifest revisions and invalidate failures on
revision changes; preserve map texture scopes and authored UV/colour semantics.

### 6. P1/P2 — The final gameplay contract still differs across entry paths

Sources: MapLoader's readiness/entity phases; `ClientMapLoader.ts`;
`MatchMapLoader.ts`; `DemoService.ts:631`, `:703`; `FPSAudio.ts`;
`src/engine/audio/AudioV2Sfx.ts:160`, `:385`.

The world GPU gate precedes entity spawning. ClientMapLoader then configures
world lighting features after core map completion. Match postload adds audio,
prediction/controllers and prepared held/projectile models. Demo runtime wiring
initializes effects and audio but does not call `preloadFPSWeapons`; its view
models/projectiles are not covered by the live match's media barrier.

Audio bank acquisition/decode is awaited after the map and has no consumer
signal or decode deadline. A hung decode remains in the pending buffer cache.
Collision initialization and much controller setup catch errors and log them,
allowing presentation to complete without a typed required-state failure.
Some material/entity failures are likewise warnings; a ready fallback material
is not evidence that the intended asset loaded.

**Repair:** a shared preparation specification for live and demo presentation,
with separate adapters for simulation/network setup. Include final lighting
layouts, current POV, player representation and core combat effects before
commit. Explicitly classify required and optional failures. Essential collision
must fail a live join; optional audio unavailability needs an explicit fallback
policy. Do not make every decoration mandatory or start live simulation merely
to prepare assets. This review does not attribute the reported ADS/LG demo bug
to missing preload alone: continuous state reconstruction is a separate concern.

### 7. P2 — A deploy metadata mismatch can trigger archive scanning

Source: `src/engine/loader/pk3/PK3Index.ts:731`, `:758` and `buildIndex`.

Manifest and index are fetched as separate mutable URLs. A mismatch goes straight
to legacy validation/build rather than retrying a coherent published pair.
Without a cached index that path indexes archives, so a temporary publication
race can turn startup into broad acquisition. `ensureIndex` also lacks a shared
in-flight ensure promise; callers can overlap metadata work.

**Repair:** publish an immutable revisioned index referenced by a small atomic
manifest, retain the last coherent snapshot, coalesce concurrent ensures and
retry transient metadata mismatch before legacy fallback. Retain explicit
support for truly legacy/custom deployments. Test deployment transitions, rather
than treating every mismatch as an invalid user's cache.

## Speed improvements worth pursuing

These are proposals, not measured speedups. The earlier 5.58 s to 0.35 s water
measurement remains the established local result; no new browser benchmark was
run while concurrent texture/media work changed the checkout.

| Order | Technique | Fit and limits |
| --- | --- | --- |
| 1 | Overlap audio and immutable source preparation with world work | MatchMapLoader waits for the map before audio, and for audio before held preparation. Begin bounded audio/package work once index identities are ready; join it at the game barrier. Keep mutable view switching, package-scope changes and scene commit serialized. |
| 2 | Small CPU batches with cooperative yielding | BSP parse/build, image reduction and the remaining water BVH/masks still run synchronously. Use a measured time budget and `scheduler.yield()` when available, with a task-based fallback. This improves responsiveness; it does not inherently reduce CPU time. |
| 3 | Reuse immutable model sources across compatible consumers | ZIP extraction now shares only concurrent reads; pickup and held paths still import their own GLBs. Existing ModelInstanceCache already uses AssetContainer cloning. Extend source reuse only after proving skeleton/tag/animation/material compatibility; preserve independent mutable presentation. |
| 4 | Worker preparation for pure data | Move measured expensive BSP parsing/mesh-array preparation, archive entry decode or BVH/mask work to a bounded worker pool. Transfer immutable ArrayBuffers; return typed arrays/results. Keep Babylon scene/GPU mutation on its owner thread. |
| 5 | Generate static map products at packaging time | Precompute water masks and potentially mesh-ready static arrays, versioned by geometry, lighting, build options and algorithm. Validate before reuse and retain a runtime custom/editor-map path. This removes repeated work rather than just moving it. |
| 6 | Compressed reduced-resolution variants | `picmip>0` skips KTX2 and decodes/reduces source pixels on CPU. The Smooth preset uses 1; Balanced uses 0. Ship suitable reduced KTX2 variants or carefully support selecting existing mips. Verify normal/alpha/colour/orientation and WebGL/WebGPU equivalence. |

[`scheduler.yield`](https://developer.chrome.com/blog/use-scheduler-yield) yields
to a new task and prioritizes continuation; `await Promise.resolve()` does not
provide that event-loop break. Feature detection and fallback remain necessary.
Choose batch budgets from low-end responsiveness measurements; do not insert a
full frame delay after every small unit of work.

[Transferable ArrayBuffers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
move ownership without copying their bytes, but detach the sender's buffer. Do
not transfer an archive/entry buffer still shared by the package store or another
consumer. Avoid worker oversubscription with existing KTX2 decoder workers.

[Babylon AssetContainers](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/importers/assetContainers.md)
already provide model duplication, including skeletons and animation groups;
materials share by default. Our installed ModelInstanceCache already controls
those choices. A new cache must reconcile ownership, not add an overlapping cache
around the existing one.

[KTX2 supports mip-level organisation and streaming](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html).
That format capability does not establish streaming support in our Babylon
adapter. Prebuilt reduced variants are a smaller experiment than introducing
runtime range fetching and progressive replacement.

Keep existing SHA verification, index-first ownership and bounded acquisition.
Raising all concurrency limits, wrapping CPU work in Promise.all, removing
required checks or adding a service worker would not solve the ownership defects.
Tune network, decode, scene mutation and disk work independently after measuring
median/tail latency, long tasks and memory on representative devices.

## Proposed implementation sequence and acceptance

1. **Lifetime correctness:** operation IDs/overlay leases, pickup generation and
   cancellation, guard all post-await callbacks. Test cancel/rejoin, demo-to-live,
   scene replacement and late success/error; old work cannot change the new flow.
2. **Lifecycle-aware GPU state:** explicit suspended/visible/lost transitions,
   active-time budgets and resource diagnostics. Test hidden before/during/after
   warmup, lengthy freeze/resume, real context loss and device loss separately.
3. **Durable caching:** repair persistence debt, storage circuit breaker and
   coherent index snapshots. Test more than two quick archives under slow writes,
   new-page warm reuse, corrupt cache, denial/quota and deployment mismatch.
4. **One game presentation barrier:** live/demo required media, final layouts and
   typed failures, with bounded optional audio. Test FFA, normal Watch, POV
   changes and rapid retries. Do not conflate asset readiness with demo state.
5. **Measured overlap and CPU scheduling:** establish cold/warm/new-page baselines
   on DM2/DM5/DM11 before audio/source overlap, yielding or workers. Keep largest
   owned tasks below an agreed budget and check socket/input responsiveness.
6. **Packaging optimisations:** evaluate static products and reduced compressed
   variants with output-equivalence tests and visual/GPU checks.

Remaining WebGL `glGetProgramiv` warnings need a targeted compile/dispose trace.
Installed Babylon still has internal effect/pipeline readiness retries even
though our helper does not create `forceCompilationAsync` pollers. That is an
investigation lead, not a demonstrated cause or justification for a blind upgrade.

## Validation and scope

Commands run for this review:

```powershell
npx.cmd vitest run --config .cache/loading-followup-review.vitest.config.ts
npx.cmd vitest run src/engine/loader/map/__tests__/MapLoadLifetime.test.ts src/engine/loader/map/__tests__/GpuPreparation.test.ts src/engine/loader/pk3/__tests__/PackageStore.test.ts src/engine/loader/pk3/__tests__/TextureAcquisition.test.ts src/games/fps/client/__tests__/FPSWeaponPreloader.test.ts src/games/fps/client/__tests__/WeaponViewLoading.test.ts
npm.cmd run docs:build
```

Four fault probes passed after correcting their document mock's missing event
API during NullEngine disposal. Six existing files / 43 tests passed. Research
probes/config live under ignored `.cache/loading-followup-review*`; the exact
defect setups and results are recorded above because ignored scripts are not a
durable CI artifact. Convert them to requirements/regressions when implementing
repairs. Documentation build passed (4.57 s); the initial sandboxed attempt hit
the child-process `spawn EPERM` restriction, and the approved retry succeeded.

No runtime changes or fresh browser/performance claims are part of this review.
The implementation's earlier full suite, GPU probes and required renderer/server
regressions are in its receipt; they were not rerun as a full release gate for
documentation changes. Actual Opera GX, production slow joins, Firefox/mobile,
device loss and memory-pressure behavior remain unverified. Existing assets and
`public/data` were not regenerated, replaced or removed by this pass.
