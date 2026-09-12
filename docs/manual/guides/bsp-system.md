# BSP system

SHAG supports Quake 3 `IBSP` version 46 and Warsow/qfusion `FBSP` version 1 maps.

## Normal map flow

The playable FPS path resolves a map through `PK3Index`, loads its dependencies, parses it, builds Babylon meshes, initializes collision, and spawns supported entities:

```text
map wdm2 duel
```

`MapLoader.getInstance().loadMap(mapName, scene, onProgress?)` is the high-level browser API. It currently resolves indexed BSP maps. Its local text-map branch is marked TODO.

## Inspection flow

`BspManager` and the `bsp` command expose a lower-level path that is useful in the developer console and headless runner:

```text
developer 1
bsp load wdm2
bsp info
bsp faces
bsp entities
bsp textures
bsp worldspawn
bsp clusters
bsp lightmaps
```

In a browser scene, additional inspection operations include:

```text
bsp render
bsp applytextures
bsp applylightmaps
bsp sky info
bsp sky apply
bsp fog info
```

Use `help bsp` for the complete list in the current build.

## Low-level parsing and mesh construction

```ts
import { BspLoader } from '../../../src/engine/loader/bsp/BspLoader';
import { BspMeshBuilder } from '../../../src/engine/loader/bsp/BspMeshBuilder';

const bsp = BspLoader.load(arrayBuffer);
const result = BspMeshBuilder.build(bsp, scene, {
  filterTextures: true,
});
```

`BspLoader.load` and `BspMeshBuilder.build` are static. The mesh builder constructor is private. Parsed entities are already available as `bsp.entities`; a separate `EntityParser` is not required.

The result includes the world mesh and mesh/material bookkeeping needed by map cleanup and animation systems. Treat its exact shape as an internal loader contract and import the `BspMeshBuildResult` type when extending it.

## Coordinates

Quake map coordinates are converted to Babylon coordinates by the BSP mesh helpers. Reuse `q3ToBabylonVec3` and the existing winding conversion rather than adding local axis swaps.

## Visibility, lightmaps, and entities

- polygon, patch, mesh, and billboard face types are parsed;
- PVS cluster data enables static-world visibility culling by default on playable map loads;
- IBSP and FBSP lightmap sizes and lightstyles are handled separately;
- worldspawn, spawn points, brush entities, lights, and other supported entities are processed after geometry.

Not every classname has gameplay behavior. Confirm handlers in `BspEntityHandlers.ts` and the FPS entity layer before promising support.

## PVS culling

PVS activates automatically after a playable map finishes setup. Use the console to inspect it or compare performance:

```text
pvs status
pvs cluster
pvs off
pvs on
```

Each playable map load enables PVS, including reloads and map changes. `pvs off` disables it for the current map; `pvs on` restores it immediately. Missing or malformed visibility data leaves the world visible and does not prevent loading. Menu background maps do not activate gameplay PVS.

World meshes use compiled BSP face/leaf membership. A mesh stays visible if any of its clusters could be seen; unassigned surfaces remain visible. Large material batches can therefore limit how much geometry PVS removes. Movers and other untagged entities use their own visibility handling.

Culling follows the current world camera, including the usual world + weapon camera setup. Until a camera is assigned, and for multiple world views, it conservatively shows all registered surfaces. Disabling restores the visibility recorded when meshes were registered; map cleanup removes PVS observers. `pvs status` reports the last evaluated view without forcing a visibility change.

For headless inspection, build geometry with `bsp render` before `pvs on`. Enabling updates visibility immediately, but command batches do not run the gameplay render loop. Mesh counts from `NullEngine` do not measure GPU performance. The repository's `docs/research/v0.9.23-rendering-research.md` tracks implementation progress, validation and remaining visual checks.

## Experimental spatial grouping

`r_bsp_cellsize` changes grouping on the next map load. The default is `0` (off); positive values use 128-4096 map-unit cells. Only eligible opaque texture/lightmap/patch groups with at least 1,024 triangles split. Small batches, liquids, transparent surfaces, animated materials, sprites and fog-associated textures retain their existing grouping. Whole faces are preserved, so large faces can extend outside their assigned cell.

To try the experiment on a large map, enter these commands individually:

```text
developer 1
r_bsp_cellsize 1024
map wbomb6
pvs status
perf capture 10
```

Compare with `r_bsp_cellsize 0` and reload the same map; PVS enables automatically. More meshes can increase CPU submission and other pass costs even when fewer triangles remain visible. `pvs off` does not undo spatial grouping; changing cell size requires rebuilding the map.

The repeatable geometry/PVS audit checks all authored deathmatch spawn origins at sizes 0/512/1024/2048:

```bash
npx vite-node src/cli/audit-pvs.ts -- wdm2 acidwdm2 wbomb6
```

It verifies geometry hashes and reports mesh/triangle counts before frustum culling. It does not benchmark GPU rendering or load the complete gameplay/material pipeline.

## Headless verification

```bash
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
npm run test:physics
```

## Source of truth

- `src/engine/loader/map/MapLoader.ts`
- `src/engine/loader/bsp/BspLoader.ts`
- `src/engine/loader/bsp/BspMeshBuilder.ts`
- `src/engine/loader/bsp/BspManager.ts`
