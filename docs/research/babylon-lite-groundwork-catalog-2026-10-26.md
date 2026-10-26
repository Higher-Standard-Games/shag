# Babylon Lite groundwork: extraction plans and readiness criteria

Date: October 26, 2026. Status: source investigation and proposed work only.
No application refactors, renderer selection changes or Lite installation.

Read with the [overview](babylon-lite-renderer-investigation-2026-10-25.md),
[migration map](babylon-lite-migration-map-2026-10-25.md), and
[first source-boundary study](babylon-lite-code-boundaries-2026-10-25.md).
This round expands the groundwork shortlist rather than approving a prototype.
Preserve the working Babylon WebGL/WebGPU paths and keep this off the 1.0
critical path. Proposed filenames and signatures below do not exist yet.

Follow-up: [published Lite API coverage](babylon-lite-api-coverage-2026-10-26.md)
and [integration pseudocode/file changes](babylon-lite-integration-sketch-2026-10-26.md).
Those studies identify the native APIs each extraction could feed, the shipped
compat gaps, and the incomplete material/actor/lifecycle decisions. They do not
authorize the proposed refactors or make all catalog packages prerequisites.

## Evidence and interpretation

Reviewed engine baseline `2e9f61aadfc48ad70ebab7a969ed179cbb8b1527` on
`staging`, FPS `0759316308429c2ad36aa1e3bda1b111b22016e7`. The engine baseline
adds research/workflow documentation to the previous source baseline; it does
not change the runtime. Upstream assumptions remain pinned to the revision in
the overview; this round does not assert new Lite APIs or newer capabilities.

The [23-entry input list](babylon-lite-evidence/groundwork-entries-2026-10-26.json)
and [recorded graph summary](babylon-lite-evidence/groundwork-summary-2026-10-26.json)
extend the previous 63-entry investigation without replacing its evidence.
Entry hashes and observed import paths are reproducible from the root:

```powershell
node docs/research/babylon-lite-evidence/trace-boundaries.mjs --entries-file docs/research/babylon-lite-evidence/groundwork-entries-2026-10-26.json --output-dir .cache/babylon-lite-research/groundwork-2026-10-26
```

The tracer reads source and TypeScript-emitted imports; it does not execute the
game. Its external-package, computed-import and glob limitations still apply.
An entry hash identifies that file, not every dependency's content. Record the
repository revisions as well. The 23 entries are a selected follow-up inventory,
not every Babylon importer in the repository, and overlap conceptually with
earlier candidates. Do not add the two inventories to claim an exhaustive count.

Five follow-up entries have no observed emitted Babylon specifier:
`ShaderAnimationSystem`, `InputSystem`, `CameraInputHandler`,
`TextureMemoryManager`, and `WeaponCameraCandidates`. They still require
behavioral review; none is automatically a renderer-neutral host or service.

There are three separate goals:

| Goal | Acceptance | Example |
| --- | --- | --- |
| Import isolation | Direct/transitive runtime imports avoid classic presentation initialization | Move color matrices out of the postprocess module |
| Contract independence | Public input/output does not require Babylon object methods, engine enums or hidden scene state | Numeric PVS queries with conservative fallback |
| Scheduling independence | The consumer supplies frame/time/lifetime and owns one driver | Input begin/end frame outside scene observables |

Type erasure achieves only part of the first goal. Math-only Babylon imports can
be kept in an adapter or temporarily reused; banning every `@babylonjs/*` package
would also discard useful decoder code without establishing better boundaries.

## Proposed work packages

Size is a source-review judgment, not an estimate. Each row needs an independent
review and behavior checks. Paths in this catalog are relative to `src/engine/`
unless explicitly marked FPS. Keep existing public entry points as wrappers or
re-exports, and have the current renderer consume each extracted core immediately.

| Package | Proposed core | Scope | Why it is useful |
| --- | --- | --- | --- |
| G1 | `effects/ColorVisionMath.ts` | Small | Shared accessibility matrices without importing a postprocess |
| G2 | `loader/shader/Q3StageEvaluation.ts` | Medium; wave-only step is small | One shader animation policy with explicit state/time/randomness |
| G3 | `loader/model/MD3Data.ts`, `MD3Parser.ts` | Medium | Parse bytes without scene/material/model-cache imports |
| G4 | `loader/map/PatchGeometryData.ts` | Medium | Authored patch geometry without constructing meshes |
| G5 | `loader/bsp/PvsQuery.ts` | Medium | Shared conservative cluster decisions, backend-local visibility writes |
| G6 | `math/StaticTriangleIndex.ts` | Medium/broader math verification | Reusable static bake queries from explicit world triangles |
| G7 | `weapon/WeaponChargeState.ts` | Small core; medium integration | Charge progress/shake/appearance intent separated from mesh outlines |
| G8 | `weapon/WeaponSlashMotion.ts` | Small/medium | Shared preset/phase sampling without trail resources |
| G9 | `weapon/BarrelMotion.ts` | Small | Spin and shot indexing without loading/attaching models |
| G10 | Explicit frame methods in `input/InputSystem.ts` | Medium, high behavioral sensitivity | Reuse browser input without Babylon scene observers |
| G11 | `camera/MouseLookState.ts` | Small calculation; medium host change | Share sensitivity/angle policy, keep capture lifetime explicit |
| G12 | `rendering/RenderVarDefinitions.ts` | Small schema; medium/larger state split | Read settings without material/postprocess imports |
| G13 | `loader/texture/TextureBudgetPolicy.ts` | Low priority; medium if expanded | Explicit sizing/accounting, without pretending estimates are measurements |
| G14 | `sprites/SpriteSheetLayout.ts` | Small | Direction and atlas calculations separate from texture/material objects |
| G15 | `procedural/ProceduralTexturePixels.ts` | Medium | Shared CPU texture recipes; upload and canvas stay in adapters |

The earlier ammo/tag/coordinate/geometry-type/animation/fog/light-description
plans remain applicable. G1 joins that first group. G7-G9 are useful later
actor/weapon groundwork, not prerequisites for a static map viewer.

## G1: accessibility color math

Source: [ColorCorrectionPostProcess.ts](../../src/engine/effects/ColorCorrectionPostProcess.ts).
`Mat3`, `ColorVisionType`, `simulationMatrix`, `correctionMatrix`, `colorMatrix`
and `asColorVisionType` are numeric policy beside `Effect`, `Constants` and
`PostProcess` imports. `PostProcessingManager` imports the class and coercion
helper; the existing color-correction tests import both math and presentation.

Extract the tables and these functions into `ColorVisionMath.ts`, re-export
them from the old file, and make that file consume the extracted functions.
No scene, cvars, shader registration or singleton belongs in the math module.
Keep the postprocess shader, attachment order and resource disposal untouched.

The contract must say **row-major CPU matrices operating on linear RGB**.
`refresh()` transposes to the column-major uniform. The shader applies a 2.2
display-to-linear power and inverse power with clamping; moving the math does
not decide where a Lite frame is linear or display-encoded. A later WGSL sink
must implement the same intended color transform exactly once at final output,
including held weapons. Do not reinterpret a nine-float array without layout
metadata or assume a WGSL matrix uses a tightly packed nine-float uniform:
`mat3x3<f32>` has 16-byte alignment and a 48-byte size in the
[WGSL host-shareable layout rules](https://www.w3.org/TR/2026/CRD-WGSL-20260806/#alignment-and-size).
The CPU nine-number representation can remain unchanged; packing is the sink's
responsibility. This layout rule does not establish Lite's setter behavior.

Checks: off/zero-strength identity, all three vision types, gray preservation,
correction-then-simulation order, clamping location and uniform transpose. Use
`effects/__tests__/ColorCorrection.test.ts` as the existing reference, retaining
its presentation checks. New CPU fixtures need no `NullEngine`.

## G2: authored shader decisions and animation

Sources: [ShaderAnimationSystem.ts](../../src/engine/loader/shader/ShaderAnimationSystem.ts),
[Q3Blend.ts](../../src/engine/loader/shader/Q3Blend.ts), and existing
`Q3ShaderTypes`/`Q3ShaderRegistry`. The registry already produces useful authored
descriptions. Do not introduce a parallel shader parser or Lite registry.

`ShaderAnimationSystem` has only type imports of Babylon objects, yet reads
frozen materials, mutates textures/colors and owns a before-render observer.
Its time comes from `performance.now()`, with accumulated `deltaTime*timeScale`.
`evaluateWaveFunc` uses `Math.random()` for noise. tcMods are stateful: scroll
and rotate accumulate, stretch assigns scale, turbulence adds per-step offsets,
and transform decomposes into scale/rotation/offset without full shear support.
Static scale is applied on registration. These are observed implementation
semantics, not proof of complete Quake shader equivalence.

First extraction: move wave evaluation with an optional injected RNG whose
default is `Math.random`; preserve evaluation order and call count. Next:
explicit stage state plus `stepStageInto(state, definition, frame, output)`.
The proposed frame supplies delta seconds, accumulated seconds and RNG. Output
includes frame index, UV state and modulation values, not textures or materials.
The classic wrapper continues to own the clock and bind the results initially.

Preserve these details:

- With no tcMods, do not overwrite the loader's compressed-texture orientation.
- Animated texture frames must retain their virtual identities and intended
  target; Standard emissive modulation uses texture level in a special path,
  while other paths multiply color. A common scalar does not settle binding.
- Preserve stage order, shared-material registration and freeze handling in
  the binding layer. One driver steps once, not once for every camera/pass.
- Noise is not presently deterministic, and turbulence is timestep-dependent.
  Absolute seekable sampling would be a separately approved behavior change.
- Negative-time/modulo boundaries, zero frequency, enable/disable time jumps
  and material sharing need fixtures before claiming replay parity.

`Q3Blend` returns Babylon numeric alpha constants and sets transparency queue,
alpha cutoff, alpha-source and depth-write flags. Reuse authored `blendFunc`
and resolved props directly in Lite; add a neutral draw-state resolver only
where needed by both consumers. Its description should include test, factors,
depth write/forced write and sorting intent. Do not copy Babylon enum integers
into a Lite pipeline key, or treat additive-with-source-alpha as ONE/ONE.
`BspMeshBuilder` and MD3 material creation are the important classic consumers.

Proposed fixtures: ordered tcMods, authored scroll/rotation/stretch/transform,
source-image versus compressed orientation, animated emissive frames, seeded
test RNG, alpha-test plus blending, and explicitly authored depth-write stages.
Existing shader-registry tests cover resolution, not the whole extracted clock
or backend material composition; new focused behavior coverage is required.

## G3: MD3 bytes and coordinate meaning

Source: [MD3Loader.ts](../../src/engine/loader/model/MD3Loader.ts).
`parseMD3` and binary readers share a module with material plugins, textures,
mesh creation, animation registration and source-cache helpers. Observed
emitted graph: 149 local vertices and 83 distinct Babylon specifiers. These
counts are graph evidence, not actual downloaded modules or savings.

Important callers: `ModelLoader`, `WeaponViewManager` (weapon and muzzle model),
`ProjectileManager` (projectile and impact), `EditorModelAsset`, and
`console/commands/WeaponCommand`. Preserve `MD3Loader.parseMD3()` and the
existing `MD3Model`/`MD3LoadResult` shapes for those callers.

The parsed model is not a single neutral coordinate representation:

| Existing data | Observed treatment |
| --- | --- |
| Surface frame positions/normals | Numeric arrays remain in source axis order during parsing |
| Frame bounds/local origin | Babylon `Vector3` objects hold the directly read source components |
| Tags | Origins swap Y/Z; axes reorder/negate columns into a Babylon `Matrix` |
| Triangle indices and UVs | Parsed as authored; downstream mesh creation owns further interpretation |

Proposed core: raw MD3 data in documented source space, explicit per-frame
arrays, tag origin/basis numbers, shader references and parse diagnostics.
`MD3Parser.ts` reads this data; `MD3Loader` adapts it back to the exact old
public objects/conversions before calling existing mesh creation. Keep that
legacy result distinct from the raw DTO so Lite cannot double-convert tags.
Do not use ambiguous names like `axis: number[]` without basis/packing meaning.

Retain magic-number failure, version-mismatch behavior, normal decoding,
frame/surface offsets and string termination. Bounds/count/offset validation
deserves a dedicated malformed-input review; it is not safe to silently change
error behavior while claiming a mechanical extraction. Preserve cached byte
ownership and avoid a second full frame-array copy for both adapters by default.

Acceptance: a multi-frame synthetic binary with one non-identity tag basis,
known normals/UVs, multiple surfaces, and exact old-wrapper outputs. Compare
all frames, not just rendered frame zero. Add malformed/truncated cases with
an explicit error policy. `loader/model/__tests__/MD3MaterialReuse.test.ts`
covers a different responsibility and must still pass; it does not certify
raw parsing or coordinate parity.

## G4: three patch paths, not one interchangeable tessellator

Sources: [PatchGenerator.ts](../../src/engine/loader/map/PatchGenerator.ts),
[PatchTessellator.ts](../../src/engine/physics/PatchTessellator.ts), and
[faceBuilders.ts](../../src/engine/loader/bsp/mesh/faceBuilders.ts).

Authored `.map`/prefab/editor patches go through `PatchGenerator.buildMesh`.
It combines validation, a unified tessellated grid, basis-weighted positions,
UV interpolation, finite-difference normals and Babylon mesh creation. Actual
callers include `MapRenderer`, `PrefabInstance`, and `editor/PatchPreview`.
Extract `buildPatchGeometry(definition, tessellation)` returning arrays into
`PatchGeometryData.ts`; leave mesh creation and the old static tessellation
setting in the wrapper initially. Explicit input tessellation avoids making
new consumers depend on another session's global setting.

Do not merge the other paths into it during extraction:

- Compiled BSP `faceBuilders.evaluateBezierPatch` interpolates authored normals,
  lightmap coordinates and vertex colors in addition to positions and UVs.
- Collision `PatchTessellator` uses de Casteljau interpolation with explicit
  endpoint handling, per-subpatch grids and a default parameter of **5**. Its
  comment mentioning a default of 3 does not match the signature. The sweep
  backend also explicitly requests 5. It returns Babylon vectors and bounds
  but does not construct a render mesh.

Preserve each path's numeric operations, winding, seams, degeneracy fallback,
axis convention and tessellation. Replacing collision interpolation by a
visually similar basis evaluator can reintroduce flat-cap errors. A later
collision-array adapter is separate, high-risk physics work; it is not required
to show a Lite static scene. Do not change authoritative collision for render
reuse. Existing `__tests__/PatchTessellator.test.ts` and editor patch tests
are references; add geometry equality/seam/normal/UV cases for the authored path.

## G5: PVS queries versus applying visibility

Source: [PVSCuller.ts](../../src/engine/loader/bsp/PVSCuller.ts).
`findLeafForPoint`/`isClusterVisible` in `BspLoader` already supply the low-level
data queries. `PVSCuller` adds validation, camera-to-BSP conversion, visible-set
caching, dynamic-entity queries and mutation/restoration of mesh visibility.

Proposed `PvsQuery` owns BSP validity, numeric point-to-cluster lookup and
visible-cluster decisions. Inputs are engine-world positions with explicit Y-up
meaning; it converts once at the existing boundary. Keep `PVSCuller` as the
classic wrapper owning mesh maps, original visibility, counters and writes.
Lite can apply query results to its retained draw membership using stable
surface IDs and compiled cluster membership; it must not rediscover membership
from bounding boxes. The pure query must not construct either renderer's mesh.

Preserve conservative behavior for absent/malformed PVS, missing/nonfinite
positions, unknown camera clusters, negative entity clusters and same-cluster
visibility. Preserve the actual current validation at each method; do not
claim every invalid numeric cluster already has identical fallback behavior.
Keep multi-point body tests at FPS callers, so an origin behind a doorway does
not make a visible shoulder disappear. Existing callers include `BspManager`
and `src/cli/audit-pvs.ts`; entity visibility consumers need regression review.

Stationary/same-cluster frames should retain cached decisions. Disposal or
re-registration must restore classic mesh visibility. Portal/reflection/main
views require separate query snapshots or a conservative union; a global set
last overwritten by a secondary camera is unsafe. Querying PVS is not a claim
of occlusion/frustum equivalence or a substitute for Lite draw-set integration.

References: `loader/bsp/__tests__/PVSCuller.test.ts` and
`__tests__/PVSEntityVisibility.test.ts`. Add pure fixtures for every conservative
case and per-view state before introducing a second destination.

## G6: static triangle queries for baking

Source: [StaticVisibilityIndex.ts](../../src/engine/rendering/water/StaticVisibilityIndex.ts).
It snapshots mesh positions into world-space triangles, builds a median-split
BVH with leaves of at most 16 triangles, and calls Babylon ray-box/triangle math.
`WaterSurfaceLighting` builds it lazily during a bake, including hidden/PVS-
culled static blockers. This is not a permanent frame-culling structure.

Separate the existing mesh-to-world triangle adapter from a proposed
`StaticTriangleIndex(worldTriangles)`. Use caller-owned numeric ray inputs
(origin, direction, finite length) and explicit hit semantics. The adapter
retains indexed/unindexed mesh handling and world-transform evaluation.
The core owns its snapshot; moving meshes require rebuilding, not implicit
updates. Filtering eligible blockers stays with the bake caller.

Removing `Vector3`/`Ray` entails more than field substitutions: preserve finite
ray limits, triangle edge/backface/epsilon behavior, degenerate triangles,
box parallel-axis behavior and precision under transformed geometry. First
reuse the current math in a well-labeled adapter if safer; a custom scalar
intersection implementation needs reference comparison, not a confidence claim.
`__tests__/StaticVisibilityIndex.test.ts` already compares transformed geometry,
finite rays, hits and misses against Babylon picking. Extend it for edge cases
before replacing the math. Worker transfer is optional; never detach the only
cached geometry buffer or rebuild the structure every frame.

## G7-G9: weapon motion before weapon rendering

Sources: [WeaponCharge.ts](../../src/engine/weapon/WeaponCharge.ts),
[WeaponSlash.ts](../../src/engine/weapon/WeaponSlash.ts), and
[WeaponBarrels.ts](../../src/engine/weapon/WeaponBarrels.ts).
`WeaponViewManager` owns all three instances; keep that integration intact.

### G7: charge progress and appearance intent

Extract a numeric state machine with explicit `nowMs`, charging flag and charge
duration. Output includes progress, shake, desired charge-outline color/width
and start/release transitions. The classic `WeaponCharge` wrapper retains saved
outline state, `Color3`, mesh writes and the outline-renderer side-effect import.
Its public update result stays compatible, including the release restore signal.

The wrapper initially samples `performance.now()` exactly as today. Changing to
demo time is separate: the current charge path does not become seek-correct
merely because the function accepts a clock. Preserve pulse phase using absolute
time, width normalization by `rootScaleX || 1`, and restoration timing. Caller
logic applies Quad's outline after charge; extraction must retain that priority.
Reset does not itself write restoration to meshes today. Define any desired
new reset behavior as a separate change. Zero/negative duration behavior needs
an explicit decision and tests rather than incidental sanitizing.

### G8: slash phases, then trail geometry if needed

Move slash presets, preset cycling, trigger time, active state and offset
sampling into `WeaponSlashMotion`. Preserve current milliseconds, easing,
trigger cycling, shared frozen idle output and end-of-animation state update.
The existing wrapper reads its clock and delegates `trigger`/`getOffsets`.

Keep trail history, camera basis vectors, ribbon growth, materials, texture,
fade and disposal in `WeaponSlash` initially. `updateTrail` runs at a different
call site from `getOffsets`; do not accidentally advance motion twice or move
its completion update into a render pass. A later numeric ribbon writer can
take two paths, capacity and caller-owned arrays, retaining degenerate padding,
distance-based UVs and double-sided layout. `EffectGeometry` is a Babylon buffer
upload helper with bounds/VAO assumptions, not that shared geometry writer.

### G9: barrel motion records

`update(deltaTime)` advances continuous spin or approaches shot-indexed target
rotation; `fire()` adds signed shot steps. Extract that scalar update from
`BarrelInstance`, with radians, seconds and the current 0.16-second step rate
documented. Keep source cache, generation checks, tag/bone/socket precedence,
loading, hierarchy and axis assignment in `WeaponBarrels`.

One event must index once. Do not replay `fire()` merely because a second camera
draws the weapon. Preserve current root-axis assignment and interrupted loading
cleanup. `findViewBarrelSocket` is already a small lookup, but its contract uses
`TransformNode` and tags: do not replace the complete attachment system to share
one `find` operation.

References: `__tests__/BladePresentation.test.ts`,
`__tests__/WeaponSlashGeometry.test.ts`, `__tests__/SlashTrailInPlace.test.ts`,
and `weapon/__tests__/WeaponBarrels.test.ts`. Add CPU motion fixtures at phase
boundaries, repeated triggers, switch/reset, and multiple shots during spin.
Keep the existing renderer resource/outline tests too.

## G10-G11: browser input and a single frame owner

Sources: [InputSystem.ts](../../src/engine/input/InputSystem.ts),
[CameraInputHandler.ts](../../src/engine/camera/CameraInputHandler.ts), and
`camera/controllers/ICameraController.ts`. Their Babylon imports are types;
their contracts and scheduling still belong to the classic host.

### G10: reuse browser input, separate the scene scheduler

`InputSystem.init(scene, canvas)` owns DOM listeners and two scene observers:
before-render updates action states; after-render clears per-frame transitions.
Expose explicit begin/end input-frame methods and a browser attach/detach path
which does not require a scene. Preserve `init(scene, canvas)` as a wrapper
installing the same classic observers. This need not become a new input engine.

The Lite host later calls begin before all action consumers and end after
them, once per application frame, irrespective of camera/pass count. If a
render fails, cleanup must still have defined behavior; do not clear input
before simulation has consumed it. Render cadence and 125-Hz simulation cadence
are distinct. The frame host must define sampling if multiple simulation steps
occur; this extraction does not authorize changing prediction/input submission.

Preserve pointer capture, pointercancel, release outside canvas, keyboard lock,
text-input focus, context precedence, rebinding and one release after blur/tab
hide. `getScene()` exists as a public compatibility method; no direct
`InputSystem.getInstance().getScene()` or `input.getScene()` use was found in
the source search, but that does not prove every possible external consumer
is absent. Keep it for the classic wrapper; a Lite attachment has no classic
scene to return. Teardown must detach whichever scheduler registered the frame
callbacks and prevent stale captures/listeners after reattach.

### G11: aiming calculation and browser capture

`CameraInputHandler` already accepts `rotationApplier`, but still requires a
`FreeCamera` and guards mouse movement on its presence. The controller config
also lives alongside Babylon controller interfaces. Extract the small aiming
state/update and plain config contract; retain/re-export the existing config
name and setup API. The browser host owns pointer-lock requests, pending
generation, callbacks, error UI, listeners and teardown. The classic host keeps
the direct-camera fallback; Lite supplies its own rotation sink.

Retain pitch clamp `[-PI/2+0.1, PI/2-0.1]`, radians, unbounded yaw, the current
config/cvar inversion rule, sensitivity fallback, ADS modifier and frozen-look
behavior. Do not casually add both raw mouse-delta paths to a Lite camera and
double aiming. This is browser-shared code, not Node/worker-safe input capture.

References: `camera/__tests__/CameraInputHandler.test.ts` and FPS
`client/__tests__/InputFocusRecovery.test.ts`. Add explicit scheduler-order and
multiple-pass tests; preserve focus/capture failure cases before any host change.

## G12: settings schema, state and implementation bindings

Source: [RenderVars.ts](../../src/engine/rendering/RenderVars.ts).
The non-exported `DEFAULT_VARS`, metadata/types, persistence, validation, cvar
registration, scene-material writes and postprocessing coexist in one module.
Constructing the singleton initializes defaults/storage/cvars. The emitted
graph reaches the same 149 local vertices/83 Babylon specifiers as MD3's graph;
equal counts do not mean equal responsibilities or equal runtime bundles.

Start with `RenderVarDefinitions.ts`: metadata, registered names, defaults and
categories only, with no singleton, cvar registration or browser storage access.
Old `RenderVars` consumes it. `RenderVarName` includes future names which are
not all registered; exporting that union alone is not a valid capability list.
Avoid sharing mutable default records across sessions.

A later state/binding split needs explicit decisions on storage and cvar
ownership. Preserve storage key `engine.renderVars`, integer handling, bounds,
debug persistence, change callbacks, requestAnimationFrame batching and which
settings require a reload. The current direct-set rounding list and cvar type
inference are separate mechanisms; characterize both before consolidating them.
Do not register two owners for the same `r_*` names or overwrite saved choices
with effective Lite fallback values.

Keep classic material stashing, freeze/unfreeze restoration, light policy and
postprocessing in its adapter. A proposed capability report can describe
requested/effective/unsupported/reload-required state. Its actual availability
must come from the selected implementation, not a copy of Babylon's device
caps. `r_webgpu` still selects the existing WebGPU path: do not repurpose it to
mean Lite. Reference: `__tests__/RenderVars.test.ts`; add schema/state parity
and persistence round-trip cases when splitting beyond the table.

## G13-G15: lower-priority reusable asset helpers

### G13: texture budgeting and resolution policy

Source: [TextureMemoryManager.ts](../../src/engine/loader/texture/TextureMemoryManager.ts).
No emitted Babylon import, but tracking assumes texture UID, dimensions,
internal-texture access and disposal. It sorts low priority first, then last
access, and protects priorities above 5. Sizing applies max dimension/LOD bias.
The estimator uses RGBA bytes times 1.33 even when handed a compressed texture;
it is not measured GPU memory or an exact block/mip/array estimator.

The runtime initializes the manager, and console commands inspect it. Source
search found no `trackTexture`/`untrackTexture`/`evictLRU` invocation outside
the class. Confirm usage again before implementation: extracting a dormant
accounting policy is a lower-value task than working asset/visibility paths.

If useful later, split numeric resolution rules and victim selection from
renderer-owned resource leases. Budget entries must identify live bytes,
priority, last-use time, pins/references and session. A policy proposes victims;
the resource owner decides safe retirement, shared references and GPU lifetime.
Do not transplant direct `texture.dispose()` eviction into a Lite asset cache.
Exact compressed-format accounting and use tracking are separate features,
not claimed benefits of moving the existing estimator.

### G14: sprite atlas layout and view direction

Source: [SpriteSheet.ts](../../src/engine/sprites/SpriteSheet.ts).
Config/enum, `getUVs`, `calculateDirection`, and `to4Direction` coexist with
texture/material construction. Extract `SpriteSheetLayout` using frame/direction
counts and numeric angles; the classic class delegates and re-exports the enum.
Keep loading, light/emissive setup, alpha and texture sampling in the wrapper.
`BillboardSprite` uses the angular helpers and UVs; `SpriteManager` owns sheets.

Preserve half-sector boundaries, wrapping for negative/multiple-turn angles,
the exact eight-to-four mapping, V flip and quad corner order. The current
frame/direction indexing uses JavaScript remainder, not positive modulo for
every input. Invalid counts/nonfinite angles and negative frame behavior need
an explicit policy before claiming robust general input support. Do not change
atlas orientation while extracting layout. `__tests__/BillboardSpriteUVs.test.ts`
is a reference; add pure direction/boundary cases. This generic engine feature
can wait until an actual Lite consumer needs sprites.

### G15: procedural pixels before dynamic textures

Source: [ProceduralTextureGenerator.ts](../../src/engine/procedural/ProceduralTextureGenerator.ts).
`generateTexture` computes seeded `ValueNoise` samples and clamped/floored RGB,
then draws one CSS rgba pixel at a time into a Babylon DynamicTexture canvas.
Proposed core: immutable preset plus explicit dimensions/seed to caller-owned
RGBA bytes. The wrapper still owns preset registration/cache, canvas/upload,
mips, repeat and disposal; `TextureManager` remains the integration point.

Preserve the name-character seed, octave order, pseudo-4D torus sampling and
color rounding. Canvas alpha conversion, premultiplication and encoding must be
characterized before a byte upload is declared equivalent. CPU extraction is
not permission to change the classic upload method in the same patch. The
existing `NoiseType` label does not establish that alternate noise algorithms
are implemented in this generation path. Fixed small recipes can produce
golden pixel fixtures, followed by a canvas-versus-byte appearance check.
Workers are a later scheduling option with input/output ownership, not an
automatic consequence of having a numeric function.

## Boundaries to keep renderer-specific

| Inspected source | Decision and useful seam |
| --- | --- |
| `lighting/DynamicLightCluster.ts`, `DynamicLightSafety.ts` | Cluster membership, scene component registration, material caps and guarded setters implement Babylon-specific limits. Reuse game light intent; do not apply the WebGPU 1/2 or clustered 4/6 light caps to Lite without measurement. Even constants imported from the safety module reach the classic cluster implementation. |
| `rendering/WeaponCameraCandidates.ts` | Zero emitted Babylon imports does not make it a neutral candidate list: it overrides the scene's active-mesh provider, stores camera/mesh identity and registers scene observers/disposal. Share the world-versus-held-view membership requirement, not this provider implementation. |
| `loader/texture/KTX2DecoderRuntime.ts`, `KTX2DecoderWorker.ts` | The runtime configures Babylon loader globals, worker pool/start behavior and worker messaging. The decoder package itself may remain useful to Lite. Separate bytes/transcode format/capability decisions from upload only after inspecting the pinned decoder output contract; do not import the classic initializer into Lite. Preserve worker timeout/failure/retry behavior and source-image fallback. |
| `animation/AnimationStateBridge.ts` | Numeric local-velocity/aim policy can join the earlier animation-state extraction, but provider defaults, cloned velocity and borrowed slide/wall vectors have different ownership. Keep caller behavior and avoid two state snapshots with different aims/clocks. This is not another independent animation controller rewrite. |
| `weapon/EffectGeometry.ts` | Buffer updates, vertex-layout assumptions and bounds refresh belong to the classic renderer. A plain ribbon-array writer can be shared separately. Preserve fixed-buffer fast paths in the classic adapter. |

These findings refine earlier reuse labels: data policy, transient outputs,
browser hosts, device capabilities and GPU resource wrappers need different
contracts. A structural cast to make a Lite object satisfy a Babylon type is
not an approved seam.

## Contracts to write down before any extraction or prototype

Every proposed patch should have a small record with these fields, reviewed
before editing application code:

1. **Source and consumers:** exact exports/call sites, backend-independent
   behavior to move, compatibility exports to retain, and deferred behavior.
2. **Data:** coordinate space, units, handedness/basis, matrix packing, UV
   orientation, color encoding/range, and error/invalid-input semantics.
3. **Ownership:** array/object identity, borrowed versus owned data, scratch
   output reuse, mutability, shared-cache keys/revisions, disposal/transfer rules.
4. **Time/events:** milliseconds versus seconds, clock source, stepping once,
   event IDs, RNG source/call order, pause/seek/reset and multi-view semantics.
5. **Driver:** which application/session owns frame subscriptions, cancellation,
   asynchronous generation checks and teardown. Pure helpers register nothing.
6. **Proof:** existing behavior fixture, new pure-core fixture, wrapper parity,
   representative error/edge cases, allocation expectations, and rollback.

An eventual shader/GPU upload contract also needs scalar precision, storage and
uniform alignment/stride, buffer ownership, dirty ranges and device limits.
Typed arrays are CPU data, not a complete WebGPU buffer ABI. Keep packing code
beside each implementation until a proven identical layout is worth sharing.

Suggested data flow, without a universal scene interface:

```text
indexed bytes -> format/shader/geometry data -> session-owned renderer adapter
game state + one presentation frame -> numeric decisions -> selected sinks
browser events -> input frame -> gameplay/controller -> camera/weapon intent
                                      -> classic Babylon OR future Lite owner
```

Coordinate conversion belongs at documented format/adapter boundaries, not
individually inside every effect. Do not introduce `VectorLike` everywhere and
then clone/copy entire scene state on every frame. Small records, typed arrays
and direct calls should preserve the existing allocation profile.

## Recommended sequence and planning gates

The [current-renderer groundwork plan](babylon-classic-to-lite-groundwork-plan-2026-10-26.md)
provides a concrete optional route through G2 and effect data boundaries using
the working renderers first. It retains G2's evaluator as the canonical first
module, keeps current clock behavior during extraction, and pairs small
optimizations with fixtures a later Lite implementation can reuse. It does not
make every catalog extraction a prerequisite for optimization or for a viewer.

| Step | Scope and exit evidence |
| --- | --- |
| A: cheapest independent wins | Earlier ammo/tag/tuple/type work plus G1; verify old API and byte/numeric outputs, with no scene initialization in the pure entry |
| B: static-world preparation | Explicit geometry/material/asset contracts, G2's required subset and G5; G3 only if the selected fixture needs MD3, G4 only for authored patches |
| C: actor and held-view preparation | Earlier animation/viewport/pose plans plus G7-G9; agree clocks and reset ownership before event dispatch changes |
| D: browser host preparation | G10-G12 only as needed for integrated browser playback; one input/frame/settings owner and preserved current startup |
| E: optional extensions | G6 and G13-G15 where a real consumer benefits; keep physics, audio, editor and entire cache rewrites out of the first slice |

This is a dependency order, not a requirement to implement every row before a
static viewer. Complete the relevant design records first. We are still at
that planning stage: no viewer entry, renderer interfaces or engine defaults
should change as a side effect of documenting candidates.

Before authorizing a proof of concept, decide and record:

- Exact versions and isolated entry/build scope, source/media hashes, selected
  map/material cases and unsupported-feature reporting.
- Which existing modules can be used unchanged and which approved extractions
  are genuinely necessary for those cases. Avoid speculative implementation
  of the whole catalog.
- Geometry/UV/color/blend/depth/lightmap contracts, upload packing and resource
  lifetime, plus classic reference outputs for each selected fixture.
- Task/camera ownership, bounded preparation, cancellation and repeat-load
  cleanup, including hidden-tab/device-loss failure outcomes.
- How correctness, cold/warm load time, render CPU, GPU and adapter cost will
  be compared with the same visible features on the existing renderers.
- Which unresolved material-array/cubemap, instance-payload and depth/held-view
  questions from the migration map the experiment will answer. CPU extraction
  does not solve those GPU capability questions.

## Validation and remaining uncertainty

No proposed extraction, graphics behavior or performance gain is verified by
this research. Source searches identify important callers but do not prove
that external users or computed imports have no additional ones. Existing
reference tests were located/read selectively; they were not run as a runtime
regression suite for this documentation pass.

When implementing a patch, follow `.claude/skills/regression-check/SKILL.md`:
headless checks first, renderer/loader/networking regressions where applicable,
then relevant browser/GPU parity. Keep new tests behavioral: input sequences,
numbers, bytes, events, lifetime and error outcomes. A test merely asserting
that a wrapper delegates is insufficient.

Documentation/research validation for this pass is recorded in the companion
boundary study. Both graph snapshots and all source-entry hashes matched;
the manual build, tracer syntax, 37 research local links, 20 named existing
test references, code fences, whitespace and output-directory guard passed.
Biome passed at the existing baseline (0 errors, 47 warnings).
No production/dependency/protocol/media operation is implied.
