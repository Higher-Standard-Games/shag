# Performance workflow

Optimize from measurements on a representative map and target device.

## Capture a baseline

```text
show_fps on
perf capture 10
mem
pvs status
```

`perf capture` accepts 1-60 seconds and reports bounded Babylon instrumentation. Use browser Performance and Memory panels for flame graphs, allocation behavior, GPU timing, and network/asset waterfalls.

Record:

- map, route, player count, and camera position;
- renderer variables;
- average/worst frame time, not FPS alone;
- draw calls, active meshes, triangles, texture memory;
- device, browser, resolution, and thermal state.

## BSP and PVS

```text
pvs on
pvs status
pvs cluster
```

`MapLoader`/`BspManager` already coordinate PVS with the built BSP mesh. Do not create a second `PVSCuller` over the scene without cluster mesh assignments.

At the lower level, `PVSCuller` requires:

1. the parsed `BspFile`;
2. registered cluster/mesh assignments;
3. `update(cameraPosition)` calls.

Its `update` method returns stats and applies visibility. It does not expose an old `getVisibleMeshes` API.

## Renderer controls

```text
render list
r_bloom 0
r_ssr 0
r_godrays 0
r_arealights 0
r_anisotropy 4
r_bsp_freeze 1
```

Available switches depend on initialization. Change one variable at a time; some map/material construction switches apply on the next map load.

## Textures

```bash
npm run tools:textures:audit
npm run tools:textures
```

KTX2 sidecars can reduce transfer/VRAM pressure, but decoder support, quality, and generated files must be validated. Do not run the cleanup/conversion scripts blindly on user-owned media.

## Babylon practices

- reuse materials and textures;
- instance repeated props where appropriate;
- pool high-frequency transient effects;
- dispose meshes, materials, textures, observers, and render targets;
- keep static BSP transforms frozen through the existing loader option;
- avoid per-frame allocations in simulation/render loops;
- use LOD only where transition cost and visual quality have been measured.

Do not manually merge or freeze map meshes after loading without checking shader animation, autosprites, collision ownership, and cleanup.

## Regression

After an optimization:

1. repeat the same capture and compare frame-time distributions;
2. test shader animation, sky, liquid, lightmap, and transparent surfaces;
3. reload the map repeatedly and inspect memory;
4. run the renderer regression set in `AGENTS.md`;
5. verify a lower-end target device.

An optimization is not complete if it changes authoritative simulation or map compatibility.
