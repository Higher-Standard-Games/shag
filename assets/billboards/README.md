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
```

`tools:billboards` builds `public/data/tex_billboard.pk3`, containing all master
files under `textures/billboard/`, applying the nine ad PNG replacements here.
It leaves the master unchanged. `--package <path>` selects another source master;
`--source-dir <directory>` selects artwork; `--output <path>` selects output.
Ad paths are excluded from per-map banks via `config/pk3-packages.json`.
The first split needs a per-map rebuild; subsequent image changes need only the
billboard bank and regenerated metadata. Reload the game to receive new artwork.
Dynamic billboard paths bypass KTX2 sidecars, so these changes need no KTX2 rebuild.

The package recipe is `config/billboard-package.json`. `bigver1.png` is
encoded as a 32-bit TGA at packaging time to retain its map-compatible filename.
All other replacement images retain their PNG paths. Prior shared banks are
archived by hash in the ignored `archive/media/billboard-bank/` directory.
DM2's two images use explicit destination paths in the recipe, retaining the
legacy `warsow_neon_gold2.png` and `decals/wswdecal.png` names for map compatibility.
Those two static images stay in DM2's map bank. Apply changes to the master with
`npm run tools:branding`, then rebuild the map banks. That command retains the
original master-art backup workflow under `archive/media/billboards/`.
