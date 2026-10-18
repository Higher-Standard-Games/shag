# DM2 camera-face replacement

**Status:** fixed and visually accepted by the user on 2026-10-18.

The installed `washoi_dm2` BSP has four render faces using
`textures/wsw_cave1/ball_glowb_portal`. Their BSP face indices are 91, 92,
95 and 97. The corresponding `misc_portal_surface` and `misc_portal_camera`
entities remain unchanged. This work replaces their appearance, preserving
teleport triggers, collision and the BSP bytes.

The old material contained conditional `portalMaps` branches, `$portalmap`,
mask/depth stages and noise overlays. It is replaced as a whole with the two
additive layers from `textures/baxandall/teleglow_02` in the archived
`scripts/baxandall.shader`. Its exact name includes an underscore.

The shader uses `textures/baxandall/teleglow_01.tga`, a 64 x 64 RGB image from
`archive/data0_21.pk3` (5,284 bytes). This file is copied without modification.
The original effect definition comes from `archive/data0_21pure.pk3` and is
preserved in `assets/teleporter/teleglow_02.original.txt`.

Adaptations: explicit TGA references, `cull none`, and the old DM2 material name
as an alias. The authored autosprite, counter-rotation (60 and -20 degrees per
second), sawtooth stretch and brightness animations are retained. No camera
renderer support or runtime source changes were added.

## Rebuild

`npm run tools:teleporter` applies the tracked shader and image to
`public/data/washoi_textures.pk3`. `--package <path>` targets another bank.
Reapply after generating a new combined bank from upstream map packages, then
run `npm run tools:manifest` and `npm run tools:textures`.
The command verifies CRCs, file hashes and all unrelated shader definitions.
Original combined shader source is saved once under
`archive/media/teleporter/washoi_maps.before-portal.shader`.

The resulting bank is 94,714,630 bytes, SHA-256
`55d8ec439a5708119c3c95b09407f961eed1ee2b350c5c225207a52549bae8d9`.
762 other entries were verified unchanged. Package-internal dependency ledgers
and provenance are updated. The BSP package was not modified.

## Validation

- `npm run tools:teleporter`: package CRC/hash and unrelated-shader checks passed.
- `npm run tools:manifest`: index regenerated.
- `node .cache/billboards/convert.mjs`: local KTX tool wrapper; one new sidecar,
  724 skipped, zero errors.
- `node .cache/run-map-bsp.mjs`: indexed load/info of all three release maps passed.
- `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`,
  `npm run server:fuzz -- --ticks 1000`: passed.
- `npm run build`: passed, including TypeScript compilation.
- `npm run gate:biome`: passed (zero errors; 319 warnings against baseline 339).
- `npm run docs:build`: passed.
- `npm run test:run -- --maxWorkers=2`: 5,165 passed, one skipped, five failed
  in the same four editor compile suites recorded before this change:
  ConvexCompile (two), NaturalCompile, PlaytestCompile and RoundPatchCompile.
  Missing editor-source textures (`textures/blx/blx_grid`, `noshader`) remain
  unrelated to this portal patch.
- `node .cache/dm2-teleporter/probe.mjs`: headless Edge/WebGL2, production build,
  all four sprite materials use ready `textures/baxandall/teleglow_01` textures.
  Over 650 ms the primary texture angle changed from 0.880 to 1.565 radians and
  UV scale from 1.432 to 1.465. Zero failed HTTP requests or glow-texture errors.
  All four screenshots under `.cache/dm2-teleporter/face-*.png` were inspected;
  the white camera surfaces are replaced by soft, transparent animated glow.

The unchanged BSP SHA-256 remains
`f1cab8f8abdff75aca24c180c0979a13c8caeaf63273a4b8b17f8f18cb6b6da5`.
No live player teleport traversal was tested; no gameplay code or trigger data
was changed. The two authored layers share one small texture and keep the
machine behind them visible rather than rendering an opaque portal image.

Assumption: this appearance change targets the four DM2 surfaces sharing the
named material. It does not replace camera-like materials under other names in
other maps. Teleport gameplay is unchanged by this packaging-only operation.
