# BSP system

`func_explosive` inline brush models render through the BSP entity handlers and
share enabled state with the Q3 collision backend. S&D activates the structures
targeted by a detonated site after their authored delays, disables their collision
and restores them at round start. Cosmetic debris comes from the entity's
`debris1`/`debris2` MD3 references; map-media packaging includes these dependencies.
Inline models share full lightmap/direction pages within a BSP and scene; the
pages remain alive until their final inline owner is disposed.
Inline geometry includes curved patches using the same tessellation, UVs and
coordinate conversion as world geometry, alongside polygon and mesh faces.

SHAG supports Quake 3 `IBSP` version 46 and Warsow/qfusion `FBSP` version 1 maps.

## Normal map flow

The playable FPS path resolves a map through `PK3Index`, loads its dependencies, parses it, builds Babylon meshes, initializes collision, and spawns supported entities:

```text
map washoi_dm2 duel
```

`MapLoader.getInstance().loadMap(mapName, scene, onProgress?, opts?)` is the high-level browser API. It loads indexed BSP maps; it does not load local `.map` text files. `opts.backgroundOnly` loads a map as menu scenery, which is how a background map skips the gameplay setup that turns PVS on.

The application registers its game-owned entity lifecycle through
[`GameMapEntities`](./service-registries.md). Washoi uses this to populate pickup
definitions before model discovery, install handlers before entity dispatch,
and dispose pickups before their preloaded models are released.

Washoi's Node map-data helper is
`src/games/fps/shared/bsp/BspDataLoader.ts`. It supplies game spawn/pickup
extraction for bots and tools. The generic BSP parser, indexed package resolver
and collision backends remain in SHAG. The dedicated server's headless map
loader uses the same game-owned pickup extractor and landing rules as the client.

The world stays disabled while asynchronous texture loading, fog and baked-light
material setup run. This prevents partially configured material layouts from
reaching the GPU during a map switch.

Map loads run sequentially. A newer request cancels the previous operation and
waits for its cleanup before changing the scene; requests cancelled before they
start do not emit loading events. Each started operation emits one completion.
Temporary visibility listeners and GPU-readiness timers are released on success,
failure and cancellation. `disposeCurrentMap()` cancels a pending load, waits for
it to settle, then clears the map. Shared package downloads may finish for other
consumers, but an abandoned map does not complete a newer load.

## Inspection flow

`BspManager` and the `bsp` command expose a lower-level path that is useful in the developer console and headless runner:

```text
developer 1
bsp load washoi_dm2
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

`BspLoader.load` and `BspMeshBuilder.build` are static. The mesh builder constructor is private. Parsed entities are available as `bsp.entities`.

The result includes the world mesh and mesh/material bookkeeping needed by map cleanup and animation systems. Treat its exact shape as an internal loader contract and import the `BspMeshBuildResult` type when extending it.

## Coordinates

Quake map coordinates are converted to Babylon coordinates by the BSP mesh helpers. Reuse `q3ToBabylonVec3` and the existing winding conversion rather than adding local axis swaps.

## Visibility, lightmaps, and entities

- polygon, patch, mesh, and billboard face types are parsed;
- PVS cluster data enables static-world visibility culling by default on playable map loads;
- IBSP and FBSP lightmap sizes and lightstyles are handled separately;
- worldspawn, spawn points, brush entities, lights, and other supported entities are processed after geometry.

IBSP lightmap pages are 128×128. FBSP defaults to 512×512 when worldspawn has
no `_lightmapImageSize` key; a declared positive power of two selects the authored
page dimensions (including 1024 and 2048). Key lookup is case-insensitive.
Invalid dimensions and incomplete RGB lightmap pages fail loading with a
diagnostic rather than silently splitting or truncating the lighting data.

On an FBSP map with more than one lightmap page, the static world's pages are
the layers of one array texture (deluxe pages a second array), so a texture's
faces on different pages share one mesh and one draw. A face's layer rides in
its lightmap U as `u + 2 × layer` (lightmap U stays inside 0–1), and the baked
lighting plugin samples the layer; Babylon's own lightmap lookup reads a 1×1
white page. Glow-overlay surfaces read the layers the same way. IBSP maps, and
engines without a GPU context, group faces by base texture and lightmap page.

Inline lift/door meshes always group faces by both base texture and lightmap
page. Faces with page-local UV2 coordinates must not share a material across
different lightmap pages. Static and moving BSP surfaces use the same
format-specific upload: FBSP preserves authored bytes; IBSP retains the legacy
gamma/overbright conversion.

### Baked lighting

For FBSP maps, worldspawn's `_lightingIntensity` supplies lightmap gain (default
2). `_ambient` / `ambient` and `_color` / `color` supply ambient compensation;
underscored keys take precedence and names are case-insensitive.
`_lightintensity` is a different compiler key, not an alias. `r_lightmapscale`
multiplies the map gain on load.

Ordinary opaque lightmapped Standard/PBR surfaces use baked light directly,
without a second fallback vertex-RGB or synthetic sun/fill multiplier. Authored
vertex RGB receives Qfusion's map gain and hue normalization; alpha is retained
without that gain. Lightmapped alpha-tested and alpha-blended material stages
share the direct baked-lighting path. Fullbright and custom shader behavior is
retained.
Dynamic game lights remain additive. Gain belongs to each material, so shared
pages cannot receive conflicting PBR/Standard gains.

With paired color/direction pages, `r_deluxe 1` uses baked directions for
normal-map relief, ambient compensation and highlights. `r_deluxe 0` selects
plain baked lighting after a map reload. `glossIntensity` controls RGB specular
strength and `glossExponent` controls the highlight lobe; gloss RGB is not a
roughness map. Both Standard and generated PBR paths support this on WebGL2 and
WebGPU. The translated path uses the primary lightstyle; animated additional
lightstyles are not implemented.

FBSP model lighting decodes 30-byte lightgrid records and the separate uint16
site table. Sample bounds round inward, and invalid sites are omitted with
interpolation weights renormalized. Models/weapons retain their existing artistic
scaling; this is not a complete reproduction of Qfusion's entity lighting.

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

For that single world view, PVS-owned hidden meshes are also removed from
Babylon's active-mesh candidates before readiness and transform evaluation.
The filter preserves source order and keeps meshes with action managers.
Foreign cameras, multiple world views, custom LOD selectors and unknown PVS
clusters use the original candidate list. This does not change the existing
global PVS visibility policy for secondary views. The scene shares one candidate
provider with weapon-camera filtering; disabling PVS or disposing the map
releases its filter without removing a weapon-camera filter. Full-scene loading
readiness checks still include hidden meshes.

Pool owners can call `registerPooledMeshCandidate(mesh)` from
`engine/rendering/PooledMeshCandidates` to exclude that mesh while disabled.
The registry tracks effective enabled-state changes, including parent changes,
and composes with PVS/weapon filters through the shared scene provider. Its
filter is inactive when every registered member is enabled. Source order,
action-manager meshes and custom-LOD fallbacks are preserved; full-scene readiness
and scene membership remain intact. Mesh or scene disposal releases registration,
and the returned function can release it earlier. Gib shards use this policy;
other disabled scene objects retain their existing handling.

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
npx vite-node src/cli/audit-pvs.ts -- washoi_dm2 acidwdm2 wbomb6
```

It verifies authored geometry hashes, reports mesh/triangle counts before frustum culling, and checks moving/stationary autosprite upload counts with PVS on/off. It does not benchmark GPU rendering or load the complete gameplay/material pipeline.

## Headless verification

```bash
npm --prefix src/games/fps run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'
npm --prefix src/games/fps run test:physics
```

## Source of truth

### Collision route comparisons

Sweep collision uses authored BSP collision brushes and tessellated patches.
Planar and triangle-soup draw surfaces do not generate additional colliders;
their shader names and visible corner softening do not define gameplay solidity.
Solid models need collision brushes supplied by the map compiler or mapper.

Dedicated servers use `BspLoader.loadCollision`: it retains authoritative BSP
topology, contents/flags, entities, brush-model records, faces, patch control
positions and PVS. It skips render vertex attributes, mesh indices, effects,
lightmaps and the light grid. Patch controls retain their original vertex
indices; other vertex slots are absent. PVS bytes own a compact buffer so a
small visibility table cannot pin the entire raw BSP. The client continues to
use the full parser. Map extraction uses a temporary PK3 owner and the canonical
index/published-build resolution; unrelated fallback archives are released
between attempts, and extracted map archives can be collected afterward.

Sweep collision retrieves brush/face candidates from BSP leaves touched by the
swept hull. Rendering PVS visibility is not a collision filter. Repeated leaf
references are deduplicated per query, except embedded contacts whose recovery
normal depends on visit order. Static brush queries reject nonoverlapping bounds
before plane tests. The clip-brush fallback uses a spatial index, including
brushes not reached through leaf lists. Bounds are derived from exact axial
collision planes with a numeric margin; missing constraints remain unculled.
Triangle facets have per-surface BVHs built from the same collision-plane
constraints. Partial bounds retain their proven axial sides, leaving uncertain
directions infinite. Facets without any proven bounds remain unconditional
candidates within their surface. Queries retain source ordering. No visual
triangles are simplified by this index.
Patch collision tessellation preserves constant coordinates and shared control
endpoints. Each triangle's bevels enclose its full 0.5-unit backing thickness;
facet planes retain double precision so point traces can hit shared edges and
cap centers. This thickness lies behind the surface normal. It is separate
from the trace's existing 0.03125-unit contact margin.
The sweep backend reuses its candidate and query-bound storage within each
backend instance. Public trace results retain independent position/normal
vectors, and candidate lists are rebuilt for every query rather than cached
across movement frames.
Strictly contained compatible static brushes can skip plane solving when the
hull starts outside their container. The container must be reachable through
the same leaf/fallback paths. Touching or uncertain pairs remain, as do embedded
contacts, ladders and moving models. This does not delete canonical BSP brushes
or alter point-content queries.

The Node benchmark exercises `SweepCollisionBackend` at recorded player positions:

```bash
npx vite-node src/games/fps/cli/benchmark-collision.ts --demo public/data/demos/training/wfdm11_performance_investigation_1.shagdemo --out .cache/collision-baseline.json
npx vite-node src/games/fps/cli/benchmark-collision.ts --baseline .cache/collision-baseline.json --out .cache/collision-candidate.json
```

The default demo is the washoi_dm11 investigation recording. `--stride` defaults to 8;
use 1 for every recorded interval. A baseline comparison checks demo/BSP hashes,
stride, and exact trace/movement results, returning failure on any difference.
The output includes initialization time and median/p95/p99 sampled query-batch
times. This uses recorded displacements, not full movement-input re-simulation,
and does not measure browser FPS or reconciliation cost. Record a reference on
the baseline revision before comparing an implementation.

### Loader sources

- `src/engine/loader/map/MapLoader.ts`
- `src/engine/loader/bsp/BspLoader.ts`
- `src/engine/loader/bsp/BspMeshBuilder.ts`
- `src/engine/loader/bsp/BspManager.ts`
