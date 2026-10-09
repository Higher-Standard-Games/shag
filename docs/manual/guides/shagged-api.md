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
```

After `compile`, play the map with `map <mapName>` in the game console.

**MCP server**, for AI clients: `npm run shagged:mcp` (stdio). It exposes the same operations and checks as tools, and this guide as resources.

## Coordinates and IDs

- Quake units, **Z is up**. Never Babylon (Y-up) coordinates.
- Every object has a stable ID. Name objects yourself (`"id": "arena-floor"`) or let the API pick the next free `brush-N`, `ent-N`, `bent-N`. Generated parts derive their IDs from the generator's ID (`west-floor`, `west-east-2`, `west-light`).
- A batch of operations is one all-or-nothing transaction. An error names the failing operation and leaves the map unchanged.

## Operations

| Operation | Fields | Notes |
| --- | --- | --- |
| `box.create` | `id?`, `min`, `max`, `shader?` | Axis-aligned brush. Default shader `blx/blx_grid`. `min` must be below `max` on every axis. |
| `box.update` | `id`, `min?`, `max?`, `shader?` | |
| `face.material` | `id`, `faces` (`"all"` or a list of `+X -X +Y -Y +Z -Z`), `shader`, `size?` | `size` is the image size in texels, required except for `common/*` tool shaders. |
| `entity.place` | `id?`, `classname`, `origin`, `keys?` | Point entity. Keys are strings. |
| `entity.update` | `id`, `classname?`, `origin?`, `keys?` | Keys merge; an empty string removes a key. |
| `brushEntity.assign` | `id?`, `classname`, `brushIds`, `keys?` | Makes brushes a trigger/door/plat. `trigger_*` brushes get `common/trigger`. Never set `origin` or `model`. |
| `object.move` | `ids`, `delta` | Brushes, entities (a brush entity moves its brushes), patches. |
| `object.duplicate` | `ids`, `delta`, `suffix?` | Copies get `<id>-copy`, `<id>-copy-2`, … |
| `object.delete` | `ids` | Deleting a brush entity's last brush removes the entity. |
| `gen.room` | `id`, `min`, `max`, `wall?` (16), `shader?`, `floorShader?`, `ceilingShader?`, `openings?`, `light?` (300, or `false`) | Hollow room around the **interior** `min`..`max`; `min.z` is the floor surface. Adds a light. |
| `gen.corridor` | `id`, `from`, `to`, `width?` (128), `height?` (128), `wall?`, `shader?`, `light?` (200) | Open-ended corridor between two floor-centre points along x **or** y, at the same z. |

**Openings** (`gen.room`): `{ "side": "+X", "min": {...}, "max": {...} }`. The two in-wall axes of `min`/`max` give the hole (for `+X`/`-X`: y and z); the side's own axis is ignored. An opening must stay inside the room's interior span so the corners stay sealed.

**Joining a room and a corridor:** give the room an opening equal to the corridor's interior cross-section, and start the corridor at the room wall's **outer** face. Example: a room with interior `max.x = -128` and walls 16 thick has its outer east face at `x = -112`; a corridor from `x = -112` with width 128 at `y = 0` needs an opening `y -64..64`, `z 0..128` on `+X`.

Example: two rooms joined by a corridor, with spawns and a weapon:

```json
[
  { "op": "gen.room", "id": "west", "min": { "x": -512, "y": -192, "z": 0 }, "max": { "x": -128, "y": 192, "z": 256 },
    "openings": [{ "side": "+X", "min": { "x": 0, "y": -64, "z": 0 }, "max": { "x": 0, "y": 64, "z": 128 } }] },
  { "op": "gen.room", "id": "east", "min": { "x": 128, "y": -192, "z": 0 }, "max": { "x": 512, "y": 192, "z": 256 },
    "openings": [{ "side": "-X", "min": { "x": 0, "y": -64, "z": 0 }, "max": { "x": 0, "y": 64, "z": 128 } }] },
  { "op": "gen.corridor", "id": "hall", "from": { "x": -112, "y": 0, "z": 0 }, "to": { "x": 112, "y": 0, "z": 0 } },
  { "op": "entity.place", "id": "spawn-west", "classname": "info_player_deathmatch", "origin": { "x": -400, "y": 0, "z": 24 } },
  { "op": "entity.place", "id": "spawn-east", "classname": "info_player_deathmatch", "origin": { "x": 400, "y": 0, "z": 24 }, "keys": { "angle": "180" } },
  { "op": "entity.place", "id": "rl", "classname": "weapon_rocketlauncher", "origin": { "x": 320, "y": 128, "z": 16 } }
]
```

## Mapping rules

**The player** (from the game's movement constants):

- The player box is 30 × 30 units and 64 tall (32 crouched). Give corridors at least 96 × 96 of clear space; 128 is comfortable to fight in.
- A step is at most 18 units. A standing jump rises about 45 units: a 32-unit ledge is a hop; anything over about 44 needs stairs, a jump pad or a teleporter.
- Run speed is 320 units per second: a 1,024-unit room takes about three seconds to cross.

**Geometry and compiling:**

- Build on an 8- or 16-unit grid. Brushes must not overlap in volume; let them meet face to face.
- The playable space must be **sealed**: no gap from inside to the void, or the compile's leak test fails. `gen.room` and `gen.corridor` are sealed by construction when joined as described above.
- Caulk first: give faces nobody sees `common/caulk`, then texture visible faces.
- Shader names have no `textures/` prefix (`blx/blx_dark`, not `textures/blx/blx_dark`).
- Give every room a light. An unlit compiled room is black.

**Gameplay:**

- At least one `info_player_deathmatch`, with `z` 24 or more above the floor. For free-for-all, several spread apart without direct line of sight between them; set `angle` to face into the room.
- Every spawn should reach every weapon and item, and every other spawn: `report` checks this.
- Teleporters and jump pads need a destination: the trigger's `target` equals the destination's `targetname`.

**Performance:**

- Frame time grows with draw calls. Prefer fewer, larger brushes; avoid many small detail brushes in view at once.
- Let the visibility data cull: join rooms with bends and doorways rather than building one big open space.

## The report

`report` returns one JSON verdict with `ok` and three sections:

- `health`: Map Health issues (missing spawns or required keys, broken target links, unknown classes or shaders), each with the object's ID.
- `compile`: build state, `leak`, the published package and a log tail. An unchanged map reuses its last build (`reused: true`).
- `reachability`: from the bots' navigation graph of the compiled map. `unreachableItems` and `cutOffSpawns` list problems in Quake coordinates with the matching editor `objectId`.

Fix what it reports and run it again.
