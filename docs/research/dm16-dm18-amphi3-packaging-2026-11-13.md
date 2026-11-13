# Packaging washoi_dm16, washoi_dm17, washoi_dm18 and washoi_amphi3

November 13, 2026. Four maps compiled from the Warfork map sources and added
to the map pools.

| Release ID | Source | Title | Pools |
| --- | --- | --- | --- |
| `washoi_dm16` | `wswmaps/wdm16.map` | The Deepest Underground | FFA |
| `washoi_dm17` | `wswmaps/wdm17.map` | Le Toxiquet | Duel, FFA |
| `washoi_dm18` | `wswmaps/wdm18.map` | Praxtor | FFA |
| `washoi_amphi3` | `wswmaps/wda2.map` | Melee | Amphi |

Warfork ships these as `wfdm16`-`wfdm18` and `wfda2` in
`warfork-qfusion/assets/data1_21pure/maps/`. Those BSPs are q3map2 builds from
the 2015 Warsow release (`_q3map2_version` 2.5.17), unchanged since Warfork's
2022 asset import, and predate the October 2026 model and teleporter updates in
`warfork-maps`. All four are compiled here from the current sources, as Amphi2,
Depot and DM12 were ([earlier packaging](amphi2-snd6-packaging-2026-11-02.md)).

## Inputs

- `warfork-maps` at `4067818bb3225062a389eafa49819bcb8fe21dae` (clean). The four
  `.map` files are byte-identical at `00bf74a` (SHA-256: wdm16 `42a3ce1c…`,
  wdm17 `57451dc3…`, wdm18 `66a4809c…`, wda2 `63a23927…`).
- `warfork-qfusion` at `d931ca061c39e6a39ab7f3a17cb159e48101ed7b` (clean):
  `assets/data0_21` and `assets/data0_21pure`, packed as stored PK3s.
- `public/data/washoi_textures.pk3` before the merge (SHA-256 `10f5fc08…`,
  backed up in `archive/media/map-texture-merge/`).

The build is isolated in `.cache/map-build-2026-11b/` (ignored). Upstream files
are not edited. The staged sources, with the models they place, are in
`~/Desktop/washoi-maps` as `maps/washoi_*.map` (166 new model files; see its
`SOURCES.json` and README).

## Staging fixes

| Map | Source | Used instead |
| --- | --- | --- |
| wdm16 | 31 models placed as `maps/model_*.ase` (its readme's Radiant layout) | `models/mapobjects/wdm16/model_*.ase` |
| wdm18 | `models/mapobjects/teleporter/tteleporter_01_a.obj` | `teleporter_01_a.obj` |
| all | no lightmap or grid keys | `_lightmapImageSize 2048`, `gridsize 64 64 64` |

Collision follows q3map2's rule, as for the earlier maps: every `misc_model`
without spawnflag 2 has `"collisiontype" "none"` (121 in wdm16, 172 in wdm17, all
64 in wdm18 and all 148 in wda2). The solid ones (wdm16: five handrails, five
wall pieces, the rock roof, a pipe corner and a wall light; wdm17: four
handrails, a plate, two stair pieces, a wall stripe and `m_doorway4`) have
`"collisiontype" "extrude"`, per-triangle collision, because a convex hull
around a doorway or handrail fills the space it frames.

DM17's barrels (`wdm17/m_barrel1-3.ase`) name `textures/metal/orangewall_vertex`,
which no media set defines. `config/map-material-aliases.shader` defines it with
Warfork's `orangewall` colour, normal and gloss images.

## Compile

`makebsp.exe -game washoi -threads 12 -leaktest -samplesize 4 -lightmapimagesize 2048`,
then `makelight.exe -game washoi -threads 12`, full lighting.

| BSP | Bytes | Time | Faces | Vertices | Lightmaps | PVS clusters |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `washoi_dm16` | 31,802,240 | 145 s | 1,083 | 56,094 | 2 × 2048 | 571 |
| `washoi_dm17` | 37,080,940 | 248 s | 1,450 | 106,509 | 2 × 2048 | 554 |
| `washoi_dm18` | 28,787,036 | 69 s | 782 | 35,381 | 2 × 2048 | 296 |
| `washoi_amphi3` | 31,523,972 | 153 s | 1,014 | 64,578 | 2 × 2048 | 439 |

No model or material is missing. The logs warn about the compiler helpers
`noshader` and `tag_light`, one areaportal in wdm16 that does not touch two
areas, and lights in wdm16 and wdm17 whose `target` names no entity.

## Map entities

**DM16's doors.** Six `func_door` halves in three split doors (`angle` -1 and
-2), all lifts the shared `LiftSystem` already simulates. Doors 1 and 2 open
from `trigger_multiple` volumes across their doorways. Door 3 opens from two
thin `trigger_multiple` volumes under its corner buttons, or from its
`func_button` (`health 1`, `angle -2`, `speed 1000`): two panels either side of
the door, in one entity whose bounding box spans the doorway. In Warsow a
button with `health` fires only when damaged. The lift code had treated every
`func_button` as a touch volume over its bounding box, which on DM16 would
have opened door 3 for anyone walking up to it, and nothing drew or collided
with button brushes. No map shipped before has a `func_button`.

Buttons now follow Warsow (`g_func.cpp`): see the engine's BSP guide. A direct
hit must land on one of the button's brushes (boxes from their axial planes),
so a shot at the door between the panels does nothing; splash uses the
bounding box, as `G_RadiusDamage` does. The press is derived from the caller
cooldown already serialized in `lift_state`, so the snapshot and demo formats
are unchanged. DM16's button brushes are all `common/nodraw`: the visible
buttons are the static `model_buttoncorner.ase` models, so nothing is drawn
for the button and nothing visibly presses in, as in Warsow. There is no `sounds/movers/button` in Washoi's sound pack; a
button plays only its `noise` key.

**Particles.** wda2 has seven `misc_particles` smoke emitters behind its glass
(`gfx/misc/smokepuff`, spherical and expanding, 6 a second for 3 s), and wdm17
three bubbles over its slime (`gfx/misc/toxicbubble`, shrinking, 1 a second for
10 s, standing still because `speed 0.25` truncates to 0). Amphi2 has five
smoke emitters that drew nothing. `MapParticles.ts` draws them, and the
map-media packager now collects `shaderName`, so the images and the
`alphaBlendedPuff_Template` shader ship in the map banks. Amphi2's texture bank
was rebuilt to add `gfx/misc/smokepuff`; its map package is unchanged.

**Jump pads.** A player hull flown along each `trigger_push` arc reaches its
target on all four maps, except DM18's `target_location3`, which clips a caulk
ledge at Q3 (112, -1152, 99) 0.37 s into its 0.62 s arc. Warfork's 2015 build
gives the same result, so it is authored.

**Easter egg.** wdm17 carries `textures/decals/wdm17easteregg.tga`, a mapper
poster with photographs ("Crizis and 36 in Le Unmappable"). It is kept as
authored.

## Packages

The levelshots are Warfork's 1024 × 1024 `levelshots/wf*.png` under the release
names, stand-ins until owner screenshots replace them. The merge into the
master adds no conflicts. 52 new images are classified in
`config/map-texture-encoding.json` (23 colour, 11 normal, 9 gloss, 9 alpha);
every existing entry and its order are kept.

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| `map_washoi_dm16.pk3` | 12,983,334 | `11f28c2e2db49821e70b03fdd0b0b2b67bce91d9926d22d211df3974b49fb0f0` |
| `tex_washoi_dm16.pk3` | 4,786,859 | `cdb950a18e6c037420720013caecc62c862a63cbb2f032f8aecedc0bd999d804` |
| `map_washoi_dm17.pk3` | 14,672,527 | `9ccd48b656f38571485e4e24b43997d1fb0f2ed6a3ebae5f30db55379888e0d4` |
| `tex_washoi_dm17.pk3` | 6,732,420 | `f73de7ee9f24920ce70cb57e7fc5da20522011a820112e436f2512f8bfa95195` |
| `map_washoi_dm18.pk3` | 7,985,905 | `b8f6d2ba725a199c524fd1c850681d3f9645ba8e00e23f029b1da64b87c77a4e` |
| `tex_washoi_dm18.pk3` | 2,818,963 | `fd707d8c97bddc2ad092c726a48095b67749ddbc6e926c517255502dde68693a` |
| `map_washoi_amphi3.pk3` | 11,909,830 | `aa6f2ec6e9e5e2831a2da9ea0026b48c86578d980a69591025f4426b71b3e361` |
| `tex_washoi_amphi3.pk3` | 5,006,404 | `5746e0c6da10a0e7c75af7f37978c6fb551cefd707755e15063d374a4c35a3f2` |
| `tex_washoi_amphi2.pk3` | 6,258,635 | `7943f88c28565117e2ff947d33b453e962eb7f05005ac3979a6a03febffdd759` |
| `washoi_textures.pk3` | 203,429,127 | `1f018fccc6c84b30d041477166a1fc77d3eb0a47c6ceab6fbf238d8940ca9585` |

The replaced Amphi2 bank is in `archive/media/map-backups/`.

## Validation

- `cli:game` loads all four through the index (`bsp load`, `bsp info`).
- The real lobby configuration offers DM16, DM17 and DM18 for FFA, DM17 for
  Duel and Amphi3 for Amphi. Bot vision reports DM16 11 spawns and 36
  pickups, DM17 9 and 21, DM18 17 and 35, Amphi3 8 and 31.
- On DM16's real BSP and collision: standing at door 3 leaves it shut; a trace
  at a button panel stops on the panel and its impact opens both halves and
  presses the button 24 units; a shot at the door itself does nothing.
- Browser, headless Edge on WebGL2, through a scratch lobby (`map <id> <mode>`):
  no errors and no failed request on DM16, DM17, Amphi3 or Amphi2. Live sprite
  counts match the emitter rates: DM17 3 emitters and 30 bubbles, Amphi3 7 and
  119 puffs, Amphi2 5 and 73. Screenshots of the emitters were not obtained:
  the game's frame path ignored the probe's camera.
- KTX2: 60 sidecars encoded; all 1,237 are current.

Not yet played: matches on any of the four, bots on them (no learned routes
in `config/bot-routes/`), and the smoke and bubbles judged by eye.
