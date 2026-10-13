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

The current method is `loadShaders()`; there is no `loadFromPK3()`.

## Supported material behavior

The parser and BSP material path cover the compatibility features most maps depend on:

- stage maps, animated maps, blend and alpha functions;
- culling, depth-write, polygon offset, surface/content parameters;
- lightmap and base-texture stages;
- `tcMod` animation;
- `tcGen environment`;
- wave-driven `rgbGen` and `alphaGen`;
- `deformVertexes autosprite` and `autosprite2`.
- QFusion/Warsow `cubemap` sources are preserved as appearance hints for the
  unified liquid renderer, including inside `if textureCubeMap` blocks.

Support is not a complete reimplementation of the original Q3 renderer. In particular, other vertex deforms such as `wave`, `bulge`, and `move` are currently skipped by the parser. Some uncommon multi-stage combinations are approximated by Babylon material paths.

Brightness/alpha waves without `tcMod` preserve the texture's existing UV
transform. Filter decals apply that transform when sampling, including loader
orientation corrections. Glow overlays independently transform base and glow
UVs after applying their animation offsets; BSP lightmaps keep their dedicated
UV2 path. UV animation in StandardMaterial stages still needs a broader
transform-composition audit; these fixes do not establish full
WebGL/WebGPU visual parity.

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

Capture separately for the floor and halo, and record the map name and backend.
Use the same camera position/settings for a `?renderer=webgl2` comparison.

Keep shader names normalized to forward-slash paths without file extensions.

## Extending materials

Compatibility parsing and enhanced rendering should remain separate:

- preserve shader semantics in `Q3ShaderParser` and `Q3ShaderRegistry`;
- translate resolved properties in the BSP material factory/builder;
- add specialized rendering systems, such as unified liquid surfaces, at the map-loading boundary;
- keep a fallback material path for unsupported hardware or disabled effects.

This separation lets old content continue to load while selected surface classes receive modern Babylon rendering.

## Shader warmup

During gameplay map loading, `EffectPreloader` explicitly compiles seven effect
fixtures and the scene's Standard/PBR materials through Babylon. Off-screen
fixtures cannot rely on a render frame to compile them because they may be
culled. Fixture resources are released after compilation; compilation errors
reject the warmup and release its temporary lights. MapLoader logs a warmup
failure before continuing to its existing scene-readiness gate. This process
warms matching shader configurations on both backends; it does not validate GPU
commands or guarantee every runtime variant is already cached.

## Source of truth

- `src/engine/loader/shader/Q3ShaderParser.ts`
- `src/engine/loader/shader/Q3ShaderRegistry.ts`
- `src/engine/loader/shader/Q3ShaderMaterialFactory.ts`
- `src/engine/loader/shader/ShaderAnimationSystem.ts`

## Engine water replacement

`r_water 1` replaces classified liquid surfaces on the next map load; `r_water 0`
keeps their legacy shaders. Classification uses compiled contents, shader
`surfaceparm`, and exact-name compatibility overrides, not name substrings.

To bind a specific legacy shader to an engine appearance, add its normalized,
extensionless name to `DEFAULT_LIQUID_OVERRIDES` in
`src/engine/loader/bsp/LiquidClassifier.ts`, then rebuild/reload the map:

```ts
"textures/example/pool": { include: true, kind: "water", profile: "clear" },
```

Available water profiles are `default`, `clear`, and `deep`. Unknown profiles log
a warning and use `default`. An override with `exclude: true` preserves the
legacy appearance. This is an engine compatibility table, not a runtime JSON
configuration file. It does not create or modify a swimmable collision volume.

All quality levels use cached room reflections and player-driven wave normals:

- `r_water_quality 1`: no recurring depth/reflection pass.
- `r_water_quality 2`: adds depth-based transmission/tint (default; the
  Balanced video preset).
- `r_water_quality 3`: adds a half-resolution opaque world-colour capture for
  depth-guarded refraction (the Pretty preset). Both 2 and 3 enable the gameplay
  system's existing splash detail when it initializes on map load. Depth quality
  changes live; reload to change splash allocation.

The depth and colour passes run only while a liquid surface is drawn, which an
occlusion query decides, and seen from above flat water they leave out meshes
wholly above it. Saved settings override the default.

Water's background motion uses three slow, broad analytic waves plus a smaller
capillary wave. Two procedural normal samples provide detail (up to 80% slope weight,
drifting at 2 rather than 13 world units/sec), not legacy coloured shader layers.
A faint normal-driven ambient sheen helps the surface read in dark rooms; this
is an artistic cue, not additional traced lighting. At quality 3, normals and player ripples
distort transmitted scene colour as well as cached reflections. Default water is
clearer; `clear` and `deep` profiles retain distinct absorption strengths.

Fine texture/capillary slopes fade between 192 and 768 world units from the eye
and at grazing angles. The three broad waves and player ripples remain intact.
This reduces fine striping in distant reflections; it is a heuristic, not temporal
antialiasing. `r_water_detail 0` isolates broad waves and player ripples.

Refraction costs one additional world submission, at half width/height, while
water is visible. It excludes liquid, particles, weapon geometry and other
transparent effects, and it falls back to regular transparency below the surface
or without a usable depth target. It is screen-space distortion, not physically
traced refraction. Foreground-depth and screen-edge guards reduce bank smearing;
offscreen objects and submerged transparent effects cannot be reconstructed.
Use quality 2 when that extra rendering cost is not worthwhile.

The renderer captures up to four horizontal, connected water regions at 256px
per cube face, once per map load. Adjacent faces with shared vertices share a
region. Sloped, multi-height, or disconnected batches fall back to authored/sky
reflection; regions beyond the capture budget also use that fallback. A neutral
cube keeps missing assets from breaking shader sampling. Captures contain static
map geometry, not reflected players, weapons, or transient effects. Reload the
map to regenerate captures after changing static scenery or lighting.

Captures start only after lightmaps and BSP scene lighting have been configured.
`r_water_probe_height 64` lifts the capture above its waterline anchor to see more
of the room beyond dark retaining walls. Opaque geometry limits the lift, keeping
four units of ceiling clearance; the projection bounds still include the pool.
This setting requires a map reload; 0 restores the old waterline viewpoint and
128 is the maximum lift. Lighting is **not** disabled for capture. The raised,
box-projected cubemap is approximate, especially around interior islands; it is
not a geometrically exact planar mirror.

Reflection and surface-light controls update live:

```text
r_water_reflection 1.3
r_water_highlights 0.6
r_water_roughness 0.3
r_water_blur 0.3
r_water_detail 0.8
r_water_contact 0.25
```

Reflection defaults to 1.3 (30% more Fresnel weight than the previous 1.0 baseline,
still capped at 0.95). Set 1 for the previous weighting or 0 to disable reflected
contribution. This is not a 30% increase in final pixel brightness: dark room
reflections can darken the transmitted floor. Highlights use at most four authored
point lights or shader-emitting panels per supported pool, with cached 16x16 static
visibility masks for up to four pools. Weapon/projectile lights are excluded.
Roughness broadens the point-highlight lobe; it does not blur the cubemap.
The separate `r_water_blur` control softens the cubemap with a normalized five-tap
angular filter, averaged in linear colour. Zero restores one sharp sample. This
adds four cubemap lookups per water pixel, not an additional scene submission;
it is a small artistic filter, not physically prefiltered roughness. High settings
can lose detail or reveal the sparse filter. Reflection strength is unchanged.

`r_water_contact` adds a subtle neutral shade in a narrow four-world-unit
view-ray depth band. It multiplies the existing water contribution equally in
each colour channel, without changing alpha. At the default 0.25 strength the
maximum display-space attenuation is 6.25%. No coloured patches, repeated dots or
foam are added. It is an artistic contact cue, not simulated wetting or a physical
meniscus. Requires valid depth, quality
2/3, and the front side of the water. It is disabled below the surface and without
depth. Screen-depth contact changes with viewpoint and cannot represent submerged
transparent objects or a persistent world-space shoreline. Set 0 to disable.
Blur, detail and contact each range from 0 to 1 and update live.
Saved settings override defaults: explicitly set `r_water_detail 0.8` if your
existing configuration still selects 0.5.

Panel colours are approximated from the cached room; dark/occluded panel samples
can contribute no visible highlight. No eligible light means no invented sun.
These approximations add shader work and map-load visibility tracing, not another
scene render. Masks are coarse and static; moving doors/actors do not update them.

```text
developer 1
r_water 1
r_water_quality 3
map acidwdm2 duel
r_water_debug 4
```

Debug `4` shows only the cached room reflection (red means unavailable), `5`
shows reactive wave slopes, `2` shows thickness bands, and `0` restores normal
rendering. Debug `6` shows undistorted captured world colour for refraction
alignment checks (red means unavailable). Wading/swimming near the surface and existing splash/projectile
crossings feed the shader; fully submerged motion does not produce a wake.
These are cosmetic normals, not displaced collision geometry or fluid simulation.

Movement wakes now carry a world-space travel direction and form trailing V-shaped
wave packets. Their radius grows with speed; level-1 wading uses smaller/weaker
wakes than level-2 surface swimming. Fully submerged motion and cancelling position
jitter do not emit wakes. Ordinary splash impulses remain radial.
Both use the same twelve-impulse budget, with no additional replicated state.

For an unambiguous interaction check, aim at the visible pool, run `water ripple`,
and close the console promptly. This injects only a shader ripple, never a ring
mesh. `water splash` uses the gameplay crossing path at your feet instead; it
now reports if no replacement ripple was emitted. `water render` reports the
replacement surface count, resolver presence, active impulses, and persistent
acceptance/rejection counts, so a faded wave does not erase the diagnostic.
Debug `5` is neutral grey while idle and coloured where a reactive slope exists;
it is not a water beauty view. Return to `r_water_debug 0` for normal rendering.
Supported replacement water no longer overlays the old splash disc; legacy and
unsupported surfaces retain that fallback. Gameplay splash radius scales with
strength (48..112 world units); the direct debug ripple retains its 96-unit default.
Radial impacts include a softer trailing wave within the same impulse. Stronger
impacts propagate faster, and overlapping reactive slopes are smoothly bounded.
Lifetime remains at most two seconds.

Splash detail uses one pooled mesh of soft, velocity-aligned spray quads instead
of faceted sphere particles. Spray fades near the camera and on its final descent
to the waterline; it is excluded from water captures. It adds no render target or
fluid postprocess. It is still a cosmetic approximation: the quads use regular
depth testing, not depth-softened intersections with scenery.

Weak crossings throw fewer, lower droplets; exiting uses 55% of the equivalent
entry's visual strength (audio is unchanged). Spray is finer and shrinks during
actual descent, not only near a lifetime timeout. Hard droplet re-entries can
emit a small 24-unit ripple, limited to one every 120ms per interaction system,
without spawning more spray. The existing 220-droplet/12-impulse budgets remain.

See the appended implementation checkpoint in
[`WATER.md`](https://github.com/Higher-Standard-Games/shag/blob/main/docs/research/WATER.md) for validation, comparison captures, and
remaining limitations.
- `src/engine/loader/bsp/BspMeshBuilder.ts`

### Experimental nearby player reflections

At quality 3, `r_water_actors 1` enables a separate soft player-reflection layer
over the existing cached room cubemap. It defaults to **1 for testing**;
`r_water_actors 0` disables it. An existing saved zero is preserved.
It reflects remote players and a local world-space body using the same model and
locomotion animation path. The local body is loaded lazily near water and is visible
only during the reflection capture, never in the main, depth or refraction view.
No first-person weapon or extra gameplay hitbox is created. Local-body updates stop
when dead, spectating, using a non-FPS camera, out of range or below quality 3.

For a solo check, stand in shallow water with your head above the surface and look
down. Standing on a bank does not guarantee your reflected body falls on water.
`water render` reports whether the capture is active, disabled, waiting for a model,
out of range or over budget. The water state log also includes `reflectedActors`.

The prototype uses one quarter-resolution reflected view, capped at 320 pixels
on its longest side, for one nearby visible pool and at most two actors. The
camera must be above and within 240 world units of the pool bounds; actor bounds
centres must be within 160 units. Surface fragments fade between 140 and 240
units from the eye and become blurrier with distance. Even close reflections
remain soft and wave-distorted.
Actor-covered pixels use a small stylised minimum reflection weight when viewed
from above, so the body remains readable at angles where the room's Fresnel blend
is weak. The room cubemap outside those pixels is unchanged; `r_water_reflection 0`
still suppresses the reflection contribution.

Static scenery supplies reflected-view depth/zero coverage, while the cached
cubemap still supplies environment colour. Gameplay outlines, particles, sprites,
marked effects, and first-person weapon layers are excluded. Blur retains the
unwarped coverage mask to avoid spreading actor colour across occluders.

This is a testing-default visual prototype, not a finished performance tier. It still
submits occluder geometry every active frame. Actor admission and switching
between pools can pop; alpha-tested occluders are conservatively solid, and only
opaque actor parts are included. The local body uses locomotion animation, not a
complete first-person aiming/weapon pose, and shares the two-actor budget.
See the latest `WATER.md` checkpoint for tests,
cost measurements, and remaining work. Restart the dev server and refresh after
updating these renderer imports if Vite hot reload produces shader errors.
