# Render variables

`RenderVars` registers numeric `r_*` cvars, clamps values, batches live scene updates, and persists non-debug values under `engine.renderVars`.

## Current groups

| Category | Representative variables |
| --- | --- |
| Material | `r_deluxe`, `r_bsp_pbr`, `r_normalmap`, `r_glossmap`, `r_lightmap`, `r_emissive` |
| Texture | `r_anisotropy`, `r_ktx2`, `r_picmip` |
| Display | `r_webgpu`, `r_bsp_freeze`, `r_ssr`, `r_softhalos`, `r_glow`, `r_bloom`, `r_exposure`, `r_contrast` |
| Lighting | `r_ambient`, `r_lightintensity`, `r_lightmapscale`, god-ray, area-light, and day/night groups |
| Debug | `r_wireframe`, `r_showtris`, `r_water_debug` |

The defaults use bloom off (`r_bloom 0`) and 4× anisotropic filtering
(`r_anisotropy 4`), matching Washoi's Balanced preset. Zero bloom intensity
disables the bloom rendering pass. Full-resolution map textures remain the
default (`r_picmip 0`). Saved settings take priority over defaults.

Water has its own set inside those categories: `r_water` and `r_water_quality` select the tier, with `r_water_highlights`, `r_water_roughness`, `r_water_reflection`, `r_water_probe_height`, `r_water_blur`, `r_water_detail`, `r_water_contact`, `r_water_actors` and `r_underwater_distortion` shaping it. Day/night runs from `r_daynight` with its time, speed, length, lightmap range, sun/moon intensity and sky tint.

Use `render list` for the authoritative current list, defaults, ranges, and descriptions. Type-only future names in `RenderVarName` are not necessarily registered.

`r_colorcorrection` is a colour-blindness aid: 0 is off, 1 protanopia
(red-weak), 2 deuteranopia (green-weak), 3 tritanopia (blue-yellow). It
daltonizes the final frame, moving the colour differences that eye cannot see
into ones it can, and `r_colorcorrection_strength` (0–1, default 1) scales the
shift. `r_colorsimulation` (same values, not saved) shows the screen as that eye
sees it, for checking a map; with both set it shows what a colour-blind player
sees with correction on. All three apply at once, from the console mid-match
too. They are one 3×3 matrix in a single pass that `ColorCorrectionPostProcess`
keeps last on the camera, and with both at 0 there is no pass. Video → Advanced
offers the correction as **Color blindness** with a strength slider; turning
it on there also moves default team colors to cyan and orange, with an Undo. Unlike other
`r_` variables the correction follows the player's account, since it is about
their eyes rather than the device. They are ordinary cvars registered by
`PostProcessingManager`, not `RenderVars`, so `cvarlist r_color` lists them and
`render list` does not.

`r_picmip` controls static opaque BSP base textures on the next map load. The
default is 0 (full resolution); 1 halves both dimensions, 2 quarters them, and
8 selects flat color. The Video → Advanced section exposes Full, Soft, Softer,
Blurred and Flat color. Smooth selects 1; Balanced and Pretty select 0.
Transparent/alpha-tested and animated surfaces, sky, lightmaps, model textures
and shaders declaring `nopicmip` or `nomipmaps` retain full detail. Normal/gloss
maps and baked lighting stay intact, so flat color still has surface shading.

Reduced variants have separate cache keys. PNG/JPEG/WebP and TGA pixels are
area-averaged before upload; KTX1 discards authored high-resolution mips and
software-reduces incomplete supported chains when needed. Reduced variants use
source media instead of the full-resolution KTX2 sidecar. Resolution reduction
can lower texture bandwidth and storage, but FPS gains depend on the workload.

## Isolated renderer QA

Cartoon hit sprites supply their artwork to both diffuse and emissive sampling,
so `r_glow` follows the sprite's colors and transparency.

For renderer development, launch with `?rendererqa=1&renderer=webgpu` or
`?rendererqa=1&renderer=webgl2`. This runs a StandardMaterial/PBR box smoke test
before gameplay services and map loading. It does not change saved renderer
preferences. Each initialization, compilation and rendering stage has a
15-second deadline.

The page displays JSON, also available as `window.rendererQAReport` and a
`RENDERER_QA_REPORT` console record. It includes requested/actual backend,
Babylon version, capability values, selected negotiated WebGPU limits, frame
count, fallback reason and the first error with material/mesh/pass context.
`fallback` means the requested backend did not pass even if the fallback drew
successfully; NullEngine can never pass this GPU check. `passed` covers only
the two fixture materials, not BSP maps, actors, water or visual parity.
The scene and engine are disposed after the check; the JSON remains on screen.
Reload to rerun. Normal gameplay omits `rendererqa=1`.

Add `&rendererqacase=lights` to exercise eleven scene lights, first mutable,
then frozen, then with ten lights disabled and restored. Each material/phase
records the cap, active light count and compiled light defines. This is a defect
reproducer: Babylon 9.17 retains the old frozen StandardMaterial light layout
after removal in headless tests; a GPU may reject a draw before the count check.
Use `&rendererqacase=lights-refresh` for the control that explicitly invalidates
frozen materials after membership changes. The control covers five phases for
each material (30 frames). Both cases accept either renderer selection and use
local fixtures without map downloads. Neither establishes full gameplay parity.

Normal `?renderer=webgpu` gameplay also captures the first eight distinct GPU
or render-loop errors automatically. Look for `RENDERER_RUNTIME_REPORT` in the
browser console; the latest JSON snapshot is `window.rendererRuntimeReport`.
It records the frame, negotiated uniform-buffer limit, and cached shader layouts
that exceed that limit, including buffer names and matching scene owners.
These are candidates: asynchronous GPU errors cannot identify the offending
draw from a cache snapshot alone. The report is error evidence, not a pass/fail
test, and is absent until an error occurs. Reload for a fresh capture.
Each console record contains the newest error; the window property retains the
full bounded history. Layouts also include light defines, the compile-time light
cap and current material caps so stale effects can be distinguished from current
configuration. Shader-language/headless tests do not establish visual parity;
full WebGL/WebGPU compatibility remains the target.

For managed WebGPU scenes, the shared scene policy also reapplies light budgets
at glTF import readiness. Babylon 9.17 otherwise raises caps on existing world
materials to the total scene light count when any glTF import completes. The
loader callback prevents late weapon/player imports from undoing the policy.
This repair requires a fresh gameplay reload; `rendererqacase` parameters alone
do not change normal gameplay behavior. On WebGL the raise is kept, so
materials start at a cap of 8 (`SAFE_MAX_SIMULTANEOUS_LIGHTS`), the cap the
loader raises them to: a model loading during play then changes no material's
cap and compiles nothing.

## Console commands

### WebGPU bundle attribution

Start a private probe server, then run the driver from another shell:

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3122
# Second shell:
node scripts/benchmarks/webgpu-bundles.mjs 3122 default
```

The driver explicitly selects WebGPU non-compatibility mode in a temporary
headless browser and records 180 playing and 180 paused frames of the local
`washoi_dm5_ffa_20261025_170933.shagdemo` recording. It attributes bundle creation
and reuse by mesh/material/pass, records the actual cache-gate flags and buffer
identity changes, and checks totals against Babylon's engine counters.
JSON/screenshots go under `.cache/renderer-groundwork/`. GPU errors, source
changes, unreconciled counts or enabled liquid queries reject a capture.

The optional `legacy-slots` argument disables the installed engine's private
owner-keyed UBO path only in that probe page. It is a diagnostic control, not a
supported game setting or a recreation of an earlier Babylon version. The
driver leaves saved renderer preferences unchanged. Instrumented counts do not
establish a frame-time gain or visual parity.

### Renderer groundwork fixtures

Owned-pool candidate filtering has its own isolated comparison. Start the private
server on 3124, then run these commands from a second shell:

```powershell
node scripts/benchmarks/pooled-candidates.mjs webgl2 3124
node scripts/benchmarks/pooled-candidates.mjs webgpu 3124
```

Each backend compares pixels, active meshes, active indices and idle readiness
calls for disabled pool members, re-enabled members, action managers and custom
LOD. Results go under `.cache/renderer-groundwork/pooled-*.json`. This fixture
uses synthetic meshes and does not establish full-game performance or parity.

For an isolated real-GPU check, start the private Vite probe server, then run
the driver from another shell at the assembled root:

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3117
# Second shell:
node scripts/benchmarks/renderer-groundwork.mjs webgl2 effects
node scripts/benchmarks/renderer-groundwork.mjs webgpu effects
node scripts/benchmarks/renderer-groundwork.mjs webgl2 materials
node scripts/benchmarks/renderer-groundwork.mjs webgpu materials
node scripts/benchmarks/renderer-groundwork.mjs webgl2 fixed-scale
node scripts/benchmarks/renderer-groundwork.mjs webgpu fixed-scale
```

The effects fixture counts submitted dynamic vertex-buffer bytes/calls and
exercises WebGL context restoration when supported. Voltaic batches retain
logical dirty slot intervals per stream and rebuild full-capacity buffers from
CPU arrays after restoration. The material fixture compares analytic scroll
and sine expressions against current Standard/PBR rendering at fixed times,
including frozen candidate materials. It requires nonempty pixels and checks
a two-level 8-bit channel tolerance; it is not full gameplay validation. The
fixed-scale fixture counts UV property assignments, checks material freezing,
repairs an external UV write and verifies unregistration on Standard/PBR.

An optional hexadecimal commit hash after the port in effects or fixed-scale mode reads an
archived reference module without switching branches. Results go under ignored
`.cache/renderer-groundwork/`. Restart the no-HMR probe server after source edits.
The driver imports its isolated frontend fixture directly; neither the fixture
nor analytic candidate is selected by normal gameplay startup. Submitted byte
counts are not bus-traffic measurements or a whole-game FPS result.

An isolated matrix-free effect experiment requires an explicit reference commit:

```powershell
node scripts/benchmarks/renderer-groundwork.mjs webgl2 effects 3117 3196debb
node scripts/benchmarks/renderer-groundwork.mjs webgl2 matrix-free-effects 3117 3196debb
node scripts/benchmarks/renderer-groundwork.mjs webgpu effects 3117 3196debb
node scripts/benchmarks/renderer-groundwork.mjs webgpu matrix-free-effects 3117 3196debb
node scripts/benchmarks/compare-matrix-free.mjs 3196debb
```

This generates prototype modules under ignored `.cache/`, using exact source
checks and immutable module URLs. It checks draw counts, matrix-buffer capacity,
active inputs, empty/reused pools, world transforms, depth and matched images.
Its rendering pass does not mean gameplay adoption: Babylon's forced-count
route underreports active indices, so normal gameplay retains its matrix-backed
renderer. Revision-qualified JSON copies preserve separate comparison records.

### Render settings

```text
developer 1
render list
r_lightmap
r_lightmap 1.5
reset r_lightmap
render reset
render export
```

`render apply` reports that values apply automatically. Construction switches such as deluxe/PBR selection, KTX2, WebGPU, or static BSP setup may require a new map load, activation, or restart as their descriptions state.

## API

```ts
import { RenderVars } from '../../../src/engine/rendering/RenderVars';

const vars = RenderVars.getInstance();
vars.setScene(scene);

const lightmap = vars.get('r_lightmap');
vars.set('r_lightmap', 1.5);
const unsubscribe = vars.onChange('r_lightmap', (value) => {
  console.log(value);
});

vars.resetAll();
const text = vars.exportConfig();
const result = vars.importConfig(text);
```

Keep and call the `onChange` unsubscribe handle when the listener owner is disposed.

Applying render variables preserves each material's existing frozen/unfrozen
state, including materials intentionally left mutable for dynamic lighting.

`loadFromStorage` is private and runs during initialization; do not call it from application code. Debug-category variables are excluded from persisted data.

## Weapon camera candidates

The cvar `r_weapon_candidates` filters mesh candidates by the first-person
weapon camera's layer before readiness, matrix and LOD evaluation, so that
camera no longer scans the whole scene to draw a handful of weapon meshes. It
defaults to 1 on every browser and backend; 0 restores Babylon's full scan for
diagnostics. The cvar is not persisted. Registered
camera ownership, action-manager meshes and custom LOD selectors are preserved.

## Texture-array surfaces

The cvar `r_surface_arrays` merges plain opaque map surfaces that differ only in
their images into texture-array meshes on map load (see the
[BSP system](./bsp-system.md#texture-array-surfaces)). It defaults to 1; 0 keeps
every surface separate on the next map load, for diagnostics. The cvar is not
persisted.

## Adding a variable

Add the definition to `DEFAULT_VARS` with `value`, `defaultValue`, `min`, `max`, a valid category, and a useful description. Then:

1. connect any non-generic behavior in the relevant subsystem;
2. decide whether it is live, next-load, or restart-only;
3. test range clamping and persistence;
4. update the focused reference if it is user-facing.

Valid categories are `material`, `lighting`, `display`, `texture`, and `debug`.
