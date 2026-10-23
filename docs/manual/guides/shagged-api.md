# SHAGGED scripting API

Build Washoi maps from scripts or AI agents: typed edit operations on the SHAGGED map document, then compile, publish and check the result. The same document opens in the in-engine editor. Design and status: `docs/research/SHAGGED_API.md` in the repository.

## Entry points

**CLI**, for scripts and shells. Output is JSON.

```text
npm run shagged -- new map.json --name arena1        # empty document (add --room for the sealed test room)
npm run shagged -- apply map.json ops.json           # apply a batch; --dry-run to preview
npm run shagged -- info map.json --objects           # counts, bounds, every object
npm run shagged -- read map.json                     # complete authoring snapshot
npm run shagged -- query map.json region.json        # paged object/region query
npm run shagged -- health map.json                   # Map Health issues
npm run shagged -- export map.json arena1.map        # deterministic .map source
npm run shagged -- compile map.json --quality fast   # MakeBSP + MakeLight, publish a playable package
npm run shagged -- report map.json                   # health + compile + reachability
npm run shagged -- textures metal floor              # find texture names and image sizes
```

After `compile`, play the map with `map <mapName>` in the game console.

The Washoi Node entry points register the compiler profile from
`src/games/fps/editor/server/FpsCompilerProfile.ts`. It selects `washoi.json`
and supplies the fast/default/release arguments. Engine-only integrations
register their own `GameCompilerProfile` before resolving configuration or
creating jobs; no registered profile means compilation is unavailable.

Published-map reachability is supplied by the selected game through
`GameMapAnalysis`. Washoi registers `FpsMapAnalysis.ts` in its Node editor
composition and retains the existing player flood and bot-navigation checks.
Engine integrations can provide different analyses. With no provider, a report
explicitly marks player analysis unavailable instead of silently passing; direct
compilation remains available with a compiler profile.

Repository-local MakeBSP/MakeLight binaries receive a copy of the tracked
Washoi profile beside their executables, where the native tools resolve it.
External compiler installations must have `makebspdata/washoi.json` beside
each executable as well as in the configured toolchain root. Changing only
the process working directory does not change native profile lookup.

**MCP server**, for AI clients: `npm run shagged:mcp` (stdio). It exposes the same operations and checks as tools, and this guide as resources.

Compile results include `jobId`, `logPath` and `diagnostics` (warning/error counts,
missing-asset count, leak status, native phase and bounded diagnostic samples).
Every job keeps a complete `compile.log` and a durable `job.json` beneath the
configured server jobs directory. `shagged_compile_status {jobId}` reads the job
across MCP sessions; `shagged_compile_log {jobId, offset?, limit?}` reads the full
transcript in byte-range pages, up to 65,536 bytes each. Continue at `nextOffset`
until it reaches `size`. Jobs from before durable logging have no saved status.
Explicit native asset-load failures, errors and leaks block publication even
when a tool exits with code zero. Other warnings remain visible without blocking.

Build reuse requires matching source, quality and an `inputFingerprint` of the
recipe, compiler binaries, profiles, adjacent runtime libraries and compile
media. Generated indexes, managed source/job storage, the loose `maps` output
tree and numbered BSP-only packages are excluded. Numbered packages containing
other assets remain inputs. File contents are hashed; an in-process digest
cache uses size, modification/change timestamps and inode to avoid rereading
unchanged files. Legacy published pointers without a fingerprint rebuild once.
Use CLI `compile ... --force` / `report ... --force`, MCP `force: true`, or HTTP
compile body `force: true` to bypass reuse.

Native compiles sharing a canonical media root are serialized across local
processes, including different maps because the native VFS/cache is shared.
Source saves, MCP edits and publication also use filesystem locks. A live local
owner's lock never expires merely because its compile is long; confirmed dead
local owners are recovered. Ownerless/corrupt locks require inspection rather
than automatic deletion. Media changes during compilation and stale queued
source revisions fail without publishing. Restart old editor/MCP processes to
use this coordination; it is local-machine locking, not a distributed service.

## Inspect and edit a snapshot

`shagged_entity_classes {search?, compilerOnly?}` includes supported baked
authoring entities as well as runtime classes. `compilerOnly: true` filters
to compiler entities; `false` filters to runtime classes. Each result identifies
point versus brush placement, supported keys, defaults and required keys.
`func_group` uses `brushEntity.assign`; its chamfer widths need `default` or
`release` quality because `fast` disables chamfering. Grouping does not disable
collision. `misc_decal` and `misc_text_decal` use `entity.place`; set projection
`angles` (pitch 90 points down), `distance`, and optionally `decalgroup` to
avoid projecting across unwanted surfaces. Text needs a packaged font atlas
descriptor. These classes are recognized by Map Health and shown in the editor
palette/inspector; their projected appearance must be checked after compilation.

Find props with MCP `shagged_models {search?, offset?, limit?, includeBounds?}`
or CLI `npm run shagged -- models lamp --bounds`. All search words must match
the path. Pages default to 50 entries (maximum 500); continue at `nextOffset`
until `total`. Results identify the owning package, or `null` for loose models.
Later alphabetically sorted packages override earlier ones; loose models win.
Use a returned path in `entity.place` with classname `misc_model` and
`keys.model`; `modelscale` is positive uniform scale and `angle` is yaw.
Optional dimensions come from ASE/OBJ vertices or MD3 frame bounds, before
placement transforms. Other formats return `bounds: null` with an explanation.
These envelopes do not describe collision. ASE editor mesh preview remains
unsupported; inspect the compiled BSP and verify prop collision there.

For a compiled reference map, use MCP
`shagged_inspect_installed_map {mapName: "washoi_dm5", search?, offset?, limit?}`
or CLI `npm run shagged -- inspect-bsp washoi_dm5 --limit 100`.
This reads the installed BSP through the game's package index, independently
of managed authoring documents. It returns world bounds in Quake coordinates,
spawn properties, entity-class counts and a used-material palette with face
counts. Material names omit `textures/` for direct authoring use. Search matches
all words; pages default to 100 entries, at most 500. Continue at
`palette.nextOffset` until it reaches `palette.total`. The world envelope includes
scenery and clips: it is not the playable footprint. The data root is the
configured `SHAGGED_PUBLISH_ROOT` (default `public/data`).

`shagged_read_document {mapName}` returns `{ok, document}` with the complete
validated authoring snapshot, including schema/draft identity, revision, world
keys, face materials/alignment, detail flags, patch control points and brush
entity membership. CLI `read` returns the same envelope. `shagged_map_info`
with `objects: true` (CLI `info --objects`) also includes complete object arrays;
without it, inspection stays a compact count/bounds summary.

Use `shagged_query_objects` to inspect a region or a subset without retrieving
the whole document. Its fields, also accepted by CLI `query` in a JSON file:

| Field | Meaning |
| --- | --- |
| `bounds` | Optional `{min:{x,y,z}, max:{x,y,z}}`, Quake coordinates, Z up. |
| `relation` | `intersects` (default, including touching boundaries) or `contained`. |
| `kinds` | Optional array of `brush`, `patch`, `entity`, `brushEntity`, `editorGroup`. |
| `ids` | Optional object-ID filter. |
| `offset`, `limit` | Stable kind/ID ordering; default offset 0, limit 100, maximum limit 500. |

The result includes `revision`, `total`, `nextOffset` (null at the end) and
`objects`, each containing `kind`, `data` and authoring-space `bounds`. Brushes
also include `ownerId` when grouped. Patch control hulls and brush-group bounds
are conservative; point entities use their origins, not model mesh extents.
These queries inspect authored objects, not installed BSP collision or geometry.

Editor groups live in the document's optional `editorGroups` metadata, with
`id`, `name` and leaf `objectIds`. They survive JSON/sidecar saves but are absent
from compiler `.map` source. Passing a group ID to move, duplicate or delete
expands its members; a bare member ID addresses that object individually.
Deleting members prunes groups and drops groups with fewer than two objects.
Duplicating a complete group copies its metadata and any complete compiler
brush entities. Partial API copies remain detached from compiler owners.

When applying edits based on a read, pass `expectedRevision` to `shagged_apply`,
or CLI `apply ... --expected-revision N`. A stale revision is rejected before
editing, including dry runs. Query pages include their revision: restart paging
if the map changes. Read results are detached snapshots and cannot mutate the
managed document.

## Coordinates and IDs

- Quake units, **Z is up**. Never Babylon (Y-up) coordinates.
- Every object has a stable ID. Name objects yourself (`"id": "arena-floor"`) or let the API pick the next free `brush-N`, `ent-N`, `bent-N`. Generated parts derive their IDs from the generator's ID (`west-floor`, `west-east-2`, `west-light`).
- A batch of operations is one all-or-nothing transaction. An error names the failing operation and leaves the map unchanged.

## Operations

### Round patch presets

`patch.round {id?, shape, min, max, axis?, shader?, thickness?, capped?, reverse?, group?}`
creates a `cylinder`, `tube`, `cone` or disk `cap` from world-space bounds.
`axis` defaults to `z`; the other two bounds define an elliptical footprint.
Cylinder/tube/cone depth must be nonzero; a cap lies at `min[axis]` and can have
zero depth. Cones taper toward the higher axis coordinate. Radii must be
positive, and tube `thickness` (default 8 units) must be less than both radii.

`capped` defaults to true. A capped cylinder has three surfaces, a tube four
(outer/inner walls and two annular caps), and a cone two. A disk cap always has
one surface. `reverse` reverses all winding. Components use 9-by-3 quadratic
control grids: circular/elliptical approximations rather than exact rational
circles. Side UVs span 0..1 around/along the surface; cap UVs are planar.

The first surface gets `id`, with `-inner`, `-bottom` and `-top` suffixes as
needed. Multiple surfaces form a named editor group `<id>-group` unless
`group: false`. Conflicting component/group IDs reject the batch. Control
grids remain ordinary editable patches. The document uses height rows of
width controls; `.map` output transposes them into native column-major order.
New exports use that format, while server sidecar recovery also accepts
historical SHAGGED row-order source.

### Convex solids and rotation

`brush.vertices {id, edits: [{index, position: {x,y,z}}, ...]}` changes indexed
vertices in absolute world coordinates, then rebuilds the convex envelope.
Existing hull indices come from the document's `hull.vertices` (normalized
inside its min/max bounds). Boxes use corners 0..3 around the bottom in order
`(minX,minY)`, `(maxX,minY)`, `(maxX,maxY)`, `(minX,maxY)`, then 4..7 at the top.
Faces may split or merge and interior vertices disappear; re-inspect indices
after every edit. The same operation powers the graphical Vertices tool.
Materials inherit from source sides by shared vertices, then normal similarity.
Collapsed geometry, invalid indices, duplicate edits and hull limits reject
the entire batch.

`brush.rotate {id, axis: "x"|"y"|"z", degrees, pivot?}` rotates an existing
brush in Quake space. Positive Z rotation turns +X toward +Y. The default pivot
is the brush's bounds center. A box becomes a convex hull while retaining its
ID, detail flag and brush-entity owner. Face UVs stay attached to the geometry
through rotation; their shift/scale/rotation/skew parameters are recomputed in
the new compiler plane basis.

`gen.prism {id, footprint: [{x,y},...], bottom, top, shader?, detail?, alignment?,
textureSizes?}` extrudes a convex XY polygon between two Z heights. Either
footprint winding is accepted. Supply 3..32 corners without duplicate or
collinear edges. This supports diagonal platforms, triangular prisms and
octagonal reactor bases. Use several convex solids for a concave layout.

`convex.create {id?, vertices: [{x,y,z},...], sides: [{vertices: [0,1,2,...],
material?},...], shader?, detail?, alignment?, textureSizes?}` accepts arbitrary
convex solids, including wedges. Input vertices are absolute Quake coordinates;
each side lists its vertex indices counterclockwise as seen from outside.
The solid must be closed, outward-facing and nonzero in volume, with planar
convex sides. Merge coplanar sides. Limits are 128 vertices and 64 sides.
An optional side `material` has the ordinary face material fields.
`skew` is an optional relative V-axis angle in degrees (default zero), allowing
the affine mapping introduced by non-uniform deformation. Singular skew
values are rejected. `sizeKnown: false` marks locked legacy mappings whose
stored image dimensions are virtual; do not treat those dimensions as asset
metadata. Omit the flag for actual known image sizes.

Brush movement, duplication, rotation and bounds updates lock textures by
default. Bounds resizing stretches the mapping with the geometry. Carving
keeps the existing world-space mapping on the remaining pieces. Vertex edits
retain three stable UV anchors where possible; non-affine polygon changes
can shift other corners. New facets without three independent source UV
anchors retain an inherited mapping anchored at one corner.

Saved brushes retain `min`/`max` and an optional `hull`: its vertices are
normalized to those bounds, and its sides contain indices and materials.
`box.update` bounds therefore resize a hull along world axes; move, duplicate,
delete, ownership, snapshot/query, undo and export retain its geometry. Full
inspection returns the hull; region queries use conservative AABBs.
`face.material` uses zero-based numeric side indices, or `"all"`, for hulls;
axis face names continue to address boxes. Natural creation alignment works
on convex solids and prisms as it does on boxes.

`brush.clip {id, plane: {normal: {x,y,z}, distance}, keep?}` clips a brush
against `normal dot XYZ = distance`. Normal and distance are normalized together.
`keep` is `back` (default, values below the plane), `front` (above), or `both`
(split). Clipping outside the solid can retain or remove the whole brush.

`brush.subtract {ids, cutterId, removeCutter?}` subtracts one box or convex
cutter from explicit target brush IDs. The cutter must not be a target and is
kept unless `removeCutter: true`. Geometry uses the cutter's actual planes,
not its bounding box. Unrelated objects are untouched. `brush.carve` uses a
box cutter against every brush; `gen.connect` uses the same path for doorways,
including convex geometry.

Cuts produce closed convex pieces, retaining surviving face mappings, detail
flags, brush-entity owners and editor group membership. The first piece keeps
the original ID; others use available `<id>-2`, `<id>-3`, etc. Removed brushes
are pruned from owners/groups. New cut faces use the target brush's base shader
and legacy alignment; `brush.clip` and `brush.subtract` accept an optional
`capMaterial` with ordinary face material fields to override that mapping.
Surface indices change after cuts: query them again before face edits.
Each batch is atomic. Collapsed, numerically degenerate or over-limit hulls
reject the batch; this is floating-point authoring geometry, not exact arithmetic.
Patches and model meshes cannot be used as cutters or solid targets.

```json
[
  {"op":"box.create","id":"bridge","min":{"x":-128,"y":-16,"z":32},"max":{"x":128,"y":16,"z":48},"shader":"metal/metalrust_iron6","alignment":"natural"},
  {"op":"brush.rotate","id":"bridge","axis":"z","degrees":45},
  {"op":"gen.prism","id":"platform","footprint":[{"x":-64,"y":-32},{"x":-32,"y":-64},{"x":32,"y":-64},{"x":64,"y":-32},{"x":64,"y":32},{"x":32,"y":64},{"x":-32,"y":64},{"x":-64,"y":32}],"bottom":0,"top":16,"shader":"tiles/concrete_tiles","alignment":"natural"}
]
```

Native non-axis brush collision bevels can use a bare `noshader` placeholder.
That exact compiler warning is retained separately as `compilerPlaceholders`;
the pipeline checks the BSP and blocks publication if any draw surface uses
it. Other missing asset warnings remain fatal.

### Creation alignment

`box.create` and all `gen.*` operations accept `alignment: "natural"` to use
the gamepack's 0.5 world units per image texel. MCP and CLI resolve each
material's image size automatically, including separate room floor/ceiling
materials. A 512-pixel-wide image repeats every 256 world units. Missing image
sizes reject the whole batch instead of silently guessing a scale.

Omitting alignment, or specifying `alignment: "legacy"`, preserves the fixed
32-world-unit repeat used by existing scripts. Natural alignment affects only
the newly generated brushes; `gen.connect` preserves the old walls' alignment
when carving doorways. It stores ordinary per-face materials, so save/export,
movement, duplication and carving retain the result. It does not alter patches
or models. Direct `applyOperations` callers supply
`textureSizes: {"bricks/redbricks_base_01": [512, 512]}` for each non-tool
material. Supplied sizes override discovery; `common/*` tools need no sizes.
Use `face.material` to retexture these faces later: `box.update.shader` changes
the fallback shader, while explicit per-face materials retain precedence.

```json
{"op":"box.create","id":"wall","min":{"x":0,"y":0,"z":0},"max":{"x":256,"y":16,"z":128},"shader":"bricks/redbricks_base_01","alignment":"natural"}
```

Texture search and automatic sizing use `SHAGGED_PUBLISH_ROOT` (default
`public/data`); cached catalogs are kept distinct for different media roots.

| Operation | Fields | Notes |
| --- | --- | --- |
| `world.keys` | `keys` | Merge worldspawn compiler/runtime settings such as `message`, `ambient`, `_color` and `fog`. Values are strings; an empty value removes a key. `classname`, `origin` and `model` are reserved. Quotes and newlines in values are rejected. Map inspection returns `worldKeys`; apply reports `worldChanged`. |
| `box.create` | `id?`, `min`, `max`, `shader?`, `detail?` | Axis-aligned brush. Default shader `common/caulk`. `min` must be below `max` on every axis. `detail: true` exports the Q3 detail content flag. |
| `box.update` | `id`, `min?`, `max?`, `shader?`, `detail?` | Set `detail: false` to restore structural treatment. |
| `patch.create` | `id?`, `shader`, `width`, `height`, `controlPoints` | Quadratic `patchDef2` surface. Width and height must be odd, from 3 through 31. Supply `height` rows of `width` controls, each `{x,y,z,u,v}` in Quake coordinates with texture UVs. Winding follows row/column order; reverse rows to reverse the facing. Shader names have no `textures/` prefix. Patches do not seal the map; use structural brushes. Collision follows compiler/shader rules. |
| `patch.round` | `id?`, `shape`, `min`, `max`, `axis?`, `shader?`, `thickness?`, `capped?`, `reverse?`, `group?` | Cylinder, tube, cone or disk cap presets; multiple surfaces group by default. |
| `face.material` | `id`, `faces` (`"all"`, box face names, or convex numeric side indices), `shader`, `size?` | Textures the listed faces with natural alignment. Name the texture; the CLI and MCP server fill in its image size from the texture catalog. An unknown texture is rejected. |
| `entity.place` | `id?`, `classname`, `origin`, `keys?` | Point entity. Keys are strings. |
| `entity.update` | `id`, `classname?`, `origin?`, `keys?` | Keys merge; an empty string removes a key. |
| `brushEntity.assign` | `id?`, `classname`, `brushIds`, `keys?` | Makes brushes a trigger/door/plat. `trigger_*` brushes get `common/trigger`. Never set `origin` or `model`. |
| `brush.clip` | `id`, `plane`, `keep?`, `capMaterial?` | Keep the front, back (default), or both halves of a box/convex brush. |
| `brush.subtract` | `ids`, `cutterId`, `removeCutter?`, `capMaterial?` | Subtract a box/convex cutter from explicit target brushes. Cutter is kept by default. |
| `editorGroup.create` | `id?`, `objectIds`, `name?` | Saves a flat editor selection of at least two brushes, patches or point entities. Existing member groups merge; compiler ownership is unchanged. |
| `editorGroup.ungroup` | `ids` | Removes editor group metadata by group ID or member ID, keeping its objects. |
| `object.move` | `ids`, `delta` | Brushes, entities (a brush entity moves its brushes), patches and editor groups. Overlapping group/member IDs move each leaf once. |
| `object.duplicate` | `ids`, `delta`, `suffix?` | Copies get `<id>-copy`, `<id>-copy-2`, … |
| `object.delete` | `ids` | Deleting a brush entity's last brush removes the entity. |
| `gen.room` | `id`, `min`, `max`, `wall?` (16), `shader?`, `floorShader?`, `ceilingShader?`, `openings?`, `light?` (300, or `false`) | Hollow room around the **interior** `min`..`max`; `min.z` is the floor surface. Adds a light. |
| `gen.corridor` | `id`, `from`, `to`, `width?` (128), `height?` (128), `wall?`, `shader?`, `light?` (200) | Open-ended corridor between two floor-centre points along x **or** y, at the same z. |
| `gen.connect` | `id`, `from` and `to` (rooms' interiors `{min, max}`), `width?` (128), `height?` (128), `wall?` (16), `offset?`, `shader?`, `light?` (200) | **Joins two rooms** that are apart along x or y, with floors at the same z: cuts a doorway through both walls and builds a sealed corridor between them. `offset` is the corridor's centre across its direction (default: the middle of the rooms' shared span). |
| `gen.stairs` | `id`, `from` (bottom), `to` (top), `width?` (128), `step?` (16, at most 18), `shader?` | Solid steps standing on the floor at `from.z`, rising to `to.z` along x or y. |
| `gen.teleporter` | `id`, `at` (floor point under the trigger), `to` (arrival floor point), `angle?` (degrees, 0 = +X), `size?` (64), `height?` (64) | A `trigger_teleport` brush on the floor and its `misc_teleporter_dest`, already linked. |
| `gen.jumppad` | `id`, `at` (floor point under the pad), `to` (landing floor point), `size?` (64), `height?` (16) | A `trigger_push` brush on the floor and its `target_position`, already linked; the pad throws players to `to`. |
| `brush.carve` | `min`, `max` | Subtracts a box from every box/convex brush it cuts; pieces keep surviving face mappings and owner/group membership. |

**Openings** (`gen.room`): `{ "side": "+X", "min": {...}, "max": {...} }`. The two in-wall axes of `min`/`max` give the hole (for `+X`/`-X`: y and z); the side's own axis is ignored. An opening must stay inside the room's interior span so the corners stay sealed.

**Joining rooms:** use `gen.connect` with the two rooms' interiors; it works out the doorways and the corridor. (`gen.corridor` with hand-made openings also works: the corridor starts at the room wall's **outer** face and the opening equals the corridor's cross-section.)

**Levels:** a ledge up to about 44 units is a hop; anything higher needs `gen.stairs` or `gen.jumppad`. `gen.teleporter` links any two places, even separate sealed rooms. Build a balcony as a box and put stairs against it, with the top step ending at the balcony's edge.

Example: two rooms joined by a corridor, with spawns and a weapon:

```json
[
  { "op": "gen.room", "id": "west", "min": { "x": -512, "y": -192, "z": 0 }, "max": { "x": -128, "y": 192, "z": 256 }, "shader": "concrete/concreteclean" },
  { "op": "gen.room", "id": "east", "min": { "x": 128, "y": -192, "z": 0 }, "max": { "x": 512, "y": 192, "z": 256 }, "shader": "concrete/concreteclean" },
  { "op": "gen.connect", "id": "hall", "shader": "tiles/concrete_tiles",
    "from": { "min": { "x": -512, "y": -192, "z": 0 }, "max": { "x": -128, "y": 192, "z": 256 } },
    "to": { "min": { "x": 128, "y": -192, "z": 0 }, "max": { "x": 512, "y": 192, "z": 256 } } },
  { "op": "entity.place", "id": "spawn-west", "classname": "info_player_deathmatch", "origin": { "x": -400, "y": 0, "z": 24 } },
  { "op": "entity.place", "id": "spawn-east", "classname": "info_player_deathmatch", "origin": { "x": 400, "y": 0, "z": 24 }, "keys": { "angle": "180" } },
  { "op": "entity.place", "id": "rl", "classname": "weapon_rocketlauncher", "origin": { "x": 320, "y": 128, "z": 16 } }
]
```

## Mapping rules

**The player** (from the game's movement constants):

- The player box is 32 × 32 units and 56 tall (32 crouched). Give corridors at least 96 × 96 of clear space; 128 is comfortable to fight in.
- A step is at most 18 units. A standing jump rises about 51 units, but `report` counts a ledge as a hop only up to 45 units: keep hop ledges at 44 or lower, and use stairs, a jump pad or a teleporter above that.
- Ground speed is 280 units per second (400 sprinting forward): a 1,024-unit room takes three to four seconds to cross.

**Geometry and compiling:**

- Build on an 8- or 16-unit grid. Brushes must not overlap in volume; let them meet face to face.
- The playable space must be **sealed**: no gap from inside to the void, or the compile's leak test fails. `gen.room` and `gen.corridor` are sealed by construction when joined as described above.
- Caulk first: give faces nobody sees `common/caulk`, then texture visible faces.
  Caulk is also the default, as in NetRadiant: every operation's `shader?`
  falls back to `common/caulk`, which seals and collides but is never drawn. A
  room built without a `shader` is invisible in game.
- Shader names have no `textures/` prefix (`concrete/concreteclean`, not `textures/concrete/concreteclean`).
- Give every room a light. An unlit compiled room is black.

**Textures:** find names with `textures` (CLI) or `shagged_textures` (MCP); they search names and tags like the editor's texture browser and list each texture's image size. A brush's `shader` applies to all its faces; `face.material` overrides single faces. Typical flow: build with a wall texture, then `face.material` with `"faces": "all"` and `common/caulk` on brushes the player never sees from outside, then texture the faces facing the room.

**Gameplay:**

- At least one `info_player_deathmatch`, with `z` 24 or more above the floor. For free-for-all, several spread apart without direct line of sight between them; set `angle` to face into the room.
- Every spawn should reach every weapon and item, and every other spawn: `report` checks this.
- Teleporters and jump pads need a destination: the trigger's `target` equals the destination's `targetname`. `gen.teleporter` and `gen.jumppad` link them for you.

**Performance:**

- Use `detail: true` for trim, railings, service fixtures and other decorative brushes that should not split the visibility tree. Detail brushes cannot seal the map; keep the enclosing shell structural. Detail is not nonsolid: collision still follows the material's contents.

- Frame time grows with draw calls. Prefer fewer, larger brushes; avoid many small detail brushes in view at once.
- Let the visibility data cull: join rooms with bends and doorways rather than building one big open space.

## The report

`report` returns one JSON verdict with `ok` and four sections:

- `health`: Map Health issues (missing spawns or required keys, broken target links, unknown classes, unknown shaders or shaders without an image), each with the object's ID.
- `compile`: build state, `leak`, the published package, input fingerprint, diagnostics and log access. Matching source and build inputs reuse the last build (`reused: true`).
- `reachability`: where a **player** can go in the compiled map, found by flooding it with the game's own movement from every spawn (walking, stairs, drops, hops up to jump height, teleporters and jump pads). `unreachableItems` and `cutOffSpawns` list problems in Quake coordinates with the matching editor `objectId`. This decides `ok`.
- `botNavigation`: the same question for the bots' navigation graph. Bots can't plan over everything a player can (stairs in particular), so a map can pass `reachability` and still list items here that bots won't go for.

Fix what it reports and run it again.
