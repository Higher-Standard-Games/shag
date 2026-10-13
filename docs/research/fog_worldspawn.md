# Global fog from worldspawn (Warfork atmospheric fog)

**Status:** implemented on branch `v0.9.29-global-fog` (F1–F9 and sky portals);
waiting for the new Warfork maps to check against real fog. See [Results](#results).
**Goal:** read and draw the atmospheric ("world") fog that new Warfork maps set
in their worldspawn, as Warfork draws it, since those maps are coming to SHAG.
**Source:** Warfork commit
[815e344](https://github.com/TeamForbiddenLLC/warfork-qfusion/commit/815e344099f1a5fb6ba6a6153ee467fa0d1a3bc8)
("Atmospheric GLSL fog"), read from the raw patch, plus notes from Jal.

## What Warfork does

### Worldspawn keys

Each key also accepts a leading underscore (`_fog`, `_fog_height`, …).

| Key | Format | Meaning |
|---|---|---|
| `fog` | `fog_dist r g b [mindist]` | Turns fog on. `fog_dist` is where fog is about 95% opaque; density `k = 3 / fog_dist`. Colour 0–1. `mindist` (default 0) is where fog starts. Needs at least 4 numbers. |
| `fog_height` | `z_clear z_full` | Height band: transparent at `z_clear`, fully fogged at `z_full`. `0 256` is a cloud deck above, `256 0` ground mist below. Ignored if the two are equal. |
| `fog_sun` | `dx dy dz r g b [intensity] [exponent]` | Sun glow through the fog. Direction normalised. Defaults: intensity 1.5, exponent 16 (at least 1). Needs at least 6 numbers. |
| `fog_sky` | `[horizon_bias] [horizon_scale] [zenith_falloff]` | Keeps the sun haze near the horizon instead of tinting the whole sky. Defaults 0.05, 2, 3. |

Jal's example, wdm11 in Warfork: `fog 10000 0.843137 0.576471 0.25098 700`:
95% opaque at 10,000 units, an amber colour, starting at 700 units. (Our wdm11
is the older build without the key.)

### The math (per pixel, `include/fog.glsl`)

```
dist    = |worldPos - cameraPos|
factor  = 1 - exp(-max(0, dist - minDist) * k)              // Beer-Lambert
if height band:  factor *= clamp((worldPos.z - z_clear) / (z_full - z_clear), 0, 1)
fogColor = color
if sun:   fogColor += sunColor * pow(max(0, dot(viewDir, sunDir)), exponent) * intensity * factor
if sky:   fogColor = mix(fogColor, color, clamp(pow(max(0, viewDir.z + bias), falloff) * scale, 0, 1))
result   = (fogColor, factor)
```

### How each pass applies it (`r_backend_program.c`)

| Pass blend | Applied as |
|---|---|
| Opaque, or ordinary blend | `colour = mix(colour, fogColor, factor)` |
| Additive (`dst = GL_ONE` or `GL_ONE_MINUS_SRC_COLOR`) | `colour *= 1 - factor`: glows fade out instead of filling with fog colour |
| Filter (`GL_DST_COLOR GL_ZERO`, `GL_ZERO GL_SRC_COLOR`) | `colour = mix(colour, white, factor)`: decals and detail fade toward "no change" |

Fog applies to world and entity geometry, not to the 2D UI. A new shader keyword,
**`nofog`**, turns it off per surface (and also turns off the legacy Quake 3 fog
volumes on that surface).

### The sky

The sky is ordinary fogged geometry: it is drawn as a box scaled to the shader's
**sky height**, so its fog distance is the sky height, from `h` straight ahead
to about `1.73 h` in the corners. That's Jal's point: a sky at 512 is closer
than a 700 start distance and stays clear, while a sky at 1500 is partly fogged.
The commit also changed the default sky height, when a shader gives none
(`-` or 0), from **512 to 2048**.

`skyparmssides` (Warsow and Warfork) takes **six side tokens, then the height**.
Each side is an image path, or a reference to an earlier side by name (`rt bk lf
ft up dn`). There's no separate base name. Jal's example:

```
skyparmssides env/36sky rt rt rt rt rt 1500 -
```

The right face is `env/36sky`, the other five reuse it, and the sky height is 1500.

### Cvars

- `r_fog 0|1` (archived): master switch. A map without a `fog` key draws no fog.
- Development overrides, cheat-protected in Warfork:
  - `r_fog_distance <d>`: above 0, the cvars become the fog source, and fog
    appears even on maps without the key.
  - `r_fog_color "r g b"` (default 0.75 grey) and `r_fog_mindist` (-1 = the map's).
  - `r_fog_height_clear` (99999 = the map's) and `r_fog_height_full` (-99999 = the map's).
  - `r_fog_sun_dir "x y z"`, `r_fog_sun_color "r g b [exp]"` and `r_fog_sun_inscatter` (-1 = the map's).
  - `r_fog_sky_blend` (-1 = the map's).

The overrides apply only while `r_fog_distance > 0`. Sky portals scale the
start distance, the density and the heights by the portal's scale; SHAG has no
sky portals yet (`misc_skyportal` is unhandled), so that part waits.

## What SHAG has today

| Piece | State |
|---|---|
| `src/engine/effects/FogEffect.ts` | Old generic wrapper over Babylon scene fog (linear/exp/exp2), used by `EngineScene`; not driven by maps. |
| `src/engine/console/commands/FogCommand.ts` | Old `fog` console command poking `scene.fogMode` (EXP2) directly. |
| `src/engine/loader/bsp/BspFogVolume.ts` | Legacy Quake 3 fog **volumes** (brushes with `fogparms`). When the camera is inside one, it sets scene fog to EXP2 and clears it on the way out. |
| `src/games/fps/liquid/client/UnderwaterView.ts` | Saves scene fog, sets EXP2 under water, and restores it. |
| Worldspawn | No fog keys read. |
| `Q3ShaderParser` `skyparmssides` | Takes the first token as a base name and drops the rest: **the sky height is lost** (stored as 0). Needs Warfork's six-sides-then-height reading. |
| Sky meshes | Far box and cloud domes are 10,000 units across, so the real sky height is never part of their geometry. |
| Shader keyword `nofog` | Not parsed. |

## Approach: map onto Babylon's built-in fog, extend where it can't

Babylon's built-in fog (`scene.fogMode`, `fogDensity`, `fogStart`, `fogColor`)
already reaches every `StandardMaterial` and `PBRMaterial`, on WebGL and WebGPU,
through the `fogFragmentDeclaration` and `fogFragment` shader includes. Its EXP
mode is **the same curve as Warfork's**:

```
Babylon EXP:  visibility = 1 / e^(distance × density)     (radial distance from the camera)
Warfork:      factor     = 1 - e^(-max(0, distance - minDist) × k)
```

With `fogMode = EXP`, `fogDensity = 3 / fog_dist` and `fogColor = (r, g, b)`,
the two match exactly, except for `minDist`. Babylon passes `fogStart` to every
fog shader (`vFogInfos.y`) but uses it only in linear mode. **One line patched
in the EXP branch** (GLSL and WGSL), `distance → max(0, distance - fogStart)`,
gives Warfork's start distance through the existing plumbing. EXP with
`fogStart = 0`, the default, is unchanged; EXP2 (underwater, fog volumes) is
untouched. The project already patches Babylon shaders this way, exact line
for exact line, in `src/engine/rendering/BabylonShaderFixes.ts`.

| Warfork | Babylon | Notes |
|---|---|---|
| `k = 3 / fog_dist` | `scene.fogDensity` | — |
| `minDist` | `scene.fogStart` | via the patched EXP branch |
| `color` | `scene.fogColor` | — |
| fog on/off | `scene.fogMode = EXP / NONE` | — |
| `nofog` shader | `mesh.applyFog = false` | per mesh, set at build from the shader flag |

**Beyond the built-in fog**, a material plugin (`MaterialPluginBase`, registered
for Standard and PBR, with GLSL and WGSL code) reads the same scene fog values
and adds what the built-in fog can't express:

1. **Pass rules:** additive materials extinguish (`colour *= 1 - factor`), and
   filter materials fade toward white, chosen from the material's `alphaMode`.
2. **Sky distance:** for sky materials, the fog distance is the sky height
   along the box (`h / max(|x|, |y|, |z|)` of the view direction) instead of the
   mesh's 5,000-unit radius. Shrinking the sky meshes to the sky height would
   do the same, but the cloud domes draw in the blended pass and would then
   cover distant world geometry.
3. **Height band, sun glow and sky horizon tint** from `fog_height`, `fog_sun`
   and `fog_sky`, using the world position Standard and PBR already pass to
   the fragment shader (`vPositionW`).

Materials the plugin doesn't reach (node materials, custom `ShaderMaterial`s)
still get Babylon's basic fog wherever they include it, and are listed in the
coverage step.

### Coordinates

BSP is Z-up; Babylon is Y-up at the same scale (`q3ToBabylon`: `(x, y, z) → (x,
z, y)`). Distances, `fog_dist`, `mindist` and sky heights carry over unchanged.
Heights (`z_clear`, `z_full`) become Babylon **Y**. The sun direction
`(dx, dy, dz)` becomes `(dx, dz, dy)`, normalised after the swap. The sky
horizon test uses the view direction's **Y** where Warfork uses Z.

### Who owns scene fog

Fog volumes and the underwater view also write `scene.fog*`. One owner, a
`WorldFog` service, keeps the map's fog and lends the scene's fog to whoever
needs it: inside a fog volume or under water, their fog wins, and leaving
restores the world fog. Today both set the fog off (or to a saved value) when
they finish, which would erase the world fog.

## Work order

| WO | Work | Files | Status |
|---|---|---|---|
| F1 | Worldspawn `fog`, `fog_height`, `fog_sun`, `fog_sky` (and `_` variants) read as Warfork reads them, with its defaults and validity rules. | `src/engine/loader/bsp/WorldFog.ts` | done |
| F2 | `skyparmssides`: six sides (image or side name), then the height. Sky height defaults to 2048 for `skyparms` and `skyparmssides`; cloud layers use it too. | `Q3ShaderParser.ts`, `Q3ShaderTypes.ts`, `BspMeshBuilder.ts`, `SkyboxLoader.ts` | done |
| F3 | Shader keyword `nofog`; world and brush-model meshes of such shaders get `applyFog = false`. | `Q3ShaderParser.ts`, `BspMeshBuilder.ts`, `brushModelBuilder.ts` | done |
| F4 | Babylon's EXP fog counts from `fogStart` (GLSL and WGSL, one exact line each). | `BabylonShaderFixes.ts` | done |
| F5 | `WorldFogController`: the map's fog as Babylon EXP fog, `r_fog` and the developer-only `r_fog_*` overrides (Warfork's r_main.c rules), scene fog lent to fog volumes, the underwater view and weather fog. Frozen materials are re-marked when the fog changes. | `src/engine/rendering/WorldFogController.ts`, `MapLoader.ts`, `BspFogVolume.ts`, `UnderwaterView.ts`, `FogEffect.ts` | done |
| F6 | `AtmosphericFogPlugin` on Standard and PBR materials (GLSL + WGSL): Warfork's evaluation, per-pass rules, sky at its height, height band, sun glow, sky tint; blended in display space. | `src/engine/rendering/AtmosphericFogPlugin.ts` | done |
| F7 | Coverage: Standard and PBR (world, brush models, models, players) fogged by the plugin. Node materials: none in use. Custom effect shaders: not fogged (see gaps). | — | done (gaps listed) |
| F8 | Leftovers: the `fog` command reads out world fog instead of writing scene fog; `FogEffect` (weather) borrows the scene fog. Fog volumes' `fogMode = 3` (which is LINEAR, not EXP2) fixed. | `FogCommand.ts`, `FogEffect.ts`, `BspFogVolume.ts` | done |
| F9 | Docs, changelog, browser checks on WebGL and WebGPU. | guides, changelog | done |
| S1 | Sky portals: `misc_skyportal` / `props_skyportal` (origin, fov, scale, noents, angles as rotation speeds), portal camera with its own PVS, screen-sized target behind the main view, sky meshes on a portal-only layer, fog scaled in the portal pass. | `src/engine/rendering/SkyPortal.ts`, `MapLoader.ts`, `WorldFogController.ts` | done |

## Results

Checked on this machine with a wdm2 demo and the developer cvars standing in for
a fogged Warfork map (`developer 1; r_fog_distance …; r_fog_color "0.843137
0.576471 0.25098"`), WebGL and WebGPU:

- Distance fog: far surfaces fade to the amber, near ones stay sharp; no
  shader errors on either backend.
- `r_fog_mindist 700`: surfaces inside 700 units clear.
- Height band around the view height: ground mist fogs only the lower part of
  the room, a cloud deck only the ceiling.
- Sun glow: a bright haze toward the sun direction.
- Sky: wdm2's sky shader is at 512; at a fog distance of 3000 the starfield
  hazes about 40%, as Warfork's sky-height rule gives.
- Colour: with Babylon's image-processing post-process the plugin blends in
  display space (converting from and back to linear), so the fog colour is the
  map's; before that it came out washed out.
- Sky portal: on acidwdm2 the sky openings show the portal area from the
  portal camera (on wdm1 too, by the same path; no demo to view it). Hidden,
  the openings show only the clear colour.

Tests: `WorldFog.test.ts` (parsing), `WorldFogController.test.ts` (cvar rules,
scene fog, borrowing), `SkyPortalAndFogPasses.test.ts` (portal parsing and
camera origin, pass kinds, portal fog scale), `Q3ShaderParser.test.ts`
(`skyparmssides`, sky height, `nofog`), `BabylonShaderFixes.test.ts` (EXP patch).

### Effects (2026-10-13)

The engine's own shaders take world fog through `AtmosphericFogShader.ts`
(one GLSL evaluation, shared with the plugin through `AtmosphericFogGlsl.ts`,
uniforms bound per draw for the camera drawing, so the portal pass too):

| Effect | Rule |
|---|---|
| Muzzle flash, impact sparks, tracers, rail (beam + impact), voltaic (beam + impact, every output) | Premultiplied glows fade whole with the fog, Warfork's additive rule |
| BSP glow overlays (opaque lightmapped surfaces) | Mix toward the fog colour |
| Filter-blend decals (darkening, alpha-blended) | Alpha fades with the fog: toward no change, Warfork's filter rule |
| Liquid surfaces (`UnifiedWaterMaterial`), splash droplets | Mix toward the fog colour in display space, before their linear output |
| Explosion sparks (additive particles) | Faded at spawn by the fog at the explosion (the burst is emitted at once) |
| Debris particles (standard blend) | Babylon's particle fog (`applyFog`) |
| `nofog` | Also honoured by these shaders (the mesh's `applyFog`) |

Checked: every effect shader compiles on WebGL and WebGPU (compiled directly
on the WebGPU engine with each material's own options), water included on
wbomb2; no shader errors in play on either backend.

Portal rotation speeds: `skyPortalViewRotation` is tested against Quake's
convention: positive yaw turns left (Quake +X toward +Y), positive pitch
looks down.

### Known gaps

- **Rain** stays unfogged by design: it belongs to another game, not these maps.
- **Real Warfork maps**: everything above was checked with cvars on older maps.
  Check the new maps' fog, sky heights and sky portals when they arrive.

## How to check it

- **Unit:** worldspawn parsing against the spec's examples and defaults;
  `skyparmssides` with Jal's line (height 1500, all faces `env/36sky`); the
  coordinate swap; the EXP patch applied to both shader languages.
- **Headless:** `bsp load <map>; bsp worldspawn` shows the parsed fog.
- **Browser:** without a Warfork map, `r_fog_distance 10000; r_fog_color
  "0.843137 0.576471 0.25098"; r_fog_mindist 700` on our wdm11 reproduces Jal's
  setup. Check near walls stay clear inside 700 units, far walls go amber, a sky
  at 512 stays clear and one at 1500 hazes, glows fade rather than turn amber,
  and fog volumes and under water hand back the world fog. Then a real Warfork
  map with fog, once we have one.
- Renderer regressions per `AGENTS.md`.

## Open questions

1. **Warfork maps with fog:** coming (user, 2026-10-12); the cvars stand in until then.
2. **Cheat protection:** decided: the overrides work only with `developer 1`.
3. **PBR fog curve:** decided: the plugin draws fog on PBR and Standard alike,
   in display space, so Babylon's PBR fog-factor conversion no longer applies
   where the plugin draws.
4. **Sky portals:** decided: implemented in this branch (S1).
