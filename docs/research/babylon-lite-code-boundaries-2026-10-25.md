# Renderer boundaries in the actual SHAG code

Opened: October 25, 2026. Expanded: October 26, 2026.
Status: investigation and proposed groundwork only.
Read alongside the [overview](babylon-lite-renderer-investigation-2026-10-25.md)
and [feature migration map](babylon-lite-migration-map-2026-10-25.md).

This pass follows actual imports, method responsibilities and resource lifetimes.
It also records the owner's additional request: identify small refactors that
would make existing calculations usable by Babylon and Lite before a new
renderer exists. **No runtime separation or groundwork refactor was applied.**
The working renderers and the 1.0 release path remain unchanged.

The [second-round groundwork catalog](babylon-lite-groundwork-catalog-2026-10-26.md)
adds 15 proposed work packages with source owners, important callers, data/time
contracts, wrapper-preserving plans and behavioral acceptance cases. It also
records which apparent helpers should remain renderer-specific. Read it before
turning the shortlist here into implementation work.

The [published API audit](babylon-lite-api-coverage-2026-10-26.md) subsequently
checks exact shipped exports and selected implementations. Its
[pseudocode/file-change companion](babylon-lite-integration-sketch-2026-10-26.md)
connects these data boundaries to proposed load/session/material/game owners.
Treat the sketches as design records with unresolved methods, not runnable
classes or proof that native Lite is a drop-in replacement.

## Concrete finding: share data and decisions, retain renderer objects separately

The maintainable split is not three copies of the renderer directory. Babylon's
WebGL and WebGPU implementations already share scene/material/game code, and
should continue to do so. Lite would be another presentation implementation
consuming the same data and selected calculations.

We do not need to move every reusable file into a new `shared/` folder. Several
existing deep imports are already suitable. Conversely, replacing a Babylon
import with an interface does not make a method independent of scene behavior.

Four useful ownership boundaries:

| Boundary | Owner and proposed rule |
| --- | --- |
| Asset data and calculations | Keep reusable readers/parsers at their existing engine paths. Extract small pure helpers only when there is a real second consumer or a useful independent check. No GPU objects, implicit scene lookup or render-observer registration in newly extracted cores. |
| Babylon presentation | Keep `BrowserRuntime`, `MapLoader`, builders, texture/model caches, effects and current WebGL/WebGPU selection in place. Existing callers keep their APIs. |
| Lite presentation | Separate application first; later an additive `src/engine/rendering/lite/` implementation. Own its resources, passes, preparation and diagnostics explicitly. No import of existing scene-service bootstraps. |
| FPS presentation decisions | Remain inside `src/games/fps`. Interpret snapshots/events, watched subjects, weapon IDs and pickup rules once; send rendering intent to the selected implementation. Engine Lite code does not import the game. |

These are responsibility boundaries, not a demand for four packages, four
registries or a universal renderer class hierarchy.

## Evidence: source imports versus emitted dependencies

Baseline: engine `9bedff2da11cb83345d9612b2f89dca5ca8371c6`, FPS
`0759316308429c2ad36aa1e3bda1b111b22016e7`. TypeScript `5.9.3`.

The [research tracer](babylon-lite-evidence/trace-boundaries.mjs) reads the
repository's `tsconfig.json`, traverses import/re-export/literal dynamic-import
edges, and separately examines TypeScript-emitted JavaScript. It does not execute
application code. [Recorded summary](babylon-lite-evidence/boundary-summary.json)
contains 63 selected entries, entry-file hashes and example dependency paths.
Among those entries, 32 have no reachable `@babylonjs/*` specifier in the
inspected emitted project graph.

Reproduce from the repository root:

```powershell
node docs/research/babylon-lite-evidence/trace-boundaries.mjs
```

Output goes to ignored `.cache/babylon-lite-research/`. The tracked JSON is a
snapshot, not regenerated automatically. Local counts include the entry and JSON
leaves. External-package internals, computed imports and `import.meta.glob` are
not expanded. Re-exports and alternative dynamic branches are followed even if a
production bundler later removes them. **These counts are neither shipped module
counts nor download bytes, and do not prove that a module's behavior is neutral.**

| Entry | Reachable local vertices in emitted graph | Distinct reachable Babylon specifiers | What it tells us |
| --- | ---: | ---: | --- |
| `loader/pk3/PackageStore.ts` | 9 | 0 | Reusable acquisition layer; no reason to write another downloader |
| `loader/pk3/PK3Index.ts` | 13 | 0 | Index lookup can be reused directly |
| `loader/bsp/BspLoader.ts` | 5 | 0 | BSP parsing is already separate from meshes |
| `loader/shader/Q3ShaderRegistry.ts` | 14 | 0 | Definition and resolved-stage lookup are reusable; a second registry would duplicate policy |
| `loader/bsp/mesh/faceBuilders.ts` | 3 | 1 | Only observed Babylon route is through `vertices.ts -> coordinates.ts -> math.vector` |
| `loader/bsp/mesh/types.ts` | 1 | 0 | Type erasure hides the fact that this file also defines Babylon mesh/texture results |
| `loader/map/GpuPreparation.ts` | 2 | 0 | Behavior remains Babylon-specific despite erased type imports |
| `runtime/BrowserRuntime.ts` | 208 | 120 | Existing initialization is a substantial Babylon presentation entry |
| `core/EngineServices.ts` | 173 | 87 | Registering the ordinary services is not neutral Lite setup |
| `loader/index.ts` | 203 | 109 | Avoid the broad loader barrel in a small data-only entry |
| `core/index.ts` | 183 | 87 | A convenient core barrel exposes scene-service dependencies too |
| FPS `client/RemotePlayerLogic.ts` | 2 | 0 | Good reusable decision layer, unlike the model renderer |
| FPS `client/SnapshotStateStore.ts` | 32 | 3 | Apparently data-only entry reaches collision/physics implementation |
| FPS `client/registerServices.ts` | 486 | 124 | Its dynamic FPS barrel is not a lightweight neutral registration function |

Paths in the first eleven rows are relative to `src/engine/`.

Two corrections to tentative assumptions in the earlier map follow from this:

- `Q3ShaderRegistry` can be reused as a reader/resolver without inventing a Lite
  registry. It has singleton/mount state to manage, but the inspected imports
  and methods do not construct Babylon materials.
- `GpuPreparation` is an adapter, not a reusable GPU-readiness abstraction. It
  reads mesh/submesh effects, changes frozen material state, swaps the active
  camera and calls scene readiness. Copy its lifecycle guarantees, not its
  Babylon method calls.

## Actual paths that define the separation work

### Browser startup

```text
FPS client/main.ts
  -> engine/core barrel -> EngineServices -> Babylon scene services
  -> BrowserRuntime -> RenderingEngineFactory + Babylon Scene
  -> registerWashoiServices -> FPS index -> Game and game adapters
  -> CameraSystem / FPSController / FPSPlayer / lobby / scene render loop
```

Adding a `renderer=lite` branch after those static imports would not create an
isolated implementation. The existing factory still returns `AbstractEngine` and
the scene initializer still registers Babylon-owned services.

**Proposed eventual integration:** add a very small FPS browser entry that
chooses and dynamically imports either the existing self-starting `client/main.ts`
or a new Lite application entry. Change `browser.json` to point at that selector
only when integration is ready. The current main module need not be renamed or
turned into a giant adapter to run as the default branch.

Keep `renderer=webgpu` mapped to Babylon WebGPU. Lite selection is a proposal,
not a registered query option today. Do not import both implementations through
a shared barrel. A failed initialization after acquiring a canvas context needs
a whole-session/fresh-canvas or reload policy, not assignment of another engine
to the same scene. Live network admission must not be started twice by fallback.

### Map loading

The actual high-level sequence is approximately:

```text
FPS MatchMapLoader.onServerInfo
  -> operation-owned overlay hold + foreground package scope
  -> ClientMapLoader.loadClientMap -> CameraSystem + MapLoader
  -> MapLoader.loadMap -> serialized/cancellable performLoadMap
  -> buildBspMap
       mount map + parse BSP
       prepareMapTextureBank / resolveMapDependencies / resolveSkyDependencies
       load shader definitions and model/weapon dependencies
       BspMeshBuilder.build + applyTextures + sky/fog/lightmaps
       environment, liquids, cubemaps, entities and required preparation
  -> prediction collision / trigger tables / players / weapons / final holds
```

`MapLoader` owns both useful dependency planning and Babylon scene mutation.
Its `MapLoadResult` also includes `BspMeshBuildResult` and a Babylon `Vector3`
spawn point. Its `finalizeScene` callback is a useful lifecycle hook, but does
not turn the operation into a renderer-neutral loader.

**Small later separation:** extract the dependency-bank validation and asset
planning from `prepareMapTextureBank`, `resolveMapDependencies` and
`resolveSkyDependencies` into a data planner. Keep mounting scopes, package
precedence, sidecar exclusions and shared/dynamic package rules explicit. The
planner takes game-supplied extra dependencies; it must not introduce a new
engine-to-FPS import or hide a Washoi weapon recipe inside a generic renderer.

Do not start by rewriting all of `MapLoader`. A Lite viewer can initially reuse
the clean package/parser/resolver modules and implement only its required load
scope. Extract the common planner once the second consumer proves the needed
inputs, to avoid keeping two dependency-discovery algorithms indefinitely.

### Geometry and materials

```text
BspLoader -> BspFile
  -> faceBuilders -> vertices -> tuple conversion + Babylon Vector3 helper
  -> BspMeshBuilder.buildAll -> Babylon meshes / grouping / raw textures
  -> Q3ShaderRegistry.resolveMaterialProps / resolveMaterialPasses
  -> current material factories/plugins -> Babylon bindings
```

`FaceGeometry` is arrays, while `BspMeshBuildResult` holds actual meshes,
textures, fog volumes and autosprite handles. They share `mesh/types.ts` today.
A common geometry result should contain arrays, surface IDs, bounds and cluster
membership, not `Mesh | LiteMesh` unions. The existing mesh result can remain
exactly where it is for the old route.

Keep the authored shader description and stage decisions common. Keep compiled
materials, resource bindings, plugin injection points and render-target views
per implementation. A new material class per old plugin is not mandatory:
group by the actual composed surface families and preserve their semantics.

### Snapshot/event application and frame work

```text
Game.onServerStateUpdate
  -> storeSnapshotState first (lasting acknowledged match/weapon state)
  -> spectator / followed-subject / join state
  -> lazy RemotePlayerRenderer
  -> handleServerStateUpdate(GameEventContext, state)
       gameplay mirrors + HUD/audio + concrete effects/lights/models

Game.renderRemotePlayers and related frame work
  -> current camera/engine lookup + interpolation/model presentation
  -> gibs/bomb/hit effects/projectiles/audio/UI
```

`GameEventContext` already contains concrete renderers, `PointLight` maps,
followed-weapon objects and cosmetic systems. Renaming it to `RendererContext`
would preserve that coupling. `FrameEffects` gets a Babylon scene callback, and
`ServerProjectiles.render` directly obtains `ProjectileManager`.

Later, separate **state commitment**, **game presentation decisions** and
**implementation-specific drawing** at these call sites. Preserve the current
ordering: lasting state is stored before effects can fail, the followed subject
is synchronized before routing its weapon/death events, and seeks suppress
one-shots without suppressing lasting state. Do not convert this into two
independent snapshot consumers that can disagree about watched subjects.

There is another concrete path:

```text
SnapshotStateStore -> MatchStateManager
  -> CollisionManager -> BabylonPhysicsBackend -> Babylon ray/mesh code
```

`MatchStateManager.processEvent` restores authoritative disabled brush models,
and its reset path also changes brush state. This is legitimate gameplay work,
not dead rendering code. A future cleanup could inject a narrow brush-state
destination or separate that action from state storage. It is **not** a cheap
prerequisite for the static viewer, and its snapshot/round semantics need tests.

## Groundwork shortlist: inexpensive ways to share more code

These candidates are useful before a Lite renderer exists. Size labels are
relative source-review judgments, not time estimates. "Small" assumes preserving
the old API as a wrapper and changing no numeric behavior. Each needs a separate
reviewable patch; no catch-all "remove Babylon imports" commit.

### First candidates: extract a pure core, preserve the existing API

| Priority | Existing class/module and actual coupling | Proposed small refactor | Benefit and boundary |
| --- | --- | --- | --- |
| 1 | `weapon/AmmoCounterDisplay.ts`: `parseAmmoCounter`, `formatAmmoDigits` share a module with DynamicTexture/material/mesh construction and tuning cvar registration | Move only `AmmoCounterConfig`, parser, digit-capacity constant and formatter into proposed `weapon/AmmoCounterFormat.ts`; import/re-export them from the existing file | Same cfg parsing and display formatting for either renderer. The display class stays Babylon-specific. Small, low behavioral spread. |
| 2 | `loader/model/TagsLoader.ts`: parser creates `Vector3` offsets/rotations | Add proposed `loader/model/TagData.ts` with scalar/tuple tag records and pure parsing. Keep `parseTags`/`loadTags` returning their existing shapes via a Babylon adapter | Both implementations use one tags grammar and identical radians/axis semantics. Preserve optional indexed-sidecar behavior; do not loosen it into extra HTTP probes. Small. |
| 3 | `loader/bsp/mesh/coordinates.ts`: tuple conversion/winding reversal live beside `q3ToBabylonVec3` | Put tuple conversion and winding into proposed `loader/bsp/data/coordinates.ts`; retain old function names/exports and the `Vector3` wrapper | Removes the only observed Babylon dependency from `faceBuilders -> vertices -> coordinates`. Keep `(x,y,z)->(x,z,y)` and reversed triangle winding unchanged. Small. |
| 4 | `loader/bsp/mesh/types.ts`: plain `FaceGeometry` and `BuildOptions` share a file with `BspMeshBuildResult` | Place data-only interfaces in proposed `loader/bsp/data/GeometryData.ts`; re-export old types and leave mesh/texture result types in the original file | Separates the type contract, with no runtime speed claim: those imports already erase. Useful alongside the tuple extraction. Small. |
| 5 | `animation/PlayerAnimationState.ts`: selector functions read scalar flags/local XZ velocity, but default-state construction allocates Babylon vectors | Extract `AnimationStateName` and selection logic into proposed `animation/AnimationSelection.ts` with a minimal structural input. Re-export through the original file; keep its existing default-state function | Shared locomotion decisions without porting skeletons/blending. Preserve priority order and angular thresholds. Small-to-moderate because callers/types need checking. |
| 6 | `rendering/AtmosphericFogShader.ts`: CPU `atmFogFactorAt` takes plain coordinates but obtains `WorldFogController` implicitly | Extract proposed `rendering/fog/FogEvaluation.ts` taking explicit numeric active-fog data and eye/position; keep the current helper's default-controller behavior as its wrapper | Same CPU fade calculation for effects and independent tests, without importing the scene controller. Does not port fog shaders/material bindings. Small. |
| 7 | `lighting/MapGodRayEntities.ts`, `MapAreaLightEntities.ts`, `MapEmissiveSurfaces.ts`: entity/face calculations return Babylon vectors/colors; `AreaLightSpec` also allows a live `BaseTexture` | Extract plain light/emission descriptions in proposed `lighting/data/MapLightingData.ts`; keep existing constructors/conversion wrappers and the texture-bearing panel spec separate | Reuse map interpretation, coordinates and HDR color values without coupling data to GPU resources. Moderate: several related consumers and defaults. |

Paths above are relative to `src/engine/`. These names are proposed, not files
created by this research. Keep wrappers until existing callers have an explicit
reason to change; no mass rename or move is needed.

For example, candidate 2 should have this dependency direction:

```text
existing TagsLoader.parseTags ----> new plain tag parser
            |                              ^
            v                              |
  existing Vector3 results        future Lite socket adapter
```

The plain parser must not import `TagsLoader` to reuse its fetching behavior;
that would reverse the boundary and bring the adapter back in.

### Useful next, but broader than a small helper extraction

| Candidate | Actual dependency to remove | Containment strategy / reason to rank later |
| --- | --- | --- |
| `FirstPersonEffectStack`, `AdsZoom`, `WalkBobEffect`, `LandingImpactEffect`, `StrafeLeanEffect`, `SpeedFOVEffect`, `IdleBreathingEffect` | `PlayerState` and `ViewportDelta` use Babylon vectors. Delta factories/combiners call `Zero`, `addInPlace`, `lengthSquared`; effects construct vectors. `DemoPovState` writes state with `.set`. | A small plain-vector output/input contract could free all effect calculations while retaining separate applicators. Change the cluster together, preserving units, state reset, cvars and live/demo clocks. Broad behavioral coverage makes this medium scope, even though much arithmetic is simple. |
| `FirstPersonPose` module | The pose interface is plain data, but applying it imports `FPSApplicator`, which performs camera/vector operations | Expose a data-only pose contract separately; keep `applyFirstPersonPose` as the existing Babylon adapter. Useful with the viewport work; no new universal camera class. |
| `WindSystem` | Gust/direction logic also owns a scene render observer, engine delta time, a singleton, `Vector3` state and `Math.random` | Extract a `WindModel.step(dt, random)` calculation with explicit state; retain the scene wrapper and its default RNG behavior. Preserve timestep/clamping and random-call order. Medium; useful independently for deterministic effect fixtures. |
| `KTX1Loader` | Parser/software pixel algorithms share a module with Babylon capability, numeric format and upload logic | Split format/container/mip data and CPU decoding from capability/upload adapter only when another consumer needs them. Preserve malformed-input and format handling. Medium; do not recategorize all texture loading as easy. |
| `ShaderAnimationSystem` | Wave/UV calculations are mixed with Babylon material/texture setters and one scene observer | Extract sampled stage-animation values with an explicit clock, retain one Babylon binding/scheduler. Audit tcMod order, scrolling pivots and material ownership. Medium, not a stateless rewrite of the whole class. |
| FPS `PlayerModelVisualSettings` | Team/style decisions and RGB conversion share a module with `Color3`, settings imports and `PlayerModelManager` style types | Separate game-owned plain style descriptions and color parsing from backend material colors. Keep HDR channels above 1; hex UI conversion may clamp while world style must not. Medium; useful to HUD/settings too. |

Do not implement a home-grown `Vector3`/`Color3` compatibility library just to
make import counts smaller. A math-only Babylon import does not prevent a
consumer from using Lite. Extract narrow scalar/record interfaces where they
clarify ownership, and assess final bundle impact separately. Avoid replacing
scratch objects with per-frame conversions/allocations.

### Already reusable: do not refactor these for appearances

| Existing owner | Verified useful boundary |
| --- | --- |
| `PK3Index`, `PK3Loader`, `PackageStore`, `Q3ShaderParser`, `Q3ShaderRegistry` | Package bytes and shader descriptions/resolution already have no observed reachable Babylon runtime import. Manage shared mutable mount/registry lifetime explicitly. |
| `LightGridSampling` | `sampleLightGridInto` already accepts numeric coordinates and caller-owned output. Preserve its allocation-free path; no vector rewrite is needed. |
| `BspLightingProfile`, `WorldFog.ts`, `LiquidClassifier` | Existing data policy/parsing is reusable in the inspected runtime graph. |
| `TextureReduction`, `TgaDecoder`, `WaterNoise.ts` | Numeric/pixel generation helpers have no observed Babylon runtime import; browser-dependent encoding helpers still need environment checks. |
| `WaterDisturbances` class | Owns plain impulses and packed float uniforms; Babylon is only a type import used by the scene-keyed WeakMap helper functions. Lite can construct a class instance directly and own it. No algorithm rewrite required. |
| `WeaponBob`, `WeaponRecoil`, `ViewKick`, `WeaponSwitchAnim` | Calculation/state-machine classes are already usable without an observed Babylon runtime import. Review callbacks/clock ownership before using a new driver. |
| `FirstPersonMotion` | Slide/ledge/step formulas are already scalar functions. |
| `VoltaicBeamGeometry`, `VoltaicProfiles`, `RailBeamGeometry`, `RailProfiles` | Geometry/profile generation is already separate from GPU batch/material implementations. Preserve it as the single source of effect shapes. |
| FPS `RemotePlayerLogic`, `DemoAnimationTimeline` | Decision/recorded-time policy is already separate from mesh rendering. Reuse it rather than writing a second behavior implementation. |

### Do not label these easy groundwork

`PlayerModelManager`, `ModelInstanceCache`, `HumanoidRig` and `ProceduralLayers`
have skeleton/container/pose/attachment semantics to preserve. `GpuPreparation`,
`SceneDepthCapture`, `SurfaceCubemaps`, `LiquidSurfaceSystem` and `WeaponViewManager`
exist to manage rendering state. `CollisionManager`, `PhysicsSystem`,
`MatchStateManager`, `Game` and `GameEvents` have gameplay/lifecycle consequences.
These need dedicated seams and verification, not a broad structural type cast.

## A maintainable patch sequence

The October 26 catalog refines this sequence: accessibility matrix extraction
(G1) belongs beside the cheapest helpers; shader sampling/PVS need explicit
state and per-view contracts; weapon motion and browser input scheduling can
wait for actor/integrated-client work. MD3 parsing is medium scope because its
legacy parsed result mixes source-space geometry and converted tag transforms.
Do not mechanically merge visual and collision patch evaluators. Finish the
relevant design records before authorizing a prototype; implementing every
candidate is not a prerequisite for the first static fixture.

This is a proposed sequence for future authorization, not work performed now:

1. **Small foundational extractions:** ammo formatting, tag data, tuple geometry
   helpers/data types. Each is a separate small commit, preserving old exports.
   Existing Babylon clients immediately consume the same extracted logic, so
   there are not two implementations waiting to drift.
2. **Shared decisions:** animation selection and CPU fog evaluation. Keep engine
   binding wrappers; compare old and extracted outputs on edge cases.
3. **Choose any broader groundwork deliberately:** plain viewport effects or
   light descriptions if they benefit existing code now. Do not unblock Lite by
   rewriting the live camera, collision system or entire startup.
4. **Isolated Lite proof:** import approved data/calculation modules directly.
   Own session/resources locally. The research app establishes real needs before
   a common renderer interface is expanded.
5. **Promote only proven common seams:** asset planning, presentation clocks,
   world descriptions and game event intent. Keep implementation objects private.
6. **Optional game integration after the proofs:** a small entry selector and
   FPS-owned presentation dispatch, with current startup as the unchanged default
   route. No duplicate game protocol, simulation or renderer-specific server data.

This order creates useful independent groundwork without making 1.0 depend on
the success or completion of the new renderer.

## Ownership rules that should survive the implementation

| Resource/state | Lifetime owner | What crosses a boundary |
| --- | --- | --- |
| Downloaded archive bytes and shared extraction jobs | Package acquisition/store | Virtual identity, revision and bytes; one consumer's cancel does not cancel all consumers |
| Active mounted map package scope | Map-load/session transaction | Read requests respecting that scope; never a second global mount manager with different overrides |
| Parsed BSP, material descriptions, CPU geometry | Data/asset source owner | Read-only-by-contract arrays/records; do not detach the sole cached ArrayBuffer for a worker |
| Uploaded textures/pipelines/mesh buffers | Chosen renderer session/resource cache | Renderer-private handles only; no `any`, Babylon/Lite object unions or cross-engine disposal |
| Actor hierarchy, skeleton and pose | Chosen renderer's actor instance | Entity/model IDs and numeric pose/animation intent; cached sources do not own another instance's mutable skeleton |
| Frame pass attachments | Render task/session | A named depth/color product with camera, projection, dimensions, samples and lifetime |
| Match state, interpolation, admission, collision authority | Game/network/physics composition | Committed state and rendering intent; visual failure cannot prevent storing an acknowledged state |
| Transient presentation | Presentation clock + selected sink | Stable event IDs, seeds, times and explicit discontinuities; not another wall clock |

On disposal, cancel the operation, stop new presentation work, release
implementation-owned effects/instances/tasks and their resources in dependency
order, then release map/scene ownership. Shared downloads may outlive that scope.
Late results must check the operation/generation before attaching and release
their own resources if obsolete. Do not drain the GPU queue every frame to make
lifetime management appear simpler.

Use direct typed calls for hot presentation updates. Existing loading/UI events
can remain observer-based, but a global event per vertex, actor transform or
uniform update would obscure ownership and add work. A Lite helper should receive
its session/dependencies, not fetch `EngineStore.LastCreatedEngine` or the last
camera from a global singleton.

Keep settings definitions and renderer bindings separate when a second consumer
requires it: `RenderVars` itself imports materials and `PostProcessingManager`.
Reading its default table by importing the whole module is not a neutral settings
API. Preserve saved values; report requested/effective/unsupported feature states
rather than letting the new renderer silently ignore a setting.

## How to keep the boundaries from drifting

For future code, add a scoped import-boundary check rather than hundreds of
wrappers. It should understand type imports, re-exports and transitive routes:

- New pure-data modules must not import renderer objects, scene services or game
  presentation, including through barrels. Existing declarations and behavior
  should be checked separately; type erasure alone is not the acceptance rule.
- Lite presentation may import its renderer and approved data/calculation entry
  points. It must not import `BrowserRuntime`, `EngineServices`, `loader/index`,
  `core/index`, concrete Babylon caches or the FPS registration barrel.
- Engine modules must not import FPS. FPS adapters may import engine data and
  the selected presentation implementation.
- The selector must not statically import either full startup. Confirm produced
  chunks before claiming the unselected renderer is not downloaded.
- Enforce scoped rules on new/extracted modules first. Do not change every
  existing import or make an unrelated legacy violation block the experiment.

The current research tracer is evidence tooling, not a production boundary gate:
it intentionally does not expand glob/computed imports or external package
internals. A future CI rule needs explicit policy, diagnostic paths and its own
coverage before being treated as enforcement.

## Validation required when a groundwork patch is implemented

Small extraction tests should check behavior, not just that a new wrapper calls
the old function. Examples: tag parsing/radians and missing optional sidecars;
coordinate/winding and authored UV orientation; animation priority/angular
boundaries; fog height/distance/pass assumptions; fixed-width ammo clamping.
Preserve existing allocation and timing behavior in frame paths.

Existing reference tests include:

- `src/engine/weapon/__tests__/AmmoCounterDisplay.test.ts`
- `src/engine/loader/model/__tests__/TagsLoader.test.ts`
- `src/engine/loader/bsp/__tests__/BspTextureCoordinates.test.ts`
- `src/engine/__tests__/PlayerAnimationState.test.ts`
- `src/engine/rendering/__tests__/AtmosphericFogShader.test.ts`
- `src/engine/loader/bsp/__tests__/LightGridInto.test.ts`

Use the repository's regression procedure for actual renderer/loader changes,
with headless checks before GPU/manual checks. No changes to the game protocol,
canonical media, packages or deployment should be needed for the first helper
extractions. Whether that remains true must be checked per patch.

## What was actually done here

Source/import tracing and selected implementation reads only. Added the research
tracer and an evidence snapshot; no application modules were run by that tracer.
The earlier overview/feature map remain linked for the wider migration scope.
The proposed new helper filenames, contracts, selector and renderer folders have
not been created. The original October 25 pass performed no dependency
installation, branch switch, runtime refactor or production operation. The
investigation was subsequently committed to `staging`; the October 26 follow-up
continues there as documentation/research only.

Assumptions: preserve both existing renderers, stage useful groundwork before
Lite, keep FPS ownership in its repository, and treat this as future work outside
the 1.0 critical path. Complexity rankings need confirmation from each patch's
actual caller diff. Extracted-core equivalence, new GPU behavior and performance
benefits remain unverified until implementation and measurements exist.

Validation completed for this research pass:

- `node docs/research/babylon-lite-evidence/trace-boundaries.mjs` completed and
  generated the recorded 63-entry evidence. All entry hashes match the source;
  32 entries have no observed reachable Babylon runtime specifier.
- `node --check docs/research/babylon-lite-evidence/trace-boundaries.mjs` passed.
- `npm.cmd run docs:build` passed with esbuild subprocess permissions. This builds
  the engine manual, not research-page rendering or the proposed architecture.
- Research local links, code fences, whitespace and the named existing test-file
  references were checked. No gameplay or GPU tests were run for documentation.

### October 26 follow-up evidence and validation

The [23 additional selected entries](babylon-lite-evidence/groundwork-entries-2026-10-26.json)
and [separate summary](babylon-lite-evidence/groundwork-summary-2026-10-26.json)
record the second pass. Five entries have no observed emitted Babylon import,
but their scene/object/lifecycle behavior still needs separation. They are
follow-up examples, not a complete inventory of every importer.

The research tracer now accepts `--entries-file` and `--output-dir`; default
behavior preserves the original 63-entry result. Output is restricted to
ignored `.cache/` subdirectories. No application module is run by the tracer.

Validation commands for this documentation-only follow-up:

```powershell
node --check docs/research/babylon-lite-evidence/trace-boundaries.mjs
node docs/research/babylon-lite-evidence/trace-boundaries.mjs
node docs/research/babylon-lite-evidence/trace-boundaries.mjs --entries-file docs/research/babylon-lite-evidence/groundwork-entries-2026-10-26.json --output-dir .cache/babylon-lite-research/groundwork-2026-10-26
npm.cmd run docs:build
npm.cmd run gate:biome
```

Both generated summaries matched their tracked snapshots, including all 63 and
23 source-entry hashes. Tracer syntax and `npm.cmd run docs:build` passed.
Separate checks passed for all four research documents: 37 local links, 20 named
existing test references, balanced code fences and trailing whitespace. The
tracer's rejection of output outside `.cache/` also passed with subprocess
permissions. `npm.cmd run gate:biome` passed at the existing baseline (0 errors,
47 warnings) with subprocess permissions; the sandboxed attempt produced no
Biome summary. These checks matter because the manual build does not render
research pages. Renderer behavior, proposed new helpers, actual bundle savings
and performance remain unverified.
