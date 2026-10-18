# Halo media and bare shader aliases

2026-10-18. Installed and checked against the three production DM maps.

## Cause

`PK3Index.extractShaderNames` required a slash in shader names. Valid aliases
such as `halo`, `halo_large` and underscore-named map-model materials were absent
from the published index. The map-media extractor therefore omitted their
definitions and dependencies. Loading the old complete data package masked the
problem because its entire shader file was parsed once mounted.

In the reduced production set, DM5's `halo` and `halo_large` surfaces had opaque
fallback materials, no texture and no autosprite behavior. This matches the
solid colored rectangles in the reported screenshot.

## Repair

The index and map-media extractor now share a top-level shader block reader.
It handles nested stages/conditionals, quoted names and comments, and recognizes
bare aliases without confusing stage tokens with shader names. The published
index test covers both halo names, a map-model alias and ordinary texture paths.

Re-extracted the three maps with the original `data0_21.pk3` and
`data0_21pure.pk3` available only in an unserved staging directory. Current
Washoi packages retained their override priority. Merged the extracted media
with the existing texture bank using `mergeTextureBanks`, which rejects
conflicting image bytes or shader definitions.

The result restores ten missing definitions, including both halo shaders and
lamp/LED/decorative-model aliases, together with their textures. Every one of
the original 730 non-shader files and 207 shader blocks remained unchanged.
The inventory is [media/halo_repair.json](media/halo_repair.json).

Installed `washoi_textures.pk3`: 94,350,411 bytes, SHA256
`143708c53a81ff146953c25962453e8329bbfbdb9e25368f8880c7aa4a2c1a06`.
The previous bank is preserved at
`archive/media/halo-repair/washoi_textures.before-halos.pk3`.
No excess data package was restored to `public/data`. The original texture and
shader paths are preserved. Collision geometry and BSP bytes did not change.

The index now lists ten production packages and three maps. The incremental
KTX2 refresh converted 40 images, skipped 684 unchanged sources and reported
zero errors. Reload an existing browser tab to replace its mounted bank/index.

## Rebuild and validation

The source-index bug is fixed in the ordinary `npm run tools:map-media` path.
To reconstruct the missing dependencies, its indexed source directory must
include both the original source banks and current map/texture overrides.
This repair used `.cache/halo-repair/input` as that directory, generated its
index, ran `packageMap` for all three maps and merged those outputs with the
installed texture bank. The scratch driver was `.cache/repair-map-media.ts`.

Commands run:

```text
npm run test:run -- src/engine/loader/pk3/__tests__/PK3PublishedIndex.test.ts src/cli/__tests__/map-media.test.ts
node node_modules/vite-node/vite-node.mjs .cache/repair-map-media.ts
npm run tools:pk3-index
npm run tools:textures
npm run typecheck
npm run gate:biome
npm run test:run
npm run build
npm run docs:build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
node .cache/run-map-bsp.mjs
```

Focused tests: 18 passed. Typecheck, Biome, build, manual build, simulation,
physics, tick, fuzz and all three production BSP inspections passed.
The full suite has 5,149 passing tests, one skipped and the same five SHAGGED
compiler failures across four files caused by archived editor fixtures
(`textures/blx/blx_grid`; ConvexCompile also reports `noshader`). These failures
also occurred before this fix with the reduced production asset set.

Browser checks loaded all three maps successfully without failed HTTP requests
or error-level console entries. DM5 now creates individually rotated
`bsp_sprite_162_*` / `bsp_sprite_163_*` halo surfaces, with `autosprite2=true`,
additive blending and the packaged `textures/flareshalos/halo*` artwork. An
isolated real-map halo screenshot was also inspected. An audit found no BSP
shader references defined by the archived original shader bank but absent from
the repaired production index. A source-unresolved `_miscmodelclip` name remains
in the extraction report; this repair did not invent a shader for it.

## Files changed

- `src/engine/loader/shader/ShaderSourceBlocks.ts`
- `src/engine/loader/pk3/PK3Index.ts`
- `src/engine/loader/pk3/__tests__/PK3PublishedIndex.test.ts`
- `src/cli/map-media.ts`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/changelog/v0.9.32.md`
- `docs/research/media/halo_repair.json`
- This note. Generated PK3/index/KTX files are intentionally outside Git.

Assumption: preserve the authored halo appearance and existing map artwork.
The original live match camera position has not been reproduced exactly.
