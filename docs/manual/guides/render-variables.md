# Render variables

`RenderVars` registers numeric `r_*` cvars, clamps values, batches live scene updates, and persists non-debug values under `engine.renderVars`.

## Current groups

| Category | Representative variables |
| --- | --- |
| Material | `r_deluxe`, `r_bsp_pbr`, `r_normalmap`, `r_glossmap`, `r_lightmap`, `r_emissive` |
| Texture | `r_anisotropy`, `r_ktx2` |
| Display | `r_webgpu`, `r_bsp_freeze`, `r_ssr`, `r_glow`, `r_bloom`, `r_exposure`, `r_contrast`, `r_pickupProcedural` |
| Lighting | `r_ambient`, `r_lightintensity`, `r_lightmapscale`, god-ray, area-light, and day/night groups |
| Debug | `r_wireframe`, `r_showtris`, `r_water_debug` |

Water has its own set inside those categories: `r_water` and `r_water_quality` select the tier, with `r_water_highlights`, `r_water_roughness`, `r_water_reflection`, `r_water_probe_height`, `r_water_blur`, `r_water_detail`, `r_water_contact`, `r_water_actors` and `r_underwater_distortion` shaping it. Day/night runs from `r_daynight` with its time, speed, length, lightmap range, sun/moon intensity and sky tint.

Fifty-five variables are registered today. Use `render list` for the authoritative current list, defaults, ranges, and descriptions. Type-only future names in `RenderVarName` are not necessarily registered.

## Console

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

`loadFromStorage` is private and runs during initialization; do not call it from application code. Debug-category variables are excluded from persisted data.

## Adding a variable

Add the definition to `DEFAULT_VARS` with `value`, `defaultValue`, `min`, `max`, a valid category, and a useful description. Then:

1. connect any non-generic behavior in the relevant subsystem;
2. decide whether it is live, next-load, or restart-only;
3. test range clamping and persistence;
4. update the focused reference if it is user-facing.

Valid categories are `material`, `lighting`, `display`, `texture`, and `debug`.
