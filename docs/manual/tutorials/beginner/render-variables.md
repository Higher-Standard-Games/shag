# Tweaking render variables

Render variables are numeric `r_*` cvars managed by `RenderVars`.

## List and change

```text
developer 1
render list
r_wireframe 1
r_wireframe 0
r_lightmap 1.5
r_normalmap 1.25
r_bloom 1.0
r_exposure 1.1
```

Changes with live callbacks apply immediately; there is no separate commit step.

Some variables, including material-path switches such as `r_deluxe`, `r_bsp_pbr`, and static BSP freezing, apply on the next map/material build. Read the description printed by `render list`.

## Reset and export

```text
render reset
render export
cvarexport
```

`render reset` resets render variables only. `cvarexport` exports the broader cvar set.

## Persistence

Render values persist in browser local storage under `engine.renderVars`. Debug-category variables are intentionally not treated as durable user settings.

## Performance tuning

Change one setting at a time and measure with the browser profiler. Common cost controls include post-processing gates, god-ray samples, SSR, area-light limits, and texture settings. Do not copy a fixed preset without testing the target map and device.

The exact current list and defaults are in [Render variables](../../guides/render-variables.md).
