# Media packaging investigation

Date: 2026-10-17. Branch: `v0.9.32-media-packaging` in both repositories.

**Updated packaging decision:** the three intermediate `tex_<map>.pk3` banks
described in the initial investigation are now combined into **`textures.pk3`**.
See the consolidation follow-up below for the installed layout and validation.

## Result

The active media directory now contains `map_wdm2.pk3` / `tex_wdm2.pk3`,
`map_wfdm5.pk3` / `tex_wfdm5.pk3`, and `map_wfdm11.pk3` / `tex_wfdm11.pk3`.
BSP bytes, collision data and copied media bytes are unchanged. Each texture bank
contains the referenced textures, shader definitions, all conditional branches,
normal/gloss/glow companions, sky/cubemap images and referenced map models.
It also retains original shader source files under `media-sources/` for comments
and attribution, and an asset/source/hash ledger under `media-manifests/`.

Per-map duplication is deliberate: 799 asset entries cover 657 distinct paths.
The duplicate paths and selected shader definitions have matching hashes.
Repackaging does not change the provenance or license of the copied assets.

Active archives: **86 → 24**. Active indexed maps: **53 → 8**.
Active PK3 bytes: **698.82 → 600.73 MiB**.

## Nonfree replacement todo

The two original `_nonfree` banks contain 104 distinct paths: 103 sound files
and one ROQ video. Neither original bank currently owns a winning indexed file.
All 103 sound files are still present byte-for-byte in `zz_washoi_legacy_audio.pk3`.
The video has a different winning copy in `data0_21pure.pk3`; no ROQ path was
found among the current game/engine/config references.

**41 sound paths have direct current source references** and form the confirmed
replacement todo below. This is a static usage audit, not a claim that every
sound played during the visual map probe. The source sites include shared gameplay
audio and S&D, so this list is wider than just the three duel maps. The remaining
62 sound paths have no exact or matching template-literal reference in the scan;
that alone is not proof that future dynamically constructed paths cannot use them.

There are no nonfree-origin image/texture files in these two source banks.
Removing their filenames from the live directory does **not** remove the copied
sound content from the game. Renaming/repackaging is not a replacement.

The machine-readable inventory includes all 104 paths, original package, byte
count, SHA-256, current owner, byte-identity result and source sites:
[nonfree_assets.json](media/nonfree_assets.json).

| Replacement asset | Current source sites |
| --- | --- |
| `sounds/bomb/bombtimer.ogg` | `src/games/fps/client/FPSBombAudio.ts` |
| `sounds/items/armor_green.ogg` | `src/games/fps/client/FPSPickupAudio.ts` |
| `sounds/items/armor_red.ogg` | `src/games/fps/client/FPSPickupAudio.ts` |
| `sounds/items/armor_shard.ogg` | `src/games/fps/client/FPSPickupAudio.ts` |
| `sounds/items/armor_yellow.ogg` | `src/games/fps/client/FPSPickupAudio.ts` |
| `sounds/items/health_25.ogg` | `src/games/fps/client/FPSPickupAudio.ts` |
| `sounds/items/megahealth.ogg` | `src/games/fps/client/FPSPickupAudio.ts` |
| `sounds/movers/door_start.ogg` | `src/shared/bsp/LiftSystem.ts` |
| `sounds/movers/door_stop.ogg` | `src/shared/bsp/LiftSystem.ts` |
| `sounds/movers/elevator_move.ogg` | `src/shared/bsp/LiftSystem.ts` |
| `sounds/players/bobot/death.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/players/bobot/drown.ogg` | `src/games/fps/client/FPSLiquidAudio.ts` |
| `sounds/players/bobot/jump_1.ogg` | `src/games/fps/client/FPSMovementAudio.ts` |
| `sounds/players/bobot/jump_2.ogg` | `src/games/fps/client/FPSMovementAudio.ts` |
| `sounds/players/bobot/pain100.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/players/bobot/pain25.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/players/bobot/pain50.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/players/bobot/pain75.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/blade_strike1.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/blade_strike2.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/blade_strike3.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/bladegun_strong_hit_1.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/bladegun_strong_hit_2.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/bladegun_strong_hit_3.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/gren_strong_explosion1.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/gren_strong_explosion2.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/plasmagun_strong_explosion.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/rocket_fire_strong.ogg` | `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/weapons/rocket_strong_explosion.ogg` | `src/games/fps/client/FPSBombAudio.ts`, `src/games/fps/client/FPSCombatAudio.ts` |
| `sounds/world/ft_step_met1.ogg` | `src/games/fps/client/FPSMovementAudio.ts` |
| `sounds/world/ft_step_met2.ogg` | `src/games/fps/client/FPSMovementAudio.ts` |
| `sounds/world/ft_step_met3.ogg` | `src/games/fps/client/FPSMovementAudio.ts` |
| `sounds/world/ft_step1.ogg` | `src/games/fps/client/FPSMovementAudio.ts` |
| `sounds/world/ft_step2.ogg` | `src/games/fps/client/FPSMovementAudio.ts` |
| `sounds/world/ft_step3.ogg` | `src/games/fps/client/FPSMovementAudio.ts` |
| `sounds/world/jumppad.ogg` | `src/games/fps/client/FPSMovementAudio.ts` |
| `sounds/world/lava_in.ogg` | `src/games/fps/client/FPSLiquidAudio.ts` |
| `sounds/world/lava_out.ogg` | `src/games/fps/client/FPSLiquidAudio.ts` |
| `sounds/world/tele_in.ogg` | `src/games/fps/client/TeleportEffect.ts` |
| `sounds/world/underlava.ogg` | `src/games/fps/client/FPSLiquidAudio.ts` |
| `sounds/world/underwater.ogg` | `src/games/fps/client/FPSLiquidAudio.ts` |

## Per-map packages

Map packages contain the unchanged BSP plus map metadata such as levelshots,
navigation and minimaps when available. Texture banks also contain auxiliary
map-specific media, so `tex_` denotes the dependency bank rather than image files
only. They preserve existing virtual paths, allowing deliberate duplicates.

| Map | Map PK3 (MiB) | Texture PK3 (MiB) | Asset entries | Shaders |
| --- | ---: | ---: | ---: | ---: |
| wdm2 | 3.14 | 7.92 | 251 | 55 |
| wfdm5 | 20.01 | 55.93 | 297 | 114 |
| wfdm11 | 17.27 | 44.07 | 251 | 85 |

The texture builder reads the existing runtime ownership index, BSP parser and
shader parser, follows underscore shader aliases, preserves templates and uses
the current winning asset bytes. Both graphics branches are included. Metadata
and shader source comments are retained instead of reconstructing shader syntax.

## Archived media and rollback

Moved **65 obsolete PK3s (192.07 MiB)** out of the served directory:
inactive legacy maps, editor/API probes, superseded Sol Amphi builds, and the two
fully shadowed original nonfree packages. Ten obsolete editor build pointers were
moved too. Three original target map packages are retained as repackaging backups.

Everything moved is under `archive/media/2026-10-17/`, outside `public/`, and is
ignored by Git. `sources/` holds the 68 original PK3s. The directory also contains
the original index/manifest and archive plan. Nothing was deleted.
[archive_manifest.json](media/archive_manifest.json) records source filenames,
reasons, byte counts and destination paths.

Active maps retained: wdm2, wfdm5, wfdm11, wamphi1, solamphi1 (current build 00017),
wbomb2, wbomb6 and the UI map. The other four gameplay maps remain because the
current config still advertises Amphi and S&D. All seven gameplay maps were
dependency-audited before moving inactive packages; no archived package was a
resolved dependency of those maps. `config/maps.json` was not changed.

To restore an archived map, copy its PK3 from `sources/` into `public/data/` and
run `npm run tools:pk3-index`. To undo the three-map repackaging, first move the
new six packages aside, restore the three original map PK3s from `sources/`,
and regenerate the index. Restore any desired old build pointer alongside its
corresponding numbered package. Never restore the old metadata alone.

## Measured package loading and remaining work

Cold real-GPU background-map loads used these packages:

| Map | Loaded PK3s |
| --- | --- |
| wdm2 | `map_wdm2.pk3`, `tex_wfdm5.pk3`, `tex_wdm2.pk3`, `data0_21pure.pk3` |
| wfdm5 | `map_wfdm5.pk3`, `tex_wfdm5.pk3`, `data0_21pure.pk3` |
| wfdm11 | `map_wfdm11.pk3`, `tex_wfdm5.pk3`, `tex_wfdm11.pk3`, `data0_21pure.pk3` |

None fetched `data0_21.pk3` (217.26 MiB). `data0_21pure.pk3` remains needed for
shared effects, shaders and model media; the other active game modes also still
depend on shared banks. Those banks have not been archived.

The global ownership index chooses one winning package for each shared path.
Consequently wdm2 and wfdm11 also fetch `tex_wfdm5.pk3`, although their own banks
contain the same shared bytes. Duplicating assets alone cannot provide strict
map-local downloads with that index. No runtime loader behavior was changed in
this investigation.

Recommended order:

1. Add explicit companion-bank loading with map-scoped dependency preference,
   preserving higher-priority user overrides. Test cold loads and map switches.
2. Build a separately audited shared gameplay/core package for effects, pickups,
   weapons, menu/media and audio; cover all four configured game modes.
3. Remove shared `data*` banks from a staging deployment only after full gameplay
   request traces and dependency checks show that they are unnecessary.
4. Replace the 41 confirmed nonfree-origin sounds, then examine the unreferenced
   legacy clips and any transformed/renamed derivatives before pruning the audio bank.

The audit compares same-path byte identity and exact/template string references.
It does not establish the provenance of transcoded, edited, embedded or renamed
copies. The packages retain source lineage; no claim of a license-clean release
is made by this repackaging.

## Source references without an indexed texture/shader

These already existed in the input index; they are not assets removed by the
repackaging. Some are compiler markers or procedural fallbacks. Keep them visible
in the inventory rather than inventing replacement textures:

- **wdm2:** `mapobjects_decor_misc_spanner`, `noshader`.
- **wfdm5:** `halo`, `halo_large`, `mapobjects_leds_iron_frame`, `mapobjects_leds_orange`, `noshader`, `textures/common/_miscmodelclip`, `textures/common/mosterclip`.
- **wfdm11:** `halo`, `halo_large`, `mapobjects_decor_misc_hammer`, `mapobjects_leds_iron_frame`, `mapobjects_leds_orange`, `models_mapobjects_decor_misc_powerline`, `noshader`, `textures/common/_miscmodelclip`.

The sky probe tried absent alternative extensions before finding existing images.
36sky has only its base/up images in the input banks; other conventional sides
are absent there too. Stormydays has TGA faces, not KTX faces. The visual probes
reported no HTTP failures or JavaScript/GPU errors; these optional lookup misses
are recorded separately from successful image resolution.

## Reproduce

```text
npm run tools:map-media -- --maps wdm2,wfdm5,wfdm11 --output-dir .cache/map-media-rebuild
npm run tools:map-media -- --maps wamphi1,solamphi1,wbomb2,wbomb6 --output-dir .cache/media-active-check --audit-only
npm run tools:nonfree-audit -- --source-dir archive/media/2026-10-17/sources --output docs/research/media/nonfree_assets.json
npm run tools:pk3-index
```

The builder defaults to staging output and refuses to overwrite indexed input
packages. Archive moves were separately reviewed and constrained to the workspace.
Media files and generated indexes remain external, ignored deployment assets.

## Validation

- Three package extraction tests passed (balanced shader blocks, truncation rejection and texture aliases).
- `npm run typecheck`, `npm run gate:biome`, `npm run build`, and `npm run docs:build`: passed.
- `npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`:
  622 files passed, 5,124 tests passed, three skipped. Two skips were real-map
  resolver fixtures expecting archived wdm12. Those fixtures now use retained
  wdm2; rerunning them with the extraction tests passed all eight tests. The
  remaining pre-existing skip requires an unavailable `tex_blx.pk3` fixture.
- `npm run test:run -- src/cli/__tests__/map-media.test.ts src/engine/loader/pk3/__tests__/NodePk3.test.ts`: eight passed.
- ZIP CRCs, unchanged BSP hashes and every copied asset hash passed for all six packages.
- Duplicate path/shader hashes across the three banks matched.
- `npm run tools:pk3-index`: passed; 24 packages and 8 maps.
- `npm run cli:game -- --exec "bsp load wdm2; bsp info; bsp load wfdm5; bsp info; bsp load wfdm11; bsp info; quit"`: passed.
- `node .cache/media-browser.mjs`: all three maps loaded and rendered on real-GPU Edge, with requests recorded and screenshots inspected.
- `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`, and
  `npm run server:fuzz -- --ticks 1000`: passed. The initial physics command
  failed because its wdm7 default had been archived; it now defaults to wdm2
  and passes. No physics rules were changed.

Browser validation was geometry/material/sky loading with `backgroundOnly: true`.
It did not simulate complete matches, every sound event, all camera positions or
full gameplay on the retained Amphi/S&D maps. Their static dependency checks passed.

The curated-bank rebuild was also checked against the initial extraction:
all BSP and copied asset hashes match, and original shader source attribution
survives the rebuild. Rerunning the nonfree audit from the archived originals
produces the same inventory as before archival.

## Files changed

- `.gitignore` excludes the local archived binary media.
- `package.json` exposes `tools:map-media` and `tools:nonfree-audit`.
- `scripts/package-map-media.mjs` runs the extraction CLI through the local TypeScript runtime.
- `scripts/audit-nonfree-media.mjs` inventories source provenance and code references.
- `src/cli/map-media.ts` and `src/cli/package-map-media.ts` implement staged extraction/auditing.
- `src/cli/__tests__/map-media.test.ts` checks shader blocks and path resolution.
- `src/engine/loader/pk3/__tests__/NodePk3.test.ts` uses retained wdm2 for real-media fixtures.
- `src/cli/test-server-physics.ts`, `src/cli/compare-local-vs-server.ts`,
  `src/cli/headless-netserver-v2.ts` and `src/cli/record-demo.ts` default to wdm2
  rather than archived maps. Their corresponding help examples and the headless
  manual example use the retained map too.
- `docs/manual/guides/pk3-filesystem.md` documents the commands and global ownership limitation.
- `docs/changelog/v0.9.32.md` records the new packaging work.
- This report, `media/nonfree_assets.json` and `media/archive_manifest.json` retain the findings.

Generated deployment changes: six PK3s under `public/data/`, regenerated
`pk3_index.json` / `pk3_manifest.json`, and the reversible local archive described
above. These binary/index artifacts are ignored by Git and must be distributed
separately from source changes.

## Shared effects package (follow-up)

Cartoon hit artwork now ships in `public/data/effects.pk3` (419,245 bytes),
containing the two unchanged PNGs under `effects/` and a SHA-256/size manifest.
The loose originals were moved to `archive/media/effects/` outside the served
public directory. This increases the active package count from 24 to 25.

`npm run tools:effects` rebuilds the package from those archived originals;
`-- --source-dir <directory> --output <path>` accepts another input/output.
The rebuild is byte-identical to the installed package. The index was regenerated.

`CartoonHitEffect` discovers each image's owning package through `PK3Index`,
loads it through `PK3Loader`, and creates scene-owned textures from the image
bytes. It preserves sampling, alpha and emission settings. Disposal invalidates
pending initialization and releases textures/blob URLs; `FrameEffects` awaits
initialization and checks that the gameplay scene is still current.

Changed files for this follow-up:

- `scripts/package-effects.mjs`, `package.json` (repeatable packaging command).
- `src/games/fps/client/CartoonHitEffect.ts`, `src/games/fps/client/FrameEffects.ts`.
- `src/games/fps/client/__tests__/CartoonHitTiming.test.ts` (timing and pending-load disposal).
- `docs/manual/guides/pk3-filesystem.md`, `docs/changelog/v0.9.32.md`, this report.

Validation commands:

```text
npm run tools:effects -- --source-dir public/data/effects
npm run tools:pk3-index
npm run tools:effects -- --output .cache/effects-rebuilt.pk3
npm run test:run -- src/games/fps/client/__tests__/CartoonHitTiming.test.ts src/games/fps/client/__tests__/FrameEffects.test.ts
npm run typecheck
npm run gate:biome
npm run build
npm run docs:build
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"
node .cache/effects-browser.mjs
```

The focused tests passed (six tests). Packaging verified PNG signatures, ZIP CRCs
and matching image hashes. Typecheck, Biome, build, docs and all five runtime
regressions passed. A real-GPU WebGL2 probe rendered both sprites with glow,
confirmed alpha/emission bindings and fetched only `effects.pk3` with no loose
image requests, HTTP failures or browser errors. The probe was repeated after
archival. These are isolated effect checks, not a complete multiplayer match.
The initial Biome gate caught an unsorted test import; it was corrected and the
gate passed. The PNGs are not recompressed or artistically modified.

Full gate: `npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`
passed all 622 files: 5,127 tests passed, one pre-existing fixture-dependent skip.

## One shared textures bank (supersedes the per-map texture layout)

The selected deployment is now `map_wdm2.pk3`, `map_wfdm5.pk3`,
`map_wfdm11.pk3` plus one shared **`textures.pk3`**. The combined bank is
93,028,233 bytes (88.72 MiB), versus 113,163,015 bytes (107.92 MiB) for the
three original texture banks: 19.20 MiB saved by deduplication. It contains the
three maps' textures, shader definitions and referenced map media, including
source attribution and manifests. Weapons remain in the existing `z_weapons.pk3`;
this does not introduce a replacement Warsow gameplay effects/weapon package.
The separately packaged cartoon sprites remain in `effects.pk3`.

The three superseded `tex_*.pk3` packages are backed up in
`archive/media/per-map-textures/`, with entries in `media/archive_manifest.json`.
No BSP or map package was changed in this consolidation. There are now 23 active
PK3s totaling 581.93 MiB. All eight previously retained map IDs remain indexed.
The older measurements and per-map layout above describe the initial experiment.

Build with:

```text
npm run tools:map-media -- --maps wdm2,wfdm5,wfdm11 --combined --output-dir .cache/media-combined
```

The output directory includes per-map intermediate texture banks. Install only
`textures.pk3` and the map packages. The merger checks ZIP CRCs, rejects differing
files/shaders with the same virtual name, emits each shader definition once,
and verifies copied file hashes. Rebuilding from an installed `textures.pk3`
also preserves original source attribution. A rebuild adds another provenance
layer, so its archive hash/size can differ while runtime files remain identical.
All 652 runtime files (including the consolidated shader file) matched the rebuild.
Original manifests are retained under `media-sources/inputs/<source package>/`.

Validation for consolidation:

- `npm run test:run -- src/cli/__tests__/map-media.test.ts`: five passed, including
  rejection of conflicting image bytes and shader definitions.
- `npm run typecheck`, `npm run gate:biome`, `npm run build`, `npm run docs:build`: passed.
- `npm run tools:pk3-index`: 23 packages, eight maps.
- `npm run cli:game -- --exec "bsp load wdm2; bsp info; bsp load wfdm5; bsp info; bsp load wfdm11; bsp info; quit"`: passed.
- `npm run tools:map-media -- --combined --output-dir .cache/media-combined-rebuild`:
  passed; compared runtime hashes and retained input attribution.
- `node .cache/combined-audit.mjs`: passed copied-file and rebuild comparisons.
- `node .cache/media-browser.mjs`: cold real-GPU background renders passed for
  all three maps. Each loaded its map package, `textures.pk3` and
  `data0_21pure.pk3`; none loaded a `tex_*` package or the large `data0_21.pk3`.
  No HTTP failures or JavaScript/GPU errors; existing optional sky lookup and
  shared HUD-template warnings remain as described above.

The previous full suite and collision/server regression results cover the current
runtime code; consolidation changes only packaging tooling/media and docs.
Full matches and removal of the remaining `data*` banks are deliberately deferred.
The next scope is map-media completeness, not repackaging the game's own weapons.
The nonfree inventory remains 103 sounds plus one video, with no texture files.

Checkpoint commits before consolidation: FPS `45e54de`, engine `38be448f`.
Neither was pushed. Consolidation changes are a separate reviewable diff.
