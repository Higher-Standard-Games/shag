# White view during match loading — 2026-10-25

Follow-up to the [loading repairs](asset-loading-followup-fixes-2026-10-25.md).
Branch: `v1.0.0-alpha.5-tuning`. Baseline: engine `4c505862`, FPS `363228c`.

## Reproduction and cause

An isolated lobby on port 19000 used `.cache/white-screen-lobby` for accounts
and results. Headless Edge reached it through the private Vite server on 3105.
Normal developer FFA launches traversed the lobby spawner, network handshake,
map loading, loadout picker and join. No production services or user account
database were used.

The baseline DM11 → DM2 → DM11 → DM5 sequence reported `playing` with the
overlay closed every time, but the second DM11 screenshot was white. A render
exception occurred in `Effect.getAttributeLocation`, through vertex-array
binding. The diagnostic reproduction then failed on its first DM11 launch.
Captured state identified `bsp_tex_50_pbr`, frozen, with a replacement PBR effect
still compiling (`ready: false`, asynchronous WebGL pipeline) and the temporary
warmup point light present. The render loop throws on a render exception, so
later load completion and DOM updates do not establish that frames are drawing.

`prepareMaterial` called PBR readiness without the explicit `false` instance
flag used by a normal world draw. On a previously drawn frozen material this
could bypass its cached readiness check, replace its effect with a pending one,
and leave the old draw's ready flag in place. The next draw reused that flag and
bound an effect whose attribute locations did not yet exist.

A regression test uses real Babylon PBR readiness and holds only the replacement
compiler pending. Before the fix, the next ordinary draw's readiness call
incorrectly returned `true`. After the fix it returns `false`. Preparation
unfreezes the material for its asynchronous wait and restores its frozen policy
in cleanup, including cancellation. It also passes the explicit instance flag.
The first browser follow-up showed that this narrow change alone was insufficient
for other world meshes/passes sharing material state. Map loading therefore keeps
all world materials unfrozen through temporary-light warmup, reflections and final
entity readiness, and freezes them afterwards. Static world matrices/bounds stay
frozen throughout. An ordering regression verifies both preparation and the final
frozen state.

The first smoke probes checked map/model state, and their screenshots were not
all inspected. The new probe examines PNG pixels and records shader/mesh faults;
reading the default framebuffer between frames with drawing-buffer preservation
off returned zeros even on the white view and was not a useful oracle.

## Texture lifetime defects

The user's screenshot also contained late KTX2 uploads into a released hardware
texture (`memoryAllocated` on null). A separate regression demonstrated that a
decoder result arriving after disposal still bound GPU state, uploaded mips and
marked the retired texture ready. Those results are now discarded before any
binding/upload or load notification, and the InternalTexture's pending scene
entry is removed. The optional loader also releases that entry at timeout.

Another fault test showed that an old sidecar completion could start a source
fallback in a replacement map's cache. Texture resolution now retains and checks
its original generation and abort signal before proceeding. These texture fixes
are distinct from the captured PBR render-loop failure.

## Validation

Before/after fault tests:

```powershell
npm.cmd run test:run -- src/engine/loader/map/__tests__/GpuPreparation.test.ts
npm.cmd run test:run -- src/engine/loader/texture/__tests__/KTX2SidecarLoader.test.ts
npm.cmd run test:run -- src/engine/loader/pk3/__tests__/TextureAcquisition.test.ts
```

All three newly added defect cases failed against the baseline behavior and
passed after their corresponding fixes. The three targeted files passed 28
tests together. The weapon-ownership and GPU-preparation pair passed 16 tests.

An intermediate full run passed 734 files and failed one cold lazy-attachment
assertion in `RemoteWeaponLeak.test.ts` under simultaneous browser/build load.
That file mocks model loading and does not exercise these changed loaders. Its
isolated rerun passed. The final full run is recorded separately rather than
counting that intermediate run as green.

The final ordering check ran with:

```powershell
npm.cmd run test:run -- src/engine/loader/bsp/__tests__/PVSCuller.test.ts src/engine/loader/map/__tests__/GpuPreparation.test.ts
```

Both files passed, 42 tests in total. The setup checks observed unfrozen world
materials and the completed load retained frozen materials for gameplay.

Real-GPU headless Edge checks after the final ordering change:

- Eight consecutive DM11 FFA joins through the scratch lobby reached connected
  gameplay with the loading overlay closed. All eight captured zero instrumented
  render faults, zero console errors/exceptions and zero failed HTTP requests.
  PNG checks found white pixels covering 0.03–2.54% of each frame, compared with
  about 80% in the captured failure. The final screenshot also showed the world
  and held blade drawing. Browser diagnostics still included skeleton warnings
  and WebTransport-to-WebSocket fallback.
- A WebGPU DM11 map/weapon smoke check confirmed `isWebGPU: true`, 477 scene
  meshes, a prepared weapon view and the displayed riotgun. The screenshot
  showed the textured world and weapon. No HTTP failures or console exceptions
  were captured; skeleton and adapter-option warnings remain.
- A WebGL2 sidecar fault probe delayed a real decoder result by twelve seconds.
  Source fallback returned at about 10,006 ms; after sixteen seconds the scene
  had zero pending items, with no logged errors or failed HTTP requests. The
  source texture's readiness was sampled at construction, not after the final
  wait, so this probe establishes bounded fallback and safe late completion,
  rather than final source-texture readiness.

The private Vite server and scratch lobby were stopped after these checks.
No production service was changed.

Final gates and required renderer regressions:

| Command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run test:run` | Pass, 735 files; 5,721 tests passed, 1 skipped (231.47 s) |
| `npm.cmd run gate:biome` | Pass, 0 errors / 47 warnings, at baseline |
| `npm.cmd run build` | Pass; 49 sourcemaps relocated by postbuild |
| `npm.cmd run docs:build` | Pass |
| `npm.cmd --prefix src/games/fps run test:simulation` | Pass |
| `npm.cmd --prefix src/games/fps run test:physics` | Pass |
| `npm.cmd --prefix src/games/fps run server:tick` | Pass, deterministic checksums match |
| `npm.cmd --prefix src/games/fps run server:fuzz -- --ticks 1000` | Pass, deterministic checksums match |
| `npm.cmd --prefix src/games/fps run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Pass, 7,475 faces |

## Files

- `src/engine/loader/map/GpuPreparation.ts`
- `src/engine/loader/map/__tests__/GpuPreparation.test.ts`
- `src/engine/loader/map/MapLoader.ts`
- `src/engine/loader/bsp/__tests__/PVSCuller.test.ts`
- `src/engine/loader/pk3/PK3TextureLoader.ts`
- `src/engine/loader/pk3/__tests__/TextureAcquisition.test.ts`
- `src/engine/loader/texture/KTX2SidecarLoader.ts`
- `src/engine/loader/texture/__tests__/KTX2SidecarLoader.test.ts`
- `docs/manual/guides/shader-system.md`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/changelog/v1.0.0-alpha.5.md`
- `docs/research/white-screen-loading-regression-2026-10-25.md`

## Limits

The reproduction uses developer FFA spawns through a scratch lobby, rather than
a production room's seat handoff. Opera GX and production rollout remain
unverified. Existing skeleton warnings and other renderer diagnostics are not
claimed fixed by these changes. Native decodes can finish after cancellation;
their retired results are discarded. Test logs, instrumented probes and captures
live under ignored `.cache/`; they are diagnostic artifacts, not shipped code.
