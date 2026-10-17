# SHAGGED scripting API

Build Washoi maps from scripts or AI agents: typed edit operations on the SHAGGED map document, then compile, publish and check the result. The same document opens in the in-engine editor. Design and status: `docs/research/SHAGGED_API.md` in the repository.

## Entry points

**CLI**, for scripts and shells. Output is JSON.

```text
npm run shagged -- new map.json --name arena1        # empty document (add --room for the sealed test room)
npm run shagged -- apply map.json ops.json           # apply a batch; --dry-run to preview
npm run shagged -- info map.json --objects           # counts, bounds, every object
npm run shagged -- health map.json                   # Map Health issues
npm run shagged -- export map.json arena1.map        # deterministic .map source
npm run shagged -- compile map.json --quality fast   # MakeBSP + MakeLight, publish a playable package
npm run shagged -- report map.json                   # health + compile + reachability
npm run shagged -- textures metal floor              # find texture names and image sizes
```

After `compile`, play the map with `map <mapName>` in the game console.

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

## Coordinates and IDs

- Quake units, **Z is up**. Never Babylon (Y-up) coordinates.
- Every object has a stable ID. Name objects yourself (`"id": "arena-floor"`) or let the API pick the next free `brush-N`, `ent-N`, `bent-N`. Generated parts derive their IDs from the generator's ID (`west-floor`, `west-east-2`, `west-light`).
- A batch of operations is one all-or-nothing transaction. An error names the failing operation and leaves the map unchanged.

## Operations

| Operation | Fields | Notes |
| --- | --- | --- |
| `world.keys` | `keys` | Merge worldspawn compiler/runtime settings such as `message`, `ambient`, `_color` and `fog`. Values are strings; an empty value removes a key. `classname`, `origin` and `model` are reserved. Quotes and newlines in values are rejected. Map inspection returns `worldKeys`; apply reports `worldChanged`. |
| `box.create` | `id?`, `min`, `max`, `shader?`, `detail?` | Axis-aligned brush. Default shader `blx/blx_grid`. `min` must be below `max` on every axis. `detail: true` exports the Q3 detail content flag. |
| `box.update` | `id`, `min?`, `max?`, `shader?`, `detail?` | Set `detail: false` to restore structural treatment. |
| `patch.create` | `id?`, `shader`, `width`, `height`, `controlPoints` | Quadratic `patchDef2` surface. Width and height must be odd, from 3 through 31. Supply `height` rows of `width` controls, each `{x,y,z,u,v}` in Quake coordinates with texture UVs. Winding follows row/column order; reverse rows to reverse the facing. Shader names have no `textures/` prefix. Patches do not seal the map; use structural brushes. Collision follows compiler/shader rules. |
| `face.material` | `id`, `faces` (`"all"` or a list of `+X -X +Y -Y +Z -Z`), `shader`, `size?` | Textures the listed faces with natural alignment. Name the texture; the CLI and MCP server fill in its image size from the texture catalog. An unknown texture is rejected. |
| `entity.place` | `id?`, `classname`, `origin`, `keys?` | Point entity. Keys are strings. |
| `entity.update` | `id`, `classname?`, `origin?`, `keys?` | Keys merge; an empty string removes a key. |
| `brushEntity.assign` | `id?`, `classname`, `brushIds`, `keys?` | Makes brushes a trigger/door/plat. `trigger_*` brushes get `common/trigger`. Never set `origin` or `model`. |
| `object.move` | `ids`, `delta` | Brushes, entities (a brush entity moves its brushes), patches. |
| `object.duplicate` | `ids`, `delta`, `suffix?` | Copies get `<id>-copy`, `<id>-copy-2`, … |
| `object.delete` | `ids` | Deleting a brush entity's last brush removes the entity. |
| `gen.room` | `id`, `min`, `max`, `wall?` (16), `shader?`, `floorShader?`, `ceilingShader?`, `openings?`, `light?` (300, or `false`) | Hollow room around the **interior** `min`..`max`; `min.z` is the floor surface. Adds a light. |
| `gen.corridor` | `id`, `from`, `to`, `width?` (128), `height?` (128), `wall?`, `shader?`, `light?` (200) | Open-ended corridor between two floor-centre points along x **or** y, at the same z. |
| `gen.connect` | `id`, `from` and `to` (rooms' interiors `{min, max}`), `width?` (128), `height?` (128), `wall?` (16), `offset?`, `shader?`, `light?` (200) | **Joins two rooms** that are apart along x or y, with floors at the same z: cuts a doorway through both walls and builds a sealed corridor between them. `offset` is the corridor's centre across its direction (default: the middle of the rooms' shared span). |
| `gen.stairs` | `id`, `from` (bottom), `to` (top), `width?` (128), `step?` (16, at most 18), `shader?` | Solid steps standing on the floor at `from.z`, rising to `to.z` along x or y. |
| `gen.teleporter` | `id`, `at` (floor point under the trigger), `to` (arrival floor point), `angle?` (degrees, 0 = +X), `size?` (64), `height?` (64) | A `trigger_teleport` brush on the floor and its `misc_teleporter_dest`, already linked. |
| `gen.jumppad` | `id`, `at` (floor point under the pad), `to` (landing floor point), `size?` (64), `height?` (16) | A `trigger_push` brush on the floor and its `target_position`, already linked; the pad throws players to `to`. |
| `brush.carve` | `min`, `max` | Subtracts a box from every brush it cuts; the pieces keep their material and brush-entity owner. |

**Openings** (`gen.room`): `{ "side": "+X", "min": {...}, "max": {...} }`. The two in-wall axes of `min`/`max` give the hole (for `+X`/`-X`: y and z); the side's own axis is ignored. An opening must stay inside the room's interior span so the corners stay sealed.

**Joining rooms:** use `gen.connect` with the two rooms' interiors; it works out the doorways and the corridor. (`gen.corridor` with hand-made openings also works: the corridor starts at the room wall's **outer** face and the opening equals the corridor's cross-section.)

**Levels:** a ledge up to about 44 units is a hop; anything higher needs `gen.stairs` or `gen.jumppad`. `gen.teleporter` links any two places, even separate sealed rooms. Build a balcony as a box and put stairs against it, with the top step ending at the balcony's edge.

Example: two rooms joined by a corridor, with spawns and a weapon:

```json
[
  { "op": "gen.room", "id": "west", "min": { "x": -512, "y": -192, "z": 0 }, "max": { "x": -128, "y": 192, "z": 256 } },
  { "op": "gen.room", "id": "east", "min": { "x": 128, "y": -192, "z": 0 }, "max": { "x": 512, "y": 192, "z": 256 } },
  { "op": "gen.connect", "id": "hall",
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
- Shader names have no `textures/` prefix (`blx/blx_dark`, not `textures/blx/blx_dark`).
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
- `compile`: build state, `leak`, the published package and a log tail. An unchanged map reuses its last build (`reused: true`).
- `reachability`: where a **player** can go in the compiled map, found by flooding it with the game's own movement from every spawn (walking, stairs, drops, hops up to jump height, teleporters and jump pads). `unreachableItems` and `cutOffSpawns` list problems in Quake coordinates with the matching editor `objectId`. This decides `ok`.
- `botNavigation`: the same question for the bots' navigation graph. Bots can't plan over everything a player can (stairs in particular), so a map can pass `reachability` and still list items here that bots won't go for.

Fix what it reports and run it again.
