# DM5 and DM11 billboard replacement

**Status:** billboard artwork and DM2 atrium branding fixed and visually
accepted by the user on 2026-10-18.

The installed BSP texture tables and `scripts/washoi_maps.shader` in
`washoi_textures.pk3` identify nine artwork files. The metallic frames and
map geometry do not need changing. Texture paths, dimensions and the shader
definitions are preserved, so the animation continues to use the replacement art.

All paths below have the prefix `textures/billboard/`.

| File | Dimensions | Maps | Replacement |
| --- | --- | --- | --- |
| `bigbill1.png` | 1024 x 512 | DM5, DM11 | Washoi: Move fast. Hit hard. |
| `bigbill2.png` | 1024 x 512 | DM5, DM11 | Your next rival is waiting. |
| `bigbill5.png` | 1024 x 512 | DM11 | Keep your momentum. |
| `bigbill6.png` | 1024 x 512 | DM11 | One more round. |
| `neon1.png` | 256 x 1024 | DM5 | Washoi vertical neon |
| `small1.png` | 512 x 128 | DM11 | Teleport / Keep moving |
| `small3.png` | 1024 x 256 | DM5 | Arena open / Play all night |
| `bigver1.tga` | 256 x 512 | DM5 | Duel vertical poster |
| `ver3.png` | 256 x 1024 | DM5 | Arena / Duel / FFA |

DM11's `textures/billboard/board_512_256_2` uses an `animClampMap` at
four frames per second: repeated `bigbill1` holds followed by `bigbill2`,
`bigbill5` and `bigbill6`. The same shader layers scrolling code and scanline
noise over the ad. `code.jpg` (256 x 512) and `scanlinenoise.tga` (256 x 256)
are generic overlays, retained unchanged.

DM5 also uses the decal aliases `textures/decals/bb_bigver1`, `bb_neon1`,
`bb_small3` and `bb_ver3`, which reference the same images. Some original
posters were fictional signs rather than Warfork logos; those are replaced too.

## Packaging

Portable source images and the supplied Washoi logo are tracked under
`assets/billboards/`. `scripts/render-billboards.ps1` creates the layouts.
`npm run tools:billboards` applies `config/billboard-package.json` to
`public/data/washoi_textures.pk3`; `--package` selects another bank.
Reapply after regenerating map media from upstream archives.

The tool verifies CRCs, image dimensions and every output file hash before
replacing the package. It updates the per-map asset ledgers and adds
`media-manifests/washoi_billboards.json`. It preserves the original advertising
images under ignored `archive/media/billboards/`, outside the served tree.
The initial billboard-only bank was 94,894,725 bytes, SHA-256
`817266d97f6e699dfef94c447a6455b4e7931d898828d9993f50d790e1c53f2d`.
751 entries outside the replacements and updated ledgers were verified unchanged.

## DM2 atrium branding

Two additional recipe entries replace confirmed DM2 materials without a BSP
recompile or changes to shader definitions:

| Material/image | Size | Shader | New artwork |
| --- | --- | --- | --- |
| `textures/boqu/warsow_neon_gold2.png` | 512 x 128 | Additive, double-sided, no lightmap | Gold outlined WASHOI neon on black |
| `textures/boqu/decals/wswdecal.png` | 912 x 912 | Alpha blend, GE128 alpha test, polygon offset | Washoi logo in a metal hexagonal atrium badge |

The second image contained a gold WF logo, confirmed by the user. Despite the
legacy material name, its installed artwork was Warfork's badge. The neon PNG
in the installed bank was black; it is replaced with visible gold lettering.
`scripts/render-dm2-branding.ps1` produces the two new source PNGs. The floor
badge retains transparent space around the central emblem, and the neon uses
black surroundings to preserve the additive blend behavior.

`npm run tools:billboards` now packages eleven images and updates their ledgers.
The combined bank is 94,710,984 bytes, SHA-256
`bb609626d9f13a1246b25a125d46ab3a9de117781443b86954167935e955eeb8`.
747 other entries were verified unchanged; the same script reapplies the nine
approved billboard images. Index regeneration and the two changed KTX2 sidecars
are required after packaging.

DM2 validation: `npm run tools:billboards`, `npm run tools:manifest`,
`node .cache/billboards/convert.mjs` (two converted, 722 skipped, zero errors),
`node .cache/run-map-bsp.mjs`, `npm run docs:build`, and `npm run gate:biome`
passed. `node .cache/dm2-branding/probe.mjs` loaded a DM2 demo in headless
WebGL2 with the refreshed assets and existing production code bundle. Both
materials reported ready textures, with zero failed HTTP requests. Screenshots
`.cache/dm2-branding/neon.png` and `atrium.png` were visually inspected: the
wall reads WASHOI and the floor carries the Washoi badge with transparent edges.
No BSP or renderer source changed; prior billboard regression results above
still apply. This does not assess other baked branding elsewhere in the map.

## Validation

- `npm run tools:billboards`: nine artworks packaged; CRC and file hashes passed.
- `npm run tools:manifest`: published index regenerated.
- `node .cache/billboards/convert.mjs`: converter run with local
  `KTX_TOOLS_PATH`; nine KTX2 sidecars regenerated, 715 skipped, zero errors.
- `node .cache/run-map-bsp.mjs`: indexed load and info for all three release maps passed.
- `npm run gate:biome`: passed.
- `npm run build`: passed, including TypeScript compilation and production build.
- `npm run docs:build`: passed.
- `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`,
  `npm run server:fuzz -- --ticks 1000`: passed.
- `node .cache/billboards/probe.mjs`: headless Edge, WebGL2, production preview;
  both maps loaded and their billboard materials reported ready textures.
  No failed HTTP requests or billboard texture errors. Existing weapon/entity
  media lookup warnings appeared during demo loading. Material reports and
  browser logs are under `.cache/billboards/`.

The initial Vite development-page probe failed before boot with
`ERR_NO_BUFFER_SPACE` while fetching source modules; the bundled production
preview completed the check. No renderer or gameplay source code was changed.
The full unit suite was not rerun for this asset-only update.

Only the advertising image family above is in scope; this is not a complete
branding audit of graffiti, baked map textures, or other map props.
