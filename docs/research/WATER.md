# Unified Water System Research

The water-check driver and scene live in Washoi's
[development diagnostics](../../src/games/fps/scripts/diagnostics/README.md).
Commands and paths in the dated records below describe those earlier revisions.

**Date:** 2026-08-06<br>
**Status:** All seven phases written. Confirmed in play: swimming, the depth-tinted surface, splashes and ripples, and the Epic crown. Reworked on 2026-08-18: semantic material hints now load real map/sky cubemaps, and Epic owns one budgeted live planar reflection. Browser feedback on 2026-08-22 exposed a scene-wide capture list, captured muzzle-flash ghosts, and an underweighted mirror; those are corrected and awaiting another real-GPU visual/performance pass. Owed: broad map compatibility (Phase 6, items 3–5).<br>

**Render cost.** Low is the water draw plus a cubemap. Medium adds one shared depth pass. Epic adds one quarter-resolution planar mirror, refreshed every third frame and restricted to the already active/PVS-culled scene list. Both scene passes stop whenever no water is on screen; refraction remains omitted after measurement — see "What the surface ended up being".<br>
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

- `r_water 0|1`: legacy or unified surface (applies on the next map load).
- `r_water_quality 1|2|3`: Low cubemap, Medium depth effects, or Epic live planar reflection.
- `r_water_debug 0..4`: normal, RGB absorption, thickness bands, raw environment, or raw planar reflection.
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

An older demo or snapshot reader that predates the change decodes the new bits as part of a flags byte it thinks it understands. That is accepted: demo compatibility across the water work is not a requirement, and pre-water demos are allowed to break rather than constrain the wire format.

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

The two required clips are **in the repo**: `public/games/default/animations/swimming.fbx` (the moving stroke, body horizontal) and `swimming_idle.fbx` (treading water, body upright). Both arrived as FBX and need the same GLB conversion every other clip in that folder has had; the loader reads `.glb` only. Root motion must be stripped as usual — movement stays simulation-driven.

Later polish, none of it required for the slice: a strong upward stroke, a dive, surface swim, and enter/exit one-shots.

### The swimming hitbox, and why it cannot simply be rotated

The moving clip lays the body flat, so the natural instinct is to lay the hull flat with it — long in the direction of travel rather than tall. **An axis-aligned box cannot express that.** SHAG's collision is AABB throughout: `trace()` takes world-axis `min`/`max`, and step-slide, hitscan, spawn validation, telefrag and separation all assume it. A prone body is long along the player's *yaw*, which rotates; the moment the box has to follow yaw it stops being axis-aligned and every one of those consumers is wrong.

Three honest options, none of them free:

| Option | Hull | Gains | Costs |
|---|---|---|---|
| **A. Square footprint** | radius 32, height ~28 | Circumscribes a 64-long body at any yaw, so the hull genuinely covers the model | The swimmer is now 64 wide and can wedge in tunnels they would swim through standing — a gameplay-breaking failure in exactly the places pools are |
| **B. Short, not wide** *(recommended)* | radius 16, height ~28 | Fits through low horizontal gaps, presents a shorter vertical target, no new stuck hazard | Shots at the rendered head or feet of a prone swimmer miss; the hull covers the torso only |
| **C. No change** | standing | Zero risk; what Q3 and Warsow both do, for this reason | The flat model and the tall hull disagree completely |

Ship **B**. It delivers what "long rather than tall" means in play — you fit under things, and you are a flatter target — without the wedging that A invites, and the residual mismatch is bounded by a swimmer already being a hard target. It is two constants, so A remains available if play says otherwise.

**The hull follows the animation, and the animation yields to the hull.** The upright treading clip keeps the standing hull, as it should — the body is vertical. The moving clip takes the prone hull. That means the hull changes with movement input, which is a wedging risk in its own right, so growing back to the tall hull requires a clearance trace exactly like standing up from a crouch. **If there is no room to grow, the player stays prone and stays in the moving clip.** Visual and hull never disagree, which is the entire point of changing the hull at all.

### The weapon in water

Presentation first, and deliberately only presentation: extra low-frequency sway on the viewmodel, reduced bob, and the weapon riding a little loose in the hands. That reads as "this is not a firing platform" without touching what the shot does.

An actual accuracy penalty is a **separate gameplay decision, defaulted off**. Spread that changes with water level is a competitive change and belongs in tuning with numbers behind it, not in a presentation pass. Nothing in the visual float may feed deterministic state.

### Electrical discharge

Firing an electrical weapon while submerged discharges it into the water and kills the person holding it — Quake's lightning-gun rule, and one of the few pieces of environmental interaction old players still quote.

- **Triggers on** electrobolt and voltaic, the two electrical weapons, when the shooter is at water level 2 or 3.
- **The shooter dies**, gibbed rather than merely killed: this is an explosion in the water, not a bullet.
- **Everyone else sharing the liquid takes it too**, within a radius, because that is what makes it a hazard rather than a suicide button.
- Server-authoritative, through the existing damage funnel so scoring, obituaries and knockback all behave; the client only plays the effect.
- The ammo is spent. Discharging is a mistake, not a free action.

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

### Phase 1: Add deterministic liquid sampling and state, no new movement yet — **DONE**

Implemented as `games/fps/liquid/LiquidTypes.ts` (pure kinds, samples, transitions, fall scaling) and `LiquidVolumeSampler.ts` (the three-point query). Sampling is wrapped around the whole of `MovementProfile.simulate` rather than placed at one of its exits, because that method returns from several branches — wall-jump charging, ledge grab, teleport — and liquid state attached to only some of them would vanish whenever the player did something interesting. `waterLevel` and `liquidContents` are on `AdvancedMovementResult`, `PhysicsComponent` and the movement snapshot flags; movement itself is untouched.

Two things the implementation corrected:

- **The mid-probe fix is real and testable.** The waist sits at 105 for a standing player at origin 100; deriving it from the lifted foot probe would put it at 105.5. Both boundaries are pinned by tests.
- **The checksum expectation was wrong** — see item 8.


1. Implement pure point and three-sample player queries over the collision interface.
2. Cover standing/crouched bounds and levels 0/1/2/3 with a synthetic collision fixture.
3. Add `waterLevel` and raw liquid contents to movement input/result and authoritative physics state.
4. Sample before and after both server and predicted client movement, but keep normal movement behavior temporarily.
5. Pack/round-trip water level in movement snapshot flags and decide protocol compatibility.
6. Add transition output tests for enter, leave, head-under, and head-clear.
7. Include the new mechanics state in clone/reset/reconciliation/replay/checksum paths.
8. ~~Re-baseline the `server:tick` determinism checksum.~~ **Not needed, for two reasons, and both are worth knowing.**

   First, `WorldState.checksum()` is an FNV-1a hash over **entity positions only** — not velocity, not physics flags. Adding liquid fields to `PhysicsComponent` cannot move it, and the earlier claim that it would was wrong.

   Second, and more decisive: `server:tick` spawns a player into an **empty world with no map loaded**. There is no collision world and no liquid, so neither sampling nor swimming can engage there at all. The checksum stayed at `2768943778` through Phase 2 as well, and that is not evidence that swimming is behaviour-neutral — it is evidence that the scenario is dry.

   **`server:tick` therefore cannot validate any part of this feature.** Liquid determinism is covered by tests that run the real collision stack and compare samples and positions directly (`LiquidStateDeterminism`, `SwimMovement`). Treat the checksum as unrelated rather than as reassurance.
9. ~~Play a demo recorded before this change.~~ **Waived by decision.** Demo compatibility across the water work is explicitly not a requirement; pre-water demos are allowed to break. Revisit only if demos become a shipped artefact rather than a development tool.

Exit gate: server and predicted client report identical liquid samples for the same command stream.

### Phase 2: Core swimming — **DONE**

Implemented as `simulation/Swim.ts` (the tuning struct plus stateless 3-D physics, in the same shape as `Acceleration.ts`) and a swim branch in `MovementProfile`. Everything in `Swim.ts` works on full 3-D velocity; the ground and air families stay XZ-only, because a runner's vertical motion belongs to gravity and a swimmer's belongs to the player.

Decisions made while building it:

- **Gravity is off entirely while swimming.** The idle sink is what makes a swimmer settle, and it settles at a terminal speed rather than accelerating. A player who stops swimming drifts down; a player who stops running falls.
- **Deep water clears the special moves** — wall jump, ledge grab and crouchslide are reset on entering, and their update paths are skipped while swimming. Each describes a body against solid geometry. Deciding this by call order would have been an accident; deciding it explicitly is a choice, and it is reversible if submerged dashes turn out to be fun.
- **Crouch is descend, so the slide system must not see it.** Otherwise a player who held crouch while swimming would surface already sliding, having never touched a floor.
- **Jump is ascend, and the normal jump is suppressed while swimming** — standing on the bottom of a deep pool still reports grounded, so without that guard a submerged player could jump.
- **The assisted climb is a timed state anchored to the sim clock**, like the wall-jump and slide timers, so re-simulating a command lands on the same answer. It cancels early on ground contact or a downward velocity, so a failed climb does not freeze control for the full two seconds.
- **Fall tracking resets on contact with any liquid.** A swimmer is ungrounded, so without this the tracker keeps measuring from wherever they left solid ground and bills them for the whole drop when they touch the bottom — a safe dive charging fall damage several seconds later.

### Phase 2 original plan

1. Add movement-profile fields and explicit Q3/Warsow defaults.
2. Implement wading friction/speed rules and the deep-water movement branch.
3. Reconstruct pitched forward/right vectors and map jump/crouch to ascend/descend.
4. Add idle sinking, swim-speed cap, water acceleration, slope clipping, and no-gravity slide movement.
5. Implement profile-specific assisted water exit.
6. Integrate fall-damage attenuation/reset.
7. Resolve wall jump, dash, ledge, crouch-slide, auto-hop, and jump-held flags, with a test per feature at levels 1, 2, and 3.
8. Add deterministic replay/reconciliation cases for entering, swimming, surfacing, and leaving water.

**Exit gate met.** `SwimMovement` runs the real `MovementProfile` against the real collision stack: a headless player sinks with no input, ascends on jump, descends on crouch, swims up when looking up with forward held and down when looking down, is capped near half of base speed, wades slower than they walk on dry ground while still standing on the floor, reaches the surface and settles rather than flying out, and leaves no stale slide or ledge state. Two independent profiles over a 300-command swimming stream agree on position, velocity and level, and a replay lands in the same place — with a guard asserting the stream actually crosses the waterline.

38 tests across `Swim` and `SwimMovement`. One fixture bug is worth recording because it is a trap: forty units of water is **waist-deep** for a 64-unit player and therefore already swimming. Ankle-deep needs a surface below the waist probe at origin+5. The ladder is about the body, not about a depth that sounds shallow.


### Phase 3: First complete `acidwdm2` vertical slice — **mostly done**

Landed: the swim clips bound with the prone hull and its clearance rule; the electrical discharge; the underwater view driven by the active camera; the floating viewmodel; and the unified water material with `LiquidSurfaceSystem` owning it.

Confirmed in play: swimming mechanics and the underwater screen distortion. Not yet seen: the swim animations, the water surface itself, and the discharge.

Also landed since: **splashes and ripples** through `LiquidInteractionSystem`, fed by the water level already on the wire for remotes and by prediction for the local player; Warsow's whole liquid sound bank, which shipped in the pk3s and had never been wired; and a **`water` console command** (`sample`, `splash`).

Still owed from this phase: a **map reload/switch cleanup pass in the browser**. The lifecycle is unit-tested against a NullEngine scene, which is not the same as watching a real map unload.

Two things the material still wants, both reported from play and both single constants: the wave scale against a real pool, and whether the sky reflection reads right for an indoor room.

Two things deliberately deferred rather than forgotten: the discharge has **no effect of its own** (a burst and a crack need a new wire event), and the weapon float is presentation with **no accuracy penalty**, which stays a separate gameplay decision.

### Phase 3 original plan

1. Add map-scoped `LiquidSurfaceSystem` ownership and the zero-extra-pass unified Low material.
2. Route classified meshes away from ordinary Q3 material creation while retaining a legacy fallback.
3. Add water level to remote animation selection, replacing the current `!grounded => jump` rule.
4. Bind `swimming.glb` (moving, body flat) and `swimming_idle.glb` (treading, body upright), with the prone hull on the moving clip and the clearance rule that keeps the two in agreement.
5. Add camera-contents-driven underwater tint/fog, optional classic pulse, basic audio transition, and comfort control.
6. Add body entry/exit ripple, foam ring, and audio through `LiquidInteractionSystem`, and settle the footstep rule for wading and swimming.
7. Decide where the animated normal/noise textures live, run them through the KTX2 pass, and add them to the pk3 manifest — a texture the client cannot find fails as a broken material rather than a missing file.
8. Surface `r_water_quality` and `r_underwater_distortion` in Settings under Graphics, with the default tier from `QualityDetector`.
9. Add the electrical discharge: firing electrobolt or voltaic at water level 2 or 3 gibs the shooter and damages everyone sharing the liquid.
10. Float the viewmodel while submerged — sway up, bob down, presentation only.
11. Add debug commands for liquid sample, transition events, post-process order, and a repeatable `water splash small|medium|large`.
12. Verify cleanup across same-map reload and map switch.

In parallel—not as the permanent API—time-box a `WaterMaterial` acid-pool version using an explicit/proxy plane. Capture matched screenshots and GPU timings. Its purpose is to establish the visual bar and validate render lists, plane bucketing, target sizes, and transparent ordering.

Exit gate: `acidwdm2` is playable end to end with correct surface, swimming, remote animation, underwater presentation, and cheap interactions on WebGL 2.

### Phase 4: Medium surface and interaction quality — **depth absorption and foam confirmed; refraction omitted after profiling**

Depth-driven absorption is in and verified in the browser. It was the actual answer to three rounds of "it should be more transparent": the surface had been tinting by view ANGLE, so a pool was one flat colour whatever its depth, and lowering alpha only made that flat colour hazier. It now tints and thickens by how much liquid the view ray passes through — a shoreline nearly vanishes, a deep pool hides its floor.

`shallow` and `deep` changed meaning with it: they are now the thin-water and thick-water colours rather than the near-and-far-facing ones, and `alpha` is the DEEP opacity with a new `minAlpha` for the edge. Raising alpha back to 0.8 is not a reversal of the earlier tuning — it is the same intent expressed on an axis that can hold it.

Three guesses in the original write-up were wrong, and each cost a debugging round:

- **The depth encoding.** Babylon's depth renderer does not store linear view depth by default; it stores the clip-space metric. The fix is `storeCameraSpaceZ: true`, not a division by `far`.
- **Water polluting its own depth map.** It does not. `forceDepthWriteTransparentMeshes` defaults false, so an alpha-blended surface is already excluded. This was a stated hypothesis that turned out to be a non-problem.
- **The sign of view-space Z.** Babylon is left-handed and +Z is forward, so `(view * worldPos).z` must NOT be negated. One character doubled every measured thickness and saturated both debug views to white.

A fourth was a units error rather than an API one: absorption and the foam band were both tuned against a pool's vertical DEPTH, when the quantity the shader has is RAY LENGTH through the liquid. Those diverge badly — a poolside view across 200 units of depth presents 600+ units of water to the eye — which is why the middle of every pool saturated from any angle worth standing at, and why 20 units of foam was invisible.

The refraction capture experiment was later removed after profiling. Correct bending requires sampling a copied background, but that second full BSP submission bought only a small offset over low-detail floor textures. Hardware alpha remains scalar, so the current material uses RGB Beer-Lambert absorption in its own body colour and a luminance-derived alpha as an explicit inexpensive approximation. Exact per-channel transmission is not claimed.

Shoreline foam and pooled projectile spray are done. Projectile entry needed its own path: liquid is NONSOLID, so nothing impacts it and the ordinary hit event never fires — a rocket into a pool landed in silence.

### Phase 4 original plan

1. Add one shared opaque color/depth input per active camera, not per surface.
2. Implement refraction, depth absorption, shallow/deep tint, and intersection foam.
3. Add ordinary pooled spray for body/projectile/explosion interactions.
4. Detect projectile segment entry with a `MASK_LIQUID` trace over the previous-to-current segment, independently of solid impact events.
5. Handle camera-inside-water, unavailable depth, transparent materials, sky, particles, and SSR combinations.
6. Compile and visually test WebGL 2 and WebGPU paths.

Exit gate: Medium has bounded target count, no recursive sampling, stable shorelines, and no interaction leaks.

### Phase 5: Epic splash crowns — **FluidRenderer abandoned; drawn as geometry instead**

`SplashDroplets` (CPU ballistics over a fixed pool) and `SplashDropletRenderer` (thin-instanced spheres), joined in `LiquidInteractionSystem` and gated behind `r_water_quality 3`.

#### Why FluidRenderer is not usable here

This phase was built on Babylon's `FluidRenderer` first, per the plan below. It made `r_water_quality 3` render **no world at all** — the player was in the map and taking damage, viewmodel and HUD drew normally, and the eye camera's output was simply gone. Two hypothesis-driven fixes failed before the cause was pinned down. There are three independent conflicts, and the first two are each fatal:

1. **It splices a composite into a post-process chain it does not own.** The composite is built with `camera: null` and attached later via `attachPostProcess(pp, i)` at an index. That array belongs to `DefaultRenderingPipeline`. Rebuilding the pipeline on top of it — the first attempted fix — changed nothing. Note that manual attachment is *not* itself the problem: `CelOutlinePostProcess` appends one by passing the camera to the constructor and has always been fine.
2. **Gameplay is multi-camera.** `WeaponViewManager` sets `activeCameras = [eye, weapon]`, and the fluid pass binds and unbinds framebuffers during `_afterCameraDraw`. In a layered render that discards the eye camera's contribution, which is the observed symptom precisely.
3. **Its composite is hardcoded `UNSIGNED_BYTE`** — the same 8-bit quantisation of the HDR chain that `CelOutlinePostProcess` documents and works around with an explicit `HALF_FLOAT`. FluidRenderer exposes no setter, so even a working integration would have cost image quality permanently.

Revisit only if Babylon gains a way to render fluid to an offscreen target we composite ourselves. The API facts below stay recorded because they were verified against `node_modules` and would have to be re-derived otherwise.

#### What replaced it

Droplets are low-poly icospheres drawn with thin instances. **Spheres rather than billboards** is the choice that keeps it simple: a sphere looks the same from every angle, so there is no per-instance orientation to solve in a vertex shader and none to carry in the instance buffer. Twenty faces each, 220 of them, one draw call. No render target, no post-process, and nothing with an opinion about which camera is rendering.

Two details that matter: the material has `disableDepthWrite`, so droplets stay out of the depth map the water surface measures thickness against — otherwise a crown would punch holes in the pool it came from. And the mesh clears `WEAPON_LAYER_MASK`, because a default mask is visible to *both* cameras and the spray would otherwise be drawn a second time at the viewmodel's field of view.

**The CPU simulation was untouched by the switch.** Keeping `SplashDroplets` renderer-agnostic was deliberate, and it meant a rendering dead end cost only the rendering.

#### What survives from the original design

The CPU/GPU split is still the point. A renderer that owned droplet positions could not retire them at the waterline, because liquid is transparent and therefore absent from the opaque depth buffer — there is nothing down there to occlude a droplet against, so it would sink visibly through the pool it came from. Owning the positions is what lets a droplet retire exactly as it falls back through the surface and hand its energy to the static water as a small ripple.

Two bugs worth remembering, both found before the browser saw the feature:

- A re-entry ripple that went through the ordinary splash path would spawn another crown, which would land and spawn more, forever. Ring placement is split out from splash spawning for exactly this.
- On the frame the LAST droplet lands, the ring loop has already run and the droplet count is now zero — so the frame callback would shut down and strand that final ripple mid-animation.

Slime and lava do not crown. They are thick, and pale spray over lava reads as steam that is not there.

Still owed: a real-device look at the crowns, and tuning of droplet size and count against how they actually read in play.

#### Original plan, and the API facts it produced

`addCustomParticles(buffers, numParticles, generateDiffuseTexture?, targetRenderer?, camera?)` — omitting `targetRenderer` creates a new one **and a new final post-process** per call. `addBuffers` constructs a new `VertexBuffer` per call and never disposes the one it replaces, so per-frame use leaks a GPU buffer per frame; they are created updatable, so the per-frame path is `updateDirectly`. `removeRenderObject` does not dispose the underlying particle object.

1. Import/register Babylon FluidRenderer explicitly.
2. Create one shared target renderer per active camera/liquid visual kind.
3. Create fixed-capacity CPU particle pools; start without diffuse or velocity output.
4. Add fixed-step crown/droplet simulation, plane re-entry retirement, and ripple handoff.
5. Implement distance/visibility/energy budgets and graceful degradation.
6. Benchmark fixed map sizes, blur iterations, fixed thickness, WebGL 2, and WebGPU.
7. Assert target-renderer, wrapper, particle-system, observer, and post-process counts over repeated emissions/reloads.

Exit gate: Epic produces a visible improvement at its documented measured cost; Medium and Low allocate nothing for it. Items 1–3 and 5–7 are moot now that no fluid targets exist at any tier — the cost is one mesh and one draw call.

### Phase 6: Reflection and broader compatibility — **reflection done; compatibility still owed**

`WaterReflection` adds one planar reflection for the largest eligible horizontal water footprint in the map. It is quarter resolution, refreshes every third frame, is created only on Epic, and is removed from the render-target list while water is off-screen. The capture filters Babylon's already active/PVS-culled list; using `renderListPredicate` here rebuilt a scene-wide explicit list and bypassed normal frustum selection. Transient `effectOwned` meshes are rejected so procedural muzzle flashes and rails cannot reappear as displaced ghosts in the water sample.

`MirrorTexture` renders the scene from the camera reflected through a plane with the **same projection**, which is why it can be sampled at the fragment's own screen coordinate — no reprojection, no matrix to get subtly wrong. That is the property that made this cheap to integrate compared to everything else in Phase 5.

Real reflection is what finally lets the Fresnel cap relax. The old cap existed because the surface reflected one constant bright swatch, and full Fresnel turned the far half of every pool white. A map-provided or sky cubemap now supplies the inexpensive reflection on every tier with a restrained six-percent normal-incidence floor. The live room mirror replaces it on Epic where its selected plane matches and uses the water profile's stronger twenty-two-percent floor so the paid pass remains legible from the usual FPS view angle.

Item 2's full priority scheme was not built. The plane is chosen by footprint **area** alone — the one property available without knowing anything about the map, and the one that decides how much of the screen a reflection can ever occupy. It is picked once when surfaces are claimed, not per frame, or which pool reflects would change as the player walks. Other levels and non-horizontal liquid keep the cubemap reflection.

Also landed in this pass, from outside the original plan: **caustics** (`uCaustics`), drawn from the water shader rather than projected onto the floor's material, which would have meant touching every world material in the map. The surface already knows how far the view ray travels before it hits something, so it reconstructs the floor position and anchors the pattern there. That anchoring is the whole illusion — keyed to screen space or to the surface, the pattern swims with the player and reads instantly as a texture on the water.

Still owed here: items 3, 4 and 5 — acting on the corpus scan for maps more complex than `acidwdm2`.

#### Original plan

1. Add budgeted planar reflection for one eligible visible horizontal bucket.
2. Prioritize by screen coverage, distance, last update, and map/profile importance.
3. Act on the Phase 0 corpus scan: handle the multiple levels, slopes, patches, waterfalls, slime, and lava it actually found, rather than the ones this document guessed at.
4. Add exact overrides only for verified broken semantics.
5. Tune distinct visual/audio/underwater profiles without duplicating the core architecture.
6. Test multiple cameras only if the product actually supports them; otherwise state the single-active-camera constraint.

Exit gate: the system degrades predictably when maps are more complex than `acidwdm2`.

### Phase 7: Authoritative world effects — **written, not yet seen in play**

Written but not yet run: `LiquidWorldEffects`, the pure rules for air, drowning and lava/slime burn, wired into `FPSMovementSubsystem` beside fall damage. Until this you could swim in lava indefinitely, which sat oddly next to an electrical discharge that kills you outright.

Q3's numbers, because they are load-bearing rather than arbitrary: twelve seconds of air, drowning damage escalating 2 at a time to a cap of 15, lava at 30/second/level and slime at 10. Lava kills a full-health player in about two seconds, which is what makes it a wall rather than a shortcut.

The client mirrors the air rules for presentation only — `LocalAirTracker` runs the same pure functions to drive the gasp and, later, a HUD meter. A mirror rather than a wire field: the server owns the damage, and a meter that disagrees by a tenth of a second costs nothing, so paying protocol for it would be the wrong trade.

The HUD air meter is in — hidden at full air, amber to red as it runs out. Still owed: a decision on whether drowning and burning deserve their own damage types. They both report as `World`, which keeps obituaries honest but not specific.

### Phase 7 original plan

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

## Full-feature review, 2026-08-07

A read of all ~8,000 lines across both repos after the Epic tier landed. Seven defects, none of which had shown up in play; six were fixed in the same pass and one design gap was left open deliberately.

### The pattern

Four of the seven were the same mistake: **state captured once and cached, when the thing it depends on changes at runtime.** The depth map was bound to the first camera; the splash kind was fixed by the caller; the FOV was restored only on the surfacing path; the remote body table was never re-baselined. Each looked correct when written because at the moment of writing the dependency was constant.

Worth stating as a rule for the rest of this feature: anything captured from the camera, the active liquid, or the roster is a per-frame question, not a constructor question.

### The one that matters most

`scene.enableDepthRenderer()` cannot be shared. It caches one renderer per camera and returns the cached one **with its original settings**, silently discarding the arguments of every later caller. Water wants camera-space Z; `CelOutlinePostProcess` wants the default clip-space metric; both ask about the same camera. Whoever calls first decides for both, and the loser reads an encoding it will misinterpret — for water that means the surface renders and simply stops varying with depth.

This is the *same failure mode* as the original Phase 4 depth bug, arrived at from a completely different direction. It was dormant only because `r_cel_outlines` defaults to `0`.

Water now owns a `DepthRenderer` it constructs itself and registers in `scene.customRenderTargets`, so neither consumer can inherit or destroy the other's. When no float target exists it returns null rather than taking Babylon's `UNSIGNED_BYTE` fallback, which would clamp world distances to 1.0 and compute every thickness as zero.

### The rest

- **Remote bodies were never re-baselined.** `forget()` was wired for the local player only, so a remote dying at the bottom of a pool and respawning dry played an exit splash on dry land — the ring was suppressed for want of a nearby waterline, the sound was not.
- **The splash kind was a guess.** Only the water LEVEL is on the wire, so the remote renderer hardcoded `"water"`; lava dives and rockets into lava both got water effects. Derived from the waterline probe now, which is the only honest source, and it gates the Epic crown too.
- **Water jump accepted submerged ledges.** The upper probe rejected solid but not liquid, so a step inside a deep pool read as a way out and launched a treading player, taking control for two seconds. Q3 rejects `SOLID|WATER|SLIME|LAVA` there.
- **`liquidEffects` leaked.** Missing from `removeEntity`, which cleans seven other per-entity maps. Players can disconnect alive and entity ids are reused.
- **`UnderwaterView.dispose()` kept the camera's FOV.** Cameras outlive maps, so unloading while submerged warped every map after it.

### Checked and clean

The contents translation table and all its consumers; the raw/shared boundary at `SweepBackendAdapter` (engine side uniformly raw, shared side uniformly translated, `SOLID` the only value that coincides); `swimIntent`'s yaw decomposition against the engine's actual left-handed basis; the `MovementStateComponent` bit packing; `updateProneState`'s clearance polarity; drowning escalation against Q3's `g_active.c`; `MapLoader`'s claim/dispose lifecycle.

### Left open

- **Electrical discharge has no same-pool test.** Two pools within 384 units electrocute each other, including one directly above another. Bounding by radius alone was a deliberate simplification; making it correct needs a connectivity notion the collision world does not currently offer. The obituary also reads as `DamageType.Rail`, which is a presentation gap rather than a rule one.
- **Epic crowns are not re-enabled after a camera change.** The fluid composite stays on the old camera; crowns silently stop and the renderer is wasted. Not urgent while the whole FluidRenderer path is still unverified on a real GPU.
- **`waterJumpUntilMs` is unreplicated instance state.** Consistent with how `jumpConsumed`, slide and walljump state already work, but a two-second control lockout is higher stakes than the others if client and server ever disagree about a launch.

## What the surface ended up being, revised 2026-08-18

The renderer is tiered again, but with a strict shared budget:

- Low: the surface draw, animated normal detail, and a real map/sky cubemap; no scene re-submit.
- Medium: Low plus the one shared depth pass for thickness, absorption, foam, and caustics.
- Epic: Medium plus one live planar mirror for the largest horizontal water footprint, at quarter resolution and every-third-frame refresh.

The scene passes are lazily allocated and removed from `customRenderTargets` after water has not been drawn by the player's view. Sloped water and pools at other heights retain the cubemap rather than receiving an incorrect horizontal mirror.

### The measurement that decided it

| pass | fill cost | what it buys |
|---|---|---|
| depth (full res) | 1.000 | thickness — colour, transparency, foam, caustics |
| refraction capture (0.5) | 0.250 | a few pixels of distortion |
| planar mirror (0.25, every third frame) | ~0.021 average fill | a live reflection on one selected pool |

Fill was the smaller half. **Each pass re-submits all world geometry**, so draw calls tripled regardless of target size — and on a Q3 map built from small brush submeshes that is the dominant cost. It is why shrinking the targets never helped, and why the frame rate collapsed even though the extra targets were small.

### What stayed removed, and what came back

**Refraction's colour contribution was free all along.** It composited Beer-Lambert — background filtered by the water, plus the water's own colour for what was lost. But `dst * (1 - alpha)` in the hardware blend *is* that term. The GPU was already doing the work the extra pass was being paid for. Only the bending is gone, and that was a few pixels of distortion over flat Q3 floor textures. The surface is genuinely transparent again rather than opaque with a copied background behind it.

**The refraction capture stays removed.** Its colour contribution can be approximated by the ordinary transparent blend, while exact bending costs another submission of all BSP geometry. RGB absorption now shapes the surface body per channel; the unavoidable framebuffer alpha is derived from luminance rather than pretending the hardware blend is per-channel.

**Reflection came back with a source worth reflecting.** The old shader varied toward a constant bright swatch, so its Fresnel term could only look like glare. The semantic descriptor now preserves QFusion/Warsow `cubemap` appearance hints; `acidwdm2` therefore loads `env/acidwdm2/water_{px,nx,py,ny,pz,nz}` directly, with the map sky cubemap as fallback. Epic replaces that source with the one live mirror on its selected plane. The environment uses a deliberately stylised six-percent floor; Epic water raises the live mirror to the profile's twenty-two-percent floor because browser testing showed the lower value was still functionally invisible in dark rooms.

### What the bounded passes get you

RGB absorption, two rotated noise layers, shoreline foam, floor caustics, sun glint, cubemap reflection, and optional live planar reflection. Debug modes show spectral absorption, thickness bands, the raw environment sample, and the raw mirror sample; unavailable sources are red rather than silently indistinguishable from black.

`r_water_quality` controls both the surface budget and splash detail. Shader compilation failure is caught through Babylon's lazy `onError` path and restores the original legacy material instead of leaving a hole.

### The lesson worth keeping

Every visual problem in this feature — white plaster, no reflection, invisible refraction, dead caustics — traced to **one** quantity: thickness. And thickness was broken twice by things that had nothing to do with tuning:

1. The depth map inherited `scene.getActiveMeshes()`, which other render targets rewrite. Where it drew nothing it kept its clear value, and with `storeCameraSpaceZ` that clear is `0.0` — so `thickness = max(0, 0 - viewDepth)` was exactly zero.
2. The visibility gate read the same contaminated list and oscillated every frame.

Absorption was raised five-fold while it was being multiplied by zero. Four separate tuning passes were spent on coefficients that could not possibly have had an effect. **The diagnostics should have come first**: `r_water_debug 2` as a banded ramp with an explicit zero, and the `[Water]` state line, each converted a multi-round guessing loop into a single screenshot.

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
| The determinism checksum does not cover liquid state | A server/client disagreement about water level produces identical checksums and passes the regression suite | `WorldState.checksum()` hashes positions only. Cover liquid agreement with a direct sample-comparison test instead of trusting the checksum |
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

## Revised visual plan: cached room reflections and reactive water (2026-09-07)

**Status: agreed direction, not implemented or visually accepted.** This section is the current plan for visual work. Earlier sections remain as development history; their completion labels and conclusions do not establish that the current water looks correct. In particular, live planar reflection is no longer a prerequisite for the first successful visual milestone.

The target is attractive engine water that can be bound to selected Q3/Warsow shader surfaces, with convincing room reflections and player-driven disturbances. Start with `acidwdm2` and the normal FPS world/viewmodel camera arrangement. Keep swimming, collision volumes, prediction, and network semantics intact. Rendering must work for both local and remote player interactions without transmitting cosmetic wave or droplet state.

### What the review established

The review covered branch `0.9.22-water` and its existing uncommitted changes. Commit `ddd30996` removed reflection/refraction; the working tree subsequently restored cubemap hints and a live mirror. Reviewing only committed HEAD would therefore describe a different renderer.

- **The current mirror can capture an empty scene.** `WaterReflection` filters `scene.getActiveMeshes()` through `getCustomRenderList`, but scene-level custom targets execute before the current frame's camera draws. With `[worldCamera, weaponCamera]`, the list retained from the previous frame belongs to the weapon camera. A minimal Babylon 9.17.0 NullEngine reproduction supplied only the weapon, which the mirror then excluded. Even a correctly timed main-view list would miss geometry visible only in reflection. Capture selection and timing must be explicit.
- **Reflection and transmission are composed inconsistently.** `UnifiedWaterMaterial` mixes reflection into its colour and then alpha-blends that colour, attenuating reflection again. RGB absorption changes the water's body colour, but scalar framebuffer alpha cannot apply that RGB transmission to the background. The previous claim that ordinary alpha blending fully replaces spectral transmission is too broad. Absorption also uses a view-axis depth difference where its tuning describes distance along the viewing ray.
- **The depth pass remains a performance concern.** It uses a full-resolution target and a scene-wide predicate without its own camera-frustum selection. A cached reflection does not fix this separate cost. Current GPU timings have not been measured in this review.
- **The caustic source is nearly constant.** The normal texture's blue channel measured 0.992–1.000; the current ridge expression therefore stays at least approximately 76% bright before other attenuation. This produces a broad wash rather than the intended thin pattern. Remove it from initial appearance tuning.
- **Appearance bindings are unfinished.** Classification records `liquidProfile`, but the surface system shares materials by liquid kind and does not consume that profile. Cubemap hints are selected per kind, and mirror selection uses mesh bounding boxes rather than actual coplanar pool groups.
- **Interaction events exist, but do not deform the visual surface.** The existing system detects player entry/exit and projectile crossings and draws separate ripple discs and droplets. Continuous swimming wakes and ripple-driven reflection distortion are not implemented.

The targeted water/classifier/parser suite passed 154 tests during the review. Those tests establish useful ownership and data contracts, but did not detect the real two-camera capture failure and do not validate GPU pixels. The new milestones need both render-order integration tests and recorded visual evidence.

### Retain the useful infrastructure

Keep semantic classification, exact shader-name matching, the distinction between visible surfaces and swimming volumes, original BSP outlines, map-scoped ownership, cleanup, legacy fallback, and cubemap hint loading. Retain the interaction event sources and bounded droplet simulation where suitable. Repair or replace visual material internals behind those boundaries.

Finish the appearance contract as **shader name -> profile -> surface assignment**. Share material resources where profiles agree, and share captures where surfaces belong to the same suitable reflection region. Use actual face planes and spatial grouping: disconnected pools or different heights must not become one interaction domain merely because they use the same shader or liquid kind. Probe bounds describe the surrounding room, not just the thin bounding box of the water mesh. Allow explicit profile/probe corrections when automatic placement or room bounds are inadequate.

### First candidate: generate a local cubemap from the actual map

Use Babylon's `ReflectionProbe` to capture the static room near a pool after geometry, textures, and static lighting are ready. Capture all six directions once, then reuse the result. This is a scene capture, not generated artwork: the reflected architecture should match the loaded BSP.

- Include eligible static room geometry and the relevant sky. Exclude water, players, moving entities, viewmodels, particles, and transient effects so no player or muzzle flash is frozen into the texture.
- Build capture visibility explicitly for the probe. Do not inherit the weapon camera's active list or blindly use visibility flags set for the player's current PVS. Probe capture must leave normal world visibility and camera state restored.
- Put the probe at a validated position near the surface, inside the relevant room rather than inside solid geometry. Start with one known pool; automate placement and grouping after that case is correct.
- Configure render-once behaviour. A probe update renders six faces; updating every frame would defeat the performance objective. Initially retain captures in memory for the map lifetime. Disk caches and offline baking are later options, not requirements.
- Regenerate on map reload or an explicit capture refresh after relevant static-scene changes. Bound capture count, resolution, memory, and loading hitch cost. Stage capture work if measurements require it.
- Preserve an authored environment/sky fallback while a capture is unavailable or fails. A source being allocated is not evidence that it contains a completed, usable image.

A cached scene can still look reactive: view direction and water normals change the cubemap lookup every frame. Player ripples can bend the reflected room without recapturing it. Moving players, doors, or lighting will not appear dynamically in a static capture; that is an explicit limitation of the first version.

Add local, box-projected cubemap sampling to reduce the positional errors of treating nearby walls as infinitely distant. Babylon provides this concept for its materials, but our custom shader must implement the corresponding position/bounds-aware lookup; setting texture metadata alone will not change its raw `textureCube` call. Box projection remains approximate for irregular rooms and large pools. Validate while moving across the whole pool, not only from the probe position.

### Compare Babylon WaterMaterial before choosing the final surface implementation

Run a bounded visual comparison between the cached-probe/custom surface and Babylon's `WaterMaterial` on the same pool and fixed camera views. WaterMaterial is a candidate renderer and a reference for reflection/refraction projection, clipping, wave detail, and image-processing integration. It is not an automatic player-ripple simulation.

The stock material owns reflection and refraction targets per instance and derives the horizontal clip plane from the mesh's position. Our BSP vertices already contain world positions, so assigning it to an unchanged mesh with an origin at zero can place the plane at the wrong height. Adapt the test geometry/origin while preserving world-space shape and boundaries. Supply controlled render lists and account for both captures in the comparison; the two approaches do not have identical capture costs.

Choose from visible quality, integration effort, and measured cost. Keep WaterMaterial behind the replacement system if it meets the requirements; otherwise reuse its applicable implementation patterns in the custom surface. Do not treat either choice as settled before the comparison. Any added Babylon materials package should match the engine's installed Babylon version.

### Repair composition and establish one convincing pool profile

Define the colour space, capture timing, depth encoding, and reflection/transmission weights explicitly. Reflection should not be unintentionally weakened by a second transparency blend. Convert depth to the intended distance metric before applying absorption, with defined handling for missing depth and above/below-water views.

Keep a cheap transparency approximation as a valid fallback. For accurate background tint and refraction, investigate obtaining world colour/depth from the main world render before water and the viewmodel, rather than assuming another full world submission is necessary. Reuse existing depth only when its encoding, lifetime, and ownership are compatible. Profile the existing separate depth pass independently of reflection.

Start appearance tuning with recognizable room reflection, restrained colour, and coherent normal detail. Disable foam, caustics, and arbitrary glints in the initial baseline. Introduce optional effects only after the pool is convincing without them. Static BSP boundaries and collision remain unchanged; vertex displacement is not required for the first result.

### Reactive surface: reuse causes, make the water shader respond

Feed bounded surface disturbances from existing gameplay observations into the chosen material. A disturbance has a pool/region identity, world position, start time, strength, and spatial scale. Combine its wave slope with the base water normals so reflection, highlights, and any refraction respond consistently.

| Cause | Intended visible response |
|---|---|
| Player entering or leaving | Expanding waves; spray strength follows the crossing |
| Wading or swimming near the surface | Repeated, speed-dependent disturbances forming a wake |
| Projectile crossing the surface | Local impact ripple and appropriate spray |
| Strong droplet re-entry | Small secondary ripple without recursively spawning another crown |

Start with a fixed-budget set of analytic expanding impulses. This adds material work without another scene capture; cap active impulses and wake emission rate and measure the shader cost. Associate effects with their own pool, preserve continuous waves across adjacent BSP faces, and prevent wakes from appearing in nearby disconnected pools or while a player is deeply submerged. Cosmetic waves must not change collision, swimming, or prediction.

A later Epic experiment may use a small GPU height-field simulation in render textures for interacting waves and boundary behaviour. That requires masks, stable update timing, and a separate measured budget. It is not needed to demonstrate a convincing reactive pool.

### Optional additions after the cached reflection is accepted

**Dynamic models over cached scenery.** A hybrid may keep the room in a cubemap and render selected moving actors into a small live reflection layer. This must handle reflected-world occlusion: an actor behind a pillar must not appear through it. It also needs compatible projection, masking, and composition with the approximate cubemap background. A depth/occluder pass can consume some of the expected savings. Prototype and measure before adopting; a simple colour overlay is insufficient. A bounded full planar mirror remains an alternative for selected surfaces.

**FluidRenderer for localized splashes.** Babylon's FluidRenderer draws particles as fluid; it does not supply pool simulation or player interaction. The earlier failed SHAG integration is evidence of an integration problem, not proof of universal incompatibility. The installed implementation explicitly tracks cameras and filters work by camera. Reproduce world/viewmodel compositing and HDR/post-process behaviour in isolation before deciding whether to reuse it. Compare against existing droplets, including depth, waterline re-entry, and performance. Do not fill the BSP pool with particles.

### Implementation milestones and acceptance gates

1. **Diagnostic baseline and generated probe.** Use `acidwdm2` plus an asymmetric test scene with labelled/coloured geometry in each capture direction. Verify the cached room capture, face orientation, correct water height, exclusions, local projection, readiness, and map disposal. Start with undistorted reflection and no foam/caustics. After capture completes, it must issue no recurring six-face scene render.
2. **Material comparison and base composition.** Compare the probe-backed surface, WaterMaterial, and legacy appearance at fixed views. Repair blending and depth handling. Record which renderer is selected and why. Acceptance requires recognizable, stable room reflections and readable submerged geometry, with no weapon ghosts or camera-dependent disappearance.
3. **Shader/profile and region bindings.** Make exact-name profile assignment work end to end. Test adjacent faces, disconnected pools, multiple heights, missing authored cubemaps, and capture failure. Unsupported surface shapes keep a documented fallback. Report the selected profile, region, reflection source, and fallback reason.
4. **Reactive water.** Make local and remote player crossings and continuous surface movement disturb the same normals used for reflection. Acceptance: watch another player cross the pool and see the wake bend the reflected room, confined to that pool and fading within its budget.
5. **Performance and compatibility.** Measure capture startup, steady-state CPU/GPU frame time, draw calls, and texture memory with water visible and off-screen. Test world/viewmodel rendering, above/below-water views, camera changes, reloads, and WebGL 2/WebGPU. Broaden map coverage before setting final tier defaults. Evaluate hybrid reflections and FluidRenderer only after the preceding gates pass.

The first deliverable is **good-looking water with cached room reflections**, followed by reactive ripples and wakes. Live reflected players, full planar mirrors, fluid-rendered splashes, and simulated wave fields are optional upgrades rather than dependencies of that deliverable. A quality label such as "Epic" does not itself establish visual completion.

### Validation and reporting for the new work

Run headless checks before browser/manual acceptance. Add meaningful integration coverage for successive world/weapon camera frames, capture readiness and suspension, profile assignment, region isolation, and cleanup. Retain unit tests for classification and bounded interaction data, but do not substitute coefficient assertions or allocated render targets for rendered-image evidence. NullEngine cannot validate the cubemap's GPU image.

For renderer implementation changes, run the required regressions and inspect output:

```text
npm run typecheck
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
```

Also run the relevant water/classifier/interaction tests and headless inspection of the acceptance map. Confirm that the fuzz runner actually receives the requested tick count; previous npm argument forwarding required `npx vite-node src/cli/server-fuzz.ts --ticks 1000` to verify the intended run.

Record screenshots or captures at fixed above-water, grazing, and underwater views, plus a moving-camera/player-interaction sequence and measured frame costs on identified hardware/backend. Set numerical budgets from that baseline before increasing effect scope. Keep `r_water 0` as the legacy comparison on map load. Existing `r_water_debug` modes cover absorption, thickness, environment, and planar reflection; add explicit probe readiness/orientation and disturbance diagnostics as needed. Final quality-tier meanings and any new controls must be documented when implemented, rather than inferred from the historical ladder above.

For this dated plan, generated probes, WaterMaterial comparison, reactive shader disturbances, hybrid composition, and FluidRenderer reintegration are all **unimplemented and visually unverified**. Preserve that distinction in subsequent progress updates.

### References for this revision

- [Babylon reflection probes: capture lists, placement, and render-once refresh](https://doc.babylonjs.com/features/featuresDeepDive/environment/reflectionProbes/)
- [Babylon local cubemaps and reflection projection](https://doc.babylonjs.com/features/featuresDeepDive/materials/using/reflectionTexture/#local-cubemaps)
- [Babylon WaterMaterial](https://doc.babylonjs.com/toolsAndResources/assetLibraries/materialsLibrary/waterMat/)
- [WaterMaterial implementation](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/materials/src/water/waterMaterial.ts)
- [Babylon FluidRenderer](https://doc.babylonjs.com/features/featuresDeepDive/particles/fluid_renderer/)
- Local review evidence: `src/engine/rendering/water/`, `src/engine/loader/bsp/LiquidClassifier.ts`, `src/engine/loader/map/MapLoader.ts`, `src/games/fps/liquid/client/`, and installed Babylon 9.17.0 scene/object-renderer/probe/fluid-renderer implementations. Upstream links may evolve; verify APIs against the installed version when implementing.

### Implementation checkpoint: cached reflections and reactive normals (2026-09-08)

The preceding revision records the plan **before implementation**. This checkpoint
records what is now implemented and what is still not accepted. The earlier
research/history above the new revision has been preserved.

**Implemented:**

- Map-scoped, render-once Babylon `ReflectionProbe` captures: 256px per face,
  maximum four regions, at most one complete six-face capture per scene frame.
  They are not registered as recurring scene/camera targets. Readiness is checked;
  failure restores state and retains authored/sky/neutral fallback.
- Flat, connected world-space geometry supplies region membership and probe
  placement. Adjacent meshes sharing vertices at the same height merge into one
  region. Disconnected/multi-height batches remain explicit fallbacks rather than
  pretending that their bounding box is one pool. Candidate placement checks
  opaque backfaces to avoid capturing from inside solid islands. Room bounds are
  a raycast-derived proxy, not a reconstruction of arbitrary BSP room shape.
- Static capture lists do not depend on the previous weapon-camera active list.
  They temporarily include PVS-hidden map geometry and restore visibility in a
  `finally` block. Water, actors outside the static BSP root, effects, autosprites,
  and weapon-layer meshes are excluded. Gameplay dynamic lights and their cluster
  are tagged and disabled/restored during capture so an impact glow is not baked.
- Local/box-projected cubemap sampling, including Babylon's render-target cube
  Y inversion. The GPU fixture exposed the missing inversion: without it, water
  reflected the floor in place of the room above. The old live-mirror path is no
  longer wired into `LiquidSurfaceSystem`; its experimental standalone module
  remains in the working tree for history/testing, not in the active water path.
- Reflection is blended once, with the correct conversion from premultiplied
  contributions to straight alpha. Depth uses ray distance, not just view-axis
  separation. Background transmission remains a scalar-alpha approximation, not
  physically correct spectral refraction. Foam, fake sun glint, and caustics are
  disabled for the water baseline; historical profile coefficients remain in the
  table but are not all active material features.
- The depth target runs on the world camera **after its active-mesh evaluation**,
  filtering that camera's current candidates. It excludes liquid/effect/weapon
  geometry and stops after ten frames without drawn water. Quality 1 has no depth
  pass; qualities 2/3 retain it. There is no live reflection pass at any tier.
  Qualities 2 and 3 currently use the same surface path. Existing `Game.ts`
  enables splash geometry at initialization for both, not only 3; the new cvar
  description/manual reflect that existing behaviour. Changing depth quality is
  live, while changing splash allocation requires reinitialization/map load.
- Exact-name override profiles now reach distinct renderer materials: `default`,
  `clear`, and `deep`. Equal kind/profile pairs share a material. Unknown profiles
  warn and fall back to default. Existing per-kind authored cubemaps remain a
  fallback limitation; generated captures are bound per region/mesh.
- Up to twelve two-second analytic impulses bend the same normals as the base
  waves. Existing entry/exit, projectile, and droplet re-entry rings also feed
  shader impulses. Local and remote moving surface swimmers emit speed-scaled
  wakes at most every 120ms. Initial reports, stationary bodies, teleports, and
  fully submerged movement are suppressed. Geometry membership isolates pools,
  and no swimming, collision, prediction, or replicated state was changed.

**Renderer comparison and visual evidence:**

`scripts/water-visual-check.mjs` serves a browser-only diagnostic scene, starts an
isolated headless Chrome session, captures real WebGL output, and records console
errors and scene submission metrics. It supports a synthetic asymmetric room and
actual BSP geometry loaded through `PK3Index`/`MapLoader` (background-only loading).
`--stock` adapts the same BSP water triangles to Babylon WaterMaterial's origin-
based clip plane and uses explicit reflection/refraction lists. Babylon materials
9.17.0 is a **development-only** comparison dependency, not the production renderer.

Select the cached custom surface for this iteration: it supports reactive normals
directly and removes recurring reflected-world submissions. Stock WaterMaterial
also rendered successfully, but its two live captures cost more in this fixture.
The comparison is against this configured stock reference, not every possible
WaterMaterial optimization or a claim that the custom material is universally better.

All three browser runs compiled/drew without captured WebGL or JavaScript errors.
Images were inspected, including normal reflection, disturbance visualization,
grazing, and below-surface views. The synthetic gold pillar/red wall are visibly
reflected and distorted by an injected ripple. The actual `acidwdm2` room is dark;
its capture remains dark, not artificially brightened to manufacture a reflection.

Local artifacts (gitignored) are in:

- `temp/water-visual-check/`
- `temp/water-visual-check-acidwdm2/`
- `temp/water-visual-check-acidwdm2-stock/`

Each directory includes `surface.png`, `grazing.png`, `underwater.png`, and
`result.json`; the custom runs also include `room.png` and `disturbance.png`.
The isolated browser profiles are left in the OS temporary directory for diagnosis.

Measured fixed-view **scene totals**, 1100x740 WebGL 2 on Chrome/ANGLE D3D11,
NVIDIA GeForce RTX 4070 SUPER, 120 steady-state samples per setting:

| Scene/renderer | Setting | Draw calls/frame | Mean CPU time in `scene.render()` |
|---|---|---:|---:|
| Synthetic cached | Low | 12 | 0.237 ms |
| Synthetic cached | Epic | 23 | 0.257 ms |
| acidwdm2 cached | Low | 76 | 0.688 ms |
| acidwdm2 cached | Epic | 149 | 0.823 ms |
| acidwdm2 stock WaterMaterial | 512px reflection + refraction | 288 | 1.893 ms |

These are CPU submission measurements, **not GPU timings or gameplay FPS**. They
exclude startup capture cost, live actors, HUD, gameplay post-processing, and game
PVS integration. Other headless regression processes were running during the
capture batch, so CPU differences are directional, not controlled benchmarks.
Epic's remaining depth pass still nearly doubles draw submissions here. One
256px RGBA8 cubemap with mipmaps is approximately 2 MiB of colour storage; depth
and driver allocations are additional. Startup hitch/GPU-time budgets remain open.

**Validation commands and results:**

```text
npm run typecheck
npm run build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "bsp load acidwdm2; bsp info; bsp render; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; sim replay JUMP 1; sim replay W 30; quit"
npx vitest run src/engine/__tests__/LiquidClassifier.test.ts src/engine/__tests__/Q3ShaderParser.test.ts src/engine/__tests__/WaterProbeCache.test.ts src/engine/__tests__/WaterDepth.test.ts src/engine/__tests__/WaterReflection.test.ts src/engine/__tests__/LiquidSurfaceSystem.test.ts src/engine/__tests__/WaterProfiles.test.ts src/engine/__tests__/WaterNoise.test.ts src/engine/lighting/__tests__/DynamicLightCluster.test.ts src/games/fps/liquid/__tests__ --silent
node scripts/water-visual-check.mjs
node scripts/water-visual-check.mjs --map=acidwdm2
node scripts/water-visual-check.mjs --map=acidwdm2 --stock
git diff --check
git -C src/games/fps diff --check
```

- Typecheck/build passed. Build retains existing externalized Node-module,
  mixed dynamic/static import, and bundle-size warnings.
- 308 tests in 17 files passed, including consecutive world/weapon camera
  frames, probe cleanup/failure recovery, shared/isolated regions, solid-island
  avoidance, profile binding, and local/remote wake throttling.
- Simulation, physics, server tick, both fuzz runs, and both map checks exited 0.
  Physics still prints its existing step-slide Y-position warning. BSP loading
  still reports light-grid dimension mismatches and missing shader templates.
- npm's fuzz argument forwarding ran the default 10,000 ticks; the direct command
  confirmed the requested 1,000 ticks. Both had zero errors and deterministic
  replay checksums.
- The required combined replay command exits **1**: the existing batch parser
  splits semicolons before `sim replay` sees them, leaving `JUMP` and `W` as
  unknown console commands. The fully qualified three-command alternative exits
  0 but resets the simulation between segments; it is **not** equivalent to a
  continuous 91-tick replay. The unrelated CLI parser was not modified.
- Local setup also ran `npm install --save-exact @babylonjs/materials@9.17.0`,
  then `npm install --save-dev --save-exact @babylonjs/materials@9.17.0`, and
  `npm run deps:babylon`. npm reported 39 dependency vulnerabilities; no unrelated
  audit fix or broad dependency upgrade was attempted.

**Changed-file manifest for this implementation** (other pre-existing branch and
submodule changes were retained):

```text
docs/research/WATER.md
docs/manual/guides/shader-system.md
package.json
package-lock.json
vite.config.ts
scripts/water-visual-scene.ts
scripts/water-visual-check.mjs
src/engine/rendering/RenderVars.ts
src/engine/rendering/water/LiquidSurfaceSystem.ts
src/engine/rendering/water/UnifiedWaterMaterial.ts
src/engine/rendering/water/WaterDepth.ts
src/engine/rendering/water/WaterProbeCache.ts
src/engine/rendering/water/WaterDisturbances.ts
src/engine/lighting/DynamicLightCluster.ts
src/engine/__tests__/LiquidSurfaceSystem.test.ts
src/engine/__tests__/WaterDepth.test.ts
src/engine/__tests__/WaterProbeCache.test.ts
src/games/fps/liquid/client/LiquidInteractionSystem.ts
src/games/fps/liquid/__tests__/LiquidInteractions.test.ts
```

The last two files live in the FPS git submodule and must be committed there as
well as updating the parent repository pointer when this work is committed.
No commits were created by this implementation.

**Assumptions and remaining acceptance work:**

The first target is the existing FPS game's horizontal BSP water, with the
installed `acidwdm2` content as the visual acceptance pool. The benchmark fixture
loads actual textures/lightmaps but not a live duel. Existing local/remote body
reports supply cosmetic causes; no new server authority or protocol is assumed.

Do not call the overall "Epic water" goal complete yet. Full-game shooting near
water (the reported ghost), HDR/outline/glow compositing, a moving remote player
wake, map reload/camera swaps in the browser, WebGPU, and broader map/hardware
coverage remain unverified visually. Below-surface fixture captures validate the
surface shader only, not the game's swimming post-process. Box projection is
approximate around irregular geometry; batches with disconnected components,
T-junction-only adjacency, regions beyond the four-probe cap, and authored cubemap
selection per shader need more work. Captures freeze static animated scenery and
lighting until map reload. No live reflected players, colour-buffer refraction,
FluidRenderer splash replacement, or GPU wave simulation has been added.

Next acceptance pass: run `developer 1; r_water 1; r_water_quality 3; map acidwdm2 duel`,
inspect `r_water_debug 4` (cached room, red if missing) and `5` (wave slopes), then
restore `0`. Walk/swim across the pool, fire repeatedly, watch another player,
and compare `r_water_quality 1` against `3`. Use `r_water 0` plus a map reload for
the legacy comparison. Investigate any remaining ghost independently rather
than assuming that replacing the old mirror has proved every effect path clean.

### GPU-readiness incident follow-up (2026-09-08)

The user reported `acidwdm2` hanging at GPU readiness with Babylon world-material
compilation errors, then confirmed that restarting the services resolved it.
The exact original compiler failure was not reproduced. Stale development-server
dependency/module state is the leading explanation, not a proven water GLSL bug.

The diagnostic Vite server previously shared the normal development server's
dependency cache while using different `optimizeDeps` settings. It now uses
`temp/vite-water-check-cache`, so comparison runs cannot rewrite that shared
cache. Dependency changes can still require restarting the ordinary dev server
and hard-refreshing the browser. Tentative renderer changes made while diagnosing
the report were withdrawn after the clean-start result; no production rendering
behaviour was changed in this follow-up.

Expanded checks now support `--full` (the real MapLoader warm-up/readiness path)
and `--app` (the actual application services/lighting/post-processing scene,
loading the map directly after reaching the lobby). Both succeeded on acidwdm2.
The application check reached `ready: true`, loaded successfully, produced one
water probe, and found no failed mesh shaders. It does not start a networked duel
or reproduce the user's prior persisted browser state. Failure diagnostics are
saved before asserting readiness, rather than being lost on a failed check.

Files changed in this follow-up:

- `scripts/water-visual-check.mjs`
- `scripts/water-visual-scene.ts`
- `docs/research/WATER.md`

Validation:

```text
npx vitest run src/engine/__tests__/WaterProbeCache.test.ts src/engine/lighting/__tests__/DynamicLightCluster.test.ts --silent
node scripts/water-visual-check.mjs --map=acidwdm2 --full
node scripts/water-visual-check.mjs --map=acidwdm2 --app
node --check scripts/water-visual-check.mjs
git diff --check
```

The 14 headless tests passed; both browser paths and the syntax/diff checks passed.
The application check was rerun successfully after isolating the dependency cache.

### Gameplay appearance correction: colour space and high-FPS wakes (2026-09-08)

The user's gameplay screenshot still looked like a flat cyan surface. The earlier
attractive screenshot was an asymmetric, brightly lit diagnostic room using the
`clear` profile with a manually injected full-strength ripple. It was not a
representative screenshot of ordinary acidwdm2 gameplay. A screenshot alone also
cannot prove which material is bound: `r_water_debug 4` remains the useful check
for cached reflection (red indicates no local capture).

Source review found two concrete problems, now corrected:

1. The custom water shader composed display-space colours but did not convert
   them to linear input for the game's image-processing post-process. That
   allows the post-process to brighten the blue body colour a second time.
   Following the installed Babylon WaterMaterial's output convention, water now
   converts its final RGB when image processing is enabled and applied as a
   post-process. This is bound per draw, including frozen materials and live
   configuration changes. Debug colours follow the same output convention.
   The cheap internal colour composition/scalar transmission remains an
   approximation; this does not implement physically correct spectral refraction.
2. Wakes required movement greater than 0.5 units **in one rendered frame**.
   At 200 units/sec and 1000 FPS each move is only 0.2 units, suppressing every
   wake. Movement now accumulates over the 120ms emission interval, from which
   average speed determines strength. Stationary/submerged/teleported motion
   remains suppressed. A regression covers 60 and 1000 FPS at the same speed.

Room captures now record the scene's actual colour encoding on their texture;
linear captures are decoded before the material's display-space composition.
This also keeps later post-process toggles from misinterpreting an existing cube.
No profile coefficients or map overrides were changed in this correction.

The expanded `--postprocess` diagnostic explicitly supplies engine and scene
image-processing configuration, uses linear input, and pre-optimizes its Babylon
module in the isolated cache. An initial fixture-only run failed because its
post-process relied on the ambient engine singleton; explicit engine/configuration
binding fixed that setup error. Uncaught fixture exceptions now fail promptly.
The successful acidwdm2 run compiled with no captured errors and produced the
water/reflection/ripple screenshots in
`temp/water-visual-check-acidwdm2-postprocess/`. The `--app` check also loaded
acidwdm2 successfully with one probe and zero failed mesh shaders.

Files changed for this correction:

```text
src/engine/rendering/water/UnifiedWaterMaterial.ts
src/engine/rendering/water/WaterProbeCache.ts
src/engine/__tests__/WaterColorSpace.test.ts
src/games/fps/liquid/client/LiquidInteractionSystem.ts
src/games/fps/liquid/__tests__/LiquidInteractions.test.ts
scripts/water-visual-scene.ts
scripts/water-visual-check.mjs
docs/research/WATER.md
```

Validation commands:

```text
npm run typecheck
npx vitest run src/engine/__tests__/WaterColorSpace.test.ts src/engine/__tests__/WaterProbeCache.test.ts src/engine/__tests__/WaterDepth.test.ts src/engine/__tests__/LiquidSurfaceSystem.test.ts src/games/fps/liquid/__tests__/LiquidInteractions.test.ts --silent
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
node scripts/water-visual-check.mjs --map=acidwdm2 --postprocess
node scripts/water-visual-check.mjs --map=acidwdm2 --app
git diff --check
git -C src/games/fps diff --check
```

90 targeted tests passed. Typecheck and required simulation/physics/server/map
commands passed, retaining the previously documented physics and asset warnings.
Both 10,000-tick (npm forwarding) and direct 1,000-tick fuzz runs passed with zero
errors and matching deterministic replay checksums. Browser checks passed after
the fixture setup correction above. Production build was not rerun for this
small correction; the earlier build result is not a claim about a new build.

Assumption: existing WebGL 2 FPS rendering and acidwdm2, with cosmetic local/remote
movement notifications unchanged. The user's precise persisted settings, live
networked player wake, and WebGPU output remain visually unverified. The dark room
will not reflect like the brightly lit diagnostic room, and large expanding rings
require an interaction. To inspect an interaction explicitly, stand in the pool
and run `water splash`; use `r_water_debug 5` for its shader slopes and restore
`r_water_debug 0` afterwards. Reload the map/browser to ensure the revised shader
is compiled before comparison. Further aesthetic tuning should use the actual
gameplay pipeline and fixed map views, not just the attractive synthetic room.

### 2026-09-08 follow-up: prove gameplay ripple delivery, remove duplicate discs

The user's grey debug surface and legacy-looking splash were not evidence that
the legacy material was still bound. Debug 5 deliberately hides the base normals
and draws grey wherever there is no current reactive slope. Previous fixture
captures injected strength 1 / radius 120 directly into the renderer; that did
not validate the actual gameplay emitter and overstated the ordinary splash.

The expanded acidwdm2 check loads collisions and shader warm-up (`--full`), uses
the game's `createBSPCollisionWorld` adapter and `LiquidInteractionSystem.notify`
wet/dry transition, and reads the WebGL uniform array back from the compiled
program. An initial diagnostic attempt incorrectly handed raw BSP content flags
to the gameplay sampler, which expects normalized shared flags; using the same
adapter as Game fixed the fixture. This was not a discovered production bug.

Before the production edits, that corrected check confirmed a real gameplay
splash at body `(704,72,-960)` reached render height 56 with strength 0.679 and
radius 48, but also allocated one legacy disc. The shader's 55-unit/sec wavefront
already reaches the old 48-unit radius cutoff at 0.87 seconds, despite a nominal
two-second lifetime. The console also always claimed a splash succeeded, even
when no shader impulse was emitted, and its foot-position effect can be outside
the player's view. These are concrete usability/visibility issues, not proof
that the gameplay-to-shader connection was wholly broken.

Changes in this follow-up:

- Suppress the legacy disc when the replacement renderer accepts a water
  impulse. Retain fallback rings for unsupported/legacy water and other liquids.
  Crown updates still start even when there is no disc to animate.
- Increase ordinary splash radius to 96 (wake radii and shader coefficients
  unchanged). The two-second lifetime and twelve-impulse budget remain bounded.
- Return acceptance from the impulse queue, retaining accepted/rejected counts
  and the last result after expiry. These are queue diagnostics, not GPU proof.
- Add `water ripple`: aim at a visible replacement surface, inject an ordinary
  strength shader-only impulse, never draw a disc. The nearest visible geometry
  blocks targeting water behind a bank. Add `water render` for delivery state.
  `water splash` now reports if it failed to emit a replacement impulse.
- Add integration tests for actual surface ownership plus gameplay events,
  fallback preservation, aimed command occlusion and truthful diagnostics.

After the changes, the real-map WebGL 2 check read back strength 0.679 / radius 96
at height 56, with age advancing from 0.285 to 1.067 seconds and **zero ring
meshes active**. The debug images show an expanding shader-normal disturbance
at both ages. No captured GPU/JavaScript errors. Artifacts:
`temp/water-visual-check-acidwdm2-full-postprocess/gameplay-disturbance.json`,
`gameplay-disturbance.png`, and `gameplay-disturbance-later.png`.

Exact files changed in this follow-up (FPS paths live in the game submodule):

```text
src/engine/rendering/water/WaterDisturbances.ts
src/games/fps/liquid/client/LiquidInteractionSystem.ts
src/games/fps/liquid/__tests__/LiquidInteractions.test.ts
src/games/fps/console/commands/WaterCommand.ts
src/games/fps/console/commands/__tests__/WaterCommand.test.ts
scripts/water-visual-scene.ts
scripts/water-visual-check.mjs
docs/manual/guides/shader-system.md
docs/research/WATER.md
```

Validation commands and results:

```text
npm run typecheck
npx vitest run src/engine/__tests__/WaterColorSpace.test.ts src/engine/__tests__/WaterProbeCache.test.ts src/engine/__tests__/WaterDepth.test.ts src/engine/__tests__/LiquidSurfaceSystem.test.ts src/games/fps/liquid/__tests__/LiquidInteractions.test.ts src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess
```

97 targeted tests and typecheck pass. Required simulation/physics/tick/map
commands exit 0. Physics still prints the previously noted step-slide warning;
map loading still prints light-grid and asset warnings. The npm fuzz wrapper
forwards the tick argument incorrectly and runs its default 10,000 ticks;
the additional direct 1,000-tick run also passes with zero errors and matching
deterministic checksums. The first browser attempt required permission to spawn
the local diagnostic server/browser; subsequent runs used the isolated cache.

Assumptions: acidwdm2, existing WebGL 2 FPS coordinate/collision conventions,
cosmetic waves rather than gameplay physics. Unverified: the user's persisted
settings and live server-backed local/remote movement, WebGPU, and a new production
build. The fixture exercises real map geometry/collision and the game emitter,
but does not run a networked duel or the complete Game startup flow.

This is **not** a claim that the water now looks epic. Ordinary surface motion
still comes from two scrolling normal-map layers. The underlying scene colour
is alpha-blended without displaced/refraction sampling; only reflected light
responds to the changing normal. In a dark room, with the floor dominating the
view, correct shader ripples can consequently remain subtle in beauty mode.
The next visual milestone should address transmission distortion and broad
surface motion in the actual gameplay pipeline, with fixed before/after views.
Do not use stronger debug rings or another tint adjustment as its acceptance test.

Additional workflow checks:

```text
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
git diff --check
git -C src/games/fps diff --check
```

Both whitespace checks pass. The documented replay command still exits 1:
the batch parser runs its first replay but treats `JUMP 1` and `W 30` as separate
unknown console commands. This is the previously documented CLI composition
issue, not a passing continuous movement replay. Its first attempt was also
sandbox-blocked at the Vite subprocess; the authorized retry reached this actual
command failure. No movement or batch-parser code was modified in this follow-up.

### 2026-09-08 visual milestone: calm waves and screen-space transmission

Following the user's confirmation that reactive ripples now show, this pass
addresses the remaining fast-scrolling surface and undistorted underwater view.
The reference is the clearer appearance in the user's test capture, not a promise
to make a dark indoor map resemble the brightly lit synthetic room.

Implemented:

- Water base normals now combine three broad analytic wave gradients with only
  8% of the former texture-layer slope. Fine texture drift is 2 world units/sec
  instead of 13. Slime/lava keep their previous motion. Interactive impulses
  contribute to the same normal used by both reflection and transmission.
- Quality 3 adds a camera-scoped world-colour target at exactly half width and
  height (550x370 for the 1100x740 fixture), with no camera post-processing,
  particles, sprites, liquids, viewmodels, or transparent effect meshes. It
  samples the current world's active candidates, not the weapon camera list.
- Above-water shading offsets this colour lookup using the view-space wave
  normal, fades distortion at shallow boundaries, and rejects samples outside
  the screen or in front of the water according to the existing depth map.
  Per-channel transmission/scattering and cached reflection are then composed
  once; the already-rendered world is not alpha-blended a second time.
- Default absorption is 0.008; clear is 0.0045, deep remains 0.035. This reduces
  the opaque blue-sheet appearance while keeping long paths coloured. Legacy
  coefficient tests were updated deliberately to assert the new clear-water
  target, rather than require the old fast drift and heavy shallow tint.
- Quality 2 retains depth-tinted alpha transmission; quality 1 needs neither
  recurring capture. All tiers share calm/reactive normals and cached cubemaps.
  The extra colour pass unregisters offscreen/at lower quality, follows camera
  changes, resizes without changing viewport proportions, and disposes on unload.
- Debug 6 shows undistorted captured colour (red when absent), so alignment can
  be compared against the same view with water hidden. No fluid simulation,
  displaced collision surface, or recurring planar mirror was introduced.

Validation added: capture ownership/filtering/colour-space/resize tests and
quality/offscreen integration tests. The existing motion tests now distinguish
slow water texture detail from slime/lava animation. One newly added test
initially reached a browser-only requestAnimationFrame in its cleanup; resetting
the headless test's cvar value directly fixes the harness, not production code.

Fixed acidwdm2 WebGL 2 captures with and without image processing pass without
captured GPU/JavaScript errors. Gameplay ripple position/strength/radius and
advancing age still read back correctly from the GPU, with zero legacy discs.
The undistorted colour capture visually aligns with the hidden-water reference;
half-resolution edges are naturally less sharp. Normal-mode idle and gameplay
wave shots, grazing/underwater views, alignment/reference shots and metrics are
saved under `temp/water-visual-check-acidwdm2-full-postprocess/` (and `-full/`
without postprocessing). `--app` also reaches ready/success with one probe and
zero failed mesh shaders, now explicitly setting quality 3 before map load.

Final postprocessed fixture cost, 120-frame CPU render samples:

| Quality | CPU render ms | Draw calls | Recurring water targets |
| --- | ---: | ---: | ---: |
| 1 | 1.02 | 83 | 0 |
| 2 | 1.17 | 160 | 1 depth |
| 3 | 1.65 | 238 | 1 depth + 1 colour |

This is an RTX 4070 SUPER Chrome/ANGLE diagnostic, **not gameplay FPS or GPU
timing**. Quality 3 resubmits world geometry once more despite shading only a
quarter-resolution colour image. The non-postprocessed run measured differently
(1.89/1.95/3.06 ms); do not extrapolate a universal performance promise. Keep
quality 2 available for users who prefer the lower submission cost.

Exact files changed for this visual milestone:

```text
src/engine/rendering/water/UnifiedWaterMaterial.ts
src/engine/rendering/water/LiquidSurfaceSystem.ts
src/engine/rendering/water/WaterRefraction.ts
src/engine/rendering/RenderVars.ts
src/engine/__tests__/WaterRefraction.test.ts
src/engine/__tests__/WaterProfiles.test.ts
src/engine/__tests__/LiquidSurfaceSystem.test.ts
scripts/water-visual-scene.ts
scripts/water-visual-check.mjs
docs/manual/guides/shader-system.md
docs/research/WATER.md
```

Exact validation commands:

```text
npm run typecheck
npx vitest run src/engine/__tests__/WaterProfiles.test.ts src/engine/__tests__/WaterNoise.test.ts src/engine/__tests__/WaterRefraction.test.ts src/engine/__tests__/WaterColorSpace.test.ts src/engine/__tests__/WaterProbeCache.test.ts src/engine/__tests__/WaterDepth.test.ts src/engine/__tests__/LiquidSurfaceSystem.test.ts src/games/fps/liquid/__tests__/LiquidInteractions.test.ts src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npm run build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess
node scripts/water-visual-check.mjs --map=acidwdm2 --full
node scripts/water-visual-check.mjs --map=acidwdm2 --app
git diff --check
git -C src/games/fps diff --check
```

144 targeted tests, typecheck, build, simulation, physics, tick, map inspection
and browser checks pass. Both fuzz runs (10,000 through the npm wrapper, 1,000
direct) pass with zero errors and matching deterministic checksums. The build
retains existing externalized fs/path, mixed import and large-chunk warnings.
Physics retains its existing step-slide warning and maps their light-grid/asset
warnings. The documented compound replay still exits 1 on unknown JUMP/W commands;
it is not a passing continuous replay. Build/replay first attempts required
authorized retries after the sandbox blocked Vite's subprocess.

Assumptions and unverified limits: full-viewport WebGL 2 FPS rendering on acidwdm2.
The application check loads a map in the real app but is not a server-backed duel;
live multiplayer motion/firing, the user's persisted settings, WebGPU, split
viewports and other GPUs/maps remain unverified. The refraction is a screen-space
approximation, not traced optics: it cannot reconstruct offscreen scenery and
does not transmit submerged transparent particles/effects. Byte-target fallback
can clip HDR lighting. Below-water views retain the previous transparency path.
Cached reflections still approximate room geometry and omit moving actors.
Visual polish is not complete; this milestone specifically replaces dominant
fast scrolling and adds actual wave-driven transmission distortion.

### 2026-09-08 follow-up: idle readability and fine splash spray

User feedback after that milestone: the idle surface reads as blank, while
splash particles look like pale blobs. These are two distinct presentation
problems, not evidence that the legacy shader has returned. The previous calm
normal setting reduced procedural texture detail to 8%; the splash renderer was
still drawing unlit, faceted spheres. Its lifetime-based size fade usually never
started before ballistic droplets landed.

Changes in this pass:

- Strengthened the three slow analytic wave slopes, added a smaller capillary
  wave, and restored procedural normal detail to a 50% slope weight. Texture
  drift remains 2 world units/sec: legacy coloured scrolling layers are not
  restored. A faint, bounded slope-driven ambient sheen adds an artistic surface
  cue where uniformly dark scenery gives refraction little detail to distort.
  This is not traced lighting, a new reflection source, or a new render pass.
- Replaced sphere droplets with soft, velocity-aligned camera-facing quads in
  one pooled mesh, two triangles per active droplet, capped at 220 droplets.
  They fade in briefly, fade over their final 12 units of descent, and fade near
  the eye. Ballistics and waterline retirement remain CPU-owned. The mesh is
  excluded from water captures and adds no fluid postprocess or render target.
- Explicitly refresh shortened submesh bounds for transparent sorting. The
  first browser exercise caught a new missing-bounds exception in this rewrite;
  it was fixed and covered by a regression before the final successful run.
- Added renderer ownership/pooling/bounds/velocity/opacity tests and a short-flight
  fade test. The visual fixture's new `--spray` option enables the actual gameplay
  emitter and checks a ready shader, live particle geometry, and capture exclusion.
  It also saves two idle frames, not only an injected maximum-strength ring.

Current normal-mode captures are under
`temp/water-visual-check-acidwdm2-full-postprocess-spray/`: `quality-3-idle.png`,
`idle-later.png`, `spray.png`, and `gameplay-beauty.png`. The earlier non-spray
directory is preserved for comparison. The final WebGL 2 run records no captured
GPU/JavaScript errors, and the spray snapshot has 21 active droplets / 126 indices
with a ready shader. The gameplay impulse GPU check, refraction alignment,
quality 1/2/3, grazing and underwater captures also complete.

Visual assessment: spray is finer and soft-edged instead of faceted beads.
Idle water still reads subtly in this dark, sparsely textured room; the shots
do **not** establish that the desired visual target is finished. Future tuning
should compare normal-mode idle views and actual gameplay splashes at fixed
camera/settings, not treat a strong diagnostic ripple as a beauty acceptance
test. The final timing sample overlapped a production build, so it is not used
to claim a performance improvement. The recurring target budget is unchanged.

Exact files changed in this follow-up (other dirty branch work is preserved):

```text
src/engine/rendering/water/UnifiedWaterMaterial.ts
src/games/fps/liquid/client/LiquidInteractionSystem.ts
src/games/fps/liquid/client/SplashDroplets.ts
src/games/fps/liquid/client/SplashDropletRenderer.ts
src/games/fps/liquid/__tests__/SplashDroplets.test.ts
src/games/fps/liquid/__tests__/SplashDropletRenderer.test.ts
scripts/water-visual-check.mjs
scripts/water-visual-scene.ts
docs/manual/guides/shader-system.md
docs/research/WATER.md
```

Exact validation commands (targeted subset runs preceded the combined run):

```text
npm run typecheck
npx vitest run src/games/fps/liquid/__tests__/LiquidInteractions.test.ts src/games/fps/liquid/__tests__/SplashDroplets.test.ts src/engine/__tests__/WaterProfiles.test.ts --silent
npx vitest run src/games/fps/liquid/__tests__/SplashDropletRenderer.test.ts src/games/fps/liquid/__tests__/SplashDroplets.test.ts src/games/fps/liquid/__tests__/LiquidInteractions.test.ts --silent
npx vitest run src/games/fps/liquid/__tests__/SplashDropletRenderer.test.ts --silent
npx vitest run src/engine/__tests__/WaterProfiles.test.ts src/engine/__tests__/WaterNoise.test.ts src/engine/__tests__/WaterRefraction.test.ts src/engine/__tests__/WaterColorSpace.test.ts src/engine/__tests__/WaterProbeCache.test.ts src/engine/__tests__/WaterDepth.test.ts src/engine/__tests__/LiquidSurfaceSystem.test.ts src/games/fps/liquid/__tests__/LiquidInteractions.test.ts src/games/fps/liquid/__tests__/SplashDroplets.test.ts src/games/fps/liquid/__tests__/SplashDropletRenderer.test.ts src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npm run build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess --spray
git diff --check
git -C src/games/fps diff --check
```

Results: 169 tests pass in the final combined run; typecheck, production build,
simulation, tick, map inspection and final browser check pass. Physics exits 0
but retains the previously documented step-slide warning (expected Y 432, got
422). Both fuzz runs pass with zero errors and matching deterministic checksums:
the npm wrapper runs 10,000 ticks because it drops the option; direct invocation
verifies 1,000. The compound replay still exits 1 on unknown JUMP/W commands after
its first segment; it is not a passing continuous replay. Sandbox subprocess
restrictions required authorized retries for browser/build/replay tools. Existing
build chunk/import and map light-grid warnings remain.

Assumptions: acidwdm2, full-viewport WebGL 2 FPS camera, quality 3 normal rendering
(`r_water_debug 0`); quality 2 remains the lower-cost option. Reload the application
and map to recreate the spray renderer; set quality 2 or 3 before map load to
allocate splash detail. The browser fixture uses real map geometry/collision and
the gameplay liquid interaction system, but not a server-backed duel. Live
multiplayer, the user's saved settings, other GPUs/maps and WebGPU are unverified.
Spray uses ordinary depth testing, not soft depth intersections or per-droplet
lighting; cached reflections still omit moving actors. No collision/swimming
or network behavior was intentionally changed in this pass.

### 2026-09-08 next milestone: reflection control, authored lighting and directional wakes

The accepted next steps were surface lighting/reflection control, then directional
player wakes; shoreline detail and caustics remain later milestones. During work,
the user also requested a small increase in cubemap visibility. The cubemap system
was already active: cached static world captures were not deferred; dynamic actor
reflection was. This pass leaves that architecture and the recurring RTT budget
unchanged.

Implemented:

- Live `r_water_reflection` (0-2), default **1.3**, multiplies the previous water
  Fresnel weight and retains its 0.95 cap. This modest boost preserves transmission;
  it does not brighten every pixel or change slime/lava reflection weighting.
- Live `r_water_highlights` (0-2, default 0.6) and `r_water_roughness` (0.12-0.8,
  default 0.3). A bounded, normalized Blinn-style lobe with Fresnel and finite-range
  attenuation is composed in both refraction and transparent water paths.
  Roughness controls this lobe, **not** cubemap mip filtering.
- `WaterSurfaceLighting` consumes authored BSP point lights and the existing
  emissive-surface extractor, restricted to positive `surfaceLight` shaders.
  Arbitrary fullbright paint, targeted sun/spot entities, weapons and runtime
  lights are not treated as point emitters. Panel positions are offset along their
  normals and panels facing away from the pool are excluded. Panel hue/brightness
  are approximated by sampling the cached room in their direction, not by inventing
  a white point light or spawning an actual Babylon area light.
- At most four sources per horizontal connected patch and four lit patches.
  Map-claim-time rays bake one 16x16 RGBA visibility texture per patch (one light per
  channel). Hidden/PVS-culled opaque world geometry still blocks; liquid, effects,
  weapon meshes and transparent surfaces do not. Masks also encode panel facing.
  No per-frame ray tracing or new scene target; all textures are water-owned and
  disposed on unload/complete shader fallback.
- Movement packets now pack normalized direction in the two previously unused
  impulse components and shade as trailing V-shaped wave packets. Net movement
  direction accumulates over the existing rate-limit interval; radius grows with
  speed (40 + speed*0.08, capped at 88). Radial splash behavior, two-second expiry,
  twelve-impulse budget and cosmetic local/remote event flow remain intact.

Evidence and limits:

The acidwdm2 fixture initially had no eligible point-light highlights. Reusing the
existing shader-emitter extractor supplies four facing panel sources and one
visibility mask. Readback confirms nonzero visibility channels and unchanged light
uniforms after injecting a bright transient light. However, the matched-time
normal-mode highlights-on/off images are identical in this camera view: valid
uniforms are **not** proof of a visible visual upgrade. Dark cached panel colours
and highlight/view alignment limit this approximation. The controlled room with
an authored point light does show the highlight: its matched on/off comparison
changes 258,129 pixels, maximum channel difference 30/255. This isolates shader
functionality without claiming that synthetic lighting represents acidwdm2.

The matched-time acidwdm2 reflection 1.0/1.3 comparison changes 161,495 pixels,
maximum channel difference 20/255 in the checked pair. Directional gameplay wake
components reach the GPU and normal-mode wake/spray shots complete. Browser checks
capture no GPU/JavaScript errors. Quality 1/2/3 retain 83/160/238 draw calls and
0/1/2 recurring camera targets in the map fixture. CPU render samples vary between
runs; they are not GPU timings or a gameplay FPS guarantee. The four-source shader
and visibility bake are additional work even though scene submissions are unchanged.

Captures: `temp/water-visual-check-acidwdm2-full-postprocess-spray-lighting/`
and `temp/water-visual-check-postprocess-lighting/`. Compare `reflection-baseline.png`,
`reflection-boost.png`, `highlights-off.png`, `directional-wake.png`; `lighting.json`
contains GPU controls, source arrays, mask summaries and wake data. Earlier capture
directories remain untouched. No new foam, caustics or dynamic actor reflections
are claimed by this milestone.

Exact files changed in this milestone:

```text
src/engine/rendering/water/WaterSurfaceLighting.ts
src/engine/rendering/water/UnifiedWaterMaterial.ts
src/engine/rendering/water/LiquidSurfaceSystem.ts
src/engine/rendering/water/WaterDisturbances.ts
src/engine/rendering/RenderVars.ts
src/engine/loader/map/MapLoader.ts
src/engine/__tests__/WaterSurfaceLighting.test.ts
src/engine/__tests__/WaterProbeCache.test.ts
src/games/fps/liquid/client/LiquidInteractionSystem.ts
src/games/fps/liquid/__tests__/LiquidInteractions.test.ts
scripts/water-visual-scene.ts
scripts/water-visual-check.mjs
docs/manual/guides/shader-system.md
docs/research/WATER.md
```

Validation commands:

```text
npm run typecheck
npx vitest run src/engine/__tests__/WaterProfiles.test.ts src/engine/__tests__/LiquidSurfaceSystem.test.ts src/engine/__tests__/WaterProbeCache.test.ts src/games/fps/liquid/__tests__/LiquidInteractions.test.ts --silent
npx vitest run src/engine/__tests__/WaterSurfaceLighting.test.ts src/games/fps/liquid/__tests__/LiquidInteractions.test.ts --silent
npx vitest run src/engine/__tests__/WaterSurfaceLighting.test.ts src/engine/__tests__/WaterProbeCache.test.ts src/engine/__tests__/WaterProfiles.test.ts src/engine/__tests__/WaterNoise.test.ts src/engine/__tests__/WaterRefraction.test.ts src/engine/__tests__/WaterColorSpace.test.ts src/engine/__tests__/WaterDepth.test.ts src/engine/__tests__/LiquidSurfaceSystem.test.ts src/games/fps/liquid/__tests__/LiquidInteractions.test.ts src/games/fps/liquid/__tests__/SplashDroplets.test.ts src/games/fps/liquid/__tests__/SplashDropletRenderer.test.ts src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npm run build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess --spray --lighting
node scripts/water-visual-check.mjs --postprocess --lighting
git diff --check
git -C src/games/fps diff --check
```

175 targeted tests pass. Typecheck, build, simulation, server tick, map inspection,
and both browser fixtures pass. Fuzz verifies zero errors and matching checksums
for 10,000 ticks through the npm wrapper (which drops `--ticks`) and 1,000 through
direct invocation. Physics exits 0 but retains the known step-slide warning
(expected Y 432, got 422); maps retain light-grid warnings. The documented compound
replay again exits 1 on unknown JUMP/W commands after its first segment. Its initial
attempt hit sandbox EPERM and was retried with authorization. Build retains known
mixed-import, fs/path externalization and large-chunk warnings.

Assumptions: acidwdm2, full-viewport WebGL 2 FPS camera, normal water rendering.
Live settings work without reload, but new lighting data/masks need a map reload.
Previously saved cvar values can override defaults; explicitly run
`r_water_reflection 1.3` to select the new weighting. The browser gameplay checks
exercise real geometry/collision and the liquid interaction system, not a complete
server-backed duel or real weapon firing. WebGPU, other GPUs/maps, moving-door
lighting and the user's persisted configuration remain unverified. Cached masks
are coarse static visibility, not per-pixel shadow maps; alpha-tested cutouts are
treated as solid triangles and panel emission is a point approximation. The next
lighting improvement should address panel-colour reliability/area response, not
silently boost all highlights until the water glows.

### 2026-09-09 checkpoint: capture lighting order and probe viewpoint

The user's lighting question meant that missing lighting might explain the weak
reflection, not a request for an unlit capture mode. Inspection and cube-face
readback found a real ordering defect: liquid claiming installed the one-shot
capture callback before lightmaps and the awaited BSP lighting initialization.
Rendering during that await could cache the wrong lighting state permanently.
Material readiness alone did not guarantee the scene lighting was configured.

Liquid claiming now happens after lightmap application and the complete BSP
lighting setup/fallback block. Captures still use the map's lit materials, with
transient weapon/effect lights excluded. The browser audit verifies the lighting
configuration log precedes capture and exports all six faces, rather than merely
checking that a texture exists. The corrected acidwdm2 cube contains purple trim,
stairs and other lit geometry; the earlier capture had entirely black faces.

A second limitation was the capture viewpoint only two units above the surface,
mostly seeing dark retaining walls. `r_water_probe_height` now defaults to 64
(range 0..128), added to that waterline anchor. After finding an open anchor, an
upward ray limits the lift to four units below opaque geometry. Hidden/non-pickable
BSP geometry still blocks it. The projection box must still include the actual
waterline, even if a downward ray hits a raised island. Value 0 restores the old
viewpoint; changing it requires a map reload. This remains approximate box-projected
static reflection, not a planar mirror, and may misplace nearby interior geometry.

`r_water_quality` now defaults to 3. Saved quality settings are preserved rather
than silently migrated. For an existing installation, select these explicitly:

```text
r_water_quality 3
r_water_probe_height 64
r_water_reflection 1.3
r_water_debug 0
map acidwdm2 duel
```

Evidence and limits:

- Full-map, postprocessed WebGL 2 fixture: one ready cached probe at
  `(704, 122, -960)`, zero captured GPU/JavaScript errors. Each 256px cube face
  contains coloured scene pixels (8,089 / 9,766 / 9,266 / 23,363 / 6,379 / 14,590
  under the diagnostic threshold). These counts establish content, not beauty.
- Inspected normal-mode quality-3 and reflection-control captures as well as raw
  cube faces. The room is still dark and the reflection is subtle in normal mode;
  this checkpoint does not claim the requested "epic" visual target is reached.
- Actual-app acidwdm2 smoke check also completes map loading, reaches readiness
  with one probe, and reports no failed materials. It is not a networked duel.
- Gameplay ripple data reaches the GPU and no legacy ring is emitted. Quality
  1/2/3 retain 83/160/238 draw calls and 0/1/2 recurring camera targets in this
  fixture. The lift adds load-time tracing, not another recurring render pass.
  Quality 3 still costs more than 2 because of refraction; no FPS guarantee.
- Captures: `temp/water-visual-check-acidwdm2-full-postprocess-spray-lighting-reflection/`.
  See `quality-3-idle.png`, `reflection-boost.png`, `cube-face-0.png` through
  `cube-face-5.png`, and `reflection-audit.json`. The audit's `--probe-height=N`
  option is an experimental additional recapture offset, not the production cvar.

Exact files changed in this checkpoint (other pre-existing branch edits preserved):

```text
src/engine/loader/map/MapLoader.ts
src/engine/rendering/RenderVars.ts
src/engine/rendering/water/LiquidSurfaceSystem.ts
src/engine/rendering/water/WaterProbeCache.ts
src/engine/__tests__/RenderVars.test.ts
src/engine/__tests__/LiquidSurfaceSystem.test.ts
src/engine/__tests__/WaterProbeCache.test.ts
scripts/water-visual-check.mjs
scripts/water-visual-scene.ts
docs/manual/guides/shader-system.md
docs/research/WATER.md
```

Validation commands (headless checks before browser validation):

```text
npm run typecheck
npx vitest run src/engine/__tests__/WaterProbeCache.test.ts src/engine/__tests__/RenderVars.test.ts src/engine/__tests__/LiquidSurfaceSystem.test.ts --silent
npx vitest run src/engine/__tests__/Water src/engine/__tests__/Liquid src/engine/__tests__/RenderVars.test.ts src/games/fps/__tests__/LiquidInteractionSystem.test.ts src/games/fps/__tests__/SplashDropletRenderer.test.ts --silent
npx vitest run src/games/fps/liquid/__tests__/LiquidInteractions.test.ts src/games/fps/liquid/__tests__/SplashDroplets.test.ts src/games/fps/liquid/__tests__/SplashDropletRenderer.test.ts src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npm run build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess --spray --lighting --reflection-audit
node scripts/water-visual-check.mjs --map=acidwdm2 --app
git diff --check
git -C src/games/fps diff --check
```

256 distinct targeted tests pass (178 engine + 78 FPS). The initial broad command
used two nonexistent FPS filters; the explicit subsequent command covers the
correct liquid/console test paths. Typecheck, build, simulation, tick, map
inspection and both final browser checks pass. The npm fuzz wrapper ran 10,000
ticks; direct invocation ran the requested 1,000, both with zero errors and
matching checksums. Physics exits 0 but still reports the known step-slide
discrepancy (expected Y 432, got 422); map loading retains light-grid warnings.
The compound replay exits 1 because JUMP/W are parsed as standalone unknown
commands after the first segment. Build and replay initially hit sandbox spawn
EPERM and were retried with authorization. Build retains mixed-import,
fs/path-externalization and large-chunk warnings.

Assumptions: acidwdm2, existing replacement water enabled, WebGL 2 FPS camera.
Verified browser hardware: RTX 4070 SUPER through Chrome ANGLE/D3D11. Other maps,
WebGPU, other GPUs, the user's saved config and full server-backed gameplay remain
unverified. No unlit capture mode, dynamic actor reflections, extra foam or new
fluid simulation was added. Next visual work should inspect reflection alignment
and contribution in matched normal-mode gameplay views before increasing effects.

### 2026-09-09 checkpoint: reflection softness, fine waves and bank contact

The user confirmed that the corrected cached reflection is now visible and
approved the next surface-polish batch. This checkpoint retains the existing
probe placement, reflection weighting and 1/2/3 capture budgets. No live mirror,
moving-actor reflection, caustics or new splash geometry was added.

Implemented:

- `r_water_blur 0.3` (0..1): small five-tap angular filtering of the cubemap,
  weighted 0.4 at the centre and 0.15 at each of four neighbours. Samples are
  averaged in linear colour before returning to the water composition's display
  space. Zero selects a single sharp sample. It works without prefiltered authored
  cube mipmaps. This is an artistic softness control, not a GGX convolution or a
  correction for the cubemap's approximate geometric alignment. The existing
  `r_water_roughness` remains the separate point-highlight lobe control.
- `r_water_detail 0.5` (0..1): fine procedural/capillary slopes fade between 192
  and 768 world units and near grazing incidence. Broad wave frequencies and
  player-driven slopes remain unchanged. Zero leaves broad waves and reactive
  ripples. No legacy coloured scrolling layer is restored.
- `r_water_contact 0.25` (0..1): narrow, broken scene-coloured contact detail,
  fading out by six units of view-ray thickness. Slow world-coordinate breakup
  and reactive slopes modulate coverage. It requires valid depth behind the
  fragment and front-facing water, so it does not whiten empty depth or the
  underside. Both quality-2 transparency and quality-3 refraction compose it;
  quality 1 disables it. It is not white shoreline foam or simulated wetting.
- All three controls update live without new material allocation. Their console
  registration explicitly preserves fractional values; the old max==1 heuristic
  would have registered them as integer toggles. Defaults do not override saved
  user values.

Validation uses three normal-mode viewpoints with water time fixed at eight
seconds and all player impulses expired. Each compares defaults against sharp
reflection, contact disabled and broad-waves-only independently. The inspected
views retain visible distorted room features; this is incremental polish rather
than a claim that the engine-water visual target is finished. The box projection
still distorts/misplaces nearby geometry and this patch does not change that.

In the first matched run, blur changed 7,528 / 5,778 / 23,551 pixels across the
three views; contact changed only 588 / 904 / 880. These are coverage diagnostics,
not a quality score. The final run also asserts contact on/off images are
pixel-identical without depth and underwater, and verifies new control values
reach actual GPU uniforms. Final fixture reports no captured GPU/JavaScript
errors, one ready lit probe, and real gameplay impulses with no legacy ring.

No new scene passes: quality 1/2/3 still measure 83/160/238 draw calls and 0/1/2
recurring camera targets. Blur adds four cubemap samples per shaded water pixel;
fine-wave/contact evaluation adds arithmetic. CPU samples are not GPU timings
and do not establish unchanged gameplay FPS. `r_water_blur 0` is the cheaper
single-sample option. High blur values can expose the sparse filter or erase
detail. Depth-based contact is view-dependent, not a persistent world-space
shoreline, and excludes transparent submerged objects.

Use a fresh page load to pick up the shader changes, then reload acidwdm2. Live
defaults and individual comparison switches:

```text
r_water_quality 3
r_water_debug 0
r_water_blur 0.3
r_water_detail 0.5
r_water_contact 0.25
```

Set any of the last three to 0 to isolate its effect. Comparison captures and
GPU/pixel diagnostics are in
`temp/water-visual-check-acidwdm2-full-postprocess-spray-lighting-reflection-polish/`,
especially `polish-0-default.png` through `polish-2-default.png`, their comparison
variants, `polish.json`, and `contact-guard-*.png`.

Exact files changed in this checkpoint:

```text
src/engine/rendering/water/UnifiedWaterMaterial.ts
src/engine/rendering/water/LiquidSurfaceSystem.ts
src/engine/rendering/RenderVars.ts
src/engine/__tests__/LiquidSurfaceSystem.test.ts
src/engine/__tests__/RenderVars.test.ts
scripts/water-visual-scene.ts
scripts/water-visual-check.mjs
docs/manual/guides/shader-system.md
docs/research/WATER.md
```

Validation commands:

```text
npm run typecheck
npx vitest run src/engine/__tests__/Water src/engine/__tests__/Liquid src/engine/__tests__/RenderVars.test.ts --silent
npx vitest run src/engine/__tests__/Water src/engine/__tests__/Liquid src/engine/__tests__/RenderVars.test.ts src/games/fps/liquid/__tests__ src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
npm run build
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess --spray --lighting --reflection-audit --polish
node scripts/water-visual-check.mjs --map=acidwdm2 --app
git diff --check
git -C src/games/fps diff --check
```

331 tests pass across 22 files, including live control/material reuse, fractional
console values and existing gameplay/liquid tests. Headless regressions preceded
browser validation. Typecheck, build, simulation, tick, map inspection and final
browser checks pass. Fuzz has zero errors and deterministic checksums for both
10,000 ticks via the npm wrapper (which drops the flag) and the direct 1,000-tick
run. Physics still exits 0 with the known Y 432/422 step-slide warning, and BSPs
retain light-grid warnings. The compound replay still exits 1 on standalone
unknown JUMP/W commands after its first segment. The initial unit-test startup
hit sandbox spawn EPERM and was retried with authorization. Build retains
mixed-import, externalized fs/path and chunk-size warnings.

Assumptions: acidwdm2, replacement water enabled, WebGL 2 FPS camera. Verified on
Chrome/ANGLE/D3D11 with RTX 4070 SUPER. Other GPUs, WebGL 1/WebGPU, other maps,
full networked gameplay and temporal shimmer during an actual player-controlled
walk remain unverified. Existing dirty work outside these nine files was preserved.

### 2026-09-09 feedback pass: stronger detail, no cyan contact dots

User feedback identified the previous contact patches as blue dots and requested
at least 0.8 fine-wave strength. `r_water_detail` now defaults to 0.8 in the cvar,
material initialization and live-binding fallback; existing saved settings remain
untouched. The distance/grazing fade and broad/reactive waves are unchanged.

The dot treatment mixed shallow-water colour into the surface and increased alpha
in a repeating sine pattern. Removed that colour, opacity increase and pattern.
Contact is now only a smooth neutral attenuation of the existing water contribution,
fading out by four view-ray world units. RGB uses the same factor and alpha stays
unchanged. At default `r_water_contact 0.25`, the shader's display-space attenuation
is at most 6.25% (not a bound on postprocessed pixel differences). This intentionally
subtle artistic edge cue does not claim to simulate a meniscus, foam or wetting.
It keeps the valid-depth/front-face guards and adds no samples or scene passes.

After a page refresh/map reload to load the revised shader:

```text
r_water_detail 0.8
r_water_contact 0.25
```

Set contact to 0 if the depth-based edge is still undesirable. Saved 0.5 detail
values override the new default, so existing users should select 0.8 explicitly.

Matched-time normal-mode screenshots across three acidwdm2 viewpoints confirm
0.8 vs 0.5 changes visible wave detail. Contact affects only 280 / 136 / 217 pixels
in those views; no RGB channel is brighter with contact enabled. Additional
checks compare contact 0 vs 1: quality 1 and underwater are pixel-identical,
quality 2 shows a change with zero brightening. This replaces the previous test's
"visible difference" criterion with a no-added-light guard for the reported defect.
Inspected normal-mode views 0 and 2; no tinted contact patches are introduced.

Browser fixture has zero captured GPU/JavaScript errors and verifies one lit cached
probe, detail 0.8 on the GPU, and gameplay impulses with no legacy ring. Quality
1/2/3 retain 83/160/238 draw calls and 0/1/2 recurring camera targets. These are not
GPU timings or an FPS guarantee. Captures preserve the previous checkpoint and
are stored in `temp/water-visual-check-acidwdm2-full-postprocess-spray-lighting-reflection-polish-contact/`.
`polish.json` records comparisons and guards; `polish-*-previous-detail.png` compares
the old 0.5 setting with new defaults, not the old dot shader.

Exact files changed in this feedback pass:

```text
src/engine/rendering/water/UnifiedWaterMaterial.ts
src/engine/rendering/water/LiquidSurfaceSystem.ts
src/engine/rendering/RenderVars.ts
src/engine/__tests__/RenderVars.test.ts
scripts/water-visual-scene.ts
scripts/water-visual-check.mjs
docs/manual/guides/shader-system.md
docs/research/WATER.md
```

Exact validation commands:

```text
npm run typecheck
npx vitest run src/engine/__tests__/Water src/engine/__tests__/Liquid src/engine/__tests__/RenderVars.test.ts src/games/fps/liquid/__tests__ src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
npm run build
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess --spray --lighting --reflection-audit --contact-polish
git diff --check
git -C src/games/fps diff --check
```

331 tests pass; typecheck, build, simulation, tick, map inspection and browser
fixture pass. Both 10,000-tick npm-wrapper and direct 1,000-tick fuzz checks pass
with zero errors and matching checksums. Physics retains the known expected-Y432/
actual-Y422 warning despite exit 0. Map loading retains light-grid warnings;
compound replay still exits 1 on unknown standalone JUMP/W commands. Build retains
mixed-import, fs/path externalization and large-chunk warnings. Headless checks
preceded browser validation.

Assumptions: acidwdm2 replacement water, WebGL 2 FPS view on Chrome/ANGLE RTX 4070
SUPER. Other maps/GPUs, WebGPU/WebGL 1, player-controlled temporal shimmer and
networked gameplay remain unverified. Contact remains screen-depth-dependent;
reflection alignment remains the existing approximate cubemap projection. No
changes to swimming, splash particles or networking in this feedback pass.

### 2026-09-09 checkpoint: differentiated interactions and settling spray

Implemented the approved interaction polish, leaving actor reflections as a
discussion-only proposal below:

- Level-1 wading emits weaker/smaller directional wakes than level-2 surface
  swimming at the same speed. The existing 120ms cadence, local/remote input path,
  teleport filter and submerged suppression remain. Net-zero horizontal jitter
  no longer turns into a radial impulse through a zero direction vector.
- Gameplay impact radius is now `48 + 64 * strength` (up to 112), rather than
  universally 96. Exit visuals use 55% of the equivalent entry strength; audio
  remains unchanged. Explicit debug impulses retain their own/default radius.
- Radial shader waves use strength-dependent propagation, smooth time decay and
  a weaker trailing wave inside the SAME impulse. No extra timers or impulse
  slots. Combined reactive slopes approach a bounded magnitude smoothly instead
  of growing without limit as wakes overlap. The twelve-slot/two-second budget
  still applies; this is cosmetic normal shading, not fluid displacement.
- Spray uses 3..24 droplets per positive-strength splash, lower launch velocities
  for weak entries, finer size distribution, narrower streaks and lower opacity.
  Sizes shrink using actual descending velocity relative to launch speed. The
  previous test could pass by comparing against an empty buffer after all droplets
  landed; it now asserts a live falling droplet actually shrinks.
- Re-entry aftermath is restricted to 24-unit, 0.25-strength ripples, at most one
  per 120ms per interaction system, and never spawns another spray crown. Pool
  capacity stays 220 droplets. Invalid/zero-strength spawns are rejected and
  strength is capped before determining count/velocity.

Validation: 337 tests pass in 22 files. Added behavior tests cover wading vs
swimming, submerged suppression, cancelling jitter, weaker exits, bounded small
re-entry ripples, weak/hard spray and live descent shrinkage. Typecheck and build
pass. Required simulation, tick, map inspection and fuzz regressions pass;
the npm fuzz wrapper ran 10,000 ticks, direct invocation ran exactly 1,000, both
with zero errors and matching checksums. Physics retains the known Y432/Y422
step-slide warning despite exit 0; maps retain light-grid warnings. Compound replay
still exits 1 after the first segment on unknown standalone JUMP/W commands.
Build retains mixed-import, fs/path-externalization and large-chunk warnings.

The first browser check correctly failed its stale fixed-radius-96 assertion;
it now compares the GPU radius against the actual emitted gameplay radius. Final
full-map WebGL fixture passes with zero GPU/JavaScript errors. At -100 vertical
speed, the splash emits strength 0.357/radius 70.86 and shows 11 spray quads at
the early sample; at -700, strength 1/radius 112 and 24 quads. Both expire, leaving
no impulses or legacy rings. Inspected light/hard early and hard spreading shots.
Direction-bearing gameplay wakes still reach the GPU. Idle quality 1/2/3 remain
83/160/238 draw calls and 0/1/2 recurring camera targets. Added wave arithmetic is
not free, but no new scene pass was added; these CPU samples are not GPU timings.

Captures: `temp/water-visual-check-acidwdm2-full-postprocess-spray-lighting-interactions/`.
See `impact-{light,hard}-{early,spread,settle}.png`, `spray.png`,
`directional-wake.png` and `interactions.json`. Timing is sampled, not a deterministic
video benchmark. To try in-game, refresh/reload acidwdm2 with quality 3, wade and
swim at the surface, and compare a short drop with a hard landing. No new cvars.

Exact files changed (including files inside the FPS submodule):

```text
src/engine/rendering/water/UnifiedWaterMaterial.ts
src/games/fps/liquid/client/LiquidInteractionSystem.ts
src/games/fps/liquid/client/SplashDroplets.ts
src/games/fps/liquid/client/SplashDropletRenderer.ts
src/games/fps/liquid/__tests__/LiquidInteractions.test.ts
src/games/fps/liquid/__tests__/SplashDroplets.test.ts
scripts/water-visual-scene.ts
scripts/water-visual-check.mjs
docs/manual/guides/shader-system.md
docs/research/WATER.md
```

Exact validation commands:

```text
npm run typecheck
npx vitest run src/engine/__tests__/Water src/engine/__tests__/Liquid src/engine/__tests__/RenderVars.test.ts src/games/fps/liquid/__tests__ src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
npm run build
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess --spray --lighting --interactions
git diff --check
git -C src/games/fps diff --check
```

Assumptions: acidwdm2, replacement water, WebGL 2 FPS view, Chrome/ANGLE RTX4070
SUPER. Headless validation preceded browser checks. Other maps/GPUs, WebGL1/WebGPU,
full multiplayer, and player-controlled motion remain unverified. Spray remains
unlit cosmetic quads with ordinary depth testing, not a fluid surface or particles
colliding with banks in flight. Existing unrelated dirty changes were preserved.

#### Brainstorm only: soft, distance-limited actor reflections

The user's idea is workable as a proposed visual compromise, not an occlusion
solution. Blur can hide low-resolution detail, but an occluded coloured silhouette
is still visible and can reveal a player's position through a wall. Distance limits
reduce candidate actors; small targets reduce fill cost; simplified reflected models
could reduce geometry/skinning cost. Blur by itself does not remove those costs.

Proposed experiment (NOT implemented in this checkpoint): keep static cubemap
colour and add one small actor-reflection layer for one visible pool. Start with
a strict nearby actor count/distance budget, fade with both camera distance and
distance/height from water, and keep even nearby reflections soft. Far actors fade
out entirely, not into permanent haze. Exclude first-person weapon/effect geometry.
Use a single reflected view rather than six changing cube faces per player.
Babylon supports selective mirror render lists, as demonstrated in its
[official reflection demo source](https://www.babylonjs.com/Demos/RefProbe/source/).

The critical work is occlusion: the prototype should draw relevant static geometry
depth-only from the REFLECTED viewpoint before actor colour, then use a mask-aware
blur/composite so colour does not bleed through occluders. The main-camera depth
is a different viewpoint and is not interchangeable. This adds geometry submission
even if static colour stays cached, so it must be measured, not called free.
Coarse visibility probes could instead reject ambiguous actors, but cannot prove
correct per-pixel occlusion; for an FPS, reject uncertain reflections rather than
show silhouettes through walls. Reduced update rate is a later measurement-led
option because camera motion can make cached projected images lag or slide.

Acceptance before shipping: actor behind wall/column remains hidden, banks clip
correctly, no first-person muzzle ghosts, distance fade has no popping, and measured
GPU/draw-call cost fits the budget. No actor-reflection code was added here.

### Prototype: short-range actor reflection layer (2026-09-09)

The user approved prototyping the separate, deliberately soft actor layer. The
historical brainstorm above remains unchanged; this section records what actually
exists now, rather than treating the proposed production acceptance list as done.

Enable with `r_water_quality 3; r_water_actors 1`; disable with `r_water_actors 0`.
Quality 3 remains the water default, but actor reflections default OFF. Existing
saved quality settings are preserved. This reflects remote models, including the
real skinned Vanguard model, not the first-person weapon or a nonexistent local
third-person body. The water state log now includes `reflectedActors`.

Implementation:

- One camera-owned `MirrorTexture`, quarter width/height and at most 320px on
  either side. No six-face actor cubemap, no change to the static room cubemap.
- Select one nearby visible horizontal water patch and at most two actor groups.
  Camera-to-patch-bounds distance must be below 240u and the eye above the surface.
  Actor bounding-box centres must be within 160u of the patch bounds; fully
  submerged, hidden/disabled, transparent and weapon/effect meshes are excluded.
- RemotePlayerRenderer marks model roots with `waterReflectionActorId`; engine
  code follows that metadata without importing FPS renderer classes.
- Opaque static world meshes write depth and transparent black into the actor
  capture. Zero colour/coverage, not just colour-write disabling, also removes an
  actor if a closer occluder is submitted later. Depth is shared across groups.
- Occluders are culled against the reflected frustum, NEVER the main camera's
  active/PVS list. Temporarily restore PVS-hidden occluders for capture, then
  restore their visibility. Gameplay model outlines/overlays are likewise
  suppressed only during capture and restored afterward.
- Fail closed if occlusion geometry/shader is not ready or budgets are exceeded:
  256 occluder submeshes and 32 actor submeshes. Do not truncate the blocker list.
  These are submission budgets, not an absolute GPU-time guarantee.
- Use the physical water plane (`patch.min.y`), not the cubemap anchor lifted
  two units above it. Clip geometry below the plane; capture the reflected view
  matrix for world-projected sampling. Preserve the native capture colour space.
- The water shader applies a five-tap soft filter plus wave distortion, retaining
  unwarped centre coverage so blur cannot expand freely through a wall silhouette.
  Filter radius grows from 0.65 to 4 texels over eye distances 32..200u. Fade the
  surface contribution over 140..240u; blend into the existing Fresnel reflection.
- No capture while disabled, underwater, outside range, without eligible actors,
  or after water's existing visibility gate expires. One target is reused across
  camera switches/resizes; disposal removes camera registration and render-pass
  overrides. No network/physics/event protocol changes.

Validation and findings:

- 348 targeted tests across 23 files passed, including 11 actor-reflection tests:
  opt-in allocation, readiness gating, physical plane, caps, reflected-frustum
  selection, hidden blockers, outline/visibility restoration, camera switching,
  underwater/range gates, and disposal.
- Production build and TypeScript check passed. Simulation/tick/fuzz and indexed
  `wdm2` load passed. Physics exits 0 but retains its known expected-Y432/got422
  warning; `wdm2`/`wdm7` retain lightgrid-count warnings. The documented compound
  replay still runs its first segment and fails on standalone `JUMP`/`W` commands.
- Real WebGL2/Chrome/ANGLE RTX4070 SUPER, 1100x740, acidwdm2 through full MapLoader
  and image postprocessing: 275x185 actor target; visible surface changes with
  the toggle; an admitted two-colour actor produces 3623 covered capture pixels,
  and a fully blocking wall reduces that to zero. An actual skinned player from
  RemotePlayerRenderer is captured, and the fully occluded player test also gives
  zero covered pixels. No GPU errors in the completed run.
- The final acidwdm2 run without image postprocessing also passed the visible
  overlay, native-player and full-occlusion checks with no GPU errors. Evidence
  is in `temp/water-visual-check-acidwdm2-full-actors/`.
- Test correction: low feet can have valid reflected rays passing below a bank's
  water clip plane. Those capture pixels alone are not evidence of a visible-water
  leak. The strict full-mask test uses an elevated player fully behind a tall wall,
  with reflected rays crossing the wall above the clip plane. General bank-edge
  and partial-occlusion visual acceptance still needs gameplay testing.
- The synthetic room GPU check also passed. An intermediate first-load run hit
  Vite's dependency-reoptimization/shader failure; prebundling the new Frustum
  import in the isolated fixture fixed that reload path. Restart dev services and
  refresh when adopting the renderer changes, as with earlier water updates.
- At the fixed acidwdm2 test view, the simple actor adds 79 draws (202 -> 281),
  versus 106 before reflected-frustum culling. CPU `scene.render()` samples varied
  between runs (roughly +0.4..1.1ms); these are NOT GPU timings or a multiplayer FPS
  guarantee. Rendering the native skinned model also costs skinning/material work.

Captured evidence (workspace-local, not shipped assets):

- `temp/water-visual-check-acidwdm2-full-postprocess-actors/actor-on.png`
- `temp/water-visual-check-acidwdm2-full-postprocess-actors/actor-off.png`
- `temp/water-visual-check-acidwdm2-full-postprocess-actors/actor-player.png`
- `temp/water-visual-check-acidwdm2-full-postprocess-actors/actors.json`
- `temp/water-visual-check-acidwdm2-full-postprocess-actors/actor-player-occlusion.json`

Exact files changed in this checkpoint (other pre-existing worktree edits preserved):

- `src/engine/rendering/water/WaterActorReflection.ts` (new)
- `src/engine/rendering/water/LiquidSurfaceSystem.ts`
- `src/engine/rendering/water/UnifiedWaterMaterial.ts`
- `src/engine/rendering/RenderVars.ts`
- `src/engine/__tests__/WaterActorReflection.test.ts` (new)
- `src/games/fps/client/RemotePlayerRenderer.ts` (FPS submodule)
- `scripts/water-visual-scene.ts`
- `scripts/water-visual-check.mjs`
- `docs/manual/guides/shader-system.md`
- `docs/research/WATER.md`

Exact validation commands run (including targeted iterations):

```sh
npm run typecheck
npx vitest run src/engine/__tests__/WaterActorReflection.test.ts --reporter=verbose
npx vitest run src/engine/__tests__/WaterActorReflection.test.ts --silent
npx vitest run src/engine/__tests__/WaterActorReflection.test.ts src/engine/__tests__/LiquidSurfaceSystem.test.ts src/engine/__tests__/WaterProfiles.test.ts src/engine/__tests__/RenderVars.test.ts
npx vitest run src/engine/__tests__/Water src/engine/__tests__/Liquid src/engine/__tests__/RenderVars.test.ts src/games/fps/liquid/__tests__ src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npx vite-node src/cli/server-fuzz.ts --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
npm run build
node scripts/water-visual-check.mjs --postprocess --actors
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess --actors
node scripts/water-visual-check.mjs --map=acidwdm2 --full --actors
git diff --check
git -C src/games/fps diff --check
```

The npm fuzz wrapper drops `--ticks` and runs 10000 ticks; the direct command
verified 1000 as well. Vite subprocess tests requiring escalation were retried
outside the sandbox. Earlier failing prototype tests/captures were corrected and
rerun; the counts above describe the final targeted suite, not every intermediate
iteration.

Assumptions: FPS/acidwdm2, replacement horizontal water, WebGL2. The browser fixture
uses the real player creation path but not a networked match. Other GPUs/maps,
WebGL1/WebGPU, moving doors, full multiplayer motion, frame-time spikes, and broad
bank/occlusion edge cases are unverified. This is not yet a production-ready tier.

Next work, after judging this opt-in prototype in gameplay: reduce static blocker
submission cost (a cached merged/simplified occlusion mesh is a candidate), measure
GPU time with moving players, and smooth actor/pool admission. The current per-pixel
camera fade is smooth, but actor-distance cutoffs, two-actor ranking changes and
switching the chosen pool can pop. Alpha-tested blockers are conservatively solid;
only opaque actor parts participate. The mask-constrained blur softens internal
detail more than silhouette edges. Do not claim all brainstorm acceptance criteria
are met, or enable this by default, until those remaining items are validated.

### Local player reflection and testing defaults (2026-09-10)

The user requested their own body in the water, and actor reflections enabled by
default to make solo testing practical. This explicitly supersedes the previous
checkpoint's opt-in default, but does **not** certify the prototype's performance.
Existing saved `r_water_actors 0` settings are preserved.

Implemented:

- `r_water_actors` defaults to 1 (quality 3 remains the default).
- A local world-space body reuses `RemotePlayerRenderer`'s model creation and
  locomotion animation assets. Its pose follows the local visual player position
  and camera yaw. It is not the first-person weapon and has no gameplay hitbox.
- The model loads lazily when a water reflection provider requests it. Normal
  rendering sees invisible meshes; only the selected mirror capture temporarily
  reveals them, then restores visibility. Dead/spectator/non-FPS, distant and
  disabled states suspend the body. Disposal also handles in-flight model loads.
- The body shares the existing two-actor capture, distance limits, wall mask and
  blur with other players. No second local-player reflection target is added.
- Actor-covered pixels have a stylised 0.18 minimum reflection coefficient,
  scaled by reflection strength, coverage and distance fade. This makes looking
  down useful for testing without lifting the room cubemap everywhere. Reflection
  strength zero still removes the contribution. This is an artistic adjustment,
  not a physically accurate water Fresnel model.
- `water render` reports capture status and selected actor count, including
  disabled, no eligible model, distance and geometry-budget reasons.

Solo check: restart dev services and refresh after updating renderer imports,
then join acidwdm2, stand in shallow water with the eye above its surface, and look
down. Use `r_water_quality 3; r_water_actors 1; water render` if saved settings
override the defaults. From a bank, the body's reflection may not intersect the
pool; being near water alone does not guarantee a visible self reflection.

Validation:

- Typecheck and production build passed. Build retains externalized decoder
  module, mixed import and large-chunk warnings.
- Targeted water/liquid/console suite: **352 tests passed across 24 files**.
  A separate final default/reset check passed 36 tests. New checks cover hidden
  local-body ownership/pose/suspend/dispose, temporary capture visibility and
  provider status/lifecycle.
- Required simulation and server-tick tests passed. Physics exited successfully
  with the existing expected-Y 432 vs actual 422 warning and lightgrid mismatch.
  Fuzz passed; npm's wrapper drops `--ticks` and executed 10000 ticks. Wdm2 BSP
  load/info passed with its existing lightgrid warning.
- The documented compound replay command still fails after its first 60-tick
  replay: the console treats `JUMP` and `W` as unknown standalone commands. This
  command limitation is not claimed as a passing regression.
- Headless tests preceded browser checks. Chrome/WebGL2 on RTX 4070 SUPER,
  acidwdm2 full scene with postprocessing: self capture passed, with 2308 covered
  RTT pixels and 66825 changed RGB components above threshold 3 in the on/off
  screenshots. Both body meshes remain invisible outside the capture, and both
  disable when the feature is switched off. No GPU errors in the completed run.
- The other-player fixture also passed after the shared blend change: a fully
  blocking wall reduced the real skinned player's capture coverage to zero.
  This tests full occlusion, not every partial bank-edge case.
- Both root and FPS submodule `git diff --check` passed. Sandbox-blocked esbuild
  subprocesses were retried with escalation, not reported as test failures.

Evidence (workspace-local, not shipped assets):

- `temp/water-visual-check-acidwdm2-full-postprocess-self/self-on.png`
- `temp/water-visual-check-acidwdm2-full-postprocess-self/self-off.png`
- `temp/water-visual-check-acidwdm2-full-postprocess-self/self.json`
- `temp/water-visual-check-acidwdm2-full-postprocess-actors/actor-player-occlusion.json`

Exact files changed for this checkpoint (other existing edits preserved):

- `src/engine/rendering/RenderVars.ts`
- `src/engine/rendering/water/WaterActorReflection.ts`
- `src/engine/rendering/water/LiquidSurfaceSystem.ts`
- `src/engine/rendering/water/UnifiedWaterMaterial.ts`
- `src/engine/__tests__/RenderVars.test.ts`
- `src/engine/__tests__/WaterActorReflection.test.ts`
- `src/engine/__tests__/LocalWaterReflection.test.ts` (new)
- `src/games/fps/Game.ts` (FPS submodule)
- `src/games/fps/client/RemotePlayerRenderer.ts` (FPS submodule)
- `src/games/fps/console/commands/WaterCommand.ts` (FPS submodule)
- `scripts/water-visual-scene.ts`
- `scripts/water-visual-check.mjs`
- `docs/manual/guides/shader-system.md`
- `docs/research/WATER.md`

Exact validation commands run:

```sh
npm run typecheck
npx vitest run src/engine/__tests__/LocalWaterReflection.test.ts src/engine/__tests__/WaterActorReflection.test.ts src/engine/__tests__/RenderVars.test.ts --silent
npx vitest run src/engine/__tests__/Water src/engine/__tests__/LocalWaterReflection.test.ts src/engine/__tests__/Liquid src/engine/__tests__/RenderVars.test.ts src/games/fps/liquid/__tests__ src/games/fps/console/commands/__tests__/WaterCommand.test.ts --silent
npx vitest run src/engine/__tests__/RenderVars.test.ts --silent
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- -- --exec "bsp load wdm2; bsp info; quit"
npm run cli:game -- -- --exec "sim replay W+CROUCH 60; JUMP 1; W 30; quit"
npm run build
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess --self-reflection
node scripts/water-visual-check.mjs --map=acidwdm2 --full --postprocess --actors
git diff --check
git -C src/games/fps diff --check
```

Assumptions: FPS, horizontal replacement water, acidwdm2, above-water camera.
Unverified: the local Game-to-renderer hook in a live networked match, moving
multiplayer frame time, other GPUs/maps, WebGL1/WebGPU and all partial-occlusion
edges. The browser test invokes the real local-model method with a fixed pose,
not a live player input/network stream. Local animation is a locomotion proxy,
not a full aiming/weapon pose; team cosmetics and actor-ranking transitions need
further polish. The same two-actor budget can omit a body in crowded situations.
Static blocker submission cost and smooth actor/pool admission remain next tasks.
