# Render variables

`RenderVars` registers numeric `r_*` cvars, clamps values, batches live scene updates, and persists non-debug values under `engine.renderVars`.

## Current groups

| Category | Representative variables |
| --- | --- |
| Material | `r_deluxe`, `r_bsp_pbr`, `r_normalmap`, `r_glossmap`, `r_lightmap`, `r_emissive` |
| Texture | `r_anisotropy`, `r_ktx2`, `r_picmip` |
| Display | `r_webgpu`, `r_bsp_freeze`, `r_ssr`, `r_glow`, `r_bloom`, `r_exposure`, `r_contrast`, `r_pickupProcedural` |
| Lighting | `r_ambient`, `r_lightintensity`, `r_lightmapscale`, god-ray, area-light, and day/night groups |
| Debug | `r_wireframe`, `r_showtris`, `r_water_debug` |

Water has its own set inside those categories: `r_water` and `r_water_quality` select the tier, with `r_water_highlights`, `r_water_roughness`, `r_water_reflection`, `r_water_probe_height`, `r_water_blur`, `r_water_detail`, `r_water_contact`, `r_water_actors` and `r_underwater_distortion` shaping it. Day/night runs from `r_daynight` with its time, speed, length, lightmap range, sun/moon intensity and sky tint.

Use `render list` for the authoritative current list, defaults, ranges, and descriptions. Type-only future names in `RenderVarName` are not necessarily registered.

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
do not change normal gameplay behavior.

## Console commands

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

## Adding a variable

Add the definition to `DEFAULT_VARS` with `value`, `defaultValue`, `min`, `max`, a valid category, and a useful description. Then:

1. connect any non-generic behavior in the relevant subsystem;
2. decide whether it is live, next-load, or restart-only;
3. test range clamping and persistence;
4. update the focused reference if it is user-facing.

Valid categories are `material`, `lighting`, `display`, `texture`, and `debug`.
