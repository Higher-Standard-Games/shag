# Asset loading reliability implementation — 2026-10-25

Follow-up to the [full audit](asset-startup-review-2026-10-25.md) and
[critical-path investigation](asset-startup-reliability-performance-2026-10-25.md).
The audit findings remain a historical record; this page records the implementation
and its validation. The follow-up committed this implementation on
`v1.0.0-alpha.5-tuning`: engine `29fe2cb1`, FPS `bee7c92`. No production deployment
or version bump was made. Concurrent asset work had advanced the checkout to
engine `7e562cae` / FPS `56c66e3`; the shared model-loading manual paragraph was
included in that concurrent engine commit.

The [follow-up review](asset-loading-followup-review-2026-10-25.md) records four
additional fault reproductions and the next reliability/performance priorities.

## Implemented

- **Owned GPU readiness:** material and scene polls have deadlines and stop on
  map cancellation or scene disposal. They use actual submeshes and do not leave
  Babylon `forceCompilationAsync` / `whenReadyAsync` polling promises running.
  Scene checks use the primary camera pass and restore the previously active
  camera. Settling frames are bounded. Failed batches cancel remaining checks.
- **Safe recovery and retirement:** freeze state is restored in `finally`.
  Temporary lights are disabled before retirement; a delayed WebGPU submission
  cannot hold loading forever or cause an in-flight buffer to be destroyed.
  Recovery no longer claims sampler updates re-upload texture pixels.
- **Explicit required-scene failure:** a world that cannot become ready fails
  map loading with a diagnostic, instead of silently opening a partially rendered
  match. Hidden-tab recovery failure is also a terminal map-load result.
- **Optional storage stays optional:** cache operations are bounded. Validated
  downloads resolve before persistence, which uses a separate bounded queue with
  at most two retained bodies. Hung writes cannot occupy archive-download slots.
- **Index and request identity:** the validated cached-index path registers its
  SHA identities too. Native AbortSignal composition, when available, retains
  caller cancellation after headers through fetch body consumption.
- **Texture resolution and duplicate work:** indexed owners are acquired before
  reading textures. An indexed package failure does not become a loose-file
  probe. Concurrent requests share texture creation and ZIP-entry extraction.
  Texture keys include package content identity and reduction level. Cleared
  generations discard late results. Optional KTX2 texture callbacks have a
  deadline and a source-texture fallback.
- **Bounded game preparation:** held weapons and projectiles use bounded,
  cancellable readiness waits. A required projectile failure is not reported as
  success. Cancelled held imports cannot display their weapon. Projectile reads
  are guarded against a cleared/replaced scene and cannot publish stale models;
  an old completion cannot delete a newer pending entry.
- **Safe package concurrency:** independent dependency requests are submitted
  together to the existing PackageStore scheduler. Its two-transfer limit and
  single background-job limit are unchanged. Shader lookup waits for dependency
  mounting; live weapon switching remains sequential.
- **Water CPU acceleration:** a temporary world-space triangle BVH replaces
  repeated whole-world scans for static water highlight masks. It keeps the same
  blocker filtering, lights, sampling grid and Babylon triangle intersection.
- **Depth-capture state and lifetime:** capture restores Babylon framebuffer/alpha
  state on all exits. Disposed shared captures are neither returned to consumers
  nor accepted as valid allocation reuse. Water replaces unavailable depth and
  colour samplers with its existing fallback instead of retaining dead textures.

## Additional bug found during validation

Successive WebGL2 loads initially passed DM2 and DM11 but failed DM5's required
readiness gate. A trace identified `bsp_tex_33`,
`textures/world/bluedistortwater`, using `unified-water-water`. Its sampler list
contained a disposed `scene-depth-viewz` texture: not ready, without GPU storage.

Clearing meshes can dispose a material's borrowed textures, while the scene-level
SceneDepthCapture survives for reuse. Returning that dead capture to the new
water material prevented it from becoming ready. Merely setting `uHasDepth=0`
does not remove a sampler from ShaderMaterial's readiness checks.

The capture validity guards and fallback bindings above address both sides of
this problem. The same sequence then passed:
**DM2 → DM11 → DM5 → DM11**, including held-weapon/projectile preparation,
consumption of the prepared view, and displaying a riotgun after each load.

## Measurements and browser evidence

- In a separate local Edge/WebGL2 CPU-profile fixture, DM11's
  `claimLiquidSurfaces` took **352.8 ms**, compared with **5,575.8 ms** in the
  earlier profile. The dominant earlier cost was static light-mask triangle
  intersection. This is a local before/after observation, not a cross-machine
  performance guarantee.
- The earlier instrumented two-load comparison reduced the largest observed
  main-thread task from approximately **6.8–7.5 seconds to 0.55–0.57 seconds**.
  Those intermediate runs still exposed the readiness problem subsequently fixed.
- Overall load-time comparisons are diagnostic only. Other weapon-asset work
  was happening in the shared checkout; cache state and concurrent processes also
  vary. Do not attribute every aggregate timing change to this patch.
- The prior WebGL framebuffer fixture returned **zero draw errors** after state
  restoration; the preceding unchanged control had reproduced error 1282.
- Final headless Edge/WebGL2 successive-map QA passed all four loads above.
  Real WebGPU DM11 also completed required preparation and displayed the weapon.
  These are functional checks, not timing benchmarks.
- GPU probes reported no failed HTTP responses. glTF common-root warnings remain.
  Rapid WebGL scene replacement still emits some `glGetProgramiv: Program object
  expected` warnings; these did not prevent the verified map transitions. Their
  remaining cause is not claimed fixed.

Ignored local evidence is in `.cache/startup-critical-path-before-fixes.json`,
`.cache/startup-cpu-profile-before-fixes.json`, `.cache/startup-cpu-profile.json`,
`.cache/startup-dm11.cpuprofile`, `.cache/loading-browser-webgl2.json`,
`.cache/loading-browser-webgpu.json`, `.cache/alpha4-errors-probe.json`, and the
corresponding probe scripts/screenshots. The tracked tests below preserve the
reproduced failure cases; ignored evidence is not a durable CI artifact.

## Validation receipt

Exact release-gate and required regression commands:

```powershell
npm.cmd run typecheck
npm.cmd run gate:biome
npm.cmd run test:run
npm.cmd run build
npm.cmd run docs:build
npm.cmd --prefix src/games/fps run docs:build
npm.cmd --prefix src/games/fps run test:simulation
npm.cmd --prefix src/games/fps run test:physics
npm.cmd --prefix src/games/fps run server:tick
npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000
npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"
```

TypeScript, production build, both manuals and all five required regression
commands passed. Biome passed at the unchanged baseline: **0 errors, 47 warnings**.
Indexed BSP inspection reported **7,475 faces**. The final full suite passed
**733 files / 5,702 tests**, with **one skipped test** (5,703 total).

Focused checks covered stalled storage, deduplication, indexed unmounted textures,
stale texture generations, cached SHA registration, shader cancellation/disposal,
freeze restoration, primary-camera readiness, terminal scene failure, held-view
cancellation, stale projectile reads, BVH agreement with Babylon picking, and
disposed depth/colour captures. The first full-suite run exposed two old fixtures
that needed real scene/upload boundaries; these were corrected and the expanded
preparation tests passed. A subsequent full run passed 732 files / 5,700 tests
before the additional disposed-capture regression was added.

Browser commands:

```powershell
node .cache/startup-cpu-profile.mjs
node .cache/alpha4-errors-probe.mjs
node .cache/loading-browser-qa.mjs webgl2
node .cache/loading-browser-qa.mjs webgpu
```

The WebGL2 fixture additionally ran with a diagnostic trace to isolate the DM5
failure before the capture-lifetime fix. GPU smoke fixtures used the private
no-watch Vite server, not the shared development server. Headless checks preceded
browser checks. Biome's Windows mapped-file write failure was avoided by formatting
only owned files through stdin; sandbox process restrictions required approved
retries for build/test helpers.

## Files changed by this work

Engine runtime:

- `src/engine/loader/map/GpuPreparation.ts` (new)
- `src/engine/loader/map/MapLoader.ts`
- `src/engine/loader/pk3/AssetRequest.ts`
- `src/engine/loader/pk3/PK3Index.ts`
- `src/engine/loader/pk3/PK3Loader.ts`
- `src/engine/loader/pk3/PK3TextureLoader.ts`
- `src/engine/loader/pk3/PackageStore.ts`
- `src/engine/rendering/SceneDepthCapture.ts`
- `src/engine/rendering/water/StaticVisibilityIndex.ts` (new)
- `src/engine/rendering/water/WaterSurfaceLighting.ts`
- `src/engine/rendering/water/LiquidSurfaceSystem.ts`
- `src/engine/rendering/water/UnifiedWaterMaterial.ts`
- `src/engine/weapon/EffectPreloader.ts`
- `src/engine/weapon/ProjectileManager.ts`
- `src/engine/weapon/WeaponViewManager.ts`

Engine regression tests:

- `src/engine/loader/map/__tests__/GpuPreparation.test.ts` (new)
- `src/engine/loader/bsp/__tests__/PVSCuller.test.ts`
- `src/engine/loader/pk3/__tests__/AssetRequest.test.ts`
- `src/engine/loader/pk3/__tests__/PackageStore.test.ts`
- `src/engine/loader/pk3/__tests__/PK3Mount.test.ts`
- `src/engine/loader/pk3/__tests__/TextureAcquisition.test.ts` (new)
- `src/engine/loader/pk3/__tests__/IndexCachedIdentity.test.ts` (new)
- `src/engine/weapon/__tests__/EffectPreloader.test.ts`
- `src/engine/weapon/__tests__/ProjectilePrepare.test.ts`
- `src/engine/__tests__/StaticVisibilityIndex.test.ts` (new)
- `src/engine/__tests__/SceneDepthCapture.test.ts` (new)
- `src/engine/__tests__/LiquidSurfaceSystem.test.ts`

FPS repository:

- `src/games/fps/client/FPSWeaponPreloader.ts`
- `src/games/fps/client/MatchMapLoader.ts`
- `src/games/fps/client/__tests__/WeaponViewLoading.test.ts`
- `src/games/fps/docs/manual/multiplayer/connecting.md`

Documentation:

- `docs/changelog/v1.0.0-alpha.5.md`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/manual/guides/shader-system.md`
- `docs/manual/guides/model-loading.md`
- `docs/research/asset-startup-review-2026-10-25.md`
- `docs/research/asset-startup-reliability-performance-2026-10-25.md`
- This implementation receipt.

Unrelated weapon packaging, Voltaic definition/beam-routing work, and other
pre-existing files were left untouched. This task did not rewrite PK3 archives
or remove `public/data`; normal build metadata/preview generation still ran.

## Assumptions and remaining work

Validation uses the local assembled engine/game checkout and its curated asset
data. The browser fixtures load maps directly, without a live lobby match.
Simulation/server regressions cover headless behavior; a complete live network
FFA join under a slow production connection is not claimed tested here.

Opera GX's exact version, limiters and stalled session were not reproduced.
Real context/device loss, Firefox and mobile behavior need additional coverage.
Native post-header cancellation was tested with AbortSignal composition; older
browsers without that API retain the previous fallback behavior.

This does not settle the production demo ADS/LG report or paused POV-state
reconstruction. Broader operation IDs across all loading UI, metadata-pair race
recovery, audio/model-source overlap, remaining CPU time-slicing, and optional
worker/build-time preprocessing remain follow-ups from the audit. The patch
does not promise that every startup subsystem is now immune to failure.
