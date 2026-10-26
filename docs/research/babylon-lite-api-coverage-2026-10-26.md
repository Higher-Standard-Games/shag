# Babylon Lite API coverage against SHAG

Date: October 26, 2026. Status: package/source audit; no GPU integration.
Companions: [overview](babylon-lite-renderer-investigation-2026-10-25.md),
[migration map](babylon-lite-migration-map-2026-10-25.md),
[groundwork catalog](babylon-lite-groundwork-catalog-2026-10-26.md), and
[pseudocode and file-change plan](babylon-lite-integration-sketch-2026-10-26.md).

## Answer and confidence boundary

**The published compatibility API does not cover everything SHAG uses. Native
Lite offers more suitable primitives, but full feature equivalence is not
established.** This is not an import-alias migration. A static native viewer
looks technically plausible; a complete playable renderer still has material,
actor, pass, loading and lifecycle questions to prove.

The plan remains incomplete. This audit advances it from feature names to
specific APIs and implementation behavior. It does not turn declarations into
runtime parity, or prove every method/property in SHAG compatible.

Baseline: engine `2e9f61aadfc48ad70ebab7a969ed179cbb8b1527`, FPS
`0759316308429c2ad36aa1e3bda1b111b22016e7`. Earlier research edits in the tree do
not alter application source. This pass inspects the exact published pair:

| Package | Version | Published source revision |
| --- | --- | --- |
| `@babylonjs/lite` | `1.36.0` | `5241e29f5a88ff23534a11d3114ac8ea983c5961` |
| `@babylonjs/lite-compat` | `1.36.0-preview` | Same revision; package metadata says built against Lite 1.36.0 |

The official registry's `latest` endpoints were rechecked on October 26 and
still identify this pair. That observation does not make it a floating version
requirement; a future experiment should pin the chosen package versions.

Official registry tarballs were downloaded into ignored `.cache/`, unpacked,
and checked against their registry SHA-512 integrity values. No dependencies
were installed and no downloaded package code was executed. Native declaration
and emitted JavaScript files were read directly. Compat implementation was also
read from the published package's included source-map `sourcesContent`, rather
than assuming the later repository checkout matches it. Comments sometimes lag
implementation: for example, the compat loader's opening comment understates its
implemented flat mesh-wrapper support. Use the actual methods.

The earlier October 25 repository revision
`1a2728c6d44383ef3a79cfc680e2e761b4f1e986` remains useful design evidence, but
is a separate baseline. In particular, its public entry exports `removeTask`
and `createCustomPostProcessTask`; neither name is exported by the inspected
1.36.0 package's declarations **or** runtime entry. Do not write the first
experiment against an accidental mix of the two versions.

Primary evidence:

- [Published Lite metadata](https://registry.npmjs.org/@babylonjs/lite/1.36.0)
  and [compat metadata](https://registry.npmjs.org/@babylonjs/lite-compat/1.36.0-preview).
- [Published native declarations](https://cdn.jsdelivr.net/npm/@babylonjs/lite@1.36.0/index.d.ts)
  and [compat declarations](https://cdn.jsdelivr.net/npm/@babylonjs/lite-compat@1.36.0-preview/index.d.ts).
- [Published-source compat meshes](https://github.com/BabylonJS/Babylon-Lite/blob/5241e29f5a88ff23534a11d3114ac8ea983c5961/packages/babylon-lite-compat/src/meshes/meshes.ts),
  [scene](https://github.com/BabylonJS/Babylon-Lite/blob/5241e29f5a88ff23534a11d3114ac8ea983c5961/packages/babylon-lite-compat/src/scene/scene.ts),
  [plugin bridge](https://github.com/BabylonJS/Babylon-Lite/blob/5241e29f5a88ff23534a11d3114ac8ea983c5961/packages/babylon-lite-compat/src/materials/material-plugin.ts).

The search browser could not retrieve these versioned pages. The package claims
above come from the downloaded official archives and their verified contents;
the links identify reproducible public artifacts, not successful browser renders.

## Reproducible import inventory

[Audit utility](babylon-lite-evidence/audit-published-api.mjs) and
[recorded summary](babylon-lite-evidence/published-api-summary-2026-10-26.json).
The summary includes tarball/declaration hashes, native API probes, symbol
examples and hashes for source files containing Babylon imports.

```powershell
node docs/research/babylon-lite-evidence/audit-published-api.mjs
```

The utility expects the pinned tarballs/metadata unpacked beneath
`.cache/babylon-lite-research/published-api/{lite,compat}/package`. It performs
no download or installation itself. Full import-site output and a compact
summary are written beneath that ignored research cache; the tracked summary
is a reviewed snapshot. Acquisition details are in the integration sketch.

Observed across recursive `src/**/*.ts`, excluding declaration files:

| Inventory observation | Count |
| --- | ---: |
| TypeScript files inspected | 1,810 |
| Files with static or literal dynamic Babylon imports | 459 |
| Distinct syntactically named imported symbols | 160 |
| Those symbol names absent from compat root declarations | 61 |
| Side-effect or unmatched default/namespace import sites | 79 |
| Literal dynamic Babylon import sites | 75 |

These counts include tests, editor, tools and game/server code, not just the
live renderer's reachable modules. A missing symbol can be a type-only name or
a replaceable internal helper. A present symbol can throw, ignore an argument
or implement another lifecycle. **There is no valid compatibility percentage
to calculate from these counts.** Type-only classification is syntactic;
method resolution, overload compatibility, computed imports, `.tsx`, `scripts/`
and external package internals are outside this inventory. Manual review below
uses selected concrete SHAG calls and published implementations.

## Feature/API disposition

Legend: **primitive** = an actual native API supplies part of the need;
**port** = SHAG logic/binding must be implemented for Lite;
**gap/proof** = a missing path or unresolved semantics blocks equivalence.
None means visually verified. Paths below are relative to `src/engine/` unless
marked FPS. Editor and server parity are not first-viewer requirements.

| SHAG need / actual owner | Published compat behavior | Native route and disposition |
| --- | --- | --- |
| Engine/scene creation (`BrowserRuntime`, `RenderingEngineFactory`) | Familiar names exist, but not SHAG's engine/scene contract | `createEngine`, `createSceneContext`, `registerScene`, `renderFrame`: **primitive/port**. Engine is also the primary surface. Do not return it as `AbstractEngine`. |
| Frame ownership (`client/main.ts`, render observers) | `Scene.render()` is intentionally empty | Engine-owned or host-owned native frame loop, exactly one. `onBeforeRender` delta is milliseconds; it returns void. **Port** subscriptions and end-frame ordering. |
| Loading readiness (`GpuPreparation`, loading holds) | `whenReadyAsync()` resolves immediately; `isReady()` returns true | Await actual asset/upload/scene-build work and verify selected pipelines/passes. `registerScene` is a promise; it is not a complete SHAG loading guarantee. **Gap/proof**. |
| Mesh creation and arrays (`BspMeshBuilder`) | Common builders/vertex data exist; buffer-object methods are incomplete | `createMeshFromData`, geometry-update functions and explicit bounds: **primitive/port**. Preserve spatial/lightmap partitions and index layouts. |
| Submesh/material binding (`BspBakedLightingPlugin`) | `SubMesh` is among missing root names; required plugin hooks rejected | Native mesh/draw partitioning and per-draw transforms: **port/gap**. Material-wide plugin UBOs do not replace `hardBindForSubMesh`. |
| Thin instances (`VoltaicEffectRenderer`, explosion/impact batches) | `thinInstanceSetBuffer` only recognizes `matrix` and `color`; other kinds are ignored | Matrix/color thin streams exist. `ShaderMaterial` attributes are restricted; lower-level `RenderShader` accepts explicit GPU vertex layouts. **Port/proof** custom payloads. |
| Babylon shader dialect (`VoltaicShaderMaterial`, water, rails) | Compat `ShaderMaterial` constructor throws | Native `createShaderMaterial` accepts WGSL; raw `createRenderShader` is another path. **Port** shader inputs, bindings and passes; existing Babylon-WGSL snippets are not automatically native WGSL. |
| Custom material plugins (`BspBakedLightingPlugin`, fog/soft particles) | Bridge rejects SHAG's overridden lifecycle/uniform/sampler hooks | Native `MaterialPlugin` supports named WGSL hooks, UBO writes and bindings, with different contracts. **Port**; verify each composition, not just plugin class presence. |
| Layered lightmaps/deluxe/gloss (`bsp/mesh/lightmaps.ts`) | Raw texture-array wrapper exists but has format/signature constraints | `createTexture2DArrayFromPixels`/KTX2 and custom shader `2d-array` samplers exist. Native plugin sampler declaration permits only `texture_2d<f32>`. **Gap/proof** for the existing composed lighting path. |
| Environment cubes (`Q3EnvironmentPlugin`, `SurfaceCubemaps`) | Ordinary cube wrappers are not full `RawCubeTexture` parity | Native `loadCubeTexture`, Standard cube reflection and PBR local-environment support exist. Custom high-level shader sampler union lacks cube; lower-level texture-view bindings accept a view dimension. **Primitive/port**, not “Lite has no cubes.” |
| PBR baked lighting | Class/property similarity does not establish layered lighting semantics | `enablePbrLightmap`/`setPbrLightmap` exist, plus local PBR cubemaps. **Primitive**, not proof of SHAG deluxe directions, gloss or stage order. |
| Authored blend/alpha/depth (`Q3Blend`) | Different material surface; enum equality is not proof | Native shader options include explicit GPU blend, depth-write/compare and bias. **Primitive/port** independent alpha test, blend, sorting and forced writes. |
| Animated UV/color/frame selection (`ShaderAnimationSystem`) | Wrapper mutations do not guarantee equivalent pipelines | Dynamic UV transform opt-in exists (`enableMaterialUvTransform`), plus setters/uniforms. **Primitive/port**; enable before pipeline build and prove orientation/pivot/shared texture behavior. |
| PVS visibility (`PVSCuller`) | Mesh flags do not establish cache/bundle invalidation equivalence | `setMeshVisible` and task membership are native paths. **Port** decisions from common queries; preserve fails-open behavior and independent views. |
| Held-view camera (`WeaponViewManager`) | No verified equivalent of the active-camera array/layer/depth path | Per-task `cam`, explicit lists (`autoMirror:false`), `sharedRt` and depth ownership exist. **Primitive/proof** independent FOV/depth and postprocess order. |
| Sampled opaque depth (`SceneDepthCapture`) | No reusable Babylon effect-cache/depth readiness pipeline | Geometry/depth tasks and `withSampledDepthTexture` exist. **Port/proof** linear view-Z versus reverse-Z depth, MSAA resolve, resize and camera identity. |
| Water/refraction/planar reflection (`rendering/water/*`) | Mirror/render-target class names do not implement SHAG's complete capture system | Native targets, tasks, transmission and clip plane are useful. **Port/proof** plane math, read/write separation, actor reflection and feature tiers. |
| Sky/portal/cubemap capture (`SkyPortal`, `SurfaceCubemaps`) | Scene target lists/global state need replacement | Explicit secondary tasks/targets; **port** update cadence, environment ownership and per-pass visibility. General RTT support is not full probe/cube-face generation parity. |
| Postprocess/accessibility (`PostProcessingManager`, color/cel passes) | Many legacy postprocess classes are stubs | Native bloom and other named tasks exist. Published 1.36.0 lacks the later `createCustomPostProcessTask`; `createUniformEffectWrapper` + `createEffectRenderTask` provide a lower-level option. **Port/proof** all inputs and ordering. |
| Team/charge/cel outlines | No verified equivalent for all mesh outline/overlay settings | Implement masks/shells/depth-edge passes as appropriate. Native mesh-blending effects are not evidence of SHAG outline equivalence. **Port/proof** thin surfaces, team identity, held view and accessibility. |
| glTF/GLB bytes (`ModelLoader`, player models) | `ImportMeshAsync` and canonical mesh wrappers exist | `loadGltf(engine, ArrayBuffer)` exists. **Primitive/port** PK3 source and embedded dependency validation, cancellation and resource ownership. External URI resolution needs separate work. |
| Reusable actor instances (`ModelInstanceCache`, `PlayerModelManager`) | Compat container lacks SHAG's `instantiateModelsToScene` contract | `cloneTransformNode` shares GPU buffers and retains skeleton-related state; it is not proven independent rig cloning. **Gap/proof** for many independently animated actors. |
| Bone layers/attachments (`HumanoidRig`, `ProceduralLayers`, `AttachedBlade`) | Loaded bone handles expose only part of Babylon bone behavior | Native bone overrides, world-pose setters and skinning exist. **Port/proof** rest/bind/world queries, attachment transforms, clip retargeting and layer order. |
| Demo animation (`PlayerModelManager`, FPS demo timeline) | Loader animation groups are native-style records, not all Babylon group methods | Native `goToFrame(group, frame, engine)` applies pose and pauses. Blending/masks/additive APIs exist. **Port/proof** clock, pause/resume, retargeting and seek reconstruction. |
| Text/dynamic pixels (`AmmoCounterDisplay`, damage numbers) | DynamicTexture exists, but its declared constructor is the width/height object form | Native dynamic texture/text APIs exist. **Primitive/port** texture options, alpha/orientation, numeric-size legacy calls and disposal. |
| Particle/weather/effect systems | Imperative Babylon particle APIs are not full native equivalents | Native node-particle systems and custom batched shaders are possible destinations. **Port/proof** current emission, seeds, time, sorting and lifetime. |
| Dynamic/area lights (`DynamicLightCluster`, `AreaLightManager`) | Familiar light names do not settle light caps or area textures | Native lights/clustered lighting are useful; textured area-light behavior and SHAG light safety policy remain **port/proof**. Do not copy Babylon's fallback caps into Lite. |
| Physics/collision/ragdolls (`PhysicsSystem`, `BabylonPhysicsBackend`) | Havok-oriented APIs do not make current bodies/meshes interchangeable; Ragdoll root name missing | Native physics primitives exist. **Separate adapter project**, not required for a static viewer or reason to change server collision. |
| Audio (`AudioV2Sfx`, `AudioManager`) | Some unsupported legacy audio classes have stale broad messages; not proof native Lite lacks audio | Native audio APIs exist. SHAG's V2 listener binds scene/camera observables and EngineStore. **Host seam/port**, rather than automatic reuse or a required audio rewrite. |
| Diagnostics/device loss | Babylon effect/shader stores and instrumentation missing | Native errors, device-loss signals, limits, timings and optional recovery exist. **Primitive/proof** restoration of custom resources, not just built-in scenes. |
| Editor/CLI | Some classic builder/gizmo/picking support exists but full parity unreviewed | Keep the existing renderer. **Deferred**; server, lobby, protocol and demo file format need no renderer-specific change. |

## The most important gaps and possible routes

### 1. Custom batched effects have a native route worth investigating

SHAG's Voltaic batch uses `iStartSeed`, `iEndImpact`, `iColorLife`, `iParams`
and `iNormal` streams. The compat implementation neither binds these nor throws
for them. Successful construction would therefore be misleading.

The native high-level `ShaderAttributeName` union is limited to standard mesh
attributes. However, the published lower-level `RenderShaderOptions` exposes
`GPUVertexBufferLayout[]`, and `RenderDrawOptions` supplies vertex-capable
`StorageBuffer` allocations, index buffer, counts and instance count. Two
candidate implementations should be compared before proposing upstream changes:

1. Raw render-draw task with `stepMode:"instance"` layouts matching SHAG's
   payload; preserve pooled slots and dirty-range uploads.
2. Shader-material storage records indexed by the intended instance identity;
   establish how thin-instance GPU culling/remapping affects that identity.

The first route avoids the high-level attribute restriction, but owns camera
uniforms, targets, depth, visibility/culling, sorting and draw counting. It does
not automatically receive scene lighting or postprocessing. Compare both on a
multi-beam/impact fixture, not one static quad. Check actual limits, alignment,
buffer retirement and stable bundle behavior. GPU validation remains unrun.

### 2. Layered baked lighting is a composition problem

Native array allocation exists; that is not the blocker by itself. SHAG's
baked plugin binds lightmap/direction/gloss arrays and a rendering mesh's world
matrix. Compat rejects the hooks used for that work. Native plugins have a
different UBO/bind contract and a 2D-only sampler declaration.

Options: native custom shader owning required lighting; a tested extension to
the native plugin resource contract; or an experimental per-page material
fallback. The latter changes batching and is not equivalent performance.
Built-in PBR lightmap support should be evaluated before rebuilding all PBR,
but cannot be assumed to understand SHAG's layer-encoded UVs or deluxe data.
Test at least two array layers, a transformed brush, dynamic light, fog, gloss
and both normal-map paths together. Decide acceptable shader maintenance before
choosing a low-level route that requires owning lighting/shadow integration.

### 3. Independently animated actor instances remain a hard planning question

The published `cloneTransformNode` implementation copies hierarchy transforms,
shares ref-counted GPU buffers and retains the mesh skeleton/vat/morph/thin-
instance state. The hierarchy-instance pool is thin-instancing of descendant
meshes, not demonstrated independent character-rig instantiation. Compat's
container exposes loaded meshes/skeletons but no current equivalent of the
`instantiateModelsToScene(..., {doNotInstantiate:true})` path SHAG uses.

Native loaders, animation blending and bone overrides are substantial useful
APIs. They do not prove the combination SHAG needs: multiple independent poses,
retargeted separate clip GLBs, per-instance procedural layers, weapon attachments,
demo seeks and safe release. A correctness baseline could parse the same cached
embedded GLB bytes per actor, but its time/memory/texture reuse must be measured;
do not present repeated parsing as the intended optimized solution.

Before implementing `LiteModelLibrary`/`LiteRig`, prove two actors at different
clip times with different spine/head overrides and attached weapons. Dispose one
and confirm the other and future instances survive. If a clean public clone/
retarget path is missing, decide on an upstream API proposal or a bounded local
asset adapter. Do not reach into private skeleton objects as an undocumented
shortcut. Existing `_goToFrame` patches are Babylon-version-specific and do not
belong in the Lite adapter. Native `goToFrame` explicitly pauses; preserve the
game's intended resume behavior through its own clock policy.

### 4. Readiness, cancellation and device recovery need application policy

`registerScene` returns a promise, while task recording is synchronous.
`waitForGpuIdle` exists, but is not a substitute for asset completion, complete
pipeline variants or visual correctness. `onBeforeRender` does not return an
unsubscribe handle; engine GPU-error/device-loss subscriptions do. The session
must use those actual contracts, stop its frame driver, guard retained callbacks
and dispose the owned scene. It must not invent an `.off()` API.

Neither `loadGltf` nor `registerScene` declares an AbortSignal. A timeout race
abandons a waiter, not the underlying operation. Late results still require an
owner. Never dispose/reuse a scene concurrently with an unproven pending build,
and never let stale success dismiss a newer loading hold. The failure plan must
bound in-flight work and define when retirement or a whole-session restart is
safe. This is a proof obligation, not solved pseudocode in the next document.

Native recovery helpers exist, but custom buffers with GPU-written contents,
our raw draw tasks, shared targets and decoded-source retention need separate
tests. A clean terminal retry with a new session is an acceptable experimental
policy. Automatically running the classic network bootstrap after a partial
Lite connection risks duplicate admission; fallback is a whole-session decision.

### 5. The planned API must target one version

Published 1.36.0 has a lower-level custom-effect route, not the exact custom
postprocess helper exported by the later checkout. It also lacks that checkout's
public `removeTask`. Prefer a fixed session-owned task topology with execution
gates or a deliberately rebuilt graph until task-removal ownership is proved;
do not call an unexported internal or dispose a task still executed by its graph.

Source-level `Texture2D` comments say transform fields are build-time, while
`enableMaterialUvTransform` supplies an explicit dynamic path. Treat feature
opt-in and its timing as part of the material recipe. Verify shared wrappers,
rotation convention and per-frame updates; neither the pessimistic comment nor
the existence of a setter alone proves correct animated tcMods.

## What is still needed before the plan can be called complete?

The [native redesign follow-up](babylon-lite-native-performance-2026-10-26.md)
reads beyond export names into draw-list updates, visibility epochs, instance
dirty ranges/count setters, hierarchy pools and bone-matrix VAT. Native VAT
supports dual-clip instance blends and optional captured bone origins/matrices;
these offer a concrete attachment investigation route, while procedural pose,
independent actors and correct transform composition remain unproved. The
follow-up also distinguishes existing SHAG optimizations from proposed gains.

| Open decision | Evidence required to close it |
| --- | --- |
| Package target and support policy | Pin a coherent published pair or source build; repeat probes and keep native/internal boundaries explicit |
| Layered material strategy | Equivalent composed fixture plus shader-maintenance decision; arrays allocating successfully is insufficient |
| Batched effects path | Real custom payload fixture with dirty uploads, culling/index identity, depth and multiple views |
| Actor asset/rig factory | Independent clone/retarget/pose/attachment/disposal proof, or explicit bounded alternative |
| Render products | World/held/depth/post ordering, format/size/MSAA/reverse-Z contracts and resize results |
| Startup transaction | Bounded non-abortable work, stale-result ownership, cancellation, visibility and device-loss outcomes |
| Game seam size | Exact patch plan for existing Game/map/event/demo ownership, with headless parity before dual-backend use |
| Performance value | Matched visible features and fixtures, including CPU adapter cost, memory, shader/load time and p95/p99 frames |

These cannot all be closed by reading API names. This pass defines the decisions
and source evidence so any later executable research answers a specific question.
Groundwork may proceed in small authorized patches independently; the user has
not requested runtime implementation in this round.

## Validation and limits

Research utility syntax, package integrity, evidence reproducibility, local
links and documentation build are the checks for this pass. No downloaded
module, native scene, compat scene or GPU experiment was run. Import inventory
and selected method reads do not constitute exhaustive usage/type checking of
the entire editor, tool set or application. The integration sketch distinguishes
verified API names from proposed SHAG classes and unresolved contracts.

Completed checks:

```powershell
node --check docs/research/babylon-lite-evidence/audit-published-api.mjs
node docs/research/babylon-lite-evidence/audit-published-api.mjs
npm.cmd run docs:build
npm.cmd run gate:biome
```

The generated API summary matched the tracked snapshot, all 459 importer-source
hashes matched, and both archives passed their SHA-512 checks. Evidence also
recorded hashes for 10 inspected native implementation files and 8 selected
compat source-map contents at that audit checkpoint. All six research documents passed local checks:
54 relative links resolved, code fences balanced and no trailing whitespace.
The 18 distinct `Native.*` names used in the pseudocode matched both shipped
declarations and runtime exports. This verifies vocabulary, not class correctness.
Manual build passed; Biome stayed at 0 errors and the existing 47 warnings.
The subsequent native-performance pass extends the evidence with eight more
native implementation files and additional export probes; see that study for
the expanded validation scope and unverified runtime/performance questions.
