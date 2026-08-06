# Unified Water Rendering Research

**Date:** 2026-08-06  
**Status:** Research complete; implementation proposed  
**Primary test map:** `acidwdm2`  
**Scope:** Rendering and compatibility for BSP liquid surfaces. Swimming, damage volumes, and buoyancy are separate gameplay work.

## Executive decision

SHAG should identify liquids from BSP and shader semantics, then deliberately stop translating those surfaces as ordinary Q3/Warsow materials. A map-scoped `LiquidSurfaceSystem` should replace them with one custom, quality-scalable Babylon material family.

The recommended production path is a custom `UnifiedWaterMaterial`, initially using animated normal maps, Fresnel reflection, environment fallback, tint, and opacity. Higher quality tiers can add one shared scene color/depth capture for refraction, absorption, and shoreline foam, followed by tightly budgeted planar reflections for large horizontal planes.

Babylon's `WaterMaterial` is worthwhile as a short visual and performance spike on `acidwdm2`, but it should not define the architecture. It owns reflection and refraction render targets per material and assumes a horizontal water plane. Babylon's `FluidRenderer` is a screen-space particle-fluid renderer; it is a compelling future source of splashes and jets, not a replacement for static BSP pool surfaces.

The compatibility policy should be:

1. Trust compiled BSP liquid content flags first.
2. Also consume top-level shader `surfaceparm water`, `slime`, and `lava` declarations.
3. Provide exact-name include, exclude, kind, and profile overrides for broken or unusual maps.
4. Never classify a surface as water merely because its name contains `water`.
5. Treat the original shader stages as optional appearance hints, not as the identity of a liquid.

This approach replaces Q3 and Warsow water through one route without binding the new renderer to every historical shader-language extension.

## What `acidwdm2` actually contains

The local test asset is `public/data/map_acidwdm2.pk3`. It contains an IBSP version 46 map, `scripts/acidwdm2.shader`, two water textures, and a six-face water cubemap.

The pool surface is an especially useful first test because its geometry is simple:

| Property | Observed value |
|---|---|
| BSP texture | `textures/acidwdm2/water1` |
| Texture index | `33` |
| Content flags | `0x20000020` = `TRANSLUCENT | WATER` |
| Surface flags | `0x00004c00` |
| Faces / referenced vertices | 23 polygon faces / 90 vertices |
| Q3 plane | All normals `(0, 0, 1)`, all vertices at `z = 56` |
| Babylon plane | All vertices at `y = 56` |
| Babylon bounds | `x = 512..896`, `z = -1088..-832` |
| Distinct water levels | One |

The map therefore gives us a clean horizontal plane for comparing materials, with a strong compiled `WATER` signal and no ambiguity about grouping.

However, the shader is not merely a basic old-Q3 water shader. It uses QFusion-style `if textureCubeMap` / `if ! textureCubeMap` branches. The cubemap branch combines a map-provided environment cubemap, alpha blending, turbulence, and vertex deformation; the fallback branch scrolls `water1.tga` with multiplicative blending. It also declares:

```text
surfaceparm trans
surfaceparm nonsolid
surfaceparm water
surfaceparm nolightmap
tesssize 64
deformVertexes wave 64 sin 1 1 0.25 0.6
```

SHAG's current conditional parser models only `deluxe` and `!deluxe`. It does not understand `textureCubeMap` as a condition or cubemap map source. In a headless resolve, the surface falls through to ordinary legacy stages and resolves to a transparent multiply-style material. This is the important compatibility lesson: reproducing water by extending stage emulation one vendor keyword at a time will remain fragile. The BSP's `WATER` bit and the top-level `surfaceparm water` both identify the surface correctly even when its appearance program is only partially understood.

`acidwdm2` is thus a basic *geometry* case and a valuable *shader compatibility* case. It is not sufficient by itself to validate sloped liquid, multiple water levels, waterfalls, slime, lava, underwater transitions, or very large reflective surfaces.

## Current SHAG pipeline

The relevant path today is:

```text
PK3 shader text -> Q3ShaderParser -> Q3ShaderRegistry
                                      |
BSP textures -> BspLoader -> BspMeshBuilder -> applyTextures -> Babylon material
                    |              |
                    |              +-- child mesh metadata: texture name/index,
                    |                  lightmap, content flags, surface flags
                    +-- name, surfaceFlags, contentFlags per BSP texture
```

Useful existing foundations:

- [`BspLoader`](../../src/engine/loader/bsp/BspLoader.ts) preserves `surfaceFlags` and `contentFlags` for every BSP texture.
- [`BspMeshBuilder`](../../src/engine/loader/bsp/BspMeshBuilder.ts) groups faces by texture/lightmap and copies the BSP flags and texture name into child-mesh metadata.
- [`ContentFlags`](../../src/engine/physics/ContentFlags.ts) already defines `WATER`, `SLIME`, `LAVA`, and the combined liquid mask.
- The collision world can query point contents, which can later support underwater camera effects.
- [`SSREffect`](../../src/engine/effects/SSREffect.ts) already supplies optional screen-space reflection for the general scene, with environment fallback and GPU-tier settings.
- Existing custom materials demonstrate that a shader-backed material is an established project pattern.

Current gaps:

- Liquid identity is not promoted to a first-class render descriptor.
- Water is sent through the ordinary legacy material factory.
- The Q3 shader parser cannot faithfully express all QFusion/Warsow cubemap conditions.
- Original `tesssize` and water vertex deformation are not a reliable basis for the new path.
- No map-scoped owner currently manages liquid render targets, observers, shared textures, or their disposal.
- Content flags exist, but there is no complete swimming, drowning, lava/slime damage, or underwater-rendering system.

The new system should be inserted at the semantic boundary between mesh construction and ordinary texture/material application. This avoids creating a legacy material only to dispose it immediately and makes map unload ownership explicit.

## Goals and non-goals

### Goals

- Replace Q3 and Warsow BSP water surfaces through one deterministic classification path.
- Preserve original BSP surface boundaries, position, visibility behavior, and collision semantics.
- Produce visibly modern water with animated detail, angle-dependent reflection, refraction/tint, and optional shoreline cues.
- Scale from inexpensive integrated-GPU rendering to a high-quality desktop tier.
- Work in WebGL 2 and WebGPU.
- Remain useful when the original shader is absent, unsupported, or partially parsed.
- Allow exact compatibility corrections without hard-coding map names in renderer logic.
- Give headless tools a way to report what will be replaced and why.
- Keep renderer-only work out of deterministic gameplay and networking state.

### Non-goals for the first implementation

- Full fluid simulation.
- Vertex-displaced collision or buoyancy.
- Automatic conversion of every translucent or reflective material into water.
- Perfect reproduction of each map's legacy blend-stage appearance.
- Swimming, drowning, or slime/lava damage rules.
- Fluid-particle splashes in the initial static-surface backend.

## Candidate feature matrix

| Candidate | Static BSP fit | Reflection / refraction | Plane and shape support | Relative GPU cost | Advantages | Disadvantages | Decision |
|---|---|---|---|---|---|---|---|
| Current Q3/Warsow stage translation | Medium when syntax is supported | Only what translated stages approximate | Any existing mesh | Low | Already integrated; preserves supported legacy art; natural fallback | Vendor conditionals and cubemaps are incomplete; no unified modern look; no depth-aware water | Keep only as fallback and comparison baseline |
| PBR or standard material with scrolling normal maps and environment cubemap | Good | Environment reflection; inexpensive fake transparency/refraction | Any mesh, including sloped surfaces | Low | Small implementation risk; works on weak GPUs; map cubemaps can be reused; no extra scene render | No live reflected scene; weak shoreline/depth cues; refraction is approximate | Use as the low-quality tier, but behind the unified system |
| Babylon `WaterMaterial` | Very good for `acidwdm2` and other horizontal pools | Live planar reflection and refraction render targets | One horizontal plane per material; extra instances for distinct heights | Medium to high | Fastest route to an attractive prototype; waves, bump, Fresnel, color, reflection, and refraction are built in; WebGL/WebGPU shader support | Creates two render targets per material; needs careful render lists and resolution; plane is based on mesh height and an up normal; weak fit for sloped/curved water; limited SHAG-specific depth/foam integration; adds `@babylonjs/materials` | Time-box a prototype and benchmark; do not make it the architectural contract |
| Custom `UnifiedWaterMaterial` plus shared render resources | Excellent | Tiered: cubemap, shared color/depth refraction, optional planar reflection | Any BSP mesh for the base effect; planar reflection only for eligible plane buckets | Low to high by tier | One compatibility path; full control of absorption, foam, map hints, performance, debug output, and fallback; can share captures across surfaces | Highest engineering and testing cost; WebGL/WebGPU shader maintenance; reflection edge cases must be owned by SHAG | **Recommended production path** |
| Babylon `FluidRenderer` | Poor for a static polygonal pool | Screen-space particle depth, thickness, diffuse, and refraction-like composition | Particle clouds or custom particle buffers, not arbitrary BSP surface meshes | High and resolution-sensitive | Excellent future option for localized splashes, jets, weapon effects, or poured liquid; visually dynamic | Would require converting/filling pools with particles; expensive blur and buffer passes; hard pool boundaries and collision mismatch; temporal artifacts | Optional effects layer later; reject as the base BSP-water replacement |
| Full particle or height-field fluid simulation | Poor as a compatibility renderer | Potentially physically rich | Requires purpose-built domains and boundaries | Very high | Highest interaction potential | Large simulation, authoring, determinism, collision, and performance scope; does not naturally preserve arbitrary legacy BSP surfaces | Out of scope |

### Why `WaterMaterial` is not the final abstraction

The official [`WaterMaterial` source](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/materials/src/water/waterMaterial.ts) shows that each instance creates both reflection and refraction `RenderTargetTexture`s. Its clip and reflection planes are derived from one mesh's absolute `y` position with a world-up normal. That is a good match for the single horizontal `acidwdm2` pool, but a poor global contract for maps with several heights or non-horizontal liquid.

It remains a useful spike because it can quickly establish a visual bar, reveal the cost of reflection/refraction on the project's target hardware, and expose BSP integration issues before a custom shader is built. The installed project currently has `@babylonjs/core` 9.17.0 but not `@babylonjs/materials`; a spike must add the matching materials package and import the modular water entry point rather than a UMD bundle.

### Why the Playground fluid is not a pool renderer

The linked [FluidRenderer Playground](https://playground.babylonjs.com/#XMXDAA#113) plays back precomputed particle positions and submits them as custom particles. Babylon's [fluid-renderer documentation](https://doc.babylonjs.com/features/featuresDeepDive/particles/fluid_renderer/) describes a screen-space process built from particle depth, diffuse, and thickness targets plus blur passes. It is designed for particle systems and custom particle vertex buffers, not for applying a material to a BSP mesh.

The effect is still highly relevant to the longer-term visual stack. A rocket splash, drain, fountain, or short-lived blob can be composed over the static unified surface without changing how the pool itself is classified or collided.

## Proposed architecture

```text
                         exact compatibility overrides
                                      |
BSP flags -----------+                 v
shader surfaceparms -+--> LiquidSurfaceClassifier --> LiquidSurfaceDescriptor
shader hints --------+          |                         |
                                |                         v
                                |              coplanar/profile bucketing
                                |                         |
                                +--> headless audit       v
                                                   LiquidSurfaceSystem
                                          +--------------+--------------+
                                          |              |              |
                                      low tier       medium tier      high tier
                                    normal+Fresnel   color/depth      optional planar
                                      + cubemap      refraction/foam    reflection
```

### 1. A semantic classifier

Add a renderer-independent `LiquidSurfaceClassifier` near the BSP/shader loading code. Its output should be explicit and inspectable:

```ts
type LiquidKind = "water" | "slime" | "lava";

interface LiquidSurfaceDescriptor {
  kind: LiquidKind;
  profileId: string;
  shaderName: string;
  detectionSources: Array<"override" | "contentFlag" | "surfaceParm">;
  plane?: { normal: [number, number, number]; distance: number };
  bounds: { min: [number, number, number]; max: [number, number, number] };
}
```

Classification precedence should be:

1. Explicit exact-name `exclude` override.
2. Explicit exact-name `include`, `kind`, or `profile` override.
3. BSP `WATER`, `SLIME`, or `LAVA` content flag.
4. Parsed top-level `surfaceparm water`, `slime`, or `lava`.
5. Otherwise, ordinary material handling.

If signals disagree, prefer the explicit override, otherwise prefer the compiled content flag and emit an audit warning. The descriptor should retain all contributing sources so a command or debug overlay can explain the decision.

### Detection decision matrix

| Signal | Strength | Advantages | Disadvantages | Policy |
|---|---|---|---|---|
| BSP liquid content flag | Strongest automatic signal | Compiled semantic intent; available without shader text; already preserved by the loader; cheap and deterministic | Depends on correct map compilation; BSP-only; a rare broken map may carry bad flags | Primary automatic classifier |
| Top-level `surfaceparm water/slime/lava` | Strong | Expresses author intent; common across Q3-family shaders; independent of stage details | Missing shader files or unusual parser syntax can hide it; compiled flag may disagree | Co-signal and fallback; record alongside BSP flag |
| Exact normalized-name override | Explicit | Fixes known broken maps; can exclude false positives and choose a visual profile; deterministic | Requires a maintained compatibility table; renamed assets need another entry | Supported escape hatch, not the default database |
| Name substring such as `*water*` | Weak | Finds candidates in old or malformed content | False positives (`waterfall_trim`, decals, glass) and false negatives (`pool_a`, `liquid01`); couples behavior to naming style | Audit/report only; never auto-replace |
| Stage heuristics such as cubemap, turbulence, scrolling, or alpha | Weak for identity | Useful appearance hints when understood | Glass, force fields, energy, metal, and fog use the same techniques; parser coverage varies | May select a profile, but must not establish liquid identity |

For `acidwdm2`, both the BSP `WATER` flag and `surfaceparm water` classify `textures/acidwdm2/water1`; no name override is necessary.

### 2. Exact compatibility overrides

Use a small typed table or JSON asset, normalized to lowercase forward-slash shader names. It should support:

```json
{
  "textures/example/broken_pool": {
    "include": true,
    "kind": "water",
    "profile": "clear"
  },
  "textures/example/waterfall_trim": {
    "exclude": true
  }
}
```

Overrides should be asset-centric, not map-centric, because the same shader can be reused across maps. The audit output should detect overrides that never match and surfaces that rely solely on an override. A future user-supplied compatibility file is possible, but the first version should use one versioned default table so browser and headless behavior remain identical.

### 3. Preserve meshes, bucket render resources

Keep the BSP-generated surface geometry instead of replacing it with one rectangle. This preserves irregular pool outlines, portals/visibility membership, seams, and exact depth-mask coverage.

After classification, bucket liquid meshes by:

- liquid kind;
- visual profile;
- approximately coplanar plane, including height;
- any render-resource constraint that truly requires separation.

Do not bucket by shader name alone. Adjacent shaders at the same height can share world-space waves and render resources while retaining per-surface tint or opacity inputs. Plane comparison needs a documented epsilon to avoid fragmenting a nominally flat pool because of floating-point noise.

`acidwdm2` should produce one water descriptor group and one coplanar render bucket. A debug command should report an unexpected split.

### 4. Map-scoped ownership

`LiquidSurfaceSystem` should own:

- the descriptors and mesh-to-liquid assignments for the loaded map;
- material/profile instances;
- shared normal/noise textures;
- scene color/depth captures;
- optional planar-reflection targets;
- camera or scene observers;
- debug meshes and counters;
- complete disposal on map unload or reload.

The ordinary texture pass should delegate a classified liquid mesh to this system instead of first constructing a legacy transparent material. This keeps resource ownership clear and avoids unnecessary texture loads or material compilation.

The system must not create server state or enter simulation checksums. The authoritative BSP content flags and collision remain unchanged.

## Recommended visual stack

### Base effect on every tier

- Two world-space normal/noise samples at different scale, direction, and speed.
- Fresnel-weighted reflection so grazing angles reflect more strongly.
- Shallow/deep color profile and controlled transparency.
- Environment reflection from the map-provided cubemap when available, otherwise the scene/sky environment.
- Stable world-space UVs so adjacent BSP meshes do not reveal seams.
- A legacy-material fallback if the unified shader fails to compile.

`acidwdm2` already ships `env/acidwdm2/water_{px,nx,py,ny,pz,nz}.jpg`; the profile/hint layer should be able to reuse this cubemap. Unsupported legacy cubemap syntax should not prevent classification.

### Medium-tier additions

- One shared opaque scene-color capture per camera for refracted background sampling.
- Scene depth sampling for depth-dependent absorption and shallow/deep transitions.
- Distorted refraction constrained to the liquid silhouette.
- Intersection or shoreline foam derived from the difference between water-surface depth and opaque-scene depth.
- Optional sun/specular sparkle using the active light direction.

Babylon's [`PBRSubSurfaceConfiguration`](https://doc.babylonjs.com/typedoc/classes/BABYLON.PBRSubSurfaceConfiguration) and [`RefractionTexture`](https://doc.babylonjs.com/typedoc/classes/BABYLON.RefractionTexture) demonstrate the available refraction, index-of-refraction, tint, thickness, and render-target concepts. A custom material is preferred because SHAG needs one coordinated capture, BSP-aware profiles, debug modes, and deliberate fallback behavior rather than an independent capture per material.

### High-tier addition

Add an optional planar reflection only for eligible, visible, sufficiently large horizontal plane buckets. Reuse one target for all surfaces in a bucket, restrict its render list, reduce its resolution, and update it less often when motion permits.

Do not enable planar reflection and full-scene SSR together by default. The existing SSR effect is useful for general opaque geometry and as an experiment for water reflection, but transparent/refraction composition and double work need explicit profiling. Planar reflection is more predictable for a large flat pool; the environment cubemap remains the robust fallback.

### No vertex displacement initially

The first production material should move normals and refraction, not BSP vertices. Sparse legacy water meshes can make vertex waves look faceted, and displaced render geometry would no longer coincide with collision or the logical waterline. Although the original acid shader asks for `tesssize 64` and vertex deformation, reproducing that safely would require tessellation/subdivision rules, bounds expansion, collision decisions, and crack prevention.

Later, low-amplitude displacement can be enabled only for eligible, sufficiently tessellated planar meshes. It must remain a visual option with a documented maximum deviation from the authoritative water plane.

## Quality and performance policy

| Tier | Water features | Extra full-scene passes | Intended target | Main limits |
|---|---|---:|---|---|
| Low | Animated normals, Fresnel, tint/alpha, map or sky cubemap | 0 | Integrated/low-end GPU | No live scene refraction or reflection |
| Medium | Low tier plus shared scene color/depth, refraction, absorption, intersection foam | 1 shared opaque capture, subject to implementation | Main default | Capture resolution and depth availability must be profiled in WebGL 2 and WebGPU |
| High | Medium plus budgeted planar reflection for a visible horizontal plane bucket | 1 additional pass per selected/updated plane bucket | High-end desktop | Strict cap on active buckets, resolution, render list, and update frequency |

Recommended controls for the first implementation:

- `r_water 0|1`: legacy fallback versus unified water.
- `r_water_quality 0|1|2`: low, medium, or high feature set.
- `r_water_debug 0|1`: classification/bucket visualization and counters.

Do not expose a large collection of tuning CVars until measurements show which controls users need. Visual profiles should hold map/content tuning; renderer CVars should control capability and cost.

Performance telemetry should include:

- number of classified surfaces and plane buckets;
- number and dimensions of active water render targets;
- reflection/refraction pass time where the backend exposes it;
- draw calls and material variants caused by water;
- how often each reflection target updates;
- fallback or shader-compilation events.

## Underwater and gameplay boundaries

Water rendering and being underwater are related but should not be the same system.

The collision world can query the camera position against BSP contents. A later `UnderwaterViewEffect` can use `WATER`, `SLIME`, or `LAVA` to select fog/color distortion, audio filtering, particles, and transition effects. Sampling point contents is preferable to guessing from the rendered plane, especially in stacked or enclosed volumes.

Swimming, buoyancy, drowning, current volumes, lava damage, and slime damage belong in authoritative gameplay/simulation work. The visual replacement must neither add nor remove collision and must not change deterministic state.

## Implementation plan

### Phase 0: Classification and audit, no visual change

1. Add typed liquid kinds, descriptors, and exact compatibility overrides.
2. Classify from BSP flags and parsed top-level surface parameters with the stated precedence.
3. Annotate or index the child meshes created by `BspMeshBuilder` without changing their current material.
4. Add `water info` (or a `bsp liquids` subcommand) that prints shader name, kind, sources, face/mesh count, bounds, plane, and override use.
5. Add focused tests for flag-only, surfaceparm-only, agreement, disagreement, explicit include/exclude, name-only non-classification, and water/slime/lava separation.
6. Verify that `acidwdm2` reports one `water` plane from both `contentFlag` and `surfaceParm`.

This phase is valuable independently: it produces a compatibility inventory before high-risk renderer work begins.

### Phase 1: Low-tier unified material

1. Add a map-scoped `LiquidSurfaceSystem` and explicit cleanup.
2. Route classified meshes away from ordinary Q3 material creation.
3. Implement the low-tier normal/Fresnel/tint/environment material in both WebGL 2 and WebGPU paths.
4. Define `water`, `slime`, and `lava` profiles while only claiming full visual acceptance for water.
5. Preserve and test the legacy fallback.
6. Compare `acidwdm2` seams, boundaries, sorting, sky/cubemap reflection, and unload/reload behavior.

In parallel with design—not as the permanent API—time-box a `WaterMaterial` version of the acid pool. Capture screenshots and GPU timings at matched render-target resolutions. Its purpose is to establish a quality/performance reference and validate the plane grouping assumptions.

### Phase 2: Shared refraction, depth, and foam

1. Add a shared opaque color/depth input rather than a pair of targets per water surface.
2. Implement depth absorption and shallow/deep tint.
3. Add intersection foam with temporal and distance stability.
4. Handle missing depth support and camera-inside-water cases with explicit fallbacks.
5. Validate ordering with transparent materials, sky, particles, post-processes, and SSR disabled/enabled.

### Phase 3: Budgeted reflection and underwater view

1. Add planar reflection selection and a hard per-frame budget for horizontal buckets.
2. Define reflection priority from visibility, screen coverage, distance, and last update.
3. Add the separate point-contents-driven underwater post-process.
4. Profile map transitions, split-screen/multiple cameras if supported, and context/device loss.

### Phase 4: Optional dynamic accents

Evaluate `FluidRenderer` only for bounded effects such as impacts, splashes, drips, and fountains. These effects should consume gameplay/render events and compose with the static surface; they must not redefine BSP liquid classification or collision.

## Validation and acceptance plan

### Headless-first checks

- `acidwdm2` loads without parser or mesh-construction failure.
- The audit command finds `textures/acidwdm2/water1` from both strong semantic signals.
- It reports one horizontal plane at Babylon `y = 56` and no unmatched required override.
- Disabling unified water resolves through the existing legacy material path.
- Classification tests cover Q3 and FBSP/Warsow flag values without requiring a browser.
- Repeated load/unload does not increase owned liquid-resource counts.

The baseline command used during this research was:

```bash
npm run cli:game -- -- --exec "bsp load acidwdm2; bsp info; bsp textures water; shader info textures/acidwdm2/water1; shader resolve textures/acidwdm2/water1; shader info textures/acidwdm2/colormadness_water; quit"
```

It completed successfully in Babylon NullEngine and confirmed the map/shader facts above. NullEngine cannot validate visual output.

### Browser visual matrix

Test at minimum:

| Axis | Cases |
|---|---|
| Backend | WebGL 2, WebGPU |
| Water quality | Low, medium, high, legacy fallback |
| General reflection | SSR off, SSR on |
| Camera | Above water, grazing angle, shoreline intersection, below water |
| Lifecycle | First load, reload same map, switch away and back |
| Performance | Low/integrated profile, default desktop, high-end desktop |

Acceptance criteria for `acidwdm2`:

- Every intended pool face uses the unified material and no surrounding translucent surface is captured accidentally.
- No visible cracks appear between the 23 source faces.
- Animation is continuous in world space across mesh boundaries.
- The water silhouette stays on the original BSP boundary.
- The map cubemap or documented fallback is used when live reflection is unavailable.
- Refraction does not sample stale or recursive water passes.
- Sorting is stable from above and below the plane.
- Low tier adds no full-scene render pass.
- Medium/high target counts and resolutions match the documented budgets.
- Map reload disposes all water materials, textures, targets, and observers.

### Required renderer regression suite

Implementation will touch renderer-sensitive code. Before shipping those code changes, run and report all commands required by the repository policy:

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
```

Also rerun the `acidwdm2` audit/load command and add focused liquid-classifier and lifecycle tests. Documentation-only changes in this investigation do not require the renderer regression suite.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Per-surface reflection/refraction targets multiply scene cost | Severe on maps with many pools | Share by plane bucket; use one shared color/depth capture; cap planar buckets and updates |
| False-positive classification replaces glass or effects | Visible compatibility regression | Require content flag, surfaceparm, or exact include; names and stage heuristics are audit-only |
| Broken legacy flags miss real water | Water remains on legacy renderer | Exact compatibility include plus audit report; compare flags and surfaceparms |
| Sparse BSP mesh makes waves faceted | Poor visuals and collision mismatch | Start with fragment/normal motion; defer vertex displacement and tessellation |
| Transparent sorting and refraction recursion | Artifacts or feedback | Define opaque capture timing; exclude liquid meshes from their own targets; test above/below water |
| Multiple water heights cause render-target explosion | Frame-time and memory spikes | Plane bucketing, priority/budget policy, environment fallback for non-selected buckets |
| WebGL/WebGPU shader drift | Backend-specific failures | Keep shared shader inputs/contracts, compile-test both paths, provide legacy fallback |
| SSR and planar reflection duplicate work | Unnecessary GPU cost and inconsistent image | Default to one reflection strategy for water; expose debug telemetry and profile combinations |
| Map unload leaks targets or observers | Increasing memory and work after map changes | One map-scoped owner with explicit disposal and lifecycle regression tests |
| Water visuals imply gameplay that does not exist | Player confusion | Track underwater/swimming as separate phases and document current behavior |

## Open questions to answer with prototypes

1. Can the existing scene color/depth infrastructure be reused safely, or should water own a specifically timed opaque capture?
2. Does existing SSR produce acceptable water reflections in SHAG's transparency/post-process order, and on which quality tiers?
3. What render-target resolution and update cadence keep `WaterMaterial` and custom planar reflection within budget on the project's lowest supported GPU?
4. Should map-provided cubemaps be preferred over the global environment, and how should incomplete or differently oriented cubemap sets be normalized?
5. How common are multi-height, sloped, patch, or waterfall liquid surfaces in the actual Q3/Warsow test corpus?
6. Do slime and lava need the same refraction pipeline, or only the shared classifier/ownership architecture with distinct emissive materials?
7. Which transparent objects must appear through/reflected in water, and can a restricted render list meet that requirement?
8. What shoreline foam behavior is acceptable when the BSP has no depth texture, terrain distance field, or authored shoreline mask?

The first prototype should answer questions 1–3 with measurements on `acidwdm2`, then scan a broader map corpus before committing plane and profile assumptions.

## Sources

### SHAG source and documentation

- [Shader system guide](../manual/guides/shader-system.md)
- [BSP system guide](../manual/guides/bsp-system.md)
- [PK3 filesystem guide](../manual/guides/pk3-filesystem.md)
- [Rendering pipeline research](./RENDERING_PIPELINE.md)
- [Babylon 9 SSR research](./BABYLON9_SSR.md)
- [`Q3ShaderParser`](../../src/engine/loader/shader/Q3ShaderParser.ts)
- [`Q3ShaderMaterialFactory`](../../src/engine/loader/shader/Q3ShaderMaterialFactory.ts)
- [`BspMeshBuilder`](../../src/engine/loader/bsp/BspMeshBuilder.ts)
- [`ContentFlags`](../../src/engine/physics/ContentFlags.ts)

### Official Babylon.js material and renderer references

- [Water material documentation](https://doc.babylonjs.com/toolsAndResources/assetLibraries/materialsLibrary/waterMat/)
- [WaterMaterial implementation](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/materials/src/water/waterMaterial.ts)
- [Fluid renderer documentation](https://doc.babylonjs.com/features/featuresDeepDive/particles/fluid_renderer/)
- [FluidRenderer API](https://doc.babylonjs.com/typedoc/classes/BABYLON.FluidRenderer)
- [Linked precomputed-particle FluidRenderer Playground](https://playground.babylonjs.com/#XMXDAA#113)
- [PBR subsurface/refraction API](https://doc.babylonjs.com/typedoc/classes/BABYLON.PBRSubSurfaceConfiguration)
- [RefractionTexture API](https://doc.babylonjs.com/typedoc/classes/BABYLON.RefractionTexture)
- [RenderTargetTexture API](https://doc.babylonjs.com/typedoc/classes/BABYLON.RenderTargetTexture)

