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
- PVS cluster data is used for visibility culling;
- IBSP and FBSP lightmap sizes and lightstyles are handled separately;
- worldspawn, spawn points, brush entities, lights, and other supported entities are processed after geometry.

Not every classname has gameplay behavior. Confirm handlers in `BspEntityHandlers.ts` and the FPS entity layer before promising support.

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
