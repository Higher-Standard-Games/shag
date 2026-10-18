# Washoi arena billboards

These are replacement images for the nine advertising textures used by Washoi
DM5 and DM11, plus DM2's gold neon sign and atrium badge. `washoi-logo.png` is a copy of the project's supplied
`public/data/washoi.png` branding. The original logo's rights remain unchanged.
The panels combine that logo with typography and geometric backgrounds;
they contain no upstream advertising artwork.

Edit the supplied PNGs directly, or regenerate the layout on Windows with:

```powershell
powershell -File scripts/render-billboards.ps1
powershell -File scripts/render-dm2-branding.ps1
```

The renderer uses System.Drawing and Arial. The checked-in PNGs are the
portable packaging inputs; packaging does not require Windows or installed fonts.

```sh
npm run tools:billboards
npm run tools:manifest
npm run tools:textures
```

Set `KTX_TOOLS_PATH` to your Khronos KTX executable if it is not on PATH.
When reconstructing textures from upstream archives with `tools:map-media`,
apply `tools:billboards` to the resulting combined bank before deployment.
Use `--package <path>` to target a bank outside `public/data/`.

The package recipe is `config/billboard-package.json`. `bigver1.png` is
encoded as a 32-bit TGA at packaging time to retain its map-compatible filename.
All other images retain their PNG paths. Original ad images are saved once to
the ignored, unserved `archive/media/billboards/` directory.
DM2's two images use explicit destination paths in the recipe, retaining the
legacy `warsow_neon_gold2.png` and `decals/wswdecal.png` names for map compatibility.
