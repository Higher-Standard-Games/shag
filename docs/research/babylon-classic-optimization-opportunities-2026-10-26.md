# Optimizations available in SHAG's existing Babylon renderers

Date: October 26, 2026. Status: research and proposed small experiments.
Runtime, assets, dependencies and renderer defaults are unchanged.

**Yes: GPU-driven map scrolling and waves can already be implemented in our
Babylon WebGL renderer.** Many ideas in the [Lite native performance study](babylon-lite-native-performance-2026-10-26.md)
are data/layout/scheduling improvements rather than Lite-exclusive features.
They should be evaluated on the working renderers independently of a Lite port.

This review targets the installed **`@babylonjs/core@9.31.2`**, not an assumed
future release. Package declarations and implementation were read alongside
SHAG call sites. The [evidence snapshot](babylon-lite-evidence/current-renderer-summary-2026-10-26.json)
records 24 installed-package files, selected API token probes and 21 SHAG owner
hashes at the initial comparison checkpoint. The [groundwork plan](babylon-classic-to-lite-groundwork-plan-2026-10-26.md)
extends the source review into live registration paths, canonical module choices
and independently reviewable work packages. The [read-only producer](babylon-lite-evidence/audit-current-renderers.mjs)
executes no renderer code. Source inspection establishes available routes, not
performance gains or tested integration. WebGL below means SHAG's WebGL2 target;
UBOs, array textures and transform feedback need their corresponding capabilities.

## Which proposed improvements actually require Lite?

| Opportunity | Existing Babylon WebGL2 | Existing Babylon WebGPU | SHAG status / remaining work |
| --- | --- | --- | --- |
| Scroll/rotate/wave math from time in the shader | Yes, GLSL `ShaderMaterial` or material plugin | Yes, corresponding WGSL/plugin path | Some map animation uses CPU-updated texture/color state; effects already use shader time |
| Shared time data, static stage coefficients | Yes, uniforms; shared `UniformBuffer` when supported | Yes, uniform buffers | Must prove layouts, frozen-material updates and clock/seek semantics |
| Change animated texture only when its frame changes | Yes | Yes | CPU animation path assigns its selected texture each update; avoid redundant application work first |
| Shader-selected texture-array frames | Yes, array textures and custom GLSL | Yes, corresponding shader/bindings | Asset dimensions/formats/mips must be compatible; indexed compressed media needs an explicit array-building design |
| Partial custom-instance uploads | Yes, `thinInstancePartialBufferUpdate` / updatable buffers | Yes, same high-level APIs | Existing Voltaic dirty masks select whole streams; dirty intervals are a plausible smaller change |
| Fixed-capacity repeated rigid geometry | Yes, instances/thin instances/custom attributes | Yes | Existing effect pools already do much of this; rigid prop/pickup conversion needs identity and culling contracts |
| Avoid dummy matrices in custom analytic draws | Candidate: instanced `VertexBuffer`s plus `forcedInstanceCount` | Candidate: same mesh route, or custom GPU data | Supported lower-level route, not a drop-in thin-instance edit; shader attribute/define/bounds proof required |
| Selective baked bone animation | Yes, `VertexAnimationBaker` and `BakedVertexAnimationManager` | Yes, corresponding built-in shader path | No gameplay BVA setup found in reviewed actor path; live animation LOD already exists |
| Stable draw lists and visibility cohorts | Yes, candidate providers, RTT lists; FrameGraph object lists | Yes | Weapon candidate filter exists; PVS/batching already present; dynamic scenes cannot simply freeze all active meshes |
| Explicit render graph and owned depth/color products | FrameGraph and object-render tasks exist | Same architecture, with backend capabilities | Broader integration project; our existing shared-depth fast path is specifically WebGL2 |
| Cached / due-only reflection capture | Yes | Yes | Water room probes already cached; do not count existing caching as a new benefit |
| Dirty-only material writes and recipe reuse | Yes | Yes | Frozen world materials and Babylon caches already suppress work; measure the additional avoidable part |
| Workers / bounded concurrent loading / lazy feature loading | Yes, CPU/browser architecture | Yes | Independent of renderer; keep dependencies, asset identity and load lifetime explicit |
| General compute/storage-buffer algorithms | No standard WebGPU compute/storage API in WebGL2 | Yes, Babylon `ComputeShader` / storage APIs | WebGPU requirement, not a Lite requirement |
| GPU particle simulation | Yes, capability-dependent transform-feedback path | Yes, compute path | Not automatically better than existing analytic effects; distinct from general compute support |
| Cached WebGPU render bundles | No equivalent standard WebGPU bundle object on WebGL | Babylon non-compatibility mode exists | SHAG already has startup-only `?ncm=1` experiment; no default change proposed |
| Lite's thin-instance GPU-culling/LOD convenience functions | Not the same API | Custom GPU algorithm is possible; no equivalent turnkey classic route established by this review | Native Lite helper implementation remains a separate experiment, not proof of an exclusive algorithm |

The justification for Lite therefore remains its different runtime/render-work
architecture and potential measured overhead reduction, rather than access to
scrolling shaders, instance buffers, VAT or render graphs for the first time.
Keep the classic WebGPU comparison in any future Lite performance report.

## 1. Animated map materials: a practical current-renderer route

Existing owners:

- [ShaderAnimationSystem](../../src/engine/loader/shader/ShaderAnimationSystem.ts):
  centralized CPU update of registered stage UV/color/alpha/frame state.
- [GlowOverlayShaderMaterial](../../src/engine/loader/shader/GlowOverlayShaderMaterial.ts):
  custom GLSL already transforms UVs, but its offset is supplied as a value;
  doing a UV transform on the GPU is different from calculating its animation
  phase there.
- [Q3NodeMaterialBuilder](../../src/engine/loader/shader/Q3NodeMaterialBuilder.ts):
  contains nonconstant stage offset inputs and GPU blending nodes. This read
  does not establish that every constructed graph/animation input is used by
  the live BSP route; trace each selected material family before changing it.
- [Q3DistanceRampPlugin](../../src/engine/loader/shader/Q3DistanceRampPlugin.ts):
  demonstrates existing GLSL/WGSL plugin injection and per-vertex calculations.
- [VoltaicShaderMaterial](../../src/engine/weapon/voltaic/VoltaicShaderMaterial.ts)
  and [ExplosionBatchMaterial](../../src/engine/weapon/explosion/ExplosionBatchMaterial.ts):
  examples already using shader time for analytic effects.

The change would be **where the animated value is calculated**. Immutable rate,
phase and wave coefficients can be set at material creation; a clock advances
once per frame. The vertex/fragment shader evaluates the supported expression.
The CPU still renders, binds resources and advances the clock; this removes
some per-stage state evaluation and mutation, not the entire material bind.

Illustrative GLSL only, not a complete SHAG shader or exact tcMod replacement:

```glsl
// Caller supplies the correct UV space, initial phase and clock convention.
vec2 scrollUv(vec2 uv, vec2 rate, float timeSeconds) {
    return uv + rate * timeSeconds;
}
float waveValue(float base, float amplitude, float phase, float frequency, float timeSeconds) {
    return base + amplitude * sin(6.28318530718 * (phase + frequency * timeSeconds));
}
```

The arithmetic is ordinary shader work; Lite and compute shaders are unnecessary.
Simple expressions can be represented in GLSL for WebGL and WGSL for the current
WebGPU path, sharing the same numeric stage descriptor. Existing plugin patterns
already handle both shader languages. `ShaderMaterial.setFloat` is available;
it records a material value which is bound later, not an immediate universal
GPU update for all materials. Set one scalar per material initially if that is
the simplest correct fixture. Shared `UniformBuffer`/`setUniformBuffer` is a
later WebGL2-capable route to one clock-buffer upload with multiple bindings.
It needs explicit layout, feature checks and GLSL/WGSL declarations. One shared
buffer does not mean one total draw-time operation.

### Small changes first

1. Classify a stage once: constant, supported analytic, frame-selected or
   stateful. Keep the current CPU behavior as the initial reference.
2. For frame-selected animation, assign a new texture only when the chosen
   identity changes. Preserve the distinction between opaque base and emissive
   animation, including restart/registration. This can reduce CPU assignments;
   Babylon may already suppress redundant downstream work, so measure it.
3. Prototype GPU scroll and deterministic brightness waves on a narrow
   material family. Preserve all other material features and compare images.
4. Expand to rotate/stretch only after UV pivot/order and wave semantics are
   recorded. Move shared clock data into a UBO only if profiling warrants it.
5. Consider texture arrays separately; they add asset and sampler constraints
   beyond changing a frame index. They are not needed for the first experiment.

### Correctness conditions before expanding coverage

- Keep texture orientation, UV transform composition, wrap/clamp modes, lightmap
  UV2 and layered pass ordering. Applying `fract` to final UVs is not universally
  equivalent to the current wrapped offset, especially with clamped sampling.
- Preserve original contribution/color space and stage modulation position.
  A wave on emission is not a multiplier on the final lit/fogged image.
- Preserve alpha testing, depth writes and alpha-blending classification/sorting.
  A shader-only opacity change with CPU `material.alpha` fixed at one can choose
  the wrong render queue. Declare correct pipeline features ahead of time and
  check behavior near opacity one; do not silently change it for convenience.
- Keep integrated turbulence and random noise on the CPU until their semantics
  are deliberately resolved. The current turbulence accumulates delta-time
  offsets, and noise calls `Math.random`; a pure sine/hash is not equivalent.
- Use bounded/rebased time with phase continuity for long sessions. Define
  registration phase, pause/resume, speed changes, hidden tabs and demo seek.
  `ShaderAnimationSystem` accumulates a performance-clock delta; inheriting that
  by accident is not a coherent demo-time design. A clock behavior change needs
  separate acceptance from a rendering optimization.
- Static coefficients do not make the whole material static. Frozen materials,
  plugin bind paths, camera-dependent values and dynamic time must remain live
  where required. Re-freezing every animated material is not an assumed win.
- Cache distinct plugin compositions correctly. The shader-system manual
  requires unique identities for code-changing options; avoid defines based
  on the changing time value or a new program per stage/frame.

The existing [texture-transform tests](../../src/engine/loader/shader/__tests__/TextureTransforms.test.ts)
provide reference behavior for texture ownership and emission separation. Future
implementation needs headless numeric/descriptor checks and actual GPU image
comparisons for each material family; NullEngine cannot prove shader pixels.

Proposed file ownership, when implementation is authorized:

| File | Proposed responsibility |
| --- | --- |
| `loader/shader/animation/StageAnimationDescriptor.ts` (new) | Pure classification/coefficients and explicit stateful exceptions; shared with future Lite |
| `loader/shader/animation/SurfaceAnimationClock.ts` (new) | Numeric time/phase contract with lifetime and playback inputs; no global GPU owner |
| `loader/shader/Q3AnalyticAnimationPlugin.ts` (new) | Classic material-family GLSL/WGSL adapter, immutable feature layout and live time binding |
| Existing `ShaderAnimationSystem.ts` | Delegate accepted analytic stages; retain remaining CPU stages and existing controls |
| Existing BSP/MD3 material-registration call sites | Select the adapter without duplicate stage ownership; exact sites depend on chosen family |
| Existing `GlowOverlayShaderMaterial.ts` or selected factory path | Narrow first fixture; do not rewrite every material path together |

These paths are proposals relative to `src/engine/`, not files added by this
research. Reconcile them with the groundwork catalog before extraction; avoid
two separate shader-animation descriptor/clock hierarchies. Do not introduce a
Lite dependency into classic shader modules.
The subsequent groundwork plan resolves the first step to G2's existing proposed
`Q3StageEvaluation.ts`; the separate descriptor/clock paths above are optional
later splits, rather than extra files to create alongside that module.

## 2. Partial instance uploads: available today, with exact offset rules

Current [Voltaic batches](../../src/engine/weapon/voltaic/VoltaicEffectRenderer.ts)
already track which attribute streams changed. `flushMeshBuffers` calls
`thinInstanceBufferUpdated` per dirty stream. In installed 9.31.2, the custom
attribute implementation supplies the entire CPU attribute array to
`updateDirectly`; the matrix branch has different active-count handling.
There is a concrete opportunity to track slot intervals within custom streams.

The installed `thinInstancePartialBufferUpdate(kind, dataOrLength, offset)` has
two different unit conventions:

| Form | Meaning in installed 9.31.2 | Example for a vec4 custom attribute |
| --- | --- | --- |
| Numeric length | Count and offset are logical elements using the attribute stride | `mesh.thinInstancePartialBufferUpdate("iParams", slotCount, firstSlot)` |
| `Float32Array` payload | Offset is a float offset in the underlying buffer | `mesh.thinInstancePartialBufferUpdate("iParams", changedFloats, firstSlot * 4)` |

Update the authoritative CPU array before the numeric form. The array form does
not update the stored CPU array for you; retain CPU/GPU consistency for later
full updates and swap-removal. Buffers must be updatable; the partial helper
does not contain the full-update path's automatic static-buffer recreation.
Do not re-create buffers while trying to avoid uploads.

The classic `thinInstanceCount` setter checks against matrix-array capacity and
changes the count; it does **not** mark the matrix range dirty as Lite's general
count setter does. The reviewed setter does not fully validate all bad counts
either, so the application's pool should enforce nonnegative integer bounds.
Do not copy Lite's count workaround or internal synchronization assumptions into
classic code.

Proposed first patch, separately authorized: retain the existing pool, shaders,
static identity matrices and slot identity; add dirty intervals and compare
full-stream, one contiguous interval and a few coalesced intervals. Account for
write-call overhead and worst-case scattered changes. Explosion batches are a
follow-up only after their spawn/expiry workload shows meaningful upload cost.
No need to redesign every effect or wait for Lite.

## 3. Removing identity matrices is also possible, but more invasive

Classic Babylon supports custom instanced `VertexBuffer`s and
`Mesh.forcedInstanceCount`. Its draw path uses the forced count for instanced
draws, so specialized analytic geometry is not inherently tied to a full
per-instance transform. The [official compute example](https://doc.babylonjs.com/features/featuresDeepDive/materials/shaders/computeShader/)
also uses this mesh mechanism; the manual vertex-buffer draw mechanism itself
does not require the data to come from compute.

This is a candidate custom draw path for both current backends, not a promise
that deleting the `matrix` thin buffer works. `hasThinInstances`, material
attribute/define preparation, bounds and previous-world-matrix paths must be
checked together. Standard shaders may still expect instance transforms.
When `forcedInstanceCount` is zero, zero means "not forced", not necessarily
"draw nothing"; empty pools must be explicitly gated. Verify draw counts and
empty behavior rather than inheriting thin-instance assumptions.

The existing identity matrices are static, so removing their stream primarily
targets allocation, attribute slots and vertex-input bandwidth, not recurring
matrix uploads. This is a second experiment after sparse custom uploads. Keep
the original path for comparison until local/spectated/demo effects and depth
are equivalent.

## 4. Baked animation is a classic Babylon option too

Installed 9.31.2 includes `VertexAnimationBaker`,
`BakedVertexAnimationManager`, built-in GLSL/WGSL includes and the per-instance
`bakedVertexAnimationSettingsInstanced` attribute. The classic bake stores bone
matrices in a texture as well: its float32 payload uses `(bones + 1) * 16`
floats per frame, or `64 * (bones + 1) * frames` bytes before overhead. This
differs from the Lite payload's bone count/layout; do not reuse bytes blindly.

The manager exposes start/end/offset/rate and time; the reviewed built-in shader
selects frames and one clip's parameters. It does not establish the same built-in
dual-clip blend contract as Lite's `setInstancesBlend`. SHAG's independent aim,
recoil, locomotion layers and socket transforms remain integration work in
either renderer. General shader skinning already running on the GPU does not
mean CPU animation evaluation and bone-matrix uploads are absent.

The synchronous baker actually poses and renders the scene per frame. Do not
run it in the live match startup and assume it is a cheap pure worker task.
A controlled offline/preparation scene and indexed sidecar loading are more
plausible, with explicit asset/clip/version identity and capability checks for
vertex texture sampling, formats and dimensions. Half-float data is an optional
API route, not a free precision/memory win; compare deformations before adoption.

[PlayerModelManager](../../src/engine/animation/PlayerModelManager.ts) already
uses animation LOD; that is the reference. The experimental
[PlayerOutlineProxy](../../src/engine/rendering/PlayerOutlineProxy.ts) also
explicitly excludes BVA meshes. A bake fixture must check ordinary outline,
shadow/depth passes, attachments, separate actor phases, demos, seek and cleanup;
the optimization cannot stop at a correctly animated body.

## 5. Draw lists, captures and frame graphs are not exclusive either

Classic Scene exposes candidate providers and active-mesh freezing; RTTs expose
render lists. SHAG already has [weapon candidate filtering](../../src/engine/rendering/WeaponCameraCandidates.ts),
with WebGL-only application and a Firefox-dependent default. That provider
still scans the source list to filter it. A stable small membership registry is
a distinct possible optimization, but it must preserve intersection-action,
LOD, dynamic mesh and disposal behavior. Freezing the full active scene can
drop newly spawned/visible entities or stale PVS membership; do not use it as
a universal switch.

Installed Babylon also has `FrameGraph`, texture management and
`FrameGraphObjectRendererTask` with object lists, camera and depth attachment.
Its constructor is Scene/AbstractEngine based. Explicit task architecture is
therefore an available current-renderer route, with backend-specific task and
format support still to verify. It would need substantial SHAG pipeline work;
it is not required for the smaller opportunities above, nor proof it will reduce
CPU traversal by itself. Do not add a second graph just to call it modern.

SHAG's [WaterProbeCache](../../src/engine/rendering/water/WaterProbeCache.ts)
already uses cached captures and explicit static render lists. Its temporary
visibility/light-state changes could be investigated for narrower ownership
without changing engines. Mandatory lighting/readiness ordering still applies.
Our [SceneDepthCapture](../../src/engine/rendering/SceneDepthCapture.ts) already
shares opaque depth through a WebGL2-specific blit/conversion route with strict
target constraints. The current WebGPU path is not automatically equivalent;
match projections/MSAA/format/lifetime before sharing products there.

## 6. Separate algorithm portability from backend facilities

Dirty-value caching, material sharing, data-oriented pools, pure-data workers,
bounded loading, cached captures and selective animation are applicable to
either current renderer. The benefit depends on remaining avoidable work.
Babylon's WebGL pipeline already caches equal scalar/vector uniforms, and
non-dynamic UBOs can skip unchanged uploads. CPU property assignments, uniform
setter calls and actual driver writes are three different counters. Frozen
world materials and their [lighting invalidation watcher](../../src/engine/rendering/FrozenWorldMaterials.ts)
must remain part of the reference measurement.

General `ComputeShader`/storage-buffer techniques need a capable WebGPU engine,
which classic Babylon supplies. WebGL2 has different GPU techniques, including
transform feedback; installed `GPUParticleSystem` can choose a transform-feedback
or compute platform. `BoundingInfoHelper` also has both platform paths, but
computing deformed bounds is not the same problem as compacting visible instances
or performing PVS. Neither is an automatic drop-in for Lite's GPU-culling helper.
Do not add GPU readback to the frame loop to recreate CPU decisions expensively.

WebGPU render-bundle retention likewise needs WebGPU rather than Lite. SHAG's
[engine factory](../../src/engine/rendering/RenderingEngineFactory.ts) already
has the startup-only `?ncm=1` experiment and records bundle counters in its
[performance capture](../../src/engine/rendering/RendererPerformanceCapture.ts).
Compatibility with material features and invalidation behavior still governs
whether that experiment helps. None of these defaults changes in this review.

## Suggested current-renderer experiment order

| Priority | Experiment | Reason / acceptance |
| --- | --- | --- |
| 1 | Inventory animated material families and actual per-map counts | Establish which CPU paths are active; an available API is not a hot path |
| 2 | Avoid redundant animated-frame texture assignments | Small scope; preserve emission/base ownership; measure CPU and downstream writes |
| 3 | Sparse Voltaic custom-buffer uploads | Existing pool/layout retained; prove offsets, removals, empty pools and full-refresh fallback |
| 4 | GPU scroll and simple wave fixture using a current material plugin | Compare equivalent pixels and CPU/GPU costs in WebGL2 and current WebGPU |
| 5 | Expand analytic stage coverage and optional shared clock buffer | Only after clock, freeze, alpha-queue and shader-identity behavior is accepted |
| 6 | Custom matrix-free effect draw and isolated BVA crowd | Larger feature/lifecycle gates; proceed if their measured cost warrants it |
| Later | Broader graph/visibility redesign or custom compute culling | Requires evidence that smaller changes cannot remove the dominant cost |

For an inventory, the existing developer console supports `shader anim status`
after `developer 1`; it reports registered material/stage information and time
scale, not timings. `shader anim pause` changes appearance/work and is only a
diagnostic comparison, not proof of an equal-image optimization. The reviewed
performance capture reports p50/p95 frame/render/GPU/animation metrics and
draws/compilation/bundle counts; p99 and upload-byte counters would need additions.
Unsupported GPU timing remains unavailable data, not zero cost.

Run repeatable routes with the same map, actors, events, resolution and quality.
Measure material-update CPU, actual buffer writes, shader binds/compiles, total
render CPU, GPU time and frame tails. Compare steady and bursty pools, first
load, rejoin, background/resume and demos. Reject changes that trade a small CPU
saving for worse GPU time, memory or reliability. No measured speedup is claimed.

## Scope, evidence and validation

Assumption: preserve the working current renderers and use this review to plan
separately authorized implementation. The overview table is a capability and
SHAG-status comparison, not a completed optimization list. No native renderer,
classic shader or proposed pseudocode was executed in this pass. FrameGraph
integration, BVA actor parity and performance benefits remain unverified.

Primary API reading starts at the [installed-version package tree](https://unpkg.com/@babylonjs/core@9.31.2/?meta),
the [ShaderMaterial implementation](https://unpkg.com/@babylonjs/core@9.31.2/Materials/shaderMaterial.pure.js),
[thin-instance implementation](https://unpkg.com/@babylonjs/core@9.31.2/Meshes/thinInstanceMesh.pure.js),
[baker](https://unpkg.com/@babylonjs/core@9.31.2/BakedVertexAnimation/vertexAnimationBaker.js)
and [FrameGraph declarations](https://unpkg.com/@babylonjs/core@9.31.2/FrameGraph/frameGraph.d.ts).
The official [compute documentation](https://doc.babylonjs.com/features/featuresDeepDive/materials/shaders/computeShader/)
also distinguishes WebGPU compute from WebGL. Local implementation evidence
and version-specific signatures take priority over moving documentation.

Files changed in this pass:

- `docs/research/babylon-classic-optimization-opportunities-2026-10-26.md`
- `docs/research/babylon-lite-native-performance-2026-10-26.md`
- `docs/research/babylon-lite-renderer-investigation-2026-10-25.md`
- `docs/research/babylon-lite-migration-map-2026-10-25.md`
- `docs/research/babylon-lite-evidence/audit-current-renderers.mjs`
- `docs/research/babylon-lite-evidence/current-renderer-summary-2026-10-26.json`
- `docs/changelog/v1.0.0-alpha.6.md`

Completed validation:

```powershell
node --check docs/research/babylon-lite-evidence/audit-current-renderers.mjs
node docs/research/babylon-lite-evidence/audit-current-renderers.mjs
node .cache/babylon-lite-research/validate-api-plan.mjs
npm.cmd run docs:build
npm.cmd run gate:biome
git diff --check
```

The installed-package probes passed and the regenerated snapshot matched. All
24 recorded package-file hashes and 21 SHAG owner hashes matched. Combined
research checks passed for eight documents, 93 relative links, balanced fences,
whitespace and the existing 20 distinct published-native pseudocode names.
The manual build passed. Biome passed at its existing baseline of 0 errors and
47 warnings. The cached combined validator is a local research helper; the
tracked read-only producer is the repeatable current-renderer evidence utility.
Renderer regression tests and GPU comparisons are required for a later runtime
change; none was needed or claimed for this documentation-only investigation.
