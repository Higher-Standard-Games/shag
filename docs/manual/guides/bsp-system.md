# BSP system

SHAG supports Quake 3 `IBSP` version 46 and Warsow/qfusion `FBSP` version 1 maps.

## Normal map flow

The playable FPS path resolves a map through `PK3Index`, loads its dependencies, parses it, builds Babylon meshes, initializes collision, and spawns supported entities:

```text
map wdm2 duel
```

`MapLoader.getInstance().loadMap(mapName, scene, onProgress?, opts?)` is the high-level browser API. It currently resolves indexed BSP maps; its local text-map branch is marked TODO. `opts.backgroundOnly` loads a map as menu scenery, which is how a background map skips the gameplay setup that turns PVS on.

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

Inline lift/door meshes group faces by both base texture and lightmap page,
matching static-world batching. Faces with page-local UV2 coordinates must not
share a material across different lightmap pages. Static and moving BSP surfaces
use the same baked-light RGBA/gamma/overbright conversion.

Not every classname has gameplay behavior. Confirm handlers in `BspEntityHandlers.ts` and the FPS entity layer before promising support.

Map ambience is client-only (`AmbientEntityHandlers.ts`) and ends with the map:

- `target_speaker` with spawnflag 1 (LOOPED_ON) loops its `noise` where it
  stands, at full volume within 80 units and silent past
  80 + 1000 / `attenuation`, as in Quake; spawnflag 4 (GLOBAL) or attenuation 0
  plays it everywhere. An untriggered speaker with `wait` plays every `wait` ±
  `random` seconds. Speakers with a `targetname` wait for triggering, which the
  client does not have yet, and are reported as unhandled.
- `func_rotating` builds its inline model and spins it at `speed` degrees a
  second (default 100) about the vertical axis, or X/Y with spawnflags 4/8;
  2 reverses. A model built with an origin brush turns about its `origin`. One
  with a `targetname` stands still unless START_ON (1) is set.

### World fog

Warfork maps set atmospheric fog in worldspawn (`fog`, `fog_height`, `fog_sun`,
`fog_sky`, each also with a leading `_`); `WorldFog.ts` reads them as Warfork
does and `WorldFogController` draws them. The format, the math and the design
are in `docs/research/fog_worldspawn.md`. In short:

- `fog "fog_dist r g b [mindist]"`: about 95% opaque at `fog_dist` (density
  `3 / fog_dist`), clear inside `mindist`.
- Babylon's EXP fog carries it to every material (with a one-line shader
  patch so EXP fog starts at `fogStart`); `AtmosphericFogPlugin` draws the full
  Warfork fog on Standard and PBR materials: additive surfaces fade to black,
  filters toward white, the sky at its shader's height, the height band, sun
  glow and sky tint.
- BSP Z is engine Y: heights become Y and the sun direction swaps its last two
  components.
- Fog volumes, the underwater view and weather fog borrow the scene fog and
  hand it back (`suspend` / `resume`).
- A shader with `nofog` keeps world fog off its surfaces.

### Sky portals

`misc_skyportal` (or `props_skyportal`) makes the sky show the map seen from the
portal's origin (`SkyPortal.ts`): the portal camera takes the player's view
angles (plus `angles` as rotation speeds), the `fov` override and the `scale`
offset from the world centre, with its own PVS, and renders into a screen-sized
target drawn behind the main view; the sky meshes move to a layer only that
camera sees. `noents` leaves entities out. World fog inside the portal is
scaled as Warfork scales it.

A map logs the classnames it has no client handler for in one line,
`No client handler for: …`, leaving out markers that need none.

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

Autosprite billboards update before each world camera draws, after frame-level PVS. Hidden/disabled sprites skip vertex work; visible sprites reuse their last uploaded orientation while the eye position is unchanged. Newly visible sprites refresh before selection, and map cleanup removes their callback. This is automatic on map load and needs no extra setting.

For headless inspection, build geometry with `bsp render` before `pvs on`. Enabling updates visibility immediately, but command batches do not run the gameplay render loop. Mesh counts from `NullEngine` do not measure GPU performance. The repository's `docs/research/v0.9.23-rendering-research.md` tracks implementation progress, validation and remaining visual checks.

## Experimental spatial grouping

`r_bsp_cellsize` changes grouping on the next map load. The default is `0` (off); positive values use 128-4096 map-unit cells. Only eligible opaque texture/lightmap/patch groups with at least 1,024 triangles split. Small batches, liquids, transparent surfaces, animated materials and sprites retain their existing grouping. Existing fog associations carry across split cells. Whole faces are preserved, so large faces can extend outside their assigned cell.

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

It verifies authored geometry hashes, reports mesh/triangle counts before frustum culling, and checks moving/stationary autosprite upload counts with PVS on/off. It does not benchmark GPU rendering or load the complete gameplay/material pipeline.

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
