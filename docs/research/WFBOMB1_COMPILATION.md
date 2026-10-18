# WFBomb1 / Concrete Strike compile

**Release name:** `washoi_snd1`, served in `map_washoi_snd1.pk3` with
`maps/washoi_snd1.bsp`. The older package was archived without a compatibility
alias. The source/staging paths and initial package names below describe the
upstream `wfbomb1` integration. See `SnD_TODO.md` for the subsequent release rename
and structure/debris implementation.

**Active version:** Jal's Desktop BSP, installed byte-for-byte at the user's
request after the locally compiled preview showed lighting problems. The local
compile below is retained as an experiment and backup, not the active map.

## Active Jal build

Source: `C:/Users/sundf/Desktop/wfbomb1.bsp`, 96,218,640 bytes, SHA-256
`5f497a9d74efd509efbd0ccdba85e00200ee58b02b85639ff87dd90608f890cb`.
The BSP is FBSP v1 and declares `_lightmapImageSize 2048` and `gridsize 64 64 64`.
The engine's indexed loader reads six 2048 x 2048 lightmap/deluxe images,
195,050 expanded light-grid points and 1,074 PVS clusters correctly.

Active `public/data/map_wfbomb1.pk3`: 31,750,432 bytes, SHA-256
`e97b0ee50485d8b5a98114cb6abd60962ba36d56d708460b90e310c5b3d38ccf`.
The package retains the extracted levelshot. Its BSP entry was compared directly
with the Desktop source and is byte-for-byte identical.

The dependency extractor found 384 assets and 137 shaders. The only material
new to Jal's texture table, `textures/plastic/grey65`, was already in our bank.
Re-merging refreshed the map's dependency ledger without adding or changing
texture images or shader definitions. The active shared texture bank is
118,190,632 bytes, SHA-256
`2b85ef74a8a1a863254f327ef39d837b48071985af9f92357525082924d100e8`.
The two unresolved compiler-helper names are the same as in the local build.

Local preview map backup:
`archive/media/wfbomb1/map_wfbomb1.local-compile.pk3`.
Jal's original file and the Warfork source checkout remain unchanged.

Jal-version checks: `tools:pk3-index` on staging, `tools:map-media` into
`.cache/wfbomb1-compile/packages-jal`, the merge helper, `tools:manifest`, and
`node .cache/wfbomb1-compile/verify.mjs` all passed. The replacement introduced
no new texture images, so the previously generated KTX2 sidecars remain valid.
The final Jal lighting appearance still needs an in-game playtest; the browser
inspection recorded below used the superseded local preview.

## Inputs and staging

Source: `C:/Users/sundf/Desktop/warfork-maps/maps/wfbomb1.map`, map title
Concrete Strike, 2,809,369 bytes. The latest commit touching this source in the
local checkout is `5ed78f7` (2026-10-12).
Original source SHA-256:
`1a28415c8f4c421e8ad128b831c388062caf0a662911f56dca612b9858f462dd`.

The build is isolated under `.cache/wfbomb1-compile/`:

- `media/`: copied archived `data0_21.pk3`, `data0_21pure.pk3`,
  `data1_21pure.pk3`, `data2_21pure.pk3`, and `editortextures.pk3`.
- Repository `models/`, `prefabs/`, and `wswmaps/prefabs/` are copied below
  that media root. There are 51 distinct model references in the source.
- `toolchain/`: local `tools/makebsp` executables, DLLs and game profiles;
  `makebspdata/washoi.json` is copied from `editor/makebspdata/washoi.json`.
- `maps/wfbomb1.map`: a staged copy. Two stale model extensions are corrected:
  `models/mapobjects/crates/crate_wood.ase` and
  `models/mapobjects/handrails/handrail_2.ase` become their existing `.obj`
  counterparts. Each occurs once. Upstream files are not edited.

Staged source SHA-256:
`5081f9eb099acf03131e4fc2784d528c60d6d8169e228d6e7d856b1764d705a1`.
The full input manifest is `.cache/wfbomb1-compile/inputs.json`.
Jal's alternate BSP subsequently replaced this local result, as described above.

## Compile

Working directory: the staged `toolchain/` directory. Both commands use
absolute media and map paths in the actual run.

```text
makebsp.exe -game washoi -fs_basepath <stage>/media -threads 4 -leaktest -samplesize 8 <stage>/maps/wfbomb1.map
makelight.exe -game washoi -fs_basepath <stage>/media -threads 4 -fast <stage>/maps/wfbomb1.map
```

MakeBSP completed successfully in approximately 70 seconds, including VIS.
The geometry build does not use `-fast`; MakeLight uses preview `-fast`
lighting and still performed four radiosity passes, completing in 1m50s.
This is a test build, not a claim of final release lighting quality.

The lit BSP is 43,966,588 bytes, FBSP v1, with:

| Field | Count |
| --- | ---: |
| Entities | 501 |
| Texture records | 182 |
| Draw faces | 2,281 |
| Vertices | 212,361 |
| Brushes | 2,801 |
| Models | 8 |
| Embedded 512 x 512 lightmap images, including deluxe pages | 30 |
| Expanded light-grid points | 25,051 |
| PVS clusters | 1,112 |

Warnings: bare `noshader` and `tag_light` images, long source-model names over
MAX_QPATH, and an already-present sun entity. Neither `noshader` nor `tag_light`
is used by any draw face. Dependency extraction also reports
`textures/common/_miscmodelclip`; its BSP surface flags include NODRAW and the
runtime filters `textures/common/`, so it does not require a visible texture.
No missing prop or ordinary render-material dependency was identified.

## Packages and playlist

The isolated VFS was indexed after adding the compiled BSP and a temporary
model-source archive. `tools:map-media` extracted 388 assets and 138 shaders.
The temporary source archive and full data packages are not served.

Initial local-preview package: `map_wfbomb1.pk3`, 19,030,918 bytes,
SHA-256 `8878052547af5e6219403c02e7360e4224b456541ae186d138e97e82a73a0459`.
Its levelshot is included in the map package.

`scripts/merge-map-textures.mjs` merged the extracted media into the existing
`washoi_textures.pk3`, adding 202 entries and 55 shader definitions. It defaults
to rejecting conflicts; `--prefer-existing` explicitly keeps reviewed overrides.
For this map it retained three Washoi billboard images (`bigbill1`, `small1`,
`small3`) and the existing `models/mapobjects/nateleaf1/tree2` shader, whose
only source difference is its TGA reference instead of the upstream PNG spelling.
All other existing file bytes and shader definitions were verified unchanged.
The map's dependency ledger was updated to describe the merged winners,
including its levelshot owner. A content-addressed original bank is backed up
under ignored `archive/media/map-texture-merge/`.

Initial merged texture bank: 118,190,967 bytes, SHA-256
`129ab74f4d509507ab47363e6c62f5212715c77a7eaa5c6c2807d85e3149b6fc`.

`config/maps.json` assigns **only `wfbomb1` to S&D**, displayed as Concrete
Strike. `wbomb2` and `wbomb6` have empty gametype lists. Duel/FFA retain the
three Washoi DM maps. The running lobby must restart to read the new pool;
existing user servers were not stopped during this task.

## Validation commands

```text
npm run tools:pk3-index -- --data-dir .cache/wfbomb1-compile/media
npm run tools:map-media -- --data-dir .cache/wfbomb1-compile/media --maps wfbomb1 --output-dir .cache/wfbomb1-compile/packages
node scripts/merge-map-textures.mjs --source .cache/wfbomb1-compile/packages/tex_wfbomb1.pk3 --prefer-existing
npm run tools:manifest
node .cache/wfbomb1-compile/verify.mjs
node .cache/billboards/convert.mjs
npx vite-node .cache/wfbomb1-compile/check-pool.ts
```

Indexed headless BSP load/info passed, including expanded light-grid counts.
KTX2 conversion generated 107 sidecars, skipped 715, and reported zero errors.
The real lobby pool loader, using an in-memory account store, confirmed
S&D contains exactly `wfbomb1` and Duel/FFA remain unchanged.

The local preview rendered through the production WebGL2 BSP inspection path
with 618 meshes, 224,022 vertices, all textures ready and no failed HTTP requests.
Screenshots were inspected at several spawn locations. This validates asset
resolution but does not establish that the preview lighting matched the author;
the user requested Jal's version instead.

Project gates: `npm run build`, `npm run typecheck`, `npm run docs:build`,
`npm run gate:biome`, and `node --check scripts/merge-map-textures.mjs` passed.
`npm run test:run -- --maxWorkers=2`: 5,165 passed, one skipped, five known
editor compile failures in ConvexCompile (two), NaturalCompile, PlaytestCompile
and RoundPatchCompile due to missing editor-source materials. No runtime source
code was changed. The new merge helper also validates all preserved files,
added files and shader definitions before writing its output.

Manual test command, with a local lobby running:

```text
developer 1
map wfbomb1 snd
```

Assumption: the OBJ files sharing the two missing ASE basenames are their
intended replacements. Full S&D rounds, spawn placement, bomb-site logic and
collision traversal remain to be playtested; a successful compile alone does
not establish gameplay readiness.

## Tracked files changed

- `config/maps.json`: Concrete Strike is the sole S&D pool entry.
- `scripts/merge-map-textures.mjs`: verified merge helper with explicit conflict policy.
- `docs/manual/guides/lobby-server.md`: current map pools and restart behavior.
- `docs/changelog/v0.9.32.md`: player-facing map addition.
- `docs/research/WFBOMB1_COMPILATION.md`: compile experiment and active Jal build.

Generated PK3s, indexes, KTX2 cache, compiler staging and backups remain ignored.
