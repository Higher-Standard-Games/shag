# Babylon Lite: proposed structure and migration map

Date: October 25, 2026. Status: post-1.0 research draft; no implementation.
Companion to [the initial investigation](babylon-lite-renderer-investigation-2026-10-25.md).
The SHAG and upstream revision boundaries recorded there still apply. This pass
uses the same pinned upstream source, not an assumed future stable API.

Follow-up: [actual code boundaries and small groundwork candidates](babylon-lite-code-boundaries-2026-10-25.md),
including reproducible import evidence and concrete wrapper-preserving extraction
plans. Its source findings refine the broader reuse/adapt labels below.

The [October 26 groundwork catalog](babylon-lite-groundwork-catalog-2026-10-26.md)
extends this map with 15 work packages and concrete data/time/lifetime contracts.
Use its planning checklist before creating the proposed files here. It separates
small pure calculations from browser host work, device-specific policy and
resource wrappers that should remain backend-owned.

The [published API audit](babylon-lite-api-coverage-2026-10-26.md) and
[pseudocode/file-change sketch](babylon-lite-integration-sketch-2026-10-26.md)
add concrete call-level constraints. Use their distinction between published
1.36.0 and the later master checkout before implementing this proposed tree.
In particular, `removeTask` and `createCustomPostProcessTask` are not published
root exports at that version. Existing feature names and file proposals here
do not imply an available one-to-one Lite class.

## Agreed scope

Preserve SHAG's working WebGL and Babylon WebGPU implementations. Keep their
files, shader paths, defaults, server behavior and production assets intact.
This project must not become a prerequisite for the 1.0 release.

The immediate work is a design and source investigation. Proposed names below
are **new files/types that do not exist yet**, not instructions to reorganize
working code. Actual current owners are identified separately. Tables group
closely related functions where there is no owning class; they do not invent a
class for each helper.

The migration map covers the rendering systems and their important client
dependencies. It is not a completed audit of every call/property in the entire
editor, UI, physics integration or Babylon dependency graph. Each proposed port
still needs executable verification on a chosen Lite version.

## First home: a separate research application

Putting a folder beneath `rendering/` is not sufficient isolation. Existing
`EngineServices.ts` imports Babylon scene services eagerly; `ServiceLocator`
is a singleton and its scene lifecycle accepts Babylon `Scene`. Texture/model
managers, `RenderVars`, the camera system and several effects also have global
or scene-specific assumptions. The prototype should not initialize those
services with a Lite context or run them alongside a second renderer in one
document.

Suggested first tree, entirely additive:

```text
experiments/babylon-lite/                  # research harness, not a new game module
  README.md                              # exact versions, fixtures, known gaps
  package.json                           # own pinned dependencies and commands
  package-lock.json                      # own lock; no root dependency changes
  index.html
  vite.config.ts                         # isolated config; no global compat plugin
  src/
    main.ts                              # selects the research case
    NativeMapCase.ts                      # real indexed BSP -> Lite
    CompatCase.ts                         # separate build/entry for compat audit
    MaterialCases.ts                      # lightmap, fog, blend and depth fixtures
    BatchedEffectCase.ts                  # representative Voltaic/explosion batch
    ActorWeaponCase.ts                    # animated actor + independent weapon view
    AssetBridge.ts                       # reads existing PK3-indexed bytes
    LoadScope.ts                         # cancellation, generation, cleanup owner
    Capture.ts                           # metrics, screenshot metadata, errors
  fixtures/
    cases.json                           # paths/hashes/settings, no copied game media
    camera-path.json
  results/                               # ignored local captures and measurements
```

This tree is a proposal only. Do not create a new game package or install
dependencies until we decide to implement an experiment.

The harness needs read-only access to existing `public/data` through its own
same-origin development server. It still resolves virtual assets through
`PK3Index` and the package cache; serving a directory is not permission to
restore direct model/texture HTTP loads. Do not copy the data bank into a second
build output or modify canonical media. A distinct dev origin gets a distinct
browser cache, so cache measurements must record origin and warm/cold state.

The existing `scripts/browser-application.ts` already supports separate
application entries through `browser.json`/`SHAG_APP`. That may be useful later.
It does not by itself isolate dependencies, root Vite plugins, optimizers or
singletons, so an independent harness config is preferable for the first spike.

We can read and import narrowly chosen data modules from SHAG without moving
them. Some apparently data-only helpers transitively import Babylon math;
record that in the bundle report. Shared algorithm extraction is a later, small
reviewed change if necessary, not a preliminary engine-wide refactor.

## Possible eventual home inside the engine

If the experiment earns an integration, keep existing files at their current
locations. Add a sibling implementation rather than moving them into a new
`classic/` tree:

```text
src/engine/rendering/
  RenderingEngineFactory.ts               # EXISTING: unchanged classic factory
  ...existing files and water/...         # EXISTING: retain implementations
  lite/                                  # PROPOSED: generic Lite implementation
    LiteRendererSession.ts                # one engine, scene, surface, lifecycle
    LiteResources.ts                      # GPU handles/refcounts/retirement
    LitePreparation.ts                    # actual uploads/pipelines/frame readiness
    LiteDiagnostics.ts                    # limits, errors, counters, GPU timings
    world/
      LiteWorldBuilder.ts                 # geometry and draw partitions
      LiteWorldVisibility.ts              # PVS/frustum -> visible draw set
      LiteBrushModels.ts                  # moving brush transforms/visibility
    materials/
      LiteMaterialFactory.ts              # Q3 material descriptions -> material
      LiteBakedLighting.ts                # baked/deluxe/vertex lighting
      LiteStageAnimation.ts               # clocked UV/color/alpha changes
      LiteFog.ts
      wgsl/                               # authored Lite shader sources
    assets/
      LiteTextureUploader.ts
      LiteModelLibrary.ts
      LiteModelInstances.ts
    passes/
      LiteWorldPass.ts
      LiteWeaponPass.ts
      LiteDepthSource.ts
      LiteSkyPass.ts
      LiteShadowPasses.ts
      LitePostProcess.ts
    lighting/
      LiteLightSet.ts
      LiteEnvironment.ts
    water/
      LiteLiquids.ts                       # own shader/passes/probe lifetimes
    actors/
      LiteRig.ts                          # skeleton/node attachment adapter
      LiteAnimationPlayer.ts
    effects/
      LiteEffectBatches.ts                 # generic seeded/time-based GPU batches
      LiteTrails.ts
      LiteParticles.ts
  contracts/                             # PROPOSED, only when demonstrated useful
    GeometryData.ts
    SurfaceDescription.ts
    CameraPose.ts
    PresentationClock.ts
    RenderMetrics.ts

src/games/fps/client/presentation/lite/    # PROPOSED: inside the FPS repository
  FpsLitePresentation.ts                   # game composition and entity/event mapping
  LiteRemotePlayers.ts
  LiteHeldWeapon.ts
  LiteCombatPresentation.ts
  LitePickupPresentation.ts
  LiteDemoPresentation.ts
```

Names and subdivisions can shrink when implemented. A new file is justified
by an ownership boundary, not by this tree. For example, the first viewer may
need only a session, asset bridge, world builder and two material functions.

Engine code must never import `games/fps`. Generic GPU batching/mesh resources
belong to SHAG; weapon IDs, recipes, team rules, snapshot/event interpretation,
pickup definitions and demo POV choices belong to FPS. Where existing files
already blur that boundary, leave them alone and make the new route respect it.
Do not duplicate server/game rules merely to obtain a Lite scene.

## Data boundaries before interface design

The experiment can prove these inputs before we design a broad renderer API:

| Input/output | Proposed contents | Ownership constraint |
| --- | --- | --- |
| Asset source | Virtual path, owning package/revision, bytes and optional decoded pixels | Shared acquisition; renderer owns uploaded resources. Never detach/transfer the only cached byte buffer to a worker. |
| Geometry | Typed positions, normals, UV/UV2, colors, indices, bounds, surface IDs and PVS membership | Preserve coordinate/winding conventions; upload without reconstructing the world every frame. |
| Surface description | Ordered stages, texture references, alpha/depth/cull rules, baked-light metadata | Parser output/recipe is common; Babylon and Lite material objects are separate. |
| Camera pose | Position/orientation, world FOV, held-view FOV, viewport and projection parameters | The game determines pose; the chosen renderer applies it. No camera from the other engine crosses the boundary. |
| Actor state | Stable entity/model IDs, transform, animation intent/time, team tint, attachments | One game/interpolation update; renderer retains its own handles and dirty state. |
| Effect command | Stable event ID, seeded parameters, start/end tick or presentation time, endpoints | Discontinuities clear/reconstruct transient state; do not replay every event on every frame. |
| Presentation clock | Playhead/time, delta, paused state, discontinuity ID | Live, demo, seek and benchmark clocks are explicit; rendering does not invent another clock. |
| Metrics/failure | Renderer/version, pass timing, readiness stage, resource counts, structured failure | Real completion, not compat's unconditional ready flag; no backend-private handles in shared contracts. |

Avoid an API that rebuilds and copies the entire scene into a fresh JSON/array
tree every frame. Start with direct calls on persistent handles or reusable
records and dirty ranges. Worker transfer/SharedArrayBuffer is a later experiment
with its own ownership and hosting requirements.

## Owner-by-owner migration map

In the tables, **reuse** means a candidate algorithm/data reader, subject to
transitive-import review; **adapt** means implement a Lite-specific binding;
**port** means another rendering implementation is required; **retain** means
leave the current route as-is. None is a verified Lite integration yet.

### Startup, configuration, lifetime and diagnostics

Paths in this table are relative to `src/engine/` unless stated otherwise.

| Current owner | Proposed work | Destination / proof |
| --- | --- | --- |
| `runtime/BrowserRuntime.ts`: `createBrowserRenderer`, `createBrowserScene`, `initializeBrowserScene` | Retain. A Lite session constructs and initializes its own engine/scene without invoking Babylon scene service setup. | `LiteRendererSession`; cold init, disposal and retry case |
| `rendering/RenderingEngineFactory.ts` | Retain its types and constructor/fallback policy. Do not cast Lite into `AbstractEngine`. An eventual selector chooses a whole runtime before initialization. | Separate entry first; fallback requires fresh session/canvas where appropriate |
| `core/EngineServices.ts`, `ServiceLocator` | Retain. Explicitly compose only the services a Lite application supports; no global scene-service replacement. | Harness composition dependency report |
| `RenderVars` | Retain Babylon application logic. A Lite settings reader can interpret a tested subset without registering conflicting callbacks or rewriting saved defaults. | Feature availability report and effective settings, not silently ignored cvars |
| `SceneRendererPolicy` | Retain its Babylon/glTF light-cap fixes. Define native Lite limits and light policies from actual device/material capabilities. | `LiteLightSet`; glTF load cannot mutate unrelated world settings |
| `BabylonShaderFixes` | Retain upstream-version patches in the old route. Do not transplant Babylon shader-store edits into Lite. | Explicitly identify which fixes are unnecessary and which visual invariants remain |
| `loader/map/MapLoader` | Retain current orchestrator. Build a small Lite load transaction from indexed data, with one cleanup owner and no existing scene singleton calls. | `LoadScope` -> later `LitePreparation` |
| `ClientMapLoader`, FPS `MatchMapLoader` | Retain the working join path. Later supply a Lite-specific presentation/load hook while keeping admission, cancellation and loading holds equivalent. | Separate FPS composition only after a playable fixture exists |
| `loader/map/GpuPreparation.ts`, `MapLoadWait.ts` | Reuse cancellation/deadline ideas; port actual readiness probes to Lite. Compat scene readiness is not usable proof. | Upload + pipeline + task build + verified frame stages |
| `RendererDiagnostics`, `RendererRuntimeDiagnostics`, `ShaderCompileCapture` | Port observation/error ownership using Lite public GPU events/limits; report shader/pass context without assuming Babylon effect caches. | `LiteDiagnostics`; deliberate failed shader/device fixtures |
| `RendererPerformanceCapture`, FPS `TimedemoService` | Reuse statistics/fixture semantics where independent; port frame and GPU counters. Existing engine/scene instrumentation does not describe Lite. | Same report schema where meaningful, mark unavailable counters honestly |

### Asset acquisition, decoding and geometry

Paths are relative to `src/engine/`.

| Current owner | Proposed work | Destination / proof |
| --- | --- | --- |
| `PK3Index`, `PK3PublishedIndex`, `PK3Loader` | Reuse ownership lookup, manifest identity, mounted archive reading and shared extraction. | `AssetBridge`; every required path resolves through the same index |
| `PackageStore`, `PackageDownload`, `Pk3Mirror`, `AssetRequest` | Reuse acquisition/retry/cache behavior; audit their transitive imports rather than replace them with raw fetches. | Concurrent consumers share work; cancellation affects only the abandoned consumer |
| `PK3TextureLoader` | Preserve format/companion-map/sidecar selection behavior; replace Babylon upload and GPU-object caches. | `LiteTextureUploader`; resource identity includes revision, usage and reduction settings |
| `texture/TextureManager`, `TextureMemoryManager` | Implement separate Lite resource accounting, residency and release rules. Do not store Lite textures in Babylon caches. | `LiteResources`; repeated load/release has stable counts |
| `TgaDecoder` | Reuse pixel decoding where possible; avoid data-URL round trips when pixels are already available. | TGA orientation/alpha fixture |
| `TextureReduction` | Reuse size/pixel reduction; preserve exclusions such as alpha-tested surfaces and lightmaps. | Same picmip selection and reference pixels |
| `KTX1Loader` | Reuse parsing/software-decode algorithms where separable; port format support checks, cube/array upload and mip ownership. | Compressed-supported and software-fallback cases |
| `KTX2DecoderRuntime`, `KTX2DecoderWorker`, `KTX2SidecarLoader` | Existing integration uses Babylon loader/worker-pool internals. Keep it; add a bounded Lite decode/upload path with local decoder assets and source-image fallback. | Stalled worker, corrupt sidecar and unsupported GPU format cases |
| `BspLoader` | Reuse IBSP/FBSP parsing and leaf/cluster data directly. | Same map metadata and geometry source hashes |
| `BspMeshBuilder` | Port mesh allocation/material assignment, preserve spatial partitions and surface metadata. Do not import the builder to build an invisible Babylon world first. | `LiteWorldBuilder` |
| `bsp/mesh/faceBuilders.ts`, `vertices.ts`, `tangents.ts`, `coordinates.ts` | Reuse geometry algorithms with explicit dependency checks. `coordinates.ts` has a Babylon `Vector3` helper alongside tuple conversion; imports are not entirely renderer-free. | Small reviewed extraction only if needed; mirrored-axis/winding/UV tests |
| `bsp/mesh/lightmaps.ts` | Reuse page interpretation/gain; port texture-array/cube/raw upload and encoded layer-coordinate handling. | Array-layer boundary and authored lightmap-size cases |
| `bsp/mesh/spatialBatching.ts`, `pvs.ts` | Reuse partition calculations; preserve lightmap batching and per-face cluster membership. | Same visible surface IDs along a recorded camera path |
| `PVSCuller` | Reuse visibility decisions after separating mesh identity. Port writes from `mesh.isVisible` to Lite's supported visibility/bundle invalidation API. | `LiteWorldVisibility`; hide/restore, multiple-cluster batches, camera jumps |
| `FrozenWorldMaterials` | Retain Babylon dirty-light/material handling. Native pipeline caching and packet updates need their own rules, not a fake freeze flag. | No stale lighting after actor/projectile import or light membership changes |
| `bsp/mesh/brushModelBuilder.ts`, `BspEntityHandlers`, `AmbientEntityHandlers` | Reuse entity/transform plans where independent. Port mover visual handles and release hooks; do not duplicate mover gameplay/collision rules. | `LiteBrushModels`; door/lift/explosive reset, brush patches and shared lightmaps |
| `MapParser`, `BrushGenerator`, `PatchGenerator`, `PrefabLoader`, `PrefabInstance` | Retain editor/text-map paths. Only port when a chosen Lite application needs them; BSP viewer does not depend on editor migration. | Separate capability milestone |

### Material and shader features

Paths are relative to `src/engine/loader/` except fog/rendering entries noted.

| Current owner | Proposed work | Important parity case |
| --- | --- | --- |
| `Q3ShaderParser`, `Q3ShaderTypes`, `ShaderSourceBlocks` | Reuse authored shader parsing and stage descriptions; don't start a second parser. | Templates/conditionals, material directives and shader aliases |
| `Q3ShaderRegistry` | Reuse definition/dependency decisions; audit methods that construct or retain Babylon materials and scene state. | New mount/override and reload cannot retain old material objects |
| `Q3ShaderMaterialFactory.ts` | Port material selection to native Lite Standard/PBR/plugin or custom WGSL families. Keep current dispatch intact. | Coverage report for every material family encountered |
| `Q3NodeMaterialBuilder` | Port the supported Q3 stage subset; a Lite NodeMaterial loader is not a compiler for SHAG's Babylon node graph construction API. | Equivalent output and shader variants before selecting an implementation |
| `Q3Blend.ts` | Translate exact authored color/alpha factors and blend order. Lite native ShaderMaterial has an explicit `blend: GPUBlendState` option; alpha/additive presets alone are insufficient. | Filter passes, alpha test, additive RGB/alpha and depth-writing transparency |
| `GlowOverlayShaderMaterial` | Port base + lightmap + glow composition to WGSL and preserve layered-lightmap semantics. | Dark base still receives the correct emissive contribution |
| `FilterBlendShaderMaterial.ts` | Port multiplicative framebuffer behavior and fog interaction. | White leaves the framebuffer unchanged; no opaque-white artifacts |
| `BspBakedLightingPlugin` | Implement native plugin/binding or a dedicated material family; preserve deluxe direction, gloss, lightstyle gain, static-fill exclusion and array sampling. | Normal/gloss direction, transformed brushes, multiple lightmap pages |
| `BspVertexLightingPlugin` | Port vertex-light selection and gain, including interaction with other material passes. | Vertex-lit models/surfaces without double lighting |
| `Q3StageColorPlugin` | Port RGB/alpha vertex/constant/wave contribution and UBO ownership. | Alpha vertex fade and exact-vertex color |
| `Q3DistanceRampPlugin` | Port distance-dependent wave/color/alpha calculation and camera inputs. | Main camera vs reflection/portal camera distances |
| `Q3EnvironmentPlugin` | Port authored cube/surround sampling, reflection direction and orientation. | Surround follows view ray; cube follows reflected view |
| `Q3SoftParticlePlugin`, `Q3SoftParticleDepth` | Port opaque-depth sampling and intersection fade; share one suitable depth source per camera. | No fading against held weapon depth or wrong render target |
| `ShaderAnimationSystem` | Reuse tcMod/wave scheduling formulas after reviewing texture/material setters. Write Lite uniforms/UV transforms on the supplied clock. | Pause/seek/animation restart, no cumulative UV drift |
| `rendering/AtmosphericFogPlugin`, `AtmosphericFogShader`, `AtmosphericFogGlsl`, `WorldFogController` | Reuse fog descriptions/math as reference; port native WGSL bindings, pass-specific mixing and controller output. Preserve global vs local/underwater precedence. | Additive fades to black, filter to white, height and sun/sky terms |
| `bsp/WorldFog.ts`, `BspFogVolume` | Reuse parsing; port volume/scene/material application and lifetime. | Crossing fog volumes, underwater, sky and map unload |

Material construction is not one universal shader. Start with a small tested
set of surface families. Preserve native Standard/PBR lighting through native
plugins when possible; use custom WGSL where authored Q3 behavior warrants it.
Reimplementing all PBR/light/shadow behavior in one giant shader would greatly
expand the project and the maintenance obligation.

### Lights, sky and environmental passes

Paths are relative to `src/engine/`.

| Current owner | Proposed work | Important parity case |
| --- | --- | --- |
| `SkyLightSystem` | Port light/environment/day-night application, reuse time/color calculations where separable. | World baked-light policy and model illumination remain consistent |
| `lighting/DynamicLightCluster.ts`, `DynamicLightSafety.ts` | Retain existing optimized classic path. Map light data/scoping to Lite clustered or forward lights and device limits. | Weapon-only light must not leak into the world cluster |
| `StreetLampSystem` | Port static clustered lights and activation rules only when used. | Light scope, night transition and correct disposal |
| `AreaLightPanel`, `AreaLightManager`, `MapAreaLightEntities`, `AreaLightAssets` | Reuse map light specs; native area-light equivalent was not established. Keep unsupported status explicit rather than replace rectangles with point lights silently. | Textured panel illumination and local LTC/blur assets |
| `SunGodRays`, `GodRaysController`, `MapGodRayEntities` | Reuse emitter interpretation; port scattering passes and visibility/occlusion rules. | Occluded sun/emitter and quality-cost parity |
| `MapEmissiveSurfaces` | Reuse extraction algorithm after separating Babylon mesh/vector input. | Same authored emissive surfaces feed water/lighting |
| `loader/texture/SkyboxLoader`, `bsp/mesh/skyClouds.ts` | Port cube/sky mesh creation and cloud layers; preserve authored face orientation and UV animation. | Seams, depth, gamma and sky fog |
| `rendering/SkyVisibility` | Reuse cluster bounds/visibility logic; port mesh references and callbacks. | Sky pass stops/returns correctly across rooms |
| `SkyPortalView` and helpers in `SkyPortal.ts` | Reuse portal transform rules; implement a dedicated camera/task/composite. | Alternate camera, inherited rotation and exclusions; no recursive capture |
| `SurfaceCubemaps` | Port static scene capture/cache/assignment or explicitly evaluate pre-baked probes later. Native local environment input is not proof of dynamic capture support. | Surface-local origins, excluded transient actors/lights, probe release |
| `SceneDepthCapture` | Retain its WebGL2 blit optimization. Lite gets a world-pass depth product with correct resolve/conversion, not the GL hook. | Clear/background depth, MSAA, resize, camera-space Z sign |

### Water: its own migration milestone

Paths are relative to `src/engine/rendering/water/`.

| Current owner | Proposed work | Important parity case |
| --- | --- | --- |
| `LiquidSurfaceSystem` | Port visible-surface classification, tier scheduling, occlusion decisions and lifetime; preserve gameplay volume distinction. | Invisible liquid brushes do not become drawn surfaces |
| `UnifiedWaterMaterial.ts` | Port material factory, normal/detail/fog/specular/refraction logic and fallback resources. | Water/slime/lava families and actual effective quality settings |
| `WaterDepthProvider` | Consume Lite world depth, with a documented fallback if unavailable. | Visible-only scheduling and no weapon-camera contamination |
| `WaterRefractionProvider` | Port world-color/depth capture, candidate filtering and camera ownership. | Rendered surface never samples its active output attachment |
| `WaterProbeCache` | Port patch grouping, static cubemap capture and cache invalidation. | Multiple rooms/heights; cancellation during capture |
| `WaterReflection` | Retain separate reflection implementation; audit whether/when it is actually selected before committing to a Lite counterpart. | No dead/optional path gets mistaken for mandatory live behavior |
| `WaterActorReflection` | Port actor selection, styles/outline handling, reflected camera and depth. | Followed player/team style, target changes and actor removal |
| `WaterDisturbances` | Reuse bounded impulse/timing algorithm; adapt math and shader upload. | Ripple age on pause/seek and map transition |
| `WaterSurfaceLighting` | Reuse map-light/emissive selection; port texture baking/upload and resource ownership. | No transient gameplay light baked into static scenery |
| `StaticVisibilityIndex` | Reuse BVH intersection algorithm with geometry/ray input instead of Babylon mesh scraping. | Same occlusion result; no repeated geometry readback |
| `WaterNoise.ts` | Reuse generated pixel math; upload once per intended lifetime. | Deterministic normal texture, no reload leak |

### Models, animation, cameras and held weapons

Paths are relative to `src/engine/` unless prefixed FPS.

| Current owner | Proposed work | Important parity case |
| --- | --- | --- |
| `ModelAsset.ts`, `animation/PlayerModelAssets.ts` | Reuse indexed bytes/optional asset policy; pass embedded GLBs into Lite. | No loose primary model requests or optional-sidecar retry storms |
| `ModelLoader`, `MD3Loader` | Port model/skeleton/material creation. MD3 file data parsing and frame selection can inform a separate geometry uploader. | GLB and required MD3 projectile/map-model coverage |
| `ModelSourceCache`, `ModelInstanceCache`, `MaterialCloneBatch` | Port immutable source sharing and instance-private state with explicit resource owners. Don't call Babylon clone interception from Lite. | One instance can die while another keeps geometry/textures and private skeleton |
| `AssetPreloader` | Port required-media preparation against the actual runtime caches that will be consumed. | Preloaded held view is really reused at first draw |
| `TagsLoader.ts` | Reuse text syntax/resolution; adapt `Vector3` tag offsets/rotations and socket handles. | Packaged tags, GLB tag nodes, empty-bone root and missing optional sidecar |
| `PlayerModelManager` | Port container instancing, clip loading/retargeting, root-motion removal, tint, pose stepping and release. | Independent skeletons; missing optional animation; deterministic paused pose |
| `AnimationLoader`, `AnimationBlender`, `PlayerAnimationController` | Reuse policy where separate; port Babylon curve/group operations and blending bindings. | One-shots, locomotion crossfade, additive layers, speed and seek |
| `PlayerAnimationState.ts`, `AnimationStateBridge.ts` | Reuse state-selection algorithms subject to import audit. Don't derive a second gameplay state from rendered meshes. | Same animation intent from the same movement state |
| `HumanoidRig`, `ProceduralLayers` | Port bone/node resolution and procedural pose writes; keep named-role mapping and operation order. | Lean/aim overlays after animation; attachment transform follows final pose |
| `CameraSystem`, `CameraInputHandler`, controller classes | Retain current scene/camera ownership. Start Lite with a minimal controller/recorded pose; integrate game input through a renderer-independent pose sink later. | Correct canvas, lock/focus resets, controller cleanup |
| `FirstPersonPose`, `FirstPersonMotion`, `FovSettings` | Reuse pose structure/motion equations; replace `applyFirstPersonPose`'s camera-specific applicator. | Roll reset, crouch/ledge/slide transitions and FOV |
| `FirstPersonEffectStack`, `AdsZoom`, individual viewport effects | Reuse clocked effect calculations after import review; port `FPSApplicator` and `ViewportEffectsManager`'s scene-facing application. | Local/followed/demo effect parity with one clock |
| `WeaponViewManager` | Port held-model cache, cameras/layers, ADS/attachments/lighting, lifecycle and preload adoption. | Independent weapon FOV/depth; no world clipping or duplicate preparation |
| `WeaponBob`, `WeaponRecoil`, `WeaponSwitchAnim`, `WeaponReloadAnim`, `WeaponHolsterAnim` | Reuse calculation/state machines where they accept plain values; review callbacks and time sources before using them. | Identical timing, cancellation and outputs |
| `WeaponBarrels`, `WeaponCharge`, `WeaponLighting`, `BladeEnvironment` | Port node/material/light writes; reuse configuration and motion rules. | Correct plasma barrel sockets, charge appearance, weapon-scoped light |
| `WeaponCameraCandidates.ts` | Retain Babylon candidate hook; provide an explicit Lite weapon draw set. | World geometry never pays the weapon pass's candidate scan |
| `AmmoCounterDisplay` | Port/update the weapon's dynamic display texture or an equivalent small atlas. | Changed ammo appears without reallocating material/texture every frame |
| `PlayerOutlineProxy`, `PlayerOutlineProxyRuntime` | Retain experimental classic hook. If Lite supports the same optimization, create a dedicated native outline pass, with the same provenance checks. | Do not make experimental proxy assets a mandatory dependency |

`PlayerModelManager` includes a Babylon-private `_goToFrame` workaround. That is
evidence of an engine-specific binding that must not be copied mechanically.
The desired behavior is stable deterministic pose stepping, not emulating a
private member with the same name.

### Combat effects and FPS presentation

Engine generic render mechanisms stay in SHAG; FPS-specific choices below stay
inside the FPS checkout. These tables deliberately include the newer batching
implementations rather than assuming every effect is a classic particle system.

| Current owner | Proposed work | Important parity case |
| --- | --- | --- |
| Engine `ProjectileManager` | Port model/trail/light rendering and lifecycle; preserve the distinction between server-driven visual updates and any prediction/local trace path. | Rejoin cannot update a disposed trail or attach late media to a new scene |
| Engine `EffectGeometry.ts`, `WeaponSlash` | Reuse shape/ribbon math; port dynamic mesh writes and material state. | Fixed topology, active vertex/index count, camera-facing orientation |
| Engine `HitscanEffects` | Reuse hit/endpoint selection and seeds; route presentation to Lite implementations. Do not reintroduce world raycasts when authoritative contact is supplied. | Hero muzzle vs remote muzzle; world contact and liquid interaction |
| `VoltaicEffectRenderer`, `VoltaicInstanceBatch`, `VoltaicShaderMaterial.ts` | Port pooled batches and custom instance streams; native shader material/buffer implementation must preserve dirty-range behavior. | Multiple simultaneous beams, impact normals, target switches and removal |
| `VoltaicBeamGeometry.ts`, `VoltaicProfiles.ts` | Reuse geometry/profile algorithms where import-safe. | Same seeded arc geometry and hero/world/chain profiles |
| `RailEffectRenderer`, `RailShaderMaterial.ts`, `RailBeamGeometry.ts`, `RailProfiles.ts` | Reuse templates/profiles; port GPU materials/batches. | Beam/impact lifetime, helix, ordering and demo seek |
| `ExplosionEffect`, `ExplosionBatchRenderer`, `LayerBatch`, `ExplosionBatchMaterial.ts` | Port the existing thin-instanced analytic animation, not a new per-explosion mesh/particle tree. | Capacity/recycle policy, sparks, smoke, transparency and shared materials |
| `ImpactSparkRenderer`, `MuzzleFlashRenderer`, `StreakTracerRenderer` and their material files | Port custom instance layout, pooled lifetime and shader time uniforms. | No first-shot compile/upload hitch or per-shot allocation regression |
| Engine `PointLightPool` | Reuse capacity/reuse policy and port light handles/cluster membership. | Expired lights detached before release; muzzle-only scoping retained |
| Engine `EffectPreloader.ts` | Prepare the actual Lite effect variants/passes before play, with bounded cancellation-aware waits. | First use adds no unseen mandatory pipeline variant |
| FPS `RemotePlayerLogic` | Reuse state extraction/animation intent and visibility math where independent. | Same snapshot creates the same intended player presentation |
| FPS `RemotePlayerRenderer`, `DroppedWeaponRenderer`, `AttachedBlade.ts` | Implement Lite model/rig/weapon sinks, retaining entity IDs and source ownership. | Respawn, dropped/held transition, team style, blade normalization |
| FPS `ServerProjectiles` | Reuse interpolation/bookkeeping; replace direct `getProjectileManager()` calls with the Lite presentation destination. | One interpolation sample per entity; no duplicate simulation |
| FPS `GameEvents`, `FrameEffects` | Later adapt visual dispatch/composition; keep network authority and event semantics intact. | Exactly-once transient effects, clock and teardown |
| FPS `FollowedViewWeapon`, `SpectateView`, `SpectateEyeCamera`, `DemoPovState` | Preserve watched-player choices, clocks and weapon state; port camera/model writes. | ADS/LG beam after changing spectate target; paused and resumed demo |
| FPS `DemoAnimationTimeline`, `DemoEntityTimeline`, `DemoEventTimeline` | Reuse time/event policy where independent; keep GPU presentation outside the timeline. | Backward seek, discontinuity, speed changes, event reconstruction |
| FPS `DemoService`, `DemoViewer`, `CinematicDemoPlayer`, `DemoOverlayController` | Retain current viewers. Build a separate Lite presentation adapter; a working Lite map viewer does not imply full demo playback support. | Normal/reel/cinematic playback, pause, seek and POV changes |
| FPS `EntityManager`, `FPSPickup`, procedural pickup classes/factories | Reuse definitions, recipes and game rules; port geometry/material/animation handles. | Pickup spawn/collect/respawn, shader transparency, prompt projection |
| FPS `BombRenderer`, `BombSiteMarkers`, `BombSiteDebris` | Port models, dynamic labels and debris appearance without moving round/bomb rules into the engine. | S&D round reset, labels visible through intended layers only |
| FPS `DamageNumbers`, `CartoonHitEffect`, `GibSystem`, `RagdollSystem`, `TeleportEffect`, `PostGameShowcase` | Port the required cosmetic render/rig/body bindings incrementally. | Dynamic text, bone/trail release, deterministic showcase/death-camera control |

### Remaining systems and deliberate exclusions

| Current owner | Proposed work / boundary |
| --- | --- |
| `PostProcessingManager` | Compose native Lite tasks for supported effects; do not instantiate compat `DefaultRenderingPipeline`. Preserve settings and pass order. |
| `GlowEffect`, `SSREffect` | Explicit glow mask/bloom or reflection implementation needed. Full-screen bloom is not equivalent to selectively tagged emissive glow; no native SSR equivalence was established. |
| `CelOutlinePostProcess`, `ColorCorrectionPostProcess` | Port depth-edge and final color-matrix shaders. Accessibility correction remains in the intended final output position and covers weapon/world consistently. |
| `FogEffect` | Port scene fog application and coexistence with atmospheric/local/underwater fog; don't run two fog models unintentionally. |
| `PrecipitationEffect` (`RainEffect.ts`), `DebrisEffect`, `LocalDebrisEffect`, `LocalDebrisManager` | Port classic/GPU particle usage through a native system or purpose-built GPU batches. Native NPE support does not implement imperative Babylon particles. |
| `WindSystem`, `ThunderEffect` | Reuse gust/trigger policy where possible; separate scene/light/vector application and audio ownership. |
| `SpriteManager`, `BillboardSprite`, `SpriteSheet`, `SpriteBuilding`, `SpriteBuildingManager` | Port atlas, billboard, camera and instance binding; distinguish generic engine capability from what the selected game actually uses. |
| `ProceduralTextureGenerator` | Reuse pixel recipes; replace DynamicTexture/canvas uploads and cache lifetime. |
| `WorldIndicatorSystem`, FPS HUD projection, `WeaponPreview` | DOM widgets can remain, but projection and 3D preview calls need Lite-specific services. Check import graph; DOM appearance alone does not make a widget renderer-independent. |
| `ScreenTransition` | DOM overlay can remain in principle; `fadeSky` reads `SkyLightSystem` and needs an explicit color source in a Lite app. |
| `AudioManager`, `audio/AudioV2Sfx.ts` | Asset bytes/mix policy can remain. Audit Babylon Audio V2 and scene/spatial bindings separately; a new graphics renderer does not require rewriting all audio, nor make it independent automatically. |
| `PhysicsSystem`, `BabylonPhysicsBackend` | Keep current integration. A Lite playable app needs a body/transform/query adapter or a deliberately isolated physics owner; fake/invisible classic render scenes are not the default solution. |
| `SweepCollisionBackend`, `CollisionManager`, `MovementProfile` | Preserve authoritative movement/collision semantics. Reuse pure/shared algorithms; adapt any Babylon vector/scene-facing interfaces only where the new client needs them. |
| SHAGGED/editor picking, gizmos and viewport tools | Retain existing renderer. A separate Lite game renderer does not require editor parity first. |
| Dedicated server, lobby, bots, protocol, demo file format | No migration requested. Renderer selection is a client presentation concern; don't add renderer-specific fields to authoritative snapshots. |

## Roadblocks that deserve early proof

### 1. Native plugin support is richer than the compat layer, but has constraints

The native [`MaterialPlugin` contract](https://github.com/BabylonJS/Babylon-Lite/blob/1a2728c6d44383ef3a79cfc680e2e761b4f1e986/packages/babylon-lite/src/material/plugin/material-plugin.ts)
has uniform fields, `writeUbo`, sampler declarations and texture binding hooks.
It can preserve built-in PBR/Standard lighting while adding SHAG logic. The
compat rejection of SHAG's hooks is therefore not proof that native plugins
cannot implement them.

However, inspected `PluginSamplerDecl.textureType` declares `texture_2d<f32>`,
not arbitrary cube or array types. SHAG's baked-light material uses layered
lightmap arrays and its environment plugin binds cubemaps. Native ShaderMaterial
has a separate 2D-array sampler option, but changing the entire material family
to use it can also mean owning lighting/shadow behavior ourselves. SHAG also
writes some values in `hardBindForSubMesh`; translating those to material-owned
UBOs needs careful per-mesh/shared-material analysis.

**Proof:** one real layered-lightmap/deluxe/gloss material with dynamic light and
fog, on a static world batch and transformed brush. Compare native plugin and
custom-shader paths. If the missing capability is narrow, consider a tested
upstream extension later. Using separate per-page textures is a valid exploratory
fallback, but any extra draw calls must be counted and the result cannot be
claimed equivalent to our existing batching.

### 2. Custom instance payloads are more than ordinary thin instances

SHAG's Voltaic batch writes `iStartSeed`, `iEndImpact`, `iColorLife`, `iParams`
and impact normals using Babylon's arbitrary thin-instance buffers. Explosion
and impact batches have similar payloads. The inspected Lite ShaderMaterial
attribute union contains standard mesh attributes; its thin-instance API exposes
matrix/color streams rather than a verified equivalent of every custom stream.

**Proof:** port one existing batch with multiple live instances. Candidate
designs are native storage-buffer records indexed by the shader's instance
index, or a narrow custom instance-stream extension. Both require an executable
pipeline/layout test; neither was run here. Preserve current seeding, dirty-range
uploads and slot recycling. Replacing a batch with one draw per spark/beam would
undermine the performance objective.

The published-package follow-up identifies another concrete option:
`createRenderShader` accepts explicit GPU vertex-buffer layouts and raw render
draws can bind vertex-capable storage allocations. An instance-step payload
layout could avoid the high-level ShaderMaterial attribute restriction. This
needs its own task/depth/camera/culling integration proof; it is not evidence
that arbitrary thin-instance streams work through compat. Shipped compat
silently ignores stream kinds other than matrix and color.

### 3. Camera, pass and resource ownership

Lite has explicit ordered tasks and per-pass cameras, but our two-camera held
view, portals, water, depth consumers and postprocessing are a substantial
integration. A frame graph alone does not prevent texture feedback or stale
targets after resize. Reverse-depth and screen-coordinate conventions affect
fog, soft particles, decals, outline widths and depth reconstruction.

**Proof:** world + held weapon + sampled opaque depth at two FOVs, with resize,
MSAA and a deliberately moved camera. Confirm pass order and which output is
sampled. Then add one offscreen portal/reflection, with no transient global
visibility overrides leaking into another task.

Resource lifetime is equally important: Lite's documented removal from the last
owning scene retires a mesh. A cached source/prototype cannot be treated as a
Babylon mesh that is removed and re-added indefinitely. Record immutable source
ownership, instance references, scene/task membership and cancellation cleanup
separately in `LiteResources`.

### 4. Animation/physics and gameplay are interwoven in the client

Native glTF support does not establish SHAG retargeting, rig attachment,
procedural layers, ragdolls or demo pose parity. Current `Game`, FPS controller
and visual dispatch hold concrete renderer objects. Existing registries do not
already provide a complete renderer-neutral game interface.

**Proof:** one actor/weapon fixture driven by the same recorded state and clock,
including pause, seek and watched-target changes. Establish a narrow
presentation adapter from that case before changing the game composition. Do
not promise full gameplay integration as a constructor-only change.

The published clone implementation shares/refcounts skeleton-related mesh
state rather than establishing independently retargeted actor instances.
Compat AssetContainer does not expose SHAG's instantiateModelsToScene contract.
The actor factory and safe independent rig lifetime therefore remain explicit
planning questions. Native loaded bones, blending and seek functions exist,
but the actual two-actor combination still needs proof.

### 5. Optional rendering features still need honest support boundaries

Textured area lights, dynamic cubemap capture, selective glow, SSR, classic
particles and all cosmetic physics were not established as drop-in equivalents.
Some can be implemented with native tasks, some may warrant upstream work, and
some can wait while the renderer remains experimental.

**Decision rule:** an experimental viewer may display a known-gaps report. A
supported game renderer must have defined behavior for its supported quality
settings and required gameplay visibility. It cannot silently drop beams,
teleport effects, team outlines or accessibility correction to pass a speed test.

## A possible frame, expressed as products rather than global hooks

This is a scheduling sketch, not a fixed design. Some inputs require distinct
views or resolves; merging them without checking formats/semantics is unsafe.

```text
input/interpolation/presentation clock (once)
    -> retained transforms, animation pose, effect events, visibility changes
    -> shadow and static/dynamic capture work that is due
    -> sky / world opaque color + world depth
    -> optional resolved/sampleable world-depth product
    -> water/refraction/transparent world effects in authored order
    -> world-only postprocessing where required
    -> held-weapon view with its own FOV and depth ownership
    -> final composition / agreed shared effects / accessibility color output
    -> DOM HUD and overlay presentation
```

The exact held-view/postprocess ordering must be compared with SHAG's intended
appearance; a dedicated weapon depth attachment or ordered clear is a design
choice to prove, not a requirement to discard depth indiscriminately. Depth
consumers should declare the camera, projection convention, dimensions, format,
sample count and lifetime of the product they consume.

## Could this substantially improve performance?

The [native redesign study](babylon-lite-native-performance-2026-10-26.md)
expands this section into concrete instance/effect/animation/material/pass
experiments against published 1.36.0 implementation behavior. Read its count-only
upload preconditions, visibility invalidation and VAT memory/parity gates before
choosing a supposedly faster representation.

The [current-renderer comparison](babylon-classic-optimization-opportunities-2026-10-26.md)
also identifies which opportunities can be implemented in Babylon WebGL2 or
the existing Babylon WebGPU backend. The presence of an idea in this migration
plan does not mean Lite is necessary to implement it.

**Plausibly, especially when render CPU work limits the frame. It is not yet
measured in SHAG.** Lite's structure gives opportunities to avoid work, but
WebGPU alone does not make equal triangles, texture bandwidth, skinning and
full-screen shading free.

Existing SHAG optimizations must be in the reference: lightmap/spatial batching,
PVS, material/texture sharing, animation LOD, clustered gameplay lights, analytic
GPU effect batches, weapon camera candidates and shared depth capture on its
supported path. Babylon WebGPU's render-bundle experiment is also a relevant
comparison. Do not attribute an already-shipped optimization to the Lite port.

| Candidate win | Why it could help | What could erase it |
| --- | --- | --- |
| Less render CPU traversal/submission | Retained draw sets, material-owned render work and bundle reuse | Compat wrapper churn, copying full scene state, per-frame task rebuilds |
| Less hidden-surface work | PVS-driven visibility plus native hidden-packet update policy | Still uploading every hidden instance or invalidating all bundles every camera step |
| Fewer pipeline/UBO updates | Stable feature keys, material sharing, dirty-range writes and pipeline reuse | A new material/define per actor, light or effect spawn |
| Less repeated depth/capture work | Explicit shared products and visible-only secondary tasks | Different cameras/MSAA/formats force extra passes; over-sharing yields wrong pixels |
| Better effect throughput | Preserve analytic instanced effects, perhaps storage-backed payloads | Port falls back to individual draws or uploads all capacity every frame |
| Smaller initial code and shader-tool payload | Native Lite entry can omit classic scene engine/GLSL translators | Eager classic service/loader barrels or compat build retain both implementations |
| Fewer first-use stalls | Explicit preparation and async custom pipeline creation | Hidden additional variants compile at first shot; decoder initialization still blocks |
| Worker rendering | Could improve main-thread responsiveness later | State-copy/synchronization overhead, DOM-dependent features, increased complexity |

Even a large renderer-only gain is diluted by other work. Hypothetical CPU-only
example, assuming serial CPU costs and no new overhead:

| Share of frame CPU time improved | Speedup of that work | Overall CPU-frame speedup |
| --- | --- | --- |
| 40% | 2x | 1.25x |
| 40% | 4x | 1.43x |
| 70% | 2x | 1.54x |
| 70% | 4x | 2.11x |

Formula: `1 / ((1 - share) + share / speedup)`. These are illustrative, not SHAG
predictions; GPU overlap, frame pacing and vsync can change visible FPS entirely.
Use new matched measurements rather than extrapolating the alpha3 profile or
upstream marketing scenes.

Measure CPU render time, GPU task/frame time, p95/p99 frame delivery, scene-state
adapter cost, allocations, upload bytes, actual downloaded code, cold/warm load
stages and resource counts. Require matching visible features, render scale,
resolution, AA, lighting, camera path, actors and effects. A Lite build with no
water/shadows/outlines is not a speed comparison against the full renderer.

## Suggested decision checkpoints

1. **Before any runtime work:** agree that this is a separate post-1.0 research
   application; pin versions and representative cases. No production aliases or
   engine defaults change.
   Complete the relevant extraction design records first: current callers and
   compatibility API, spaces/units/color/matrix layout, ownership, clock/events,
   cancellation and behavior fixtures. Choose only the groundwork needed by
   those cases; the complete catalog is not a mandatory refactoring project.
2. **Before calling it a promising renderer:** show indexed DM2 and difficult
   material cases with explicit missing-feature counts, measured frame/load costs
   and stable repeated cleanup.
3. **Before a full game adapter:** prove layered materials, batched instance
   payloads and actor/weapon/depth ownership. These are the likely cost drivers.
4. **Before player exposure:** complete supported gameplay visibility, lifecycle,
   physics/animation and demo behavior; report actual fallback and feature scope.
5. **Before considering any replacement:** establish sustained benefit across
   representative hardware/browsers and maintenance costs. Keeping the current
   renderers indefinitely remains an acceptable outcome.

No calendar estimate or claim of a complete migration is made. We can revisit
upstream capability when implementation starts; some roadblocks may have narrowed
by then. Reuse the evidence and acceptance cases rather than freezing today's
API workarounds into a permanent plan.

## Evidence and validation for this drafting pass

Current owners were checked against TypeScript imports/declarations and selected
implementations, including engine services, loader/geometry/material paths,
water/depth, lighting, animation, camera/weapon, batched effects and FPS visual
dispatch. Relevant manuals: model loading, camera system, service registries,
render variables, BSP and shader system. An ignored TypeScript-AST inventory
under `.cache/babylon-lite-research/` helped distinguish actual classes from
function modules. It is a source inventory, not an exhaustive API-compatibility
test or a newly published tool.

Pinned upstream references for the additional findings:

- [Native material plugins and declared resource types](https://github.com/BabylonJS/Babylon-Lite/blob/1a2728c6d44383ef3a79cfc680e2e761b4f1e986/docs/lite/architecture/26-material-plugin.md)
- [ShaderMaterial attributes, samplers, storage buffers and blend state](https://github.com/BabylonJS/Babylon-Lite/blob/1a2728c6d44383ef3a79cfc680e2e761b4f1e986/packages/babylon-lite/src/material/shader/shader-material.ts)
- [Thin-instance implementation](https://github.com/BabylonJS/Babylon-Lite/blob/1a2728c6d44383ef3a79cfc680e2e761b4f1e986/packages/babylon-lite/src/mesh/thin-instance.ts)
- [Scene ownership and last-owner removal](https://github.com/BabylonJS/Babylon-Lite/blob/1a2728c6d44383ef3a79cfc680e2e761b4f1e986/docs/lite/architecture/01-scene.md)
- [Frame graph and explicit pass ownership](https://github.com/BabylonJS/Babylon-Lite/blob/1a2728c6d44383ef3a79cfc680e2e761b4f1e986/docs/lite/architecture/28-frame-graph.md)

Assumptions: first fixture is the installed `washoi_dm2` asset set, a second map
can be `washoi_dm11`, no live network changes are necessary to test static/model
presentation, and no runtime implementation is authorized by this drafting task.
Actual fixture availability/content hashes still need recording when a prototype
is built. GPU behavior, the proposed storage-buffer instance design and native
material feature composition remain unverified.

Validation for this documentation-only pass: `npm.cmd run docs:build` passed.
Both research documents also passed local-link, balanced-code-fence and trailing
whitespace checks. Source filename references were checked against the engine/FPS
inventory; `scripts/browser-application.ts` was verified separately outside those
source directories. The manual build does not compile/render research pages or
establish correctness of the proposed runtime. No gameplay/GPU tests, dependency
installation, production action or source-code edits were performed.
