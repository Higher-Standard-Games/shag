# Unified Water System Research

**Date:** 2026-08-06<br>
**Status:** Phase 0 complete; Phase 1 next<br>
**Goal:** replace every Q3 and Warsow water shader with one engine water that looks deliberately modern, rather than translating the legacy shaders one vendor keyword at a time<br>
**Primary test map:** `acidwdm2`<br>
**Scope:** BSP liquid compatibility, static rendering, dynamic interactions, deterministic swimming, player animation, underwater presentation, and quality scaling.

## Executive decision

SHAG should treat water as one feature with several deliberately separated owners. BSP and shader semantics identify liquid surfaces; collision contents determine gameplay and camera state; a map-scoped `LiquidSurfaceSystem` renders the static surface; deterministic FPS simulation owns swimming; and a cosmetic `LiquidInteractionSystem` owns ripples, spray, audio, and optional FluidRenderer splashes.

The recommended production path is a custom `UnifiedWaterMaterial`, initially using animated normal maps, Fresnel reflection, environment fallback, tint, and opacity. Higher quality tiers can add one shared scene color/depth capture for refraction, absorption, and shoreline foam, followed by tightly budgeted planar reflections for large horizontal planes.

Babylon's `WaterMaterial` is worthwhile as a short visual and performance spike on `acidwdm2`, but it should not define the architecture. It owns reflection and refraction render targets per material and assumes a horizontal water plane. Babylon's `FluidRenderer` should be an **Epic-tier interaction renderer** for crowns, sheets, and droplets above the waterline. It does not simulate fluid and should never be used to fill the BSP pool.

One correction outranks everything else in sequencing. This design makes collision `pointContents` the authoritative source for swimming, damage, and camera immersion, and that query cannot see liquid today — it is a player-hull box trace, masked to solids, behind a filter that discards `NONSOLID` surfaces before reading their contents. Rebuilding it is the first gate, ahead of any movement or rendering work, because every mechanic here is downstream of it and rendering tests would keep looking correct while gameplay never entered water.

The first complete vertical slice should make `acidwdm2` do all of the following: classify its one pool without a name override, render it through the unified low-cost material, let a predicted and authoritative player wade and swim up/down, switch to a swimming animation, apply a camera-driven underwater view, produce entry/exit ripples and audio, and optionally add a bounded FluidRenderer splash on Epic quality.

The movement implementation should ship **one SHAG profile**, not a pair of compatibility presets. Both references use the same three-point water-level test, 50% swim-speed cap, full pitched view direction, vertical input, and idle sink; they differ only in water acceleration (Q3 `4`, Warsow `10`) and water-exit impulse. Those are small enough to pick ourselves and tune by feel, and reproducing both would buy a per-profile test matrix across every special move for a distinction no map depends on. Seed from the Q3 column — the one independently verifiable from published source — and keep the tuning in data. These are gameplay choices, not rendering quality choices.

The compatibility policy should be:

1. Trust compiled BSP liquid content flags first.
2. Also consume top-level shader `surfaceparm water`, `slime`, and `lava` declarations.
3. Provide exact-name include, exclude, kind, and profile overrides for broken or unusual maps.
4. Never classify a surface as water merely because its name contains `water`.
5. Treat the original shader stages as optional appearance hints, not as the identity of a liquid.
6. Use collision `pointContents` as the authoritative truth for swimming, drowning/damage, and camera immersion.
7. Keep visual quality independent of mechanics: low water quality must never disable swimming or change prediction.
8. Network states and interaction causes, never cosmetic fluid particles.

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

## What the rest of the corpus contains

The Phase 0 corpus scan has been run for content flags and brush counts, which have the same layout in IBSP and FBSP. Distinct liquid *heights* still need the real loader, because face and vertex layouts differ between the two formats.

**16 of the 39 shipped maps contain liquid.** The feature is not a one-map curiosity.

| Kind | Shaders | Notable maps |
|---|---:|---|
| Water | 15 | wdm5 (22 brushes), wbomb6 (14), wbomb3 (12), wdm11, wdm15, wamphi1, wbomb1, wbomb4, acidwdm2 |
| Lava | 4 | wdm7, wdm13, wbomb2, wda1 |
| Slime | 2 | wamphi1, wdm7 |
| `WATER | SLIME` combined on one shader | 4 | wbomb2, wdm16, wdm17, wda1 |

Three results change the design rather than just its size.

**Liquid volumes and liquid surfaces are usually different objects.** `textures/common/nodrawwater` appears on five maps (ui, wbomb1, wbomb3, wbomb6, wdm5) carrying `WATER` contents with the `NODRAW` surface flag, and on wdm5 it holds all 22 liquid brushes while the visible shader `textures/world/bluedistortwater` holds none. The mapper's idiom is a nodraw brush for the volume and a separate visible shader for the surface. A classifier that assumes the rendered surface and the swimmable volume are one descriptor will render a nodraw brush and miss the real waterline. Classify the two separately: **brush contents decide mechanics, face shaders decide rendering**, and a liquid surface with no volume behind it, or a volume with no visible surface, are both normal rather than broken.

**Combined liquid contents are real, not hypothetical.** Four shaders carry `WATER | SLIME` on the same brush. The instruction to preserve raw contents in `LiquidSample` rather than collapsing to one kind is load-bearing, and the rendering profile must pick a dominant kind without the mechanics doing the same.

**BSP shader names are not reliably null-terminated.** Several entries returned trailing ASE model text inside the 64-byte name field. Names must be sanitized at the first non-printable character before they are normalized, or the exact-name override table will never match the maps most likely to need it.

**Five of the six bomb maps have water** — wbomb1, wbomb2, wbomb3, wbomb4 and wbomb6. Bots already play Search and Destroy on maps with liquid volumes, which decides the bot question below rather than leaving it to a later corpus scan.

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
- The collision world exposes a `pointContents` entry point. The interface is the right one; the implementation behind it does not answer liquid questions yet, and rebuilding it is the first gate below.
- [`SSREffect`](../../src/engine/effects/SSREffect.ts) already supplies optional screen-space reflection for the general scene, with environment fallback and GPU-tier settings.
- Existing custom materials demonstrate that a shader-backed material is an established project pattern.
- [`MovementProfile`](../../src/games/fps/simulation/MovementProfile.ts) is shared by server simulation and client prediction, so swimming can be deterministic without duplicating movement code.
- [`MovementStateComponent`](../../src/engine/network/components/MovementStateComponent.ts) has two currently unused flag bits, enough to encode water level `0..3` after protocol tests.
- [`PostProcessingManager`](../../src/engine/effects/PostProcessingManager.ts) already coordinates the main Babylon post-process pipeline.
- `trace()` and `SweepBackendTraceOptions` already take a `contentMask`, with `SHOT_CONTENT_MASK` beside them, so a liquid mask is an argument to an existing parameter rather than a new query path.
- [`QualityDetector`](../../src/engine/core/QualityDetector.ts) already tiers effects by GPU class, and Settings already hosts per-effect graphics controls.

Current gaps:

- Liquid identity is not promoted to a first-class render descriptor.
- Water is sent through the ordinary legacy material factory.
- The Q3 shader parser cannot faithfully express all QFusion/Warsow cubemap conditions.
- Original `tesssize` and water vertex deformation are not a reliable basis for the new path.
- No map-scoped owner currently manages liquid render targets, observers, shared textures, or their disposal.
- [`RemotePlayerRenderer`](../../src/games/fps/client/RemotePlayerRenderer.ts) currently interprets every ungrounded player as jumping; it needs water level before it can select swim animation.
- FluidRenderer attaches its own camera post-process, so its order relative to SHAG's default pipeline and a future underwater effect must be inspected and made explicit.
- Content flags exist, but there is no complete swimming, drowning, lava/slime damage, underwater-rendering, or liquid-interaction system.
- `pointContents` cannot currently see liquid at all. This is the largest gap in the plan and has its own section below.
- There is a dangerous contents-contract mismatch: the Q3/FBSP backend returns raw flags (`LAVA=0x8`, `SLIME=0x10`, `WATER=0x20`), while the abstract `Contents` enum in [`CollisionWorld`](../../src/shared/collision/CollisionWorld.ts) uses `WATER=0x2`, `LAVA=0x4`, `SLIME=0x8`. The two agree on exactly one value, `SOLID=0x1`, which is why nothing has broken yet — and `Contents.SLIME` collides numerically with raw `LAVA`, so a mask written against the shared enum reports slime while standing in lava.
- Bots consume collision contents today and are not mentioned anywhere in this design. Changing `pointContents` regresses them on contact; see the bots section below.
- New animated normal/noise textures have no home yet. They are not in any pk3, so the asset location, the KTX2 conversion pass (`npm run tools:textures`), and the pk3 manifest all need a decision before the first material ships.

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
- Make swimming identical in server simulation, client prediction, reconciliation, and replay.
- Support wading, full swimming, pitched forward motion, explicit ascend/descend controls, idle sinking, water exits, and fall-damage attenuation.
- Provide readable third-person swim states and a comfortable first-person underwater presentation.
- Add scalable ripples, splashes, and optional screen-space fluid accents without networking particles.
- Keep cosmetic renderer state out of deterministic gameplay checksums.

### Non-goals for the first implementation

- Full fluid simulation.
- Vertex-displaced collision or buoyancy.
- Automatic conversion of every translucent or reflective material into water.
- Perfect reproduction of each map's legacy blend-stage appearance.
- A general-purpose volumetric fluid simulator.
- Networking individual splash, foam, bubble, or FluidRenderer particles.
- Making fluid particles merge perfectly with the static polygonal pool surface.
- Shipping oxygen/drowning and slime/lava damage in the first swimming milestone; those should use the same liquid sample later as separate authoritative world-effect rules.
- Authoring a large animation set before the neutral and forward swim loops have been proven sufficient.

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

There is also a concrete SHAG integration trap. BSP child meshes currently contain baked world-space vertices while their Babylon transforms normally remain at the origin. Assigning `WaterMaterial` directly to the acid surface would therefore give the material a mesh height near `y=0`, even though the actual water vertices are at `y=56`. The spike must either build a proxy mesh whose local vertices are relative to the plane and whose transform is at the water height, or fork/adapt the material to accept an explicit plane. A visually correct result obtained by hard-coding `56` would not validate the reusable architecture.

It remains a useful spike because it can quickly establish a visual bar, reveal the cost of reflection/refraction on the project's target hardware, and expose BSP integration issues before a custom shader is built. The installed project currently has `@babylonjs/core` 9.17.0 but not `@babylonjs/materials`; a spike must add the matching materials package and import the modular water entry point rather than a UMD bundle.

### Why the Playground fluid is not a pool renderer

The linked [FluidRenderer Playground](https://playground.babylonjs.com/#XMXDAA#113) plays back precomputed particle positions and submits them as custom particles. Babylon's [fluid-renderer documentation](https://doc.babylonjs.com/features/featuresDeepDive/particles/fluid_renderer/) describes a screen-space process built from particle depth, diffuse, and thickness targets plus blur passes. It is designed for particle systems and custom particle vertex buffers, not for applying a material to a BSP mesh.

The effect is still highly relevant to the longer-term visual stack. A rocket splash, drain, fountain, or short-lived blob can be composed over the static unified surface without changing how the pool itself is classified or collided.

### FluidRenderer deep dive: what an Epic splash actually costs

The installed `@babylonjs/core@9.17.0` already contains FluidRenderer; no extra package is required. The explicit integration import is:

```ts
import @babylonjs/core/Rendering/fluidRenderer/fluidRenderer;

const fluidRenderer = scene.enableFluidRenderer();
```

That side-effect import registers `scene.enableFluidRenderer()`. The relevant public routes are `addParticleSystem(...)` for Babylon CPU/GPU particle systems and `addCustomParticles(...)` for application-owned position/color/velocity buffers. Both return render objects; neither advances a liquid simulation.

The source inspection changes the implementation recommendation in several useful ways:

- Pass one shared `FluidRenderingTargetRenderer` as the third argument to all splash render objects for a camera. Omitting it creates a new target renderer and final post-process for every add call.
- Create a small number of long-lived particle pools. Do not create and dispose a Babylon `ParticleSystem` for every impact.
- Start with `generateDiffuseTexture=false`. Water spray can use one fluid color and avoid the optional diffuse render target.
- Use fixed `depthMapSize` and `thicknessMapSize` values rather than screen-size defaults. This makes cost predictable on high-DPI displays.
- Keep `samples=1`. The installed API notes depth/stencil MSAA limitations under WebGL.
- Benchmark `useFixedThickness=true`. It removes the thickness target and its blur chain at the cost of a flatter result.
- Keep `useVelocity=false` initially. In the current shader, velocity magnitude changes whiteness; it does not stretch droplets.
- Reuse FluidRenderer's depth, thickness, diffuse, normal, and debug display modes in `water debug fluid`.

With the installed defaults, one dynamic-thickness target renderer draws particle depth, performs three bilateral depth-blur iterations (two ping-pong passes each), draws thickness, performs one two-pass thickness blur, and composites the result. That is roughly eleven fluid-related draws/passes before optional diffuse output and surrounding scene work. It is far too much as an unnoticed default for a few droplets; a deliberate fixed-resolution, low-iteration Epic preset is required.

Initial prototype values, explicitly subject to GPU measurement:

| Preset | Particle pool | Depth / thickness maps | Blur | Diffuse | Purpose |
|---|---:|---:|---|---|---|
| Medium | No FluidRenderer | N/A | N/A | N/A | Ripple impulse, foam ring, and ordinary sprite/mesh spray |
| Epic starting point | 128-256 active droplets globally | 512 / 256 | 1 depth + 1 thickness iteration | Off | Validate the visual win and post-process order |
| Epic experiment | Same capped pool | 768 / 512 | 2 depth + 1 thickness iterations | Off | Measure whether extra smoothness is visible in motion |
| Fixed-thickness experiment | Same capped pool | 512 / none | 1 depth iteration | Off | High-value cost fallback if crowns still read well |

These are starting caps, not promised budgets. The browser prototype must record GPU/frame time, target count, target dimensions, particle count, and emitted-versus-dropped interactions.

### Fluid simulation and surface handoff

The first FluidRenderer prototype should use one or two CPU `ParticleSystem` pools grouped by droplet size, with a shared target renderer. CPU ownership is intentional: SHAG can update the effect on a small fixed step, know each particle position, and detect when a droplet crosses the logical water plane. On re-entry, retire the droplet and inject a cheap normal/ripple impulse into the static water material.

A GPU particle system is attractive only after profiling. GPU-owned positions make per-particle BSP/plane re-entry, ripple handoff, and deterministic replay seeding harder. A custom buffer pool offers the most control, but is extra code that should be justified by the CPU prototype.

Static water is transparent and may not be represented in the opaque depth texture FluidRenderer uses for occlusion. Fluid particles below the surface can therefore show through, and the particle volume will not truly merge with the polygonal pool. The robust art direction is to render the crown, sheet, and droplets **above** the surface, terminate them at re-entry, and let the static material supply the pool and ripples.

### Cross-system decision matrix

| Decision | Options considered | Advantages of the chosen option | Costs / disadvantages | Decision |
|---|---|---|---|---|
| Liquid identity | Name list, shader-stage heuristic, semantic BSP/shader signals | Works across Q3/Warsow syntax; deterministic; auditable | Needs overrides for genuinely broken assets | Semantic classifier plus exact overrides |
| Mechanical truth | Rendered plane, trigger meshes, collision contents | Same source is available to prediction/server; handles enclosed and stacked volumes | Raw content values must be normalized correctly | Collision `pointContents` |
| Static pool renderer | Legacy stages, WaterMaterial, FluidRenderer, custom material | Preserves BSP mesh while scaling from cubemap to depth/reflection | Largest renderer implementation surface | Custom `UnifiedWaterMaterial`; benchmark WaterMaterial |
| Interaction renderer | Only sprites, only FluidRenderer, tiered effects | Cheap feedback on all hardware and an Epic ceiling | Two visual paths need consistent event tuning | Ripple/foam always; sprite spray at Medium; FluidRenderer at Epic |
| Swim feel | One blended tuning, Q3/Warsow presets, one SHAG profile | Half the test matrix; the numbers are ours to tune; a second preset stays cheap to add later as data | Loses exact parity with either reference, which nothing measurable depends on | One profile, seeded from the verifiable Q3 values |
| Remote swim state | Guess from airborne state, recompute locally, snapshot water level | Two bits give stable animation transitions and spectator/replay behavior | Protocol serialization change | Encode water level `0..3`; derive liquid kind locally unless required |
| Underwater detection | Local-player state, water plane distance, camera contents | Correct for spectator, death, third-person, and free cameras | Binary contents need visual hysteresis | Sample active camera contents; use plane only for smoothing |
| Swim animation | Jump fallback, many directional clips, neutral+forward plus procedural pitch | Small asset requirement; Warsow-proven split; readable up/down motion | Retargeting and blend quality need validation | Neutral/tread + forward loop first |
| Cosmetic networking | Replicate particles, replicate effect seeds, derive from existing state/events | No bandwidth or prediction coupling | Distant effects may differ cosmetically | Derive client-side; stable seed from tick/source/position |

## Proposed architecture

```text
BSP flags + shader semantics + exact overrides
                  |
                  v
        LiquidSurfaceClassifier -------> LiquidSurfaceDescriptor[]
                  |                                  |
                  |                                  v
                  |                      LiquidSurfaceSystem
                  |                    static material + ripples
                  |
collision pointContents
                  |
                  v
          LiquidVolumeSampler
       +----------+-----------+-------------------+
       |                      |                   |
       v                      v                   v
predicted/authoritative   camera contents    segment/surface crossings
MovementProfile          UnderwaterView      LiquidInteractionSystem
       |                      |                |       |       |
       v                      v                v       v       v
waterLevel/state       world post-process   ripple  sprite  FluidRenderer
       |
       +----> snapshots/replays ----> remote swim animation
```

The dependencies flow one way. Rendering never decides whether a player can swim. Fluid particles never feed collision. Underwater presentation samples the active camera rather than assuming it is attached to the local player. Static render descriptors may improve the exact visual crossing point, but authoritative state always comes from collision contents.

### Ownership and suggested module boundary

The active game is FPS-centric, so avoid creating an engine-wide liquid framework before the first feature is proven. A practical split is:

- `src/games/fps/liquid/LiquidTypes.ts`: pure liquid kinds, samples, transitions, and profile data; no Babylon imports.
- `src/games/fps/liquid/LiquidVolumeSampler.ts`: pure three-point/player and point-content queries over the existing collision interface.
- `src/games/fps/simulation/MovementProfile.ts`: consumes the sampler and applies authoritative/predicted swimming.
- `src/games/fps/liquid/client/LiquidInteractionSystem.ts`: client-only body/projectile/explosion crossings and effect dispatch.
- `src/games/fps/liquid/client/UnderwaterViewEffect.ts`: camera contents, visual mix, post-process, and audio transitions.
- A renderer-owned `LiquidSurfaceSystem` close to BSP mesh/material construction, because it owns Babylon meshes, materials, captures, and map unload.

The classifier and surface descriptors should not import FPS simulation. The pure sampler should not import Babylon. Client effect systems may consume both descriptors and collision queries.

### Core liquid contracts

```ts
type LiquidKind = water | slime | lava;
type WaterLevel = 0 | 1 | 2 | 3;

interface LiquidSample {
  level: WaterLevel;
  kind: LiquidKind | null;
  rawContents: number;
  footContents: number;
  waistContents: number;
  eyeContents: number;
}

interface LiquidInteraction {
  type:
    | body-enter
    | body-exit
    | head-under
    | head-clear
    | projectile-enter
    | explosion-impulse
    | particle-reentry;
  liquidKind: LiquidKind;
  position: [number, number, number];
  normal: [number, number, number];
  velocity: [number, number, number];
  energy: number;
  radius: number;
  seed: number;
  tick?: number;
}
```

`LiquidSample` is deterministic simulation data. `LiquidInteraction` is a semantic cosmetic request: one request can produce audio, a normal-map impulse, foam, ordinary particles, and FluidRenderer particles according to quality and budget.

### Make `pointContents` a real point query first

Policy 6 makes collision contents the authoritative truth for swimming, drowning, and camera immersion. That entry point exists, but it cannot report liquid today, for three independent reasons in [`SweepCollisionBackend`](../../src/engine/physics/SweepCollisionBackend.ts):

1. **It is a box query, not a point query.** `pointContents` is implemented as `trace(point, point)` with no options, and `trace` defaults to `PLAYER_RADIUS` / `PLAYER_HEIGHT` — a 32x32x64 hull. Three-point sampling over that primitive would return the same answer for feet, waist, and eye, collapsing all four water levels into one.
2. **The default mask excludes liquids.** `trace` defaults `contentMask` to `SOLID | PLAYERCLIP`, and `shouldCollideWith` has no branch that can return true for `WATER`, `SLIME`, or `LAVA` under any mask. It falls through to `return false`.
3. **Liquid is rejected before the content check runs.** `shouldCollideWith` returns false on `SurfaceFlags.NONSOLID` as its first rule. The `acidwdm2` water surface flags recorded above, `0x00004c00`, are `NONSOLID | POINTLIGHT | NOLIGHTMAP` — the test map's water is discarded by the first line of the filter.

The net effect is that `pointContents` returns `0` inside water on every map. This is not a wrapper or a normalization job; the primitive has to be built:

- a true point-in-brush test that does not inflate the query by a player hull;
- a `MASK_LIQUID` content mask, using the `contentMask` parameter the trace already accepts;
- a liquid-aware path through the brush filter, so that liquid content is honored *because* the caller asked for it, while `NONSOLID` continues to mean "does not block movement" for every solid-seeking caller;
- a point query that reports accumulated contents rather than the contents of one stopping brush.

Everything mechanical in this design is downstream of that primitive, and all of it is testable headlessly, so it should be its own gate before any movement work begins.

### Then normalize the contents contract

The raw BSP/Q3 values used by the active collision backend are `LAVA=0x8`, `SLIME=0x10`, and `WATER=0x20`. The generic shared `Contents` enum uses `WATER=0x2`, `LAVA=0x4`, `SLIME=0x8`, while `SharedCollisionWorld.pointContents()` passes backend values through without translation. The two enums agree on `SOLID=0x1` and nothing else, and `Contents.SLIME` is numerically identical to raw `LAVA`.

The audit this needs is already done, and it is small. There are exactly two consumers, and both test only the one bit that happens to coincide:

- [`BotVision.isInsideSolid`](../../src/bot/BotVision.ts) — `pointContents(point) !== 0`;
- [`GametypeController`](../../src/games/fps/server/gametypes/GametypeController.ts) spawn-point jitter — `contents & Contents.SOLID`.

That two-call-site blast radius removes the argument for keeping a separate `Q3ContentFlags` contract purely to avoid churn. **Normalize the backend flags once at the shared collision boundary and update both consumers and their tests together.** Add exact mask tests for water, slime, lava, combinations with translucent flags, and non-liquid contents. A wrong mask would make all later rendering tests look plausible while gameplay never enters water — and the slime/lava aliasing above would do it silently rather than visibly.

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

**Classify volumes and surfaces separately.** The corpus scan shows the two are usually different objects: mappers put `WATER` contents on a `NODRAW` brush and the visible water on a different shader entirely, and on wdm5 every liquid brush is nodraw while the visible shader has none. So:

- **Brush contents decide mechanics.** A nodraw liquid brush is a real swimmable volume and must be sampled, whatever it looks like.
- **Face shaders decide rendering.** A liquid brush carrying `SurfaceFlags.NODRAW` must never produce a rendered surface, and a visible liquid face with no brush behind it is normal rather than an error.
- Neither absence is a fault to warn about. The audit output should report volume-without-surface and surface-without-volume as ordinary map shapes, and reserve warnings for the case where signals genuinely conflict.

**Sanitize shader names before normalizing them.** Several entries in the shipped corpus carry trailing uninitialized bytes — ASE model text — inside the 64-byte name field, so the name does not terminate at a null. Trim at the first non-printable character before lowercasing and normalizing separators, or exact-name overrides will silently fail to match precisely the malformed assets that need them.

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

**Slime and lava are colour, not content.** They are the same material with different absorption, tint and emissive values — bright toxic green for slime, hot emissive orange for lava — driven by shader parameters rather than by loading the original per-map texture sets. That is the whole point of replacing the legacy shaders instead of translating them: one material that looks deliberately modern, parameterized per liquid kind, rather than a fork per art asset. The classifier already yields the kind, so the profile is a lookup.

Nothing about *touching* slime or lava hurting the player belongs here. Damage is a gameplay rule over `LiquidSample`, and it ships with the world effects in Phase 7.

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

| Tier | Static surface | Interactions | Underwater view | Extra render cost | Intended target |
|---|---|---|---|---|---|
| 0: Legacy | Existing Q3/Warsow path | Entry/exit audio and minimal ring only | Readable tint; distortion off | No new full-scene pass | Compatibility / weakest GPU |
| 1: Low | Animated normals, Fresnel, tint/alpha, map or sky cubemap | Normal-map ripple and cheap foam ring | Tint/fog plus optional Q3-style FOV pulse | No full-scene water capture | Integrated GPU |
| 2: Medium | Shared scene color/depth, refraction, absorption, intersection foam | Ripple, foam, ordinary sprite/mesh spray | Tint/fog, restrained refraction, suspended particles | One shared opaque capture, subject to implementation | Main default |
| 3: Epic | Medium plus one budgeted planar reflection bucket | Medium effects plus capped FluidRenderer crowns/droplets | Medium plus optional caustics/light shafts | Shared capture, selected reflection, one fixed-size fluid target per active camera | High-end desktop |

Swimming, liquid damage, oxygen, water level, and input behavior are intentionally absent from this table: they are identical at every rendering tier.

Recommended controls for the first implementation:

- `r_water 0|1`: legacy fallback versus unified static surface.
- `r_water_quality 0|1|2|3`: legacy, low, medium, or Epic visual preset.
- `r_water_debug 0|1`: classification/bucket visualization and counters.
- `r_underwater_distortion 0..1`: accessibility/user comfort scale; `0` keeps color/fog and disables motion.
- A developer-only `r_water_fluid -1|0|1` override may force the preset choice while profiling, but should not become a required user setting.

Do not expose a large collection of tuning CVars until measurements show which controls users need. Visual profiles should hold map/content tuning; renderer CVars should control capability and cost.

`r_water_quality` and `r_underwater_distortion` belong in Settings under Graphics, beside the Bloom/Glow/Reflections controls added in v0.9.20, not console-only: the first is a performance choice and the second is a comfort control, and neither is discoverable from a console the average player never opens. The default tier should come from `QualityDetector` like the other GPU-tier-scaled effects rather than being hardcoded to Medium.

Performance telemetry should include:

- number of classified surfaces and plane buckets;
- number and dimensions of active water render targets;
- Fluid target renderer count, active/capped particle count, and dropped emissions;
- reflection/refraction pass time where the backend exposes it;
- draw calls and material variants caused by water;
- how often each reflection target updates;
- fallback or shader-compilation events.

## Swimming mechanics

### Verified Q3 and Warsow baseline

The official Q3 and Warsow/QFusion movement sources agree on the core model and differ mainly in tuning:

| Behavior | Quake 3 | Warsow/QFusion | SHAG decision |
|---|---|---|---|
| Water-level samples | Feet, midpoint to eye, eye | Same | Use one shared sampler |
| Full swimming threshold | `waterLevel > 1` | `waterLevel >= 2` | Levels 2 and 3 (the two sources spell the same condition differently; there is no difference to preserve) |
| Swim speed cap | 50% of player speed | 50% of player speed | Profile field, default `0.5` |
| Water acceleration | `4` | `10` | Seed from Q3`s 4 and tune; one profile |
| Source availability | Verified against published id source | `gs_pmove.cpp` is engine source and does **not** ship in `data0_21pure.pk3`, unlike the gametype AngelScript | Q3 values are independently checkable; the Warsow column rests on the upstream repository read and should be confirmed empirically once the profile exists |
| Water friction | `1 * waterLevel`, including wading | `1 * waterLevel` at level 2/3 | Profile behavior, not one accidental hybrid |
| Idle behavior | Sink at 60 units/sec | Sink at 60 units/sec | Default `60` |
| Direction | Full pitched forward/right plus vertical command | Same | Look-and-swim plus explicit ascend/descend |
| Water exit | Solid 30 ahead at +4, clear 16 above; forward/up `200/350` | Same probes; forward/up `50/350` | Profile impulse |
| Fall attenuation | Level 1: 50%; level 2: 25%; level 3: none | Same | Apply in authoritative fall calculation |
| Base animation | One legs swim loop | Swim torso plus neutral/forward legs | Start with Warsow-like neutral/forward split |
| Classic underwater view | Opposed horizontal/vertical FOV pulse, 1 degree at 0.4 Hz | Multiplicative FOV pulse around 0.6 Hz plus color blend | Keep as a restrained/accessibility-scaled homage |

This argues for one algorithm with its tuning held as data:

```ts
interface LiquidMovementProfile {
  swimScale: number;             // 0.5 — half of base speed
  waterAcceleration: number;     // seeded from Q3's 4
  waterFriction: number;         // 1
  frictionStartsAtLevel: 1 | 2;  // 1 — friction applies while wading
  idleSinkSpeed: number;         // 60
  waterJumpForward: number;      // seeded from Q3's 200
  waterJumpUp: number;           // 350
}
```

**Ship one SHAG profile, not two compatibility presets.** The two references differ in three numbers, and reproducing that difference exactly would buy a dual-profile system whose cost is not the numbers but the test matrix: every special move — wall jump, dash, ledge, crouch-slide, auto-hop — would need per-profile coverage at levels 1, 2 and 3, to preserve a distinction no map depends on and no player can perceive. Seed the single profile from the Q3 column, which is the one independently verifiable from published source, and tune it by feel. Half of base speed is both engines' answer and a sensible one.

The struct stays because the values want tuning, not because two of them want shipping. If a genuine compatibility need appears later, a second preset is a data entry rather than a rewrite.

Do not select this profile from `r_water_quality`. It belongs to the FPS movement/game profile used identically by server and predicted client.

### Three-point water sampling

Sample using the current canonical movement bounds and effective view height after crouch state has been resolved:

```ts
feetY = origin.y + bounds.min.y;       // the hull's own floor
footY = feetY + 1;                     // probe point, lifted 1u out of the floor
eyeY  = origin.y + viewHeight;
midY  = feetY + (eyeY - feetY) * 0.5;  // midpoint of feet..eye, NOT of footY..eye
```

The `+ 1` belongs to the foot probe alone. Q3 computes `sample2 = viewheight - MINS_Z` and places the middle sample at `origin + MINS_Z + sample2 / 2`, measuring from the hull floor rather than from the lifted probe. Deriving the midpoint from `footY` instead puts it half a unit high — visually nothing, but it makes a profile that claims Q3 exactness silently not Q3, in a path that feeds prediction and replay.

1. If the foot point is not in `MASK_LIQUID`, level is 0.
2. Otherwise level is 1 and liquid contents/kind are recorded.
3. If the midpoint is liquid, level is 2.
4. If the eye point is also liquid, level is 3.

Sample immediately before movement and again after movement. The first sample selects the movement branch; the second becomes output state and generates enter/leave/head-under/head-clear transitions. Using current bounds matters because SHAG's standing, crouched, and camera values are not currently defined in one place. The sampler should receive them from movement state rather than repeat magic heights.

Preserve raw contents in the sample. If water/slime/lava bits are ever combined, authoritative world effects may need all of them even if rendering chooses one dominant visual profile.

### Control and movement algorithm

For water levels 2 and 3:

1. Apply water friction to full 3D velocity.
2. Reconstruct full camera forward/right from the command yaw and pitch; do not flatten forward as ground/air movement does.
3. Add forward/back and strafe intentions.
4. Map jump/Space to positive vertical intent and crouch/Ctrl to negative vertical intent.
5. Use command scaling/normalization so forward+strafe+vertical input cannot exceed the intended speed.
6. If there is no input, target `-idleSinkSpeed` vertically.
7. Clamp wish speed to `maxSpeed * swimScale`.
8. Accelerate with the selected water acceleration.
9. Clip against an underwater ground plane without discarding speed, then slide-move without normal gravity.
10. Re-sample contents and emit state transitions.

This gives both familiar controls: looking upward and pressing forward swims upward, while Space/Ctrl provide unambiguous up/down movement independent of view direction.

At water level 1, retain the normal ground/air branch but apply the selected wading friction and speed reduction. Q3 interpolates from full speed toward the 50% swim cap by water level. That interpolation is the baseline: friction applies while wading, not only once swimming.

### Special movement and leaving water

Water-exit assistance is necessary for old maps. At level 2, probe a short distance forward near the torso, require a solid lip, require clearance above it, then launch forward/up using the movement profile. While the timed water-jump is active, apply gravity and collision without user control; cancel it on ground contact or once vertical velocity becomes negative.

SHAG also has wall jump, dash, ledge, crouch-slide, and auto-hop behavior that Q3 does not. Do not let call order decide their underwater behavior accidentally:

- Swimming replaces the ordinary jump and clears wall/ledge/crouch-slide state while deep. That is the Q3 answer and the simpler one. Whether a submerged dash or wall jump should be possible at all is a design question to settle in play, not a compatibility obligation inherited from either reference.
- Crouch is descend input while swimming; it must not leave a stale crouch-slide flag.
- Space is ascend input while swimming; it must not set the normal grounded jump-held state incorrectly.
- Add focused tests for each special feature at levels 1, 2, and 3. Whatever the answer, it should be chosen and pinned rather than fall out of call order.

### Deterministic and networked state

Add `waterLevel` and raw liquid contents/kind to the movement result and authoritative physics component. Include every mechanics-relevant field in cloning, reset, prediction reconciliation, replay/checksum, and simulation fingerprints.

For remote presentation, pack `waterLevel` into the two currently unused high bits of `MovementStateComponent`'s movement flags, subject to a serialization audit and protocol-version decision. Water level is discrete and must step at snapshot boundaries, not interpolate through fractional values. Remote clients can derive the visual liquid kind from local static collision/map data unless a later gameplay rule requires it explicitly.

The two bits are genuinely free — bits 0 and 1 are sliding and crouching, 2-3 are wall-jump state, and 4-5 are ledge state — but water level consumes **both**, and that byte is written on every snapshot for every player. Spend them deliberately: the next piece of movement state to need replication will have to widen the field, and it should not discover that at the time.

An older demo or snapshot reader that predates the change will decode the new bits as part of a flags byte it thinks it understands. Playing a pre-water demo is therefore part of this phase's exit gate, not a later compatibility chore.

Do not network fluid particles. Body transitions already follow movement state; projectile and explosion interactions can be reconstructed from authoritative entity/event motion. If a replicated interaction is ever necessary, send one semantic event with position, energy, kind, and seed.

### Fall damage, oxygen, slime, and lava

Current fall tracking treats a swimmer as merely ungrounded. Without integration, entering water can lead to a false hard landing later. Apply the verified water multipliers to the landing delta: level 1 halves it, level 2 quarters it, and level 3 cancels it. Liquid entry should also reset any auxiliary fall accumulator that is not already derived from instantaneous velocity.

Oxygen and damage belong to a separate server-owned `LiquidWorldEffectsSystem`, consuming the same `LiquidSample`. Q3's reference behavior resets a 12-second air timer whenever the head is clear; after full submersion exhausts it, drowning damage occurs once per second and increases from 2 up to a cap of 15. Lava and slime damage scale by water level. Those are good compatibility references, but should ship after core swimming with their own gameplay tests and configurable policy.

### Bots

**Swimming itself is not bot work.** Bots are network clients: they send usercmds and the server runs the same shared `MovementProfile` for a bot that it runs for a human. A bot that walks into water will swim, sink while idle, and obey the speed cap with no bot code written at all. What bots lack is not the ability to swim but the knowledge that water exists — where it is, what it costs to cross, and which button raises them out of it.

That knowledge is `src/bot/`, which runs in the `bot:server` process:

- **`BotVision.isInsideSolid`** is literally `pointContents(point) !== 0`. The moment `pointContents` learns to report liquid, **every water volume reads as solid to bot vision and to nav-edge validation**: bots would treat pools as walls, and graph edges crossing them would be rejected. This is a regression shipped by Phase 0, before any water feature exists, and the fix is to test the solid mask explicitly rather than "anything at all". Do it in the same change, not afterwards.
- **The nav graph** has no swimmable space and no notion of a surface; its floor sampling assumes standable ground, and nothing costs a water crossing differently from a floor crossing, so a route through a pool looks free.
- **Cached graphs will hide the fix.** Graphs persist in `.cache/bots/maps` behind `BOT_NAV_GRAPH_SCHEMA_VERSION`, a map fingerprint, a trigger-resolver version and a movement fingerprint. Adding water nodes or water edge costs without bumping the schema version means every bot silently loads its old, water-less graph and the work appears to do nothing.
- **Vertical intent has no expression.** Steering produces a horizontal direction; ascending requires the jump button and descending requires crouch. A bot that cannot press those can enter water and never leave it, which looks exactly like the bot being stuck.
- **Drowning avoidance** needs oxygen state and belongs with the Phase 7 world effects, not before.

This is not deferrable to "if a map needs it". The corpus scan says 16 of 39 shipped maps contain liquid and five of the six bomb maps have water, so bots are already running Search and Destroy in maps with water volumes in them.

The staging that follows from this: the `BotVision` fix ships in Phase 0 with the collision change, because it is a regression rather than a feature. Vertical intent ships with Phase 2, because a bot that can swim but cannot surface is worse than one that avoids water. Nav-graph water nodes, edge costs and the schema bump belong in their own milestone alongside Phase 6, and until then "bots avoid water rather than route through it" is a stated and tested limitation, not an assumption nobody wrote down.

## Swimming animation and player presentation

Q3 selects a swim legs loop for a deep, ungrounded player. Warsow goes further: it selects a swimming torso, a neutral/treading lower-body loop when not moving forward, and a forward lower-body loop otherwise. That is a strong fit for SHAG's initial animation scope.

Recommended first asset set:

- required: `swim_idle` / treading-water loop;
- required: `swim_forward` loop;
- optional: `swim_up` strong stroke;
- optional: `swim_down` / dive;
- later polish: surface swim, enter-water, exit-water, and water-jump one-shots.

Mixamo is a reasonable candidate source for the first two loops. Prefer in-place downloads, retain the untouched source files, record the source/terms with the asset, and validate retargeting against SHAG's actual player skeleton before committing names or frame ranges. Root motion must be removed; movement remains simulation-driven.

Animation-state priority should be explicit:

1. death and non-interruptible one-shots;
2. timed water-exit/water-jump;
3. `waterLevel >= 2`: swim state;
4. ordinary airborne jump/fall;
5. slide/crouch/run/walk/idle.

For the first pass, choose idle versus forward from 3D speed/input and procedurally pitch the whole body or lower-body root toward normalized swim velocity. Clamp and smooth pitch so ascending/descending reads clearly without breaking weapon aim. Keep torso/weapon aiming as a separate layer where the current skeleton supports it. Playback speed can follow swim speed within a narrow range.

At level 1, retain walking/running animation and add wading splashes. At level 2, use a surface/deep swim state even if feet occasionally contact the bottom. At level 3, use the same base loops initially; bubbles and underwater presentation provide the extra cue.

`PlayerModelManager` currently tolerates missing animation files by falling back, which is useful during development but not acceptance. The feature is visually complete only when the neutral and forward loops actually load, blend, survive map/player reload, and override the current remote-player `!grounded => jump` rule.

First-person presentation should be modest: reduce normal weapon bob, add a low-amplitude fluid sway, and allow bubbles/particulate to cross the view. Do not make weapon sway part of deterministic state.

## Liquid interactions and splash generation

Every interaction first creates a semantic `LiquidInteraction`, then quality/budget decides the outputs:

| Source | Detection | Always-cheap output | Medium output | Epic output |
|---|---|---|---|---|
| Player enter/exit | Pre/post water-level transition plus velocity | Ripple impulse + audio | Foam ring + spray | Fluid crown/droplets |
| Head under/clear | Level 3 transition | Audio/view transition | Bubbles | Small Fluid droplets only on clear if useful |
| Projectile entry | Previous-to-current projectile segment crosses liquid contents/surface | Ripple impulse | Directional spray | Fluid sheet/droplets |
| Explosion near water | Explosion radius intersects indexed liquid surface | Broad ripple | Foam/spray burst | Large bounded crown |
| Fluid particle re-entry | CPU particle crosses owning plane | Secondary ripple | Same | Particle is retired |

The existing projectile-impact event is insufficient for water entry because water is nonsolid and ordinary shot traces use a solid mask. That mask is now a parameter rather than a fixed assumption: `trace()` and `SweepBackendTraceOptions` take a `contentMask`, with `SHOT_CONTENT_MASK` defined beside them. A liquid-masked trace along the projectile's previous-to-current segment is therefore a smaller mechanism than a parallel segment sampler, and it reuses the primitive Phase 0 is already building. Client effects track the previous and current positions of server-driven projectiles and trace that segment against `MASK_LIQUID`. This is cosmetic and requires no new network state. An explosion can query a spatial index of liquid surface bounds/planes to determine whether its radius reaches the waterline.

Use a stable cosmetic seed from source entity, simulation tick, quantized position, and interaction type. That makes demos and screenshots less noisy without putting particles in the deterministic checksum.

The interaction manager should enforce:

- one global active-particle cap and one emission cap per frame;
- distance, screen-coverage, visibility, and energy priority;
- degradation from FluidRenderer to ordinary spray to ripple-only;
- no emission while offscreen unless audio is still relevant;
- fixed-step CPU particle integration with bounded catch-up;
- no per-particle full BSP sweep at high counts;
- complete removal of render objects, particle systems, observers, and pools on map unload.

Babylon's FluidRenderer wrapper does not dispose the underlying `ParticleSystem`. Cleanup must remove the fluid render object and separately dispose the pool. Repeated splash and map-reload tests should assert that there remains exactly one shared target renderer per active camera/liquid visual kind, not one per emitter.

## Underwater screen and audio

### State source

`UnderwaterViewEffect` should sample the **active camera position** against collision contents every frame. Do not use only the local player's water level: spectator, chase, death, third-person, portal, or free cameras can cross the surface independently.

Sample *after* whichever controller wrote the camera transform this frame, not before. The camera stack is contested: `FPSController`, `FreeflyController`, `SpectatorController`, `DeathCamera`, and `SpectateEyeCamera` each write position and rotation directly, and which one owns the frame is decided at runtime. Sampling ahead of that write reads last frame's position, which shows up as a one-frame lag exactly at the surface crossing, where it is most visible.

Mechanics switch immediately. Presentation can smooth its mix over roughly 100-250 ms and use a small plane-distance hysteresis when a matching surface descriptor is available. If no plane can be resolved, use a short frame debounce only for visual/audio blending; never delay authoritative swimming.

### Recommended visual stack

- liquid-kind color absorption/fog: blue/green water, toxic slime, hot emissive lava;
- restrained low-frequency refraction or UV distortion;
- optional Q3/Warsow-style FOV pulse, scaled by `r_underwater_distortion`;
- reduced contrast and distance visibility without hiding gameplay silhouettes;
- camera-local suspended particulate and occasional bubbles at Medium+;
- optional caustics/light shafts at Epic, only if the measured cost and map lighting support them;
- correct underside/backface rendering at the water surface;
- entry droplets and exit clearing without covering the crosshair.

The GUI/HUD should stay crisp. Apply the effect to the 3D world before GUI composition. The view weapon should normally receive the underwater tint and distortion because it is in the world view, but this must be checked against the actual camera/layer setup.

The existing post-process chain is a risk area. FluidRenderer attaches its final composite to a camera, while `PostProcessingManager` owns the default pipeline and camera changes. Before implementation is locked, add a debug dump of active camera post-process names/order and test the desired conceptual order:

```text
opaque/static scene + water -> FluidRenderer composite -> underwater view -> bloom/tone/color -> GUI
```

This is a target, not an assumption about Babylon's current attachment order. Camera replacement, quality changes, map unload, and context/device restoration must rebuild the chain without duplicates.

### Audio

On head-under/head-clear transitions, crossfade to:

- a low-pass or muffled world mix;
- lower high-frequency weapon/impact content;
- an underwater ambience/bubble loop;
- distinct entry, exit, wade, and swim stroke sounds;
- separate slime/lava profiles.

Footsteps are an existing system and need an explicit rule. `FPSMovementAudio` drives them off replicated travel distance and selects normal/metal/silent banks from the BSP `METALSTEPS` and `NOSTEPS` surface flags. Wading should replace that bank rather than play dry footsteps through water, and swimming should suppress it entirely in favour of stroke sounds — a swimmer is ungrounded and covering distance, which is exactly the condition the current rule fires on.

Audio and visual transitions should consume the same camera contents state but maintain independent mix timers. A missing audio effect must not block movement or rendering.

### Comfort and competitive readability

Distortion must be optional and amplitude-limited. A value of zero should retain tint/fog/audio so underwater state remains clear without motion. Never communicate drowning, lava, or direction solely through screen warp; provide sound, color, and HUD cues as well.

## Implementation plan

### Phase 0: Make collision answer liquid questions, and lock the semantic contracts — **DONE**

Nothing else in this plan can be built or tested until the collision primitive is real, so it came first and stood alone.

1. ✅ **`pointContents` rebuilt as a true point query.** Descends the BSP tree to the leaf holding the point, tests the point against every brush that leaf references, and ORs the contents of the ones it is inside. No hull inflation, no solidity filter, optional content mask. Overlapping volumes union rather than the last brush winning.
2. ✅ **Backend content flags normalized at the shared boundary** (`toSharedContents` in `SweepBackendAdapter`), so nothing in shared or simulation code sees a BSP value. `MASK_LIQUID` and `MASK_SOLID` added to the shared vocabulary. BSP bits with no shared meaning are dropped rather than passed through.
3. ✅ **`BotVision.isInsideSolid` fixed** to test `MASK_SOLID` instead of "any contents at all", in the same change.
4. ✅ **Exact mask tests**, including the `Contents.SLIME` / raw `LAVA` aliasing asserted directly rather than described.
5. ✅ Typed liquid kinds, surface descriptors and an exact-override table (`LiquidClassifier`). Samples and interactions belong to Phase 1 and are not built yet.
6. ✅ **Classification from BSP flags and `surfaceparm`** with the stated precedence, retaining every contributing signal so the audit can explain itself. A name containing "water" never qualifies.
7. ✅ **Child meshes annotated** with `liquidKind` in `BspMeshBuilder` metadata. Annotation only — the material is unchanged, so nothing looks different until a renderer claims them.
8. ✅ **`bsp liquids` audit command** in `headless-bsp`: per shader, the kind, volume brush count, drawn face count, nodraw state and waterline, plus live `pointContents` probes at each brush's own centre.
9. ✅ **Verified on the real maps.** `acidwdm2` reports one water shader, 1 volume brush, 23 drawn faces, waterline `z=56`. A point inside the pool returns `0x30000020` (water, translucent, detail); a point above returns no liquid.
10. ✅ **Volume and surface classification separated**, `NODRAW` honoured, shader names sanitized.
11. ~~Scan the shipped map corpus for liquid.~~ **Done for content flags and brush counts**; results are in "What the rest of the corpus contains" above. Still owed, because it needs the real loader rather than a format-agnostic reader: **distinct liquid heights per map, non-horizontal liquid normals, and patch/mesh liquid surfaces.** Those are what plane bucketing actually rests on.

The corpus scan was listed here rather than in Phase 6 deliberately. Plane bucketing, the multi-height policy, and the "one horizontal plane" assumption are the largest architectural bets in this design and were validated against a single map with a single pool. The half that has been run already changed the classifier design; the half that remains is the half that decides bucketing.

**Exit gate met.** Evidence:

- `wdm5` — the map that motivated the volume/surface split — probes `water` inside three separate `common/nodrawwater` brushes and nothing above them, while its 22 nodraw brushes contribute zero rendered surfaces and its `bluedistortwater` shader contributes 5 faces and zero volume.
- 44 new tests across `LiquidContents`, `LiquidClassifier` and `BotLiquidAwareness`. The contents suite was run against the previous implementation to confirm it bites: 7 of 18 failed, and they were the 7 that describe the new behaviour.
- `tsc --noEmit` clean; full suite 207 files / 2113 tests.
- **`server:tick` determinism checksum unchanged at `2768943778`** — Phase 0 touches no simulation state, which is exactly what "zero behaviour change" has to mean here. That number is expected to move in Phase 1, when liquid state enters the authoritative physics component.
- `test:simulation` passes; `test:physics` shows only its known pre-existing `StepSlideMove` diagnostic warning.

### Phase 1: Add deterministic liquid sampling and state, no new movement yet

1. Implement pure point and three-sample player queries over the collision interface.
2. Cover standing/crouched bounds and levels 0/1/2/3 with a synthetic collision fixture.
3. Add `waterLevel` and raw liquid contents to movement input/result and authoritative physics state.
4. Sample before and after both server and predicted client movement, but keep normal movement behavior temporarily.
5. Pack/round-trip water level in movement snapshot flags and decide protocol compatibility.
6. Add transition output tests for enter, leave, head-under, and head-clear.
7. Include the new mechanics state in clone/reset/reconciliation/replay/checksum paths.
8. Re-baseline the `server:tick` determinism checksum deliberately, and record the new value in the changelog. Adding liquid fields to authoritative physics state changes it by construction; that checksum has been quoted across recent cycles as evidence that a change was presentation-only, so it must move as an announced decision rather than turn up as a red regression suite.
9. Play a demo recorded before this change, to confirm the widened flags byte does not misdecode in an older reader.

Exit gate: server and predicted client report identical liquid samples for the same command stream, the new checksum is recorded, and pre-water demos still play.

### Phase 2: Core Q3/Warsow swimming

1. Add movement-profile fields and explicit Q3/Warsow defaults.
2. Implement wading friction/speed rules and the deep-water movement branch.
3. Reconstruct pitched forward/right vectors and map jump/crouch to ascend/descend.
4. Add idle sinking, swim-speed cap, water acceleration, slope clipping, and no-gravity slide movement.
5. Implement profile-specific assisted water exit.
6. Integrate fall-damage attenuation/reset.
7. Resolve wall jump, dash, ledge, crouch-slide, auto-hop, and jump-held flags, with a test per feature at levels 1, 2, and 3.
8. Add deterministic replay/reconciliation cases for entering, swimming, surfacing, and leaving water.

Exit gate: a headless player can enter a test liquid, sink, ascend, descend, move along view pitch, exit, and reconcile without divergence.

### Phase 3: First complete `acidwdm2` vertical slice

1. Add map-scoped `LiquidSurfaceSystem` ownership and the zero-extra-pass unified Low material.
2. Route classified meshes away from ordinary Q3 material creation while retaining a legacy fallback.
3. Add water level to remote animation selection, replacing the current `!grounded => jump` rule.
4. Import/retarget `swim_idle` and `swim_forward`, add blending, speed scaling, and procedural swim pitch.
5. Add camera-contents-driven underwater tint/fog, optional classic pulse, basic audio transition, and comfort control.
6. Add body entry/exit ripple, foam ring, and audio through `LiquidInteractionSystem`, and settle the footstep rule for wading and swimming.
7. Decide where the animated normal/noise textures live, run them through the KTX2 pass, and add them to the pk3 manifest — a texture the client cannot find fails as a broken material rather than a missing file.
8. Surface `r_water_quality` and `r_underwater_distortion` in Settings under Graphics, with the default tier from `QualityDetector`.
9. Add debug commands for liquid sample, transition events, post-process order, and a repeatable `water splash small|medium|large`.
10. Verify cleanup across same-map reload and map switch.

In parallel—not as the permanent API—time-box a `WaterMaterial` acid-pool version using an explicit/proxy plane. Capture matched screenshots and GPU timings. Its purpose is to establish the visual bar and validate render lists, plane bucketing, target sizes, and transparent ordering.

Exit gate: `acidwdm2` is playable end to end with correct surface, swimming, remote animation, underwater presentation, and cheap interactions on WebGL 2.

### Phase 4: Medium surface and interaction quality

1. Add one shared opaque color/depth input per active camera, not per surface.
2. Implement refraction, depth absorption, shallow/deep tint, and intersection foam.
3. Add ordinary pooled spray for body/projectile/explosion interactions.
4. Detect projectile segment entry with a `MASK_LIQUID` trace over the previous-to-current segment, independently of solid impact events.
5. Handle camera-inside-water, unavailable depth, transparent materials, sky, particles, and SSR combinations.
6. Compile and visually test WebGL 2 and WebGPU paths.

Exit gate: Medium has bounded target count, no recursive sampling, stable shorelines, and no interaction leaks.

### Phase 5: Epic FluidRenderer accents

1. Import/register Babylon FluidRenderer explicitly.
2. Create one shared target renderer per active camera/liquid visual kind.
3. Create fixed-capacity CPU particle pools; start without diffuse or velocity output.
4. Add fixed-step crown/droplet simulation, plane re-entry retirement, and ripple handoff.
5. Implement distance/visibility/energy budgets and graceful degradation.
6. Benchmark fixed map sizes, blur iterations, fixed thickness, WebGL 2, and WebGPU.
7. Assert target-renderer, wrapper, particle-system, observer, and post-process counts over repeated emissions/reloads.

Exit gate: Epic produces a visible improvement at its documented measured cost; Medium and Low allocate no fluid targets.

### Phase 6: Reflection and broader compatibility

1. Add budgeted planar reflection for one eligible visible horizontal bucket.
2. Prioritize by screen coverage, distance, last update, and map/profile importance.
3. Act on the Phase 0 corpus scan: handle the multiple levels, slopes, patches, waterfalls, slime, and lava it actually found, rather than the ones this document guessed at.
4. Add exact overrides only for verified broken semantics.
5. Tune distinct visual/audio/underwater profiles without duplicating the core architecture.
6. Test multiple cameras only if the product actually supports them; otherwise state the single-active-camera constraint.

Exit gate: the system degrades predictably when maps are more complex than `acidwdm2`.

### Phase 7: Authoritative world effects and polish

1. Add optional oxygen/drowning policy.
2. Add slime/lava periodic damage and protection rules.
3. Add surface currents or authored volume metadata only after a real map requires them.
4. Add optional swim-up/down, surface-swim, and water-entry/exit animation polish.
5. Add Epic caustics/light shafts only if profiling and competitive readability support them.

These rules consume `LiquidSample`; they do not belong in `LiquidSurfaceSystem`.

## Validation and acceptance plan

### Headless-first checks

- `acidwdm2` loads without parser or mesh-construction failure.
- The audit command finds `textures/acidwdm2/water1` from both strong semantic signals.
- It reports one horizontal plane at Babylon `y = 56` and no unmatched required override.
- Disabling unified water resolves through the existing legacy material path.
- Classification tests cover Q3 and FBSP/Warsow flag values without requiring a browser.
- Raw content-mask tests distinguish `0x8`, `0x10`, and `0x20` despite other contents bits, including the `Contents.SLIME` / raw `LAVA` aliasing.
- A point inside the `acidwdm2` pool reports `WATER`; a point above the surface reports nothing; the three sample heights of one standing player can return three different answers.
- `BotVision.isInsideSolid` still answers false inside water after the contents change.
- A `common/nodrawwater` brush yields a sampled liquid volume and no rendered surface; a visible liquid face with no brush behind it still renders.
- Shader names carrying trailing uninitialized bytes normalize to the same key as their clean equivalents.
- Maps carrying `WATER | SLIME` on one shader report both bits in `LiquidSample.rawContents`.
- The height half of the corpus scan reports distinct liquid heights and non-horizontal liquid across all shipped maps.
- Synthetic volume tests cover standing/crouched levels 0/1/2/3 and pre/post transitions.
- Server and predicted client produce the same sample and movement for identical commands.
- Swimming tests cover idle sink, Space ascend, Ctrl descend, pitched-forward motion, diagonal normalization, friction, speed cap, and water exit.
- Swim tuning lives entirely in `LiquidMovementProfile`; no water constant is hardcoded in the movement branch.
- Fall tests cover the 50%/25%/0% water-level multipliers and no false post-swim landing.
- Snapshot tests round-trip all four water levels and do not fractional-interpolate them.
- Reconciliation/replay tests cross the waterline repeatedly without divergence.
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
| Water quality | 0 legacy, 1 Low, 2 Medium, 3 Epic |
| Movement profile | The single shipped profile, at its default and at retuned values |
| General reflection | SSR off, SSR on |
| Camera | Above, grazing/crossing, below, spectator/free camera |
| Interaction | Body slow/fast entry, exit, projectile entry, nearby explosion, repeated splash |
| Animation | Tread, forward, ascend/descend pitch, surface exit, missing-clip fallback |
| Comfort | Distortion 0, default, maximum allowed |
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
- Level 1 wades; levels 2/3 swim; Space/Ctrl move up/down; looking up/down and moving forward affects swim direction.
- Server and predicted local player stay reconciled while crossing the waterline.
- Remote players use tread/forward swimming instead of the jump loop.
- The active camera, including spectator/free camera, drives underwater presentation.
- HUD remains crisp and distortion can be disabled without hiding underwater state.
- Body/projectile/explosion interactions all create a ripple; Medium adds conventional spray.
- Low allocates no full-scene capture; Medium allocates the documented shared capture only.
- Epic keeps one shared fluid target renderer for the active water camera and respects the global particle cap.
- Fluid droplets terminate at surface re-entry and create ripples rather than showing through below the pool.
- Map reload disposes all water materials, textures, targets, post-processes, particle systems, wrappers, and observers.

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

Because swimming changes deterministic networking/prediction, implementation validation should also include a recorded command sequence that enters and exits water and, when a verification bundle exists, `npm run demo:verify -- <bundle.shagverify>`.

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
| `pointContents` reports nothing for liquid | Every mechanic in this plan silently does nothing; rendering tests still look correct | Rebuild it as a real point query with a liquid mask in Phase 0, gated on a positive test inside the `acidwdm2` pool |
| Raw contents enum mismatch | Swimming never activates or wrong liquid is selected | Normalize at the shared boundary; the two enums alias `SLIME` onto raw `LAVA`, so test that pair explicitly |
| Liquid-aware contents make bots treat pools as walls | Bot navigation regresses the moment Phase 0 lands, before any feature exists | Fix `BotVision.isInsideSolid` to test the solid mask in the same change; check bot behavior at the collision phase, not the rendering phase |
| Determinism checksum moves unannounced | A red regression suite reads as a bug rather than an intended change | Re-baseline `server:tick` deliberately in Phase 1 and record the new value |
| Server/client water sampling differs | Prediction jitter and replay divergence | One pure sampler and movement implementation; deterministic fixtures and reconciliation tests |
| Rendering quality changes mechanics | Competitive inconsistency | Keep movement profile/config independent of all `r_water*` settings |
| Player in water is classified as airborne | Wrong jump animation and false fall damage | Replicate water level, prioritize swim state, integrate water into fall tracking |
| Projectile impact never fires on nonsolid water | Missing weapon splashes | Detect projectile segment contents/surface crossing, not solid impact |
| One Fluid target per emitter | Severe target/post-process explosion | Pass one shared target renderer to long-lived pools and assert counts |
| Fluid droplets render below transparent pool | Visible screen-space leak | Render above-surface crown/droplets; retire at plane re-entry and inject ripple |
| Post-process attachment order changes | Fluid or underwater effect is tinted/composited incorrectly | Central order diagnostics and rebuild tests on camera/pipeline changes |
| Underwater distortion causes discomfort | Accessibility failure | User scale down to zero; retain non-motion tint/fog/audio cues |
| Swim clips are missing or incompatible | Remote players remain in jump/idle poses | Validate in-place retargeted neutral/forward loops; explicit fallback only during development |
| Cosmetic particles become network state | Bandwidth and determinism burden | Network/derive semantic causes and stable seeds, never particle instances |

## Open questions to answer with prototypes

1. Can the existing scene color/depth infrastructure be reused safely, or should water own a specifically timed opaque capture?
2. Does existing SSR produce acceptable water reflections in SHAG's transparency/post-process order, and on which quality tiers?
3. What render-target resolution and update cadence keep `WaterMaterial` and custom planar reflection within budget on the project's lowest supported GPU?
4. Should map-provided cubemaps be preferred over the global environment, and how should incomplete or differently oriented cubemap sets be normalized?
5. How common are multi-height, sloped, patch, or waterfall liquid surfaces in the actual Q3/Warsow test corpus?
6. Do slime and lava need the same refraction pipeline, or only the shared classifier/ownership architecture with distinct emissive materials?
7. Which transparent objects must appear through/reflected in water, and can a restricted render list meet that requirement?
8. What shoreline foam behavior is acceptable when the BSP has no depth texture, terrain distance field, or authored shoreline mask?
9. Does the current camera post-process order place FluidRenderer before a world-only underwater effect and before GUI composition?
10. Is fixed thickness visually sufficient for fast splash crowns, and what fixed depth/thickness sizes meet the actual GPU budget?
11. Does the existing projectile interpolation expose stable previous/current segments for cosmetic liquid crossings?
12. ~~Should Q3/Warsow movement profile selection follow game/media configuration, a server setting, or the existing movement-profile identity?~~ **Answered:** there is one profile, so there is nothing to select.
13. Should wall jumps and dashes be possible while submerged? Now a design question to settle in play rather than a compatibility question, since neither reference binds us.
14. Can the current player skeleton retarget two in-place Mixamo swim loops without foot/root artifacts?
15. Is packing water level into the two spare movement-flag bits protocol-compatible with all snapshot/demo readers?
16. ~~Does Warsow's water acceleration of `10` reproduce Warsow's actual feel?~~ **Moot:** one profile, seeded from Q3 and tuned by feel, so the unverifiable upstream constant is no longer load-bearing.
17. ~~Do any shipped maps actually need bot-navigable water?~~ **Answered by the corpus scan:** 16 of 39 maps carry liquid and five of six bomb maps have water, so bots meet it in normal play. What remains open is how far the nav graph should go — avoidance, or genuine swim routing.
18. Does any shipped map put a liquid volume where its visible surface shader disagrees about the waterline height, rather than merely being a separate object? The nodraw idiom makes this possible, and it decides whether the render descriptor can ever be trusted for a mechanical answer.

The first rendering prototype should answer questions 1-3, 9, and 10 with measurements on `acidwdm2`. The first mechanics prototype should answer 13 and 15 with deterministic tests. Question 5 needs the height half of the corpus scan, which requires the real loader; question 18 comes with it.

## Sources

### SHAG source and documentation

- [Shader system guide](../manual/guides/shader-system.md)
- [BSP system guide](../manual/guides/bsp-system.md)
- [PK3 filesystem guide](../manual/guides/pk3-filesystem.md)
- [Movement system guide](../manual/guides/movement-system.md)
- [Networking guide](../manual/guides/networking.md)
- [Headless mode guide](../manual/guides/headless-mode.md)
- [Rendering pipeline research](./RENDERING_PIPELINE.md)
- [Babylon 9 SSR research](./BABYLON9_SSR.md)
- [`Q3ShaderParser`](../../src/engine/loader/shader/Q3ShaderParser.ts)
- [`Q3ShaderMaterialFactory`](../../src/engine/loader/shader/Q3ShaderMaterialFactory.ts)
- [`BspMeshBuilder`](../../src/engine/loader/bsp/BspMeshBuilder.ts)
- [`ContentFlags`](../../src/engine/physics/ContentFlags.ts)
- [FPS `MovementProfile`](../../src/games/fps/simulation/MovementProfile.ts)
- [`MovementConfig`](../../src/games/fps/simulation/MovementConfig.ts)
- [`SharedCollisionWorld`](../../src/shared/collision/SharedCollisionWorld.ts)
- [shared `CollisionWorld` contract](../../src/shared/collision/CollisionWorld.ts)
- [`SweepCollisionBackend`](../../src/engine/physics/SweepCollisionBackend.ts) — the active trace/`pointContents` implementation
- [`BotVision`](../../src/bot/BotVision.ts) — the existing contents consumer on the bot side
- [`QualityDetector`](../../src/engine/core/QualityDetector.ts)
- [`FPSMovementAudio`](../../src/games/fps/client/FPSMovementAudio.ts)
- [`PhysicsComponent`](../../src/shared/server/simulation/components/PhysicsComponent.ts)
- [`MovementStateComponent`](../../src/engine/network/components/MovementStateComponent.ts)
- [`SnapshotBuilder`](../../src/games/fps/server/SnapshotBuilder.ts)
- [`V2NetworkClient`](../../src/games/fps/client/V2NetworkClient.ts)
- [`RemotePlayerRenderer`](../../src/games/fps/client/RemotePlayerRenderer.ts)
- [`PlayerModelManager`](../../src/engine/animation/PlayerModelManager.ts)
- [`PostProcessingManager`](../../src/engine/effects/PostProcessingManager.ts)
- [FPS client `GameEvents`](../../src/games/fps/client/GameEvents.ts)

### Official Babylon.js material and renderer references

- [Water material documentation](https://doc.babylonjs.com/toolsAndResources/assetLibraries/materialsLibrary/waterMat/)
- [WaterMaterial implementation](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/materials/src/water/waterMaterial.ts)
- [Fluid renderer documentation](https://doc.babylonjs.com/features/featuresDeepDive/particles/fluid_renderer/)
- [FluidRenderer API](https://doc.babylonjs.com/typedoc/classes/BABYLON.FluidRenderer)
- [FluidRenderer registration/implementation](https://github.com/BabylonJS/Babylon.js/tree/master/packages/dev/core/src/Rendering/fluidRenderer)
- [FluidRenderingTargetRenderer implementation](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Rendering/fluidRenderer/fluidRenderingTargetRenderer.ts)
- [Linked precomputed-particle FluidRenderer Playground](https://playground.babylonjs.com/#XMXDAA#113)
- [PBR subsurface/refraction API](https://doc.babylonjs.com/typedoc/classes/BABYLON.PBRSubSurfaceConfiguration)
- [RefractionTexture API](https://doc.babylonjs.com/typedoc/classes/BABYLON.RefractionTexture)
- [RenderTargetTexture API](https://doc.babylonjs.com/typedoc/classes/BABYLON.RenderTargetTexture)

### Official Q3 and Warsow compatibility references

- [ioquake3 shared movement source: water sampling, friction, swimming, exits, fall attenuation, and events](https://github.com/ioquake/ioq3/blob/master/code/game/bg_pmove.c)
- [Quake III client view source: classic underwater FOV warp](https://github.com/id-Software/Quake-III-Arena/blob/master/code/cgame/cg_view.c)
- [Quake III server world effects: air timer, drowning, lava, and slime](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/g_active.c)
- [Warsow/QFusion shared movement source: swimming parameters, sampling, exits, and fall attenuation](https://github.com/Warsow/qfusion/blob/master/source/common/facilities/gs_pmove.cpp)
- [Warsow client view source: underwater/crossing state, FOV pulse, color blend, and reduced water bob](https://github.com/Warsow/qfusion/blob/master/source/client/cgame/cg_view.cpp)
- [Warsow player-model source: swim torso and neutral/forward leg-state selection](https://github.com/Warsow/qfusion/blob/master/source/client/cgame/cg_pmodels.cpp)
