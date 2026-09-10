# Lighting system

SHAG combines baked BSP lighting with optional dynamic scene lighting.

## BSP lighting

- lightmap textures illuminate static BSP surfaces;
- the BSP lightgrid supplies ambient, directional, and direction samples for models;
- `BspManager.getLightingAt(position)` queries the loaded grid;
- `r_lightmap` and `r_lightmapscale` affect baked-light presentation.

```text
bsp lightmaps
bsp lightgrid
bsp debug_grid
```

`spawnmodel lighting <index>` refreshes lightgrid lighting for a developer-spawned model.

## Day/night

`SkyLightSystem` owns the BSP day/night state:

```text
developer 1
daynight on
daynight noon
daynight midnight
daynight sunrise
daynight sunset
daynight time 0.3
daynight cycle 10
daynight start
daynight stop
daynight info
```

Supported BSP worldspawn keys:

```text
daynight_enabled
daynight_time
daynight_cycle
daynight_animate
```

Map loading reads them once per worldspawn through `SkyLightSystem.loadFromWorldspawn()`.

Renderer cvars also expose a `r_daynight_*` group. Use `render list` for current defaults and bounds rather than duplicating them in map content.

## Dynamic map effects

The loader has focused integrations for emissive surfaces, area-light entities, and god-ray emitters. These are map/material presentation features and are bounded by renderer variables and dynamic-light safety limits.

`StreetLampSystem` is used by the raw `MapRenderer` extension path. Do not assume a `street_lamp` text-map entity is automatically part of every playable BSP flow.

## API entry points

- `src/engine/lighting/SkyLightSystem.ts`;
- `src/engine/lighting/StreetLampSystem.ts`;
- `src/engine/lighting/MapAreaLightEntities.ts`;
- `src/engine/lighting/MapGodRayEntities.ts`;
- `src/engine/lighting/DynamicLightSafety.ts`;
- `src/engine/loader/bsp/BspManager.ts`.

Dynamic lights, observers, shadow generators, and post-process resources must be disposed with the map/scene that owns them.
