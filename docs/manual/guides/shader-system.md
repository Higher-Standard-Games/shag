# Quake shader system

SHAG parses Quake 3 and Warsow shader scripts from loaded PK3 archives and resolves them into Babylon materials for BSP surfaces.

## Loading and inspection

```text
developer 1
shader load
shader count
shader list water
shader info textures/liquids/pool3d_3c
shader resolve textures/liquids/pool3d_3c
shader deps textures/liquids/pool3d_3c
```

In code:

```ts
import { Q3ShaderRegistry } from '../../../src/engine/loader/shader/Q3ShaderRegistry';

const registry = Q3ShaderRegistry.getInstance();
await registry.loadShaders();

const shader = registry.getShader('textures/liquids/pool3d_3c');
const props = registry.resolveMaterialProps('textures/liquids/pool3d_3c');
```

## Supported material behavior

The parser and BSP material path cover the compatibility features most maps depend on:

- stage maps, animated maps, blend and alpha functions;
- culling, depth-write, polygon offset, surface/content parameters;
- lightmap and base-texture stages;
- implicit baked lighting for Qfusion `material` stages, authored
  `glossIntensity` / `glossExponent`, and `rgbGen exactVertex`;
- `tcMod` animation;
- `tcGen environment`;
- wave-driven `rgbGen` and `alphaGen`;
- Qfusion `rgbGen wave distanceramp` and `alphaGen wave distanceramp` on
  primary Standard/PBR material stages;
- `alphaGen vertex` on blended BSP meshes and true multiplicative
  `blendFunc filter` decals (white leaves the framebuffer unchanged);
- the first additive shine stage following a Qfusion `material` stage,
  including its brightness wave and UV animation;
- `deformVertexes autosprite` and `autosprite2`;
- `softParticle` intersection fading on transparent Standard/PBR primary stages;
- QFusion/Warsow `cubemap` sources are preserved as appearance hints for the
  unified liquid renderer, including inside `if textureCubeMap` blocks.

Support is not a complete reimplementation of the original Q3 renderer. Other vertex deforms, such as `wave`, `bulge` and `move`, are skipped by the parser. Some uncommon multi-stage combinations are approximated by Babylon material paths.

Repeated material stages support an opaque base followed by alpha-blended
material layers and additive image stages. Each pass retains its own texture,
vertex RGB/alpha selection, constant RGB gain, UV animation and depth-write
state. This covers Warfork's industrial supports and vertex-coloured crates.
The passes draw separately; they are not combined into one shader. An initial
`surroundmap` or `cubemap` pass can precede a blended material and additive shine.
`if textureCubeMap` selects the six-face source; its negated branch supplies the
authored 2D fallback. Selected passes retain their script order. `surroundmap`
samples the view ray, while `cubemap` reflects it around the surface normal.
Explicit lightmap stacks and other blend combinations retain the existing
compatibility path.

Opaque vertex-lit `material` stages without lightmaps retain baked vertex RGB
and accept additive game lights and gloss, excluding the synthetic world fill.
Black baked colours remain valid shadows; the renderer does not whiten them.
On BSP surfaces, `rgbGen lightingDiffuse` uses the baked vertex channel, matching
Qfusion's static-surface interpretation. Two-sided deluxe diffuse lighting uses
the absolute normal/light dot product so reversing a fence does not extinguish
its baked light.

`wave distanceramp from to near far` interpolates between `from` and `to`
with a smoothstep over the projected camera distance at each vertex. The
projection uses the deformed surface normal; billboard normals turn with their
geometry. These ramps depend on camera position rather than elapsed time.
Custom shader overlays outside the Standard/PBR path do not implement this ramp.

For BSP `autosprite2`, each authored quad rotates around its own longest edge
axis. The camera-facing direction is projected perpendicular to that axis;
the original centre, length and vertex/UV association are retained. This covers
horizontal and tilted halos as well as vertical cones. A view directly along
the axis retains the previous orientation, and normals/bounds follow the deform.

`softParticle` fades effects against opaque scene depth, including alpha-tested
cutouts. It uses Qfusion's softness curve and default scale of 0.02 (full
strength at 50 world units of separation). Source-alpha blends fade their alpha;
pure additive stages fade their RGB contribution. Clear background depth leaves
the effect at full strength.

Soft particles share a separate camera-space depth capture. It runs when a
registered effect is enabled and in the world camera frustum, excluding sky,
viewmodels and alpha-blended geometry. Camera changes replace the capture;
disposing the last material releases it. This costs an additional depth pass
while visible. Devices without float render targets retain the authored effect
without intersection fading. Custom overlay shaders are outside this path.

Material stages retain their own UV and blend state when an earlier pass uses
environment coordinates. An authored additive shine stage uses a separate
pass so the base image's alpha does not mask it. Arbitrary environment backgrounds
are still approximated outside the repeated-material path.

PK3 PNG/JPG, TGA and KTX images share a top-to-bottom upload convention. BSP
diffuse maps use UV0 and baked lightmaps use UV2, including type-3 triangle soups.
Normal-mapped BSP meshes use an explicit Qfusion tangent frame built from UV0,
including mirrored UV handedness, so OpenGL normal maps agree with baked light
directions on floors and walls.

`blendFunc add` uses source RGB plus destination RGB independently of texture
alpha. The explicit `GL_SRC_ALPHA GL_ONE` form attenuates the source by alpha.
`blendFunc blend` uses texture alpha multiplied by authored vertex alpha;
`blendFunc filter` multiplies destination RGB by the source image.
On BSP and MD3 Standard materials, `alphaFunc` and `blendFunc` apply together:
the cutoff rejects pixels, then the surviving pixels retain their blend alpha.
Cutout-only stages remain alpha-tested without blending. An explicit stage
`depthWrite` also writes depth from the transparent queue.
FBSP vertex RGB receives the map lighting gain and hue normalization while
vertex alpha remains unchanged. Lightmapped vertex-coloured material stages
use direct baked lighting rather than an additional synthetic fill multiplier.

Primary `animMap` stages and the supported additive material shine can cycle
loaded frames. MD3 materials retain authored texture V coordinates with the
same PK3 image upload convention and support primary stage UV/colour animation.

Brightness/alpha waves without `tcMod` preserve the texture's existing UV
transform. Filter decals apply that transform when sampling, including loader
orientation corrections. Glow overlays independently transform base and glow
UVs after applying their animation offsets; BSP lightmaps keep their dedicated
UV2 path. How UV animation composes with other transforms in StandardMaterial
stages has not been audited across all content, and WebGL/WebGPU visual parity
is not established.

## Debug workflow

When a material looks wrong:

1. Run `pk3 find <path>` to confirm which archive wins.
2. Run `shader deps <shader-name>`.
3. Inspect parsed stages with `shader info <shader-name>`.
4. Compare resolved flags with `shader resolve <shader-name>`.
5. In the browser, use `shader aim 1` to identify the surface under the crosshair.

For rendering differences between backends, aim at the broken area and run
`shader surface`. It returns a `RENDERER_SURFACE_REPORT` with the nearest eight
pickable mesh hits, authored shader names, UV/UV2 coordinates, material depth
and alpha state, and texture sources/transforms. Hidden meshes and meshes outside
the world camera's layer mask are excluded. This is CPU picking/state inspection;
it does not prove which GPU fragment is visible or enumerate every triangle
overlapping within one mesh.

The latest complete snapshot is also available as `window.rendererSurfaceReport`.
If console output is truncated, copy it from browser DevTools with:

```js
copy(JSON.stringify(window.rendererSurfaceReport, null, 2))
```

Capture each problem surface separately, and record the map name and backend.
Use the same camera position/settings for a `?renderer=webgl2` comparison.

Keep shader names normalized to forward-slash paths without file extensions.

## Extending materials

Compatibility parsing and enhanced rendering should remain separate:

- preserve shader semantics in `Q3ShaderParser` and `Q3ShaderRegistry`;
- translate resolved properties in the BSP material factory/builder;
- add specialized rendering systems, such as unified liquid surfaces, at the map-loading boundary;
- keep a fallback material path for unsupported hardware or disabled effects.

This separation keeps existing content loading while selected surface classes receive modern Babylon rendering.

## Shader warmup

During gameplay map loading, `EffectPreloader` explicitly compiles small off-screen
fixtures for each effect material variant and the scene's Standard/PBR materials through Babylon. Off-screen
fixtures cannot rely on a render frame to compile them because they may be
culled. Fixture resources are released after compilation; compilation errors
reject the warmup and release its temporary lights. MapLoader logs a warmup
failure, or a warmup that has not finished within ten seconds, and continues to
its scene-readiness gate. This process
warms matching shader configurations on both backends; it does not validate GPU
commands or guarantee every runtime variant is already cached.

## Source of truth

- `src/engine/loader/shader/Q3ShaderParser.ts`
- `src/engine/loader/shader/Q3ShaderRegistry.ts`
- `src/engine/loader/shader/Q3ShaderMaterialFactory.ts`
- `src/engine/loader/shader/ShaderAnimationSystem.ts`
- `src/engine/loader/bsp/BspMeshBuilder.ts`

## Engine water

With `r_water 1` (the default), liquid surfaces are drawn with the engine's
unified water material instead of their map shaders; `r_water 0` keeps the map
shaders. Either change applies on the next map load.

### Which surfaces are water

Classification uses compiled contents, shader `surfaceparm`, and exact-name
overrides, never name substrings. To bind a specific map shader to an engine
appearance, add its normalized, extensionless name to
`DEFAULT_LIQUID_OVERRIDES` in `src/engine/loader/bsp/LiquidClassifier.ts`, then
reload the map:

```ts
"textures/example/pool": { include: true, kind: "water", profile: "clear" },
```

The profiles are `default`, `clear` and `deep`, which differ in how strongly
they absorb light; an unknown profile logs a warning and uses `default`. An
override with `exclude: true` keeps the map's own shader. The table is engine
source, not a runtime configuration file, and it never changes the swimmable
collision volume.

### Quality

Every quality level uses cached room reflections and player-driven wave
normals.

| `r_water_quality` | Adds |
| --- | --- |
| `1` | Nothing beyond the cached reflection: no recurring depth or capture pass |
| `2` (default, Balanced preset) | Depth-based transmission and tint, bank contact shading, and splash detail |
| `3` (Pretty preset) | A half-resolution capture of the opaque world for depth-guarded refraction, and nearby player reflections |

Depth quality changes live; splash detail is allocated on map load, so changing
it needs a reload. The depth and colour passes run only while an occlusion query
says a liquid surface is drawn, and seen from above flat water they skip meshes
wholly above it.

Refraction at quality 3 costs one more world submission, at half width and
height, while water is visible. It leaves out liquid, particles, weapon geometry
and other transparent effects, and falls back to plain transparency below the
surface or without a usable depth target. It is screen-space distortion, not
traced refraction: foreground-depth and screen-edge guards reduce smearing along
banks, but objects off screen and transparent effects under water cannot be
reconstructed.

### Surface and reflection controls

These update live unless noted. Saved settings override the defaults.

| Variable | Default | Range | Effect |
| --- | --- | --- | --- |
| `r_water_reflection` | 1.3 | 0–2 | Fresnel weight of the cached reflection, capped at 0.95; 0 removes it. A higher weight can darken the floor seen through the water, so it is not a brightness control |
| `r_water_highlights` | 0.6 | 0–2 | Highlights from authored static lights; 0 disables |
| `r_water_roughness` | 0.3 | 0.12–0.8 | Width of the point highlights (it does not blur the reflection) |
| `r_water_blur` | 0.3 | 0–1 | Softens the reflection with a five-tap angular filter; 0 takes one sharp sample |
| `r_water_detail` | 0.8 | 0–1 | Fine wave strength; 0 leaves the broad waves and player ripples |
| `r_water_contact` | 0.25 | 0–1 | Neutral shading in a narrow band where water meets geometry; 0 disables |
| `r_water_probe_height` | 64 | 0–128 | Lift of the reflection capture above the waterline; needs a map reload |
| `r_water_actors` | 1 | 0–1 | Nearby player reflections at quality 3 |
| `r_underwater_distortion` | 1 | 0–1 | Underwater view warp; at 0 the tint, fog and audio still mark being underwater |

The surface moves with three slow, broad waves and a smaller capillary wave,
with two procedural normal samples for detail. Fine slopes fade between 192 and
768 world units from the eye and at grazing angles, which reduces striping in
distant reflections. A faint normal-driven sheen helps the surface read in dark
rooms; it is an artistic cue, not traced lighting.

Highlights come from at most four authored point lights or light-emitting panels
per pool, with coarse static visibility masks for up to four pools. Weapon and
projectile lights are excluded, a map without eligible lights gets no invented
sun, and moving doors and players do not update the masks. Panel colours are
approximated from the cached room, so a dark or occluded panel can add nothing.

The reflection blur adds four cubemap lookups per water pixel but no scene pass;
high values can lose detail. Contact shading darkens all colour channels equally
within four world units of view-ray depth, at most 6.25% at the default
strength, and needs valid depth, quality 2 or 3 and a view from above the
surface. It depends on the viewpoint and cannot draw a fixed shoreline.

### Room reflections

The renderer captures up to four flat, connected water regions at 256px per cube
face, once per map load, after lightmaps and scene lighting are set up. Faces
that share vertices share a region. Sloped, multi-height or disconnected
batches, and regions past the budget, use the authored or sky reflection
instead, and a neutral cube stands in for missing assets. Captures contain the
static map only, not players, weapons or effects; reload the map to capture
again after changing scenery or lighting.

`r_water_probe_height` lifts the capture point to see more of the room over dark
retaining walls, keeping four units below the ceiling, while the projection
bounds still include the pool. The box-projected cubemap is approximate,
especially around islands; it is not an exact planar mirror.

### Player reflections

At quality 3, `r_water_actors 1` adds a soft reflection of up to two nearby
players over the room reflection: remote players and your own body, which uses
the same model and locomotion animation. Your body is loaded when you come near
water and drawn only into the reflection, never into the main, depth or
refraction view. No weapon model or hitbox is created, and it stops updating
when you are dead, spectating, in a non-FPS camera, out of range or below
quality 3.

The reflection renders one quarter-resolution view, at most 320 pixels on its
longest side, for one visible pool. The camera must be above the water and
within 240 world units of the pool, and a player's centre within 160 units.
Reflections fade between 140 and 240 units from the eye and stay soft and
wave-distorted even close up. Where a player covers the water, a small minimum
reflection weight keeps them readable from above; `r_water_reflection 0` still
removes it. Static scenery occludes the reflection; outlines, particles, sprites
and first-person weapons are left out.

Limits: occluder geometry is drawn on every active frame, players can pop in at
the range limits and when switching pools, alpha-tested occluders count as
solid, and only opaque body parts are reflected. To see your own reflection,
stand in shallow water with your head above the surface and look down.

### Ripples, wakes and splashes

Wading or swimming near the surface, splashes and projectile crossings feed
ripples into the shader. Moving through water leaves a trailing V-shaped wake
whose size grows with speed, smaller when wading than when swimming; fully
submerged movement leaves none. Impacts send out a radial wave with a softer one
behind it, faster for stronger impacts, and lasting at most two seconds. Splash
radius scales with strength from 48 to 112 world units. All of this shares a
budget of twelve impulses and adds no replicated state. Ripples are cosmetic
normals, not displaced collision geometry or fluid simulation.

Splash detail draws soft, velocity-aligned spray quads from one pooled mesh, at
most 220 droplets. Spray fades near the camera and as it falls back to the
water, and is left out of water captures. Weak crossings throw fewer, lower
droplets, and leaving the water throws 55% of the spray of entering it. A hard
droplet re-entry can add a small 24-unit ripple, at most one every 120ms. The
quads use regular depth testing, so they can intersect scenery sharply.
Surfaces that keep their map shader also keep the older splash disc.

### Debugging water

```text
developer 1
r_water 1
r_water_quality 3
map acidwdm2 duel
r_water_debug 4
```

| `r_water_debug` | Shows |
| --- | --- |
| `0` | Normal rendering |
| `1` | Absorption |
| `2` | Thickness bands |
| `3` | Environment |
| `4` | The cached room reflection (red where unavailable) |
| `5` | Reactive wave slopes (neutral grey when idle) |
| `6` | The undistorted refraction capture (red where unavailable) |

The `water` command checks interaction directly. Aim at the pool, run `water
ripple` and close the console: it injects a shader ripple only. `water splash`
runs the gameplay crossing path at your feet and says if no ripple was emitted.
`water render` reports the water surface count, the impulse state with running
accepted and rejected counts, and whether player reflections are active,
disabled, waiting for a model, out of range or over budget. The water state log
also includes `reflectedActors`.

Design notes, validation captures and remaining limitations are in
[`WATER.md`](https://github.com/Higher-Standard-Games/shag/blob/main/docs/research/WATER.md).
