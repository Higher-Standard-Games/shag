# Packaging washoi_amphi2 and washoi_snd6

November 2, 2026. Two maps compiled from the Warfork map sources and added to
the map pools:

| Release ID | Source | Title | Pool |
| --- | --- | --- | --- |
| `washoi_amphi2` | `wswmaps/wda5.map` | Octagon Obsession | Amphi |
| `washoi_snd6` | `wswmaps/wbomb6.map` | Depot | S&D |

Warfork ships Depot as `wfbomb6`. Its ready-built `wfbomb6.bsp` in
`warfork-qfusion/assets/data1_21pure/maps/` is 38,140,400 bytes, the same size
as Warsow's 2015 `wbomb6.bsp`: the old build, without the 2026 model and light
changes in `warfork-maps`. There is no build by Jal for either map, so both are
compiled here from the current sources.

## Inputs

- `C:/Users/sundf/Desktop/warfork-maps` at `00bf74a72c6a66561e07571c59b4ca99850279fa`
  (clean): `wswmaps/wda5.map` (SHA-256 `d77073f8…`), `wswmaps/wbomb6.map`
  (`715641ef…`), `models/` and `prefabs/`.
- `C:/Users/sundf/Desktop/warfork-qfusion` at
  `54810ef794a6a80d01c7ec679da31fba47b6e1c1` (clean): `assets/data0_21`
  (textures) and `assets/data0_21pure` (shaders, models).
- `public/data/washoi_textures.pk3` as it stood before the merge (SHA-256
  `52fa16e0…`, backed up in `archive/media/map-texture-merge/`).
- `wda5_WallPipe.ase` (SHA-256 `e60d18e4…`, dated 2013) from the inner
  `Desktop/rapid.tar/rapid.tar`, at `rapid/game/base/models/mapobjects/wda5/`.
  The map places it nine times; it is the one wda5 model missing from
  `warfork-maps`.

The build is isolated in `.cache/map-build-2026-11/` (ignored): copies of the
compiler (`tools/makebsp`, with `editor/makebspdata/washoi.json`), the media
above packed as PK3s, and staged copies of the two maps. Upstream files are not
edited.

## Staging fixes

Stale names in the sources, corrected in the staged copies:

| Map | Where | Source name | Used instead |
| --- | --- | --- | --- |
| wda5 | 69 brush faces | `refly/Bricks_Refly_DarkGrey1` | `refly_bricks/Bricks_Refly_DarkGrey1` (the 2016 build's name) |
| wda5 | `wda5_BlueSmallSign.ase` | `textures/billboard_001/bulletsblue2` | `textures/billboard/bulletsblue2` |
| wbomb6 | `city/light_street_2way_2.ase` | `textures/halo_large` | `halo_large` (the shader in `flareshalos.shader`) |
| wbomb6 | One visible end cap of a plate strip at (2032–2096, 4064, 416–480) | `dev/vertical_orange` | `exwsw/eX_rplates_01`, the strip's own material |

Both maps also get the worldspawn keys of Jal's dm7 and dm14 builds:
`_lightmapImageSize 2048` and `gridsize 64 64 64`. The remaining `dev/vertical_*`
faces in wbomb6 are hidden and draw nothing.

### Model collision

Both maps were made for q3map2, where a `misc_model` has collision only with
spawnflag 2 (or a `q3map_clipModel` material, which no Warsow or Warfork model
material has); the mapper's `fullclip` and `playerclip` brushes do the rest.
MakeBSP makes every model solid by default, wrapping each in convex hulls. The
first builds added 2,606 hull brushes to Depot, and one closed Amphi2's tower
jump pad: the pipes crossing above the shaft became one hull, a
slab at z 324–348 inside the pad's trigger. Maps Warfork's mappers have
reworked for MakeBSP mark models `"collisiontype" "none"` (89 of 180 in
wfbomb1, 117 of 183 in wfdm11); these two never had that pass.

Each staged `misc_model` without spawnflag 2 now has `"collisiontype" "none"`:
169 of 171 in wda5, 417 of 422 in wbomb6. That is q3map2's rule, so collision is
the original's: Depot's clip brushes are the same 334 `fullclip` and 69
`playerclip` brushes as Warsow's 2015 build, which made its crates and props
solid. Flying a player hull along each jump pad's launch arc
(`.cache/map-build-2026-11/padtrace.ts`, the movement code's AimAtTarget
solution through `SweepCollisionBackend`) reaches every target on both maps.

### Signs

- **The Warfork board.** Warfork's `textures/billboard/bulletsblue2.png` is a
  Warfork logo. It is now a Washoi ammo sign (`assets/billboards/bulletsblue2.png`),
  drawn inside the part of the image the sign model shows (u 0.125–0.875,
  v 0.25–0.75).
- **The "WF" neon.** `textures/billboard/jujitsu_sign` animates
  `textures/neon/jujitsu_sign1-5.png`, five frames that light one more red "WF"
  each second. The frames now spell W, WA, WAS, WASH, then WASHOI in the same red
  (`assets/billboards/amphi2_neon1-5.png`). Amphi1 uses the same sign.
- **The slim neon advert.** `wsw_adverts/tech_add_1_b.ase`, squeezed by
  `modelscale_vec 0.16 0.5 0.5`, shows only u 0.53–0.93 of
  `textures/billboard/neon1`: the column where Warsow's art had its sign. The
  Washoi `neon1` (DM5's, which maps it differently) was cut off there. Amphi2
  places `wda5/wda5_washoi_neon.ase` instead: the same model, its sign naming
  `textures/billboard/neon1_tall` with UVs spanning the whole image, a 128 × 1024
  Washoi neon for its 36 × 292 unit face.

### Dirt decals drawn opaque

Depot's tower showed its `textures/decals/dirt_02` decal as solid olive panels.
The decal's script is `template template_Dirt 02` after its surface flags.
`Q3ShaderParser` expanded a template only when it was the first line of a body
and its name ended in `_template`; `template_Dirt` met neither, so the decal had
no stages and drew its image opaque. `dirt_02.tga` is olive (mean RGB 95, 101,
63) and mostly transparent (mean alpha 38).

The parser now follows Warsow: any shader can serve as a template, and a
`template <name> <args...>` line expands where it stands among the shader's own
directives, its arguments ending with the line (templates that use templates
expand up to four levels). The master's dirt decals keep Warsow's text, and
`dirt_02` parses as one alpha-blended stage: the browser shows the grime streaks
over the plaster.

### KTX2 sidecars

`ktx2cache/` sidecars load before a bank's WebP. The cache held sidecars of
Warsow's "WF" neon frames, so the new frames did not show: their five entries
are removed from `ktx2cache/manifest.json` (originals in
`archive/media/ktx2-stale/`). `npm run tools:textures:audit` reports 759 of
1,030 sidecars current and 271 to encode, the new maps' textures among them;
`npm run tools:textures` needs KTX-Software 5.x, which is not installed here.
Until then those textures load as WebP.

`scripts/render-billboards.ps1` draws `neon1_tall.png`;
`scripts/render-amphi2-branding.ps1` draws the ammo sign and the five neon
frames. All seven are entries in `config/billboard-package.json`, applied to the
master with `npm run tools:branding`; `neon1_tall` and its shader were added to
the master first, since that command replaces existing images only.

## Compile

From the staged `toolchain/` directory, with forward-slash absolute paths:

```text
makebsp.exe -game washoi -fs_basepath <stage>/media -threads 12 -leaktest -samplesize 4 -lightmapimagesize 2048 <stage>/maps/<map>.map
makelight.exe -game washoi -fs_basepath <stage>/media -threads 12 <stage>/maps/<map>.map
```

Full lighting, no `-fast`. wda5 takes about 2.5 minutes, wbomb6 about 30.
The logs confirm the Washoi profile (`Active game: washoi (BSP format: FBSP)`)
and 1,889 shaders from 100 shader files. Remaining warnings are the compiler
helpers `noshader` and `tag_light`, the hidden dev faces, and
`textures/wsw_city1/vertex_stepup01_shiny`, whose image `stepup01.png` exists in
no media set (Warfork, Warsow, rapid or ours); the 2016 build had the same gap.

| BSP | Bytes | Faces | Vertices | 2048² lightmaps | PVS clusters | Light-grid points |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `washoi_amphi2` | 37,719,380 | 1,282 | 96,227 | 2 | 344 | 16,632 |
| `washoi_snd6` | 158,856,720 | 5,090 | 301,641 | 10 | 1,603 | 361,046 |

Depot's ten lightmap pages are the cost of samplesize 4 on a large map: Jal's
Concrete Strike has six. Samplesize 8 would cut them to about a quarter.

## Packages

1. Each BSP is put in a staged `map_<release id>.pk3`. The owner's levelshots,
   taken in Washoi and saved at 1920 × 1080, are `levelshots/washoi_amphi2.png`
   and `levelshots/washoi_snd6.png` in those packages, replacing
   Warfork's `wfbomb6.png` that Depot first carried; `npm run tools:manifest`
   generates the 960 × 540 JPG previews. The PNGs are archived in
   `archive/media/levelshots/`, the packages they replaced in its
   `map-backups/`.
2. `npm run tools:manifest -- --data-dir <stage>/pkgmedia`, then
   `npm run tools:map-media -- --data-dir <stage>/pkgmedia --maps <id> --lossless`.
   Nothing drawn is unresolved.
3. `textures/billboard/bulletsblue2.png` is added to the master from Warfork's
   `data0_21`: billboard images are owned by the shared `tex_billboard.pk3`,
   which `npm run tools:billboards` rebuilds from the master, so a map bank never
   carries them.
4. `node scripts/merge-map-textures.mjs --source <bank>` for each map, without
   `--prefer-existing`: no conflicts. Amphi2 adds 128 files and 28 shader
   definitions, Depot 145 files and 24 definitions.
5. `--init-encoding` classifies the 100 new TGA/PNG textures in
   `config/map-texture-encoding.json` (39 colour, 29 normal, 20 gloss, 11 alpha,
   1 sky); every existing entry is kept as it was.
6. `npm run tools:map-media -- --maps washoi_amphi2,washoi_snd6 --master-package washoi_textures.pk3`
   builds the WebP banks; the packages are installed in `public/data` and
   `npm run tools:manifest` re-indexes (nine maps).

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| `map_washoi_amphi2.pk3` | 13,458,873 | `6e54311b21e4b8c21336b8517a9b95a529cdc2e89fb4553263490f3a4456435e` |
| `tex_washoi_amphi2.pk3` | 5,880,805 | `59f067c888c7e2b9acbc4bb118597ee8b011300bf5f0984347921b39e86ddde8` |
| `map_washoi_snd6.pk3` | 51,265,975 | `c26ac2b11a7d8012394e708786aa7f8c1ee997797ae3ea2734f2f821513b898f` |
| `tex_washoi_snd6.pk3` | 12,781,081 | `9af41869c3084d95614a3ce2672b44d7d12762c4ffab290af6b01d4296e3d43a` |
| `washoi_textures.pk3` | 155,101,739 | `9286ec3b6b4bbffffdd44defa7fd830f59ea415618b862e64f6e7dd136a6a286` |
| `tex_billboard.pk3` | 3,755,827 | `78143817610ef7344aa28e34c7b3ca86966defc34738b822a938dc663f918039` |

`npm run tools:textures` was not run: the KTX-Software tools are not installed
on this machine. The maps load their WebP textures without KTX2 sidecars.

## Validation

- `npm --prefix src/games/fps run cli:game -- --exec "bsp load washoi_amphi2; bsp info; bsp load washoi_snd6; bsp info; quit"`:
  both load through the index, exit 0.
- Browser, headless Edge on WebGL2, through a scratch lobby (`map washoi_amphi2 amphi`,
  `map washoi_snd6 snd`): every texture ready, no failed media request, lightmaps
  and models visible at spawn. wda5 has eight deathmatch spawns, which Amphi
  uses; wbomb6 has the two bomb sites and team spawns `isBombMap` needs.

Not yet played: full Amphi rounds on wda5, S&D rounds on Depot (plant sites,
spawns, the lift), and bots on either map.

## washoi_snd4 (Shepas)

`maps/wfbomb4.map` ("Shepas") is in warfork-maps' `maps/`, reworked for MakeBSP:
44 of its 242 models carry `collisiontype`, so its collision is compiled as
authored. Warfork's `data1_21pure/maps/wfbomb4.bsp` is a MakeBSP build of
2026-09-18 with the same worldspawn keys, but the source changed after it: the
sky (`sky/sky_test` → `sky/grimmnight`), `blx_wt3_grid` → `grates/simplegrid`,
`wsw_city1/concret7` → `concrete/concret7`, and moved plant, barrier and
container models. It is compiled here from warfork-maps `00bf74a`, with
`_lightmapImageSize 2048` and `gridsize 64 64 64` as in Warfork's build: 69
seconds of MakeBSP and about 7 minutes of MakeLight, no missing model or
material, 6 lightmap pages (as Warfork's), 1,799 faces, 880 clusters.

Its 393 curve patches compiled with `textures/common/_miscmodelclip` carry
NODRAW (surface flags `0x204a0`) and draw nothing, as in Concrete Strike.
`textures/billboard/bigbill9.tga` is a Warfork logo; the recipe replaces it with
a Washoi board (`assets/billboards/bigbill9.png`, saved as TGA at that path).
`decals/poster01` and `decals/poster_bobot` are fully transparent placeholders.
The merge adds 69 files and 17 shaders without conflicts; 28 new textures are
classified. Its levelshot is the owner's 1920 × 1080 `levelshots/washoi_snd4.png`.

In the browser every texture is ready and nothing fails to load. The
`textures/billboard/board_512_256_1` board, which cycles the Washoi big boards
with `animClampMap`, draws black there (Depot uses it too); it is not yet
investigated.
