# KTX2 normal-map color conversion investigation

Date: 2026-10-18. Target: `washoi_snd1` A-site floor/pillars, with
`washoi_dm11` as a regression scene. This follows the reports of sunlight
appearing dark and relief lighting pointing the wrong way.

## Finding

The KTX2 generator declared UASTC normal/scalar output as UNORM without assigning
the input transfer function. KTX `create` treated the intermediate PNG as sRGB,
converted its color values to linear, then normalized the already-biased normal.
Neutral normal components around 128 became approximately 72. That is a large
directional bias, rather than a simple inversion of one channel.

A shared bug can appear surface-specific: the tangent frame rotates that bias
with each surface's UV axes, so its dot product with the baked light direction
changes. Different textures and light directions can hide or reveal the problem.
DM11's previous tangent-frame fix is still needed; a good-looking DM11 patch did
not establish that all normal-map cache values were correct.

Verified using the actual packaged `stonecollumn01_norm.tga`, the shipped KTX2
and Khronos KTX-Software v4.4.2's RGBA extraction:

| Image | Mean R | Mean G | Mean B |
| --- | ---: | ---: | ---: |
| Original TGA | 127.31 | 127.54 | 253.89 |
| Old cached KTX2 | 71.61 | 71.49 | 225.92 |
| Corrected KTX2 | 127.27 | 127.50 | 252.85 |

The corrected legacy `toktx` branch also preserved the source values:
127.27 / 127.54 / 254.02. The difference in blue reflects its existing lack of
the `ktx create` normal-normalization step; it is not the color-space bias.

## Changes

`scripts/convert-ktx2.js` assigns linear input for data textures:
`--assign-tf linear` for `ktx create`, `--assign_oetf linear` for `toktx`.
Color textures retain the existing sRGB recipe. Generator version increases
from 2 to 3 so an incremental invocation cannot retain the old encoded cache.

All 904 sidecars were regenerated: 689 ETC1S and 215 UASTC, zero failures.
The original PK3 textures, BSPs, tangent builder and lighting formulas are
unchanged by this fix. The generated cache/manifest remain ignored deployment
assets; rebuild/deploy them, then refresh the browser to release old GPU textures.

Tracked files changed in this follow-up:

- `scripts/convert-ktx2.js`
- `docs/changelog/v0.9.32.md`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/research/KTX2_NORMAL_COLORSPACE.md`

## Isolation and visual verification

The live S&D material audit found 197 normal-mapped meshes, all with tangent
attributes, no negative world-transform determinants and identity normal-map
UV transforms. Source comparison with Qfusion's `R_BuildTangentVectors` and
Babylon's `bumpVertex` did not justify changing the shared tangent convention.
This audit rules out missing tangent attributes and mirrored object transforms
in this scene, not every possible authored UV or model issue.

Same-camera A/B captures removed bump textures entirely and separately inverted
T, S and both axes. Simply changing the normal-map intensity cvar was not a
reliable isolation in the probe; actual null bump textures were used instead.
Similarly, `r_deluxe` is a next-map-load setting, so its live toggle was not
used as evidence. Broad pillar darkening disappeared with flat normals.

Keeping the original tangent frame and changing only the cached normal pixels
restored the pillar lighting and floor detail in headless Edge on the real GPU,
on both WebGL2 and WebGPU. Captures inspected:

- Before: `.cache/snd-compare-normal.png`.
- Flat diagnostic: `.cache/snd-compare-flat.png`.
- Corrected WebGL2: `.cache/snd-fixed-normal.png`.
- Corrected WebGPU: `.cache/snd-fixed-webgpu-normal.png`.
- DM11 courtyard regression: `.cache/dm11-cache-fixed-qfusion.png` retains the
  bright sunlight strip beside the mushrooms, with normal detail enabled.

No failed HTTP requests in these probes. DM11's background-map probe had an
empty warning/error list. S&D's full MapLoader probes still report weapon/ammo
model-path and skeleton warnings. Neither corrected probe captured GPU validation
errors. These
separate diagnostics are not claimed fixed by this cache correction. No match
was played and bomb-blast lighting/exposure was not used for the comparison.

Three real normal maps were extracted from the regenerated cache and compared
pixel-by-pixel with their original PK3 images. Mean directional error:

| Normal map | Mean angle error |
| --- | ---: |
| `textures/hexagons/stonecollumn01_norm` | 2.35 degrees |
| `textures/refly_wood/wood2_norm` | 0.64 degrees |
| `textures/bricks/bricks_05_norm` | 0.24 degrees |

Both TGA- and PNG-derived paths retain neutral components; these are lossy UASTC
textures, so exact byte equality is not expected. The check required mean
angular error below three degrees and per-channel mean change below five bytes.

## Commands and results

```text
node .cache/billboards/convert.mjs                         904 converted, 0 errors
npx vite-node .cache/validate-normal-cache.ts              3 real maps pass pixel/direction checks
node .cache/snd-compare-probe.mjs                          baseline/flat/axis diagnostics
node .cache/snd-fixed-probe.mjs                            corrected WebGL2
node .cache/snd-fixed-webgpu.mjs                           corrected WebGPU
node .cache/dm11-cache-fixed.mjs                           DM11 courtyard sunlight retained
node .cache/normal-headless.mjs                            indexed S&D1, DM11, DM2 BSP loads pass
npm run typecheck                                         pass
npm run test:simulation                                   pass
npm run test:physics                                      pass (known position warning)
npm run server:tick                                       pass
npm run server:fuzz -- --ticks 1000                        pass
npm run gate:biome                                        pass, 0 errors / 319 warnings
npm run docs:build                                        pass
```

`node .cache/billboards/convert.mjs` sets `KTX_TOOLS_PATH` to the local tool and
invokes the same converter as `npm run tools:textures`. The headless runner uses
structured arguments, avoiding the shell-quoting failure documented in the
Amphi packaging notes; the old `wdm2` package is absent, so it checks the
canonical `washoi_dm2` package instead. Logs use `.cache/normal-fix-*` and
`.cache/normal-pixel-validation.log`.

Full suite (`npm run test:run -- --maxWorkers=2`): 5,186 passed, one skipped,
the five known archived-material editor compilation failures in four files, and
one uncaught `window is not defined` timer error at untouched
`MatchLobbyView.ts:505` during the run. The full suite is not green; no DOM or
lobby code was changed in this cache fix. Exact matched-camera Qfusion parity,
every normal texture and live combat/exposure remain unverified.

Production build and `node --check scripts/convert-ktx2.js` also pass. A second
converter run skipped all 904 entries with zero errors, confirming generator-v3
incremental reuse after the one-time regeneration. The private probe browser
sessions and Vite server were closed; user lobby/game/bot services were not
restarted. Refresh the browser page to release cached GPU textures.
