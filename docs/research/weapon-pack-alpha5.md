# Weapon package: 86 MB to 4.9 MB

Investigated 2026-10-25 for 1.0.0-alpha.5.

## What the package held

`public/data/washoi_weapons.pk3` was 85.9 MB stored (185.5 MB unpacked).
Packaging copied the whole original asset bank
(`assets-source/weapons/z_weapons-source.pk3`) into it, then added the GLB
exports and the projectile package.

| Part | Stored | Loaded by the game |
| --- | --- | --- |
| Original bank: TGA textures (76) | 38.8 MB | No |
| Original bank: KTX/PVR textures | 14.8 MB | No |
| Original bank: IQM/IQE/MD3 models | ~1.1 MB | Projectile MD3s only |
| GLB exports | 30.2 MB | About half |
| Projectiles, impact media, shader | ~1 MB | Yes |

A browser trace of every pack read, loading and firing all nine weapons on
washoi_dm5, touched 24 files: 15.4 MB. The browser downloads the package
whole, so every player paid 86 MB.

Unused exports: `gunblade.glb` (3.9 MB, the gunblade was replaced by the blade),
`voltaic.glb` (3.6 MB, an uncredited Sketchfab model; Voltaic draws the
lasergun model), `blade.glb` (1.9 MB, replaced by the Arc Blade), and the
`_flash`/`_hand` GLBs. The machinegun, riotgun and rocket launcher barrels were
not loaded either, but are kept for later.

## Inside the GLBs

PNG textures were about 90% of each GLB:

- **Lossless PNG.** Several were decoded from lossy KTX (ETC1/DXT) and re-saved
  losslessly, so they were larger than their sources.
- **Machinegun base colour at 2048 px.** Its normal map is 1024 px.
- **Each barrel GLB embedded a full copy of its gun's texture** (machinegun
  barrel: 2.9 MB).
- **The sight texture was embedded in seven GLBs.**
- **No normal or gloss maps.** `scripts/embed_weapon_textures.py` embeds a
  material's colour map only; only the legacy MD3 path loaded `_norm` and
  `_gloss`. GLB weapons rendered without their normal maps.

## The new package

`config/weapon-models.json` lists the packaged files (`files`: pack path →
export). `scripts/package-weapon-models.mjs` builds each GLB through
`scripts/weapon-textures.mjs`:

- **Normal maps:** `<material>_norm` from the source bank becomes the material's
  glTF normal texture.
- **Roughness:** `<material>_gloss` becomes a roughness map (black gloss 0.85,
  white 0.3).
- **WebP:** every texture becomes WebP at most 1024 px (normal maps quality 92,
  the rest 85).

The source bank is no longer shipped. Voltaic's model is packaged as
`voltaic/voltaic.glb`; `lasergun` remains an alias weapon id.

Result: **4.9 MB**, with all five barrels and the new normal and roughness maps.
The build is deterministic (identical bytes on rebuild).

**Normal map convention.** All 15 source normal maps are green-up (glTF's
convention). A tangent-space normal field from a real surface is curl-free; the
residual was lower with green read as up for every map (for example lasergun
0.0127 against 0.0193 flipped), so the maps are packaged unflipped.

**Lasergun barrel.** Neither the source bank nor Warsow's `data0_21pure.pk3` has
one; the lasergun's open coil frame is its design.

## Backups

- `archive/washoi_weapons-v1.0.0-alpha.4.pk3`: the previous package.
- `archive/weapons-source-v1.0.0-alpha.4/`: the weapon source folder (bank,
  exports, projectiles) before this change.

## Next candidates

- Merge barrels into their gun's GLB to share one texture.
- KTX2/Basis textures would also cut video memory; WebP only cuts download size.
- Tune the gloss-to-roughness range in play.
