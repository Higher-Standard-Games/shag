# Loading follow-up repairs — 2026-10-25

Implementation of the [follow-up review](asset-loading-followup-review-2026-10-25.md).
Branch: `v1.0.0-alpha.5-tuning`. The prior implementation remains documented in
its [receipt](asset-loading-implementation-2026-10-25.md).

## Changes

1. **Pickup lifetime:** clearing or superseding preparation aborts its consumer
   waits. Imports and texture preparation have deadlines. Late results release
   their resources rather than entering the cache. Cloning verifies the model
   root's actual scene; MD3/GLB loading captures and rechecks scene ownership.
2. **Loading ownership:** map events carry operation IDs. Client map requests
   serialize the complete scene-clear/load/finalize flow and forward cancellation.
   Match/demo holds are unique idempotent leases. Older progress, completion,
   cancellation and unload requests cannot dismiss or unload a replacement.
   Required postload watchdogs abort their owner instead of revealing unfinished
   gameplay. Legacy named holds remain supported for existing callers.
3. **Visibility:** GPU checks and their deadline budget pause while hidden/frozen,
   remain cancellable, and reject context/device loss. Resume checks resources
   without globally dirtying materials merely because visibility changed.
   Async preparation observes promise completion directly rather than polling
   every 16 ms; rendered-frame/GPU-retirement cleanup remains bounded separately.
4. **Persistence:** a disk queue holds package identities rather than completed
   Job objects or a second body queue. Bodies come from the bounded compressed
   archive working set; one active write can retain its body after eviction.
   Download bursts no longer lose the third write solely because two are pending.
   Memory hits retry missing persistence. Storage-open failure has a cooldown;
   writes have a longer deadline and keep existing entries until replacement
   succeeds. Diagnostic logs distinguish persistence and unavailable/deferred disk.
5. **Optional textures:** manifest acquisition has a shared 2.5-second budget;
   the complete optional sidecar attempt has a ten-second budget including
   metadata/decoder setup. Consumers detach on map cancellation. Cache revisions
   include index identity; a new revision refreshes metadata and failure state.
   Image reduction decode is bounded and closes late ImageBitmaps.
6. **Presentation barrier:** final entities and final client lighting are checked
   before core completion. Live joins fail required collision/camera preparation.
   Live/demo startup prepares player bodies and uses the same held/projectile
   preparation plus a final scene check. Optional audio is bounded; live joins
   overlap it with world loading. Timed-out sound buffers are dropped from the
   pending cache so a future request can retry.
7. **Published index:** generation writes an immutable content-named payload
   before atomically updating its manifest pointer, retaining `pk3_index.json`
   for compatibility. Runtime validates the pointer name, coalesces ensures,
   retries an incomplete published pair once, and keeps a coherent cached
   snapshot or reports a retry error. Genuine files-only legacy manifests still
   support archive scanning.

The new index payload files are generated metadata. Deploy the referenced
immutable file alongside the manifest and archives. This work does not delete
`public/data`, rewrite PK3 archives, push code or deploy production.

## Validation

Final gates passed:

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

The full suite passed 735 files: 5,718 tests passed and one skipped. Biome
reported zero errors and 47 existing warnings. The production output contained
the immutable payload referenced by its manifest, with 17 indexed packages.
Simulation, physics, server tick, deterministic 1,000-tick fuzz and indexed BSP
loading all exited successfully. The physics warning is expected on a passing
run. Build chunk-size/externalization warnings remain.

Headless Edge used the real GPU against a private no-watch Vite server on port
3105. Scratch probes and their JSON/screenshots are under ignored `.cache/`:

```powershell
node .cache/loading-browser-qa.mjs webgl2
node .cache/loading-browser-qa.mjs webgpu
node .cache/loading-followup-match-demo.mjs
node .cache/loading-followup-resume-stub.mjs
```

- WebGL2 loaded DM2 → DM11 → DM5 → DM11, each with prepared held weapons;
  selecting riotgun succeeded on every map.
- WebGPU was confirmed active and loaded DM11 with a prepared, visible riotgun.
- An isolated standalone FFA server on port 17777 accepted a live join after
  confirming the loadout picker. The client reached `playing`, stayed connected
  and had its held blade ready. No remote players were alive in that sample.
- The saved EU DM5 FFA recording started through normal `demoplay`, with all four
  alive bodies loaded, a ready held weapon, both render cameras present and the
  loading overlay closed. Screenshots confirmed the world and weapon rendered.
- Edge froze for three seconds during DM11's effect-shader warmup. Restoring
  lifecycle state and foreground visibility completed GPU preparation, reflection
  capture, return-to-tab checks and final entity setup; the overlay closed.
  The scratch driver stubs Vite's development client to prevent its reconnect
  reload from destroying the test. Merely resuming a page while it remains
  hidden intentionally leaves GPU preparation paused.
- These probes reported no HTTP asset failures. Expected missing local lobby
  connection warnings, existing skeleton warnings, WebTransport fallback and
  WebGL program-query warnings remain. The first live driver incorrectly waited
  for play without confirming the required loadout picker; the corrected driver
  completed the same flow.

Focused tests cover the four original defect reproductions, hidden/resumed and
lost-device waits, map cancellation, slow optional metadata, coherent index
fallback, legacy compatibility and real HTTP index loading.

The first full-suite run found an overly restrictive preloader scene field
check; it was replaced with the cached root's actual scene ownership. PVS tests
were adjusted to assert that setup never enables culling early without assuming
an exact number of readiness checks. The original failure output is retained in
ignored `.cache/loading-followup-full-tests.log`.

## Limits

The queue cannot guarantee persistent caching when browser storage is denied,
or when bodies leave its bounded memory cache before a write starts. It never
blocks play on an unbounded disk write. Browser APIs cannot cancel every native
decode/write; consumers stop waiting and late results cannot become current.
Frozen pages cannot execute JavaScript cleanup until the browser resumes them.
Opera GX and real production rollout were not tested in this follow-up. The
live smoke test used standalone FFA, not a complete lobby seat handoff. The demo
check establishes startup readiness, not correctness of every ADS/LG replay.

Optional audio may be unavailable after its startup budget. Required model and
collision failures report an error; decoration/audio fallback remains explicit.
The remaining WebGL program-query warnings and the historical demo ADS/LG
state-reconstruction report are separate from asset readiness. Worker expansion,
cross-consumer model-template sharing, reduced KTX2 variants and build-time
geometry/water-mask products remain profiling-led follow-ups rather than changes
silently bundled into this reliability patch.

## Files changed

- `docs/changelog/v1.0.0-alpha.5.md`
- `docs/manual/guides/model-loading.md`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/manual/guides/shader-system.md`
- `docs/research/asset-loading-followup-fixes-2026-10-25.md`
- `docs/research/asset-loading-followup-review-2026-10-25.md`
- `src/cli/pk3-index-build.ts`
- `src/engine/audio/AudioV2Sfx.ts`
- `src/engine/core/AsyncWait.ts`
- `src/engine/core/LoadingEvents.ts`
- `src/engine/loader/__tests__/AssetPreloaderReload.test.ts`
- `src/engine/loader/AssetPreloader.ts`
- `src/engine/loader/bsp/__tests__/PVSCuller.test.ts`
- `src/engine/loader/bsp/BspMeshBuilder.ts`
- `src/engine/loader/map/__tests__/GpuPreparation.test.ts`
- `src/engine/loader/map/ClientMapLoader.ts`
- `src/engine/loader/map/GpuPreparation.ts`
- `src/engine/loader/map/MapLoader.ts`
- `src/engine/loader/model/ModelLoader.ts`
- `src/engine/loader/pk3/__tests__/PackageStore.test.ts`
- `src/engine/loader/pk3/__tests__/PK3PublishedIndex.test.ts`
- `src/engine/loader/pk3/__tests__/TextureAcquisition.test.ts`
- `src/engine/loader/pk3/PackageStore.ts`
- `src/engine/loader/pk3/PK3Index.ts`
- `src/engine/loader/pk3/PK3PublishedIndex.ts`
- `src/engine/loader/pk3/PK3TextureLoader.ts`
- `src/engine/ui/__tests__/MapLoadingOverlayHidden.test.ts`
- `src/engine/ui/MapLoadingOverlay.ts`
- `src/engine/weapon/EffectPreloader.ts`
- `src/games/fps/client/__tests__/DemoServiceStarts.test.ts`
- `src/games/fps/client/__tests__/FPSWeaponPreloader.test.ts`
- `src/games/fps/client/__tests__/MatchMapLoader.test.ts`
- `src/games/fps/client/DemoService.ts`
- `src/games/fps/client/FPSAudio.ts`
- `src/games/fps/client/FPSWeaponPreloader.ts`
- `src/games/fps/client/MatchMapLoader.ts`
- `src/games/fps/docs/manual/multiplayer/connecting.md`
- `src/games/fps/Game.ts`

The outer commit also updates the FPS gitlink. No protocol, production server
configuration or package archives changed in this follow-up.
