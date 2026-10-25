# Map texture packages as WebP

Investigated and built 2026-10-25 for 1.0.0-alpha.5.

## Before

The five `tex_<map>.pk3` banks were 181.4 MB together, almost all of it TGA
and PNG copied from the master bank (`washoi_textures.pk3`, unpublished). A map
load downloads its bank whole.

Most of those pixels are never drawn. With `r_ktx2` on (the default), the
loader takes a texture from the loose KTX2 sidecar cache (`ktx2cache/`, 790 map
textures in 40.2 MB, encoded from the master) before the pk3. The bank's
TGA/PNG is the fallback, and the source for `r_picmip` above 0.

## After

`tools:map-media` writes each TGA/PNG as WebP under the same name, using the
class `config/map-texture-encoding.json` gives it (generated once with
`--init-encoding`, then edited by hand). JPG and KTX stay; a KTX with a
TGA/PNG/JPG twin is left out.

| Map | Before | After |
| --- | --- | --- |
| washoi_amphi1 | 8.1 MB | 3.2 MB |
| washoi_dm2 | 8.2 MB | 2.0 MB |
| washoi_dm5 | 59.0 MB | 10.8 MB |
| washoi_dm11 | 48.5 MB | 8.4 MB |
| washoi_snd1 | 57.5 MB | 9.0 MB |
| **Total** | **181.4 MB** | **33.6 MB** |

The list classifies 769 master images: 301 colour, 89 alpha, 18 sky, 158 gloss,
203 normal. Unresolved materials and the `map_` packages are unchanged.

## Checks

- **With KTX2 (default):** screenshots of six washoi_dm5 views match the TGA
  build pixel for pixel, as KTX2 supplies the drawn textures either way.
- **With `r_ktx2 0`:** the WebP build differs from the TGA build by 0.3–2.7/255
  on average per channel. The visible change is slightly softer fine noise on
  concrete; signs, brick, sky and lights match.
- **KTX2 sources:** the sidecar generator now encodes a texture published as
  WebP from the master's TGA/PNG. The audit reports 764 of 802 sidecars
  current; the other 38 are JPG and kept textures now read from the `tex_`
  banks (identical bytes to the master's).

## Backups

`archive/tex_washoi_<map>-v1.0.0-alpha.4.pk3` holds each previous bank.

## Not done

- `tex_billboard.pk3` (3 MB, built by its own packager) is unchanged.
- Colour quality 85 could go to 90 if the softer concrete shows in play.
