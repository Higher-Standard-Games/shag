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

Active archives: **86 â†’ 24**. Active indexed maps: **53 â†’ 8**.
Active PK3 bytes: **698.82 â†’ 600.73 MiB**.

## Nonfree replacement todo

The two original `_nonfree` banks contain 104 distinct paths: 103 sound files
and one ROQ video. Neither original bank currently owns a winning indexed file.
All 103 sound files are still present byte-for-byte in `zz_washoi_legacy_audio.pk3`.
The video has a different winning copy in `data0_21pure.pk3`; no ROQ path was
found among the current game/engine/config references.

**41 sound paths have direct current source references** and form the initial
source-reference inventory below. The playback follow-up at the end refines this
to 36 playback paths for the configured game/map pool and separates dormant and
preload-only references. This is a static usage audit, not a claim that every
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

## Playback-level nonfree sound audit

The original 41 count measured source references, not observed playback. The
follow-up traced the actual FPS sound-selection functions, presentation callers,
all seven configured gameplay BSPs, and the runtime lift/speaker planners.
[nonfree_usage.json](media/nonfree_usage.json) records each original sound,
its playback scenarios, preload status, map references, byte-identical aliases
and demo observations.

### Findings

| Classification | Sound paths | Evidence |
| --- | ---: | --- |
| Playback selectors applicable to configured modes/maps | 34 | Real FPS selector calls reached AudioManager; includes conditional drowning and S&D beep |
| Installed map mover playback | 2 | wbomb6 vertical door uses door_start and door_stop; client plays them on phase changes |
| Lava crossing support, no lava in installed gameplay pool | 2 | lava_in and lava_out selectors work; no lava-content brushes in the seven maps |
| Preloaded without a playback caller | 2 | underwater and underlava; exported submergedSound has no production caller |
| Elevator support without an installed plat | 1 | elevator_move is a default, but no extracted func_plat in the seven maps |
| Referenced by an unsupported triggered speaker | 1 | wbomb6 dong.wav; actual speakerPlan returns skip/triggered |
| No current source, map or selector usage evidence | 61 | Includes old menu/voice/weapon variants; candidates for later pruning, not deleted |

Total: **103 original sound paths**. The immediate replacement list is **36
playback paths**: 33 shared Duel cues plus the S&D bomb timer and two wbomb6 door
cues. This is a supported-event/installed-map analysis, not a claim that every
conditional sound played in the two demo samples. Water immersion/drowning also
depends on player actions and volume depth; BSP flags establish presence of water,
not that every pool is deep enough for every liquid event.

### Immediate replacement list

All paths below are relative to `sounds/`. Number ranges list each numbered file.

| Use | Paths | Count |
| --- | --- | ---: |
| Blade swings | weapons/blade_strike1.ogg through blade_strike3.ogg | 3 |
| Rocket fire | weapons/rocket_fire_strong.ogg | 1 |
| Blade projectile impacts | weapons/bladegun_strong_hit_1.ogg through bladegun_strong_hit_3.ogg | 3 |
| Grenade impacts | weapons/gren_strong_explosion1.ogg, weapons/gren_strong_explosion2.ogg | 2 |
| Plasma/rocket impacts | weapons/plasmagun_strong_explosion.ogg, weapons/rocket_strong_explosion.ogg | 2 |
| Player pain/death | players/bobot/pain25.ogg, pain50.ogg, pain75.ogg, pain100.ogg, death.ogg | 5 |
| Player jumps | players/bobot/jump_1.ogg, players/bobot/jump_2.ogg | 2 |
| Footsteps | world/ft_step1.ogg through ft_step3.ogg; world/ft_step_met1.ogg through ft_step_met3.ogg | 6 |
| Armor pickups | items/armor_shard.ogg, armor_green.ogg, armor_yellow.ogg, armor_red.ogg | 4 |
| Health pickups | items/health_25.ogg, items/megahealth.ogg | 2 |
| Jumppad | world/jumppad.ogg | 1 |
| Teleport | world/tele_in.ogg | 1 |
| Drowning | players/bobot/drown.ogg | 1 |
| S&D timer | bomb/bombtimer.ogg | 1 |
| wbomb6 door | movers/door_start.ogg, movers/door_stop.ogg | 2 |

Custom weapon models in `z_weapons.pk3` do not imply custom sound selection:
`FPSCombatAudio.ts` still selects the legacy blade, rocket and impact cues above.
`GameEvents.ts` invokes it for weapon_fire/projectile_impact/damage/death events.
Movement and pickup sounds similarly run from movement snapshots and pickup events.
`LocalLiquid` wires drowning callbacks; `LiquidInteractionSystem` selects water/lava
crossings. The two submerged ambience files are warmed by `preloadFPSAudio` but
have no caller that starts them playing. These are separate from nonfree-origin
texture concerns: the original nonfree banks contain no texture images.

### Actual demo playback observations

A real-GPU browser probe wrapped AudioManager's playback methods without changing
their behavior, recording preload calls separately. It played these installed
demos for 30 seconds after each map became ready:

- `wfdm5_duel_20261017_182045.shagdemo`: 237 total playback requests; 16 distinct
  nonfree-origin paths.
- `wfdm11_duel_20261016_183147.shagdemo`: 149 total playback requests; 13 distinct
  nonfree-origin paths.

Their union contains **19 distinct nonfree-origin paths**, listed per sound in
the JSON inventory. Neither probe reported audio/decode errors or HTTP failures.
Recording playback requests is evidence of real use; it does not measure speaker
output, hearing range, mix volume or cover every rare event. Unobserved variants
remain necessary where selectors choose them during other events.

### Map/alias checks and limits

The three target Duel maps have no runtime-extracted lift and no explicit sound
entity path. Their generic game sounds still apply. All seven configured maps
have zero lava-content brushes. wbomb6 supplies the two door cues above and a
triggered dong.wav speaker that the current client intentionally skips.

A SHA-256 scan of all indexed OGG/WAV/MP3/FLAC files found 105 byte-identical paths
matching original nonfree sounds. The two additional aliases are
`players/female/fall_0.ogg` and `players/padpork/fall_0.ogg`, identical to the Bobot/
male fall_0 sound. Neither alias has a current source reference. Edited/transcoded
copies cannot be identified by byte hashes, and older demos/maps or future entity
trigger support could use dormant cues. Do not call the remaining assets proven
unnecessary for every possible deployment.

Validation: `npx vite-node .cache/nonfree-usage-probe.ts` exercised real selectors
with audio output stubbed, inspected installed BSPs through NodePk3, and used
runtime lift extraction/speaker planning. The browser probe
`node .cache/nonfree-demo-audit.mjs` then confirmed real demo playback requests.
`node .cache/nonfree-aliases.mjs` checked winning indexed audio file hashes.

```text
npm run test:run -- src/games/fps/client/__tests__/FPSCombatAudio.test.ts src/games/fps/client/__tests__/FPSMovementAudio.test.ts src/engine/loader/bsp/__tests__/AmbientEntities.test.ts src/engine/__tests__/LiftRendering.test.ts
```

All four test files passed (24 tests). Runtime code and media are unchanged by
this audit. Changed files: this report, `media/nonfree_usage.json` and the living
v0.9.32 changelog. No audio files were removed or replaced.

## Washoi map filename migration (2026-10-18)

The installed names are now:

| Recorded/original ID | Shipped ID | Package | BSP entry |
| --- | --- | --- | --- |
| wdm2 | washoidm2 | map_washoidm2.pk3 | maps/washoidm2.bsp |
| wfdm5 | washoidm5 | map_washoidm5.pk3 | maps/washoidm5.bsp |
| wfdm11 | washoidm11 | map_washoidm11.pk3 | maps/washoidm11.bsp |

This is a filename/entry rename only. **BSP bytes and all texture/shader paths
are unchanged.** `textures.pk3` retains SHA-256
`b4e68de1258bac8827a478d9674d296dbd4a894b476c33fdbc7e0717d5151d8e`.
Original source names inside its provenance records are historical, not live map
IDs, and remain intact. This does not recompile wdm2 or change its geometry.

Original curated map packages are backed up in `archive/media/map-renames/`.
Matching map-specific levelshot/minimap/navigation entry filenames were renamed
inside the new packages, retaining their bytes. The existing loose wdm2 lobby
preview was copied to `levelshots/washoidm2.jpg`; no new artwork was generated.
[map_renames.json](media/map_renames.json) records every renamed entry and hash.

`config/maps.json` advertises only the new IDs for Duel/FFA. Old IDs remain as
inactive title metadata so existing demo listings retain their Washoi titles.
CLI server/physics/demo defaults and map-media extraction defaults use the new
IDs. The learned-route file is `config/bot-routes/washoidm2.json`; only its map
identity changes, preserving route/source-demo IDs and movement coordinates.
The benchmark recipe keeps its established `wdm2-ffa10.json` filename/name but
loads washoidm2, so newly generated fixtures reflect the renamed map in metadata.
Manual examples use the renamed IDs and the player manual's map table matches
the actual configured pools.

FPS demo playback maps old header IDs to the renamed BSPs. It does not rewrite
demo bytes, headers, match IDs or ownership checks. Collision benchmarking and
bot route learning use the same alias helper when opening old recordings.
This compatibility is media lookup; it does not promise deterministic
verification against an older, geometrically different build of a map.

Rebuild the packages from backup with:

```text
npm run tools:rename-maps -- --output-dir .cache/map-renames-rebuild
```

The tool stages output, verifies ZIP CRCs and checks every entry's unchanged
hash. Other input/output roots can be selected with --source-dir/--output-dir.
To roll back local media, move the three renamed packages aside, copy the three
backups into public/data, restore the old pool configuration, and regenerate the
PK3 index. Keep source and media versions together.

Validation commands for this migration:

```text
npm run tools:pk3-index
npm run cli:game -- --exec "bsp load washoidm2; bsp info; bsp load washoidm5; bsp info; bsp load washoidm11; bsp info; quit"
npm run test:run -- src/games/fps/client/__tests__/DemoMapAliases.test.ts src/games/fps/client/__tests__/DemoLoadOwnership.test.ts src/engine/loader/pk3/__tests__/NodePk3.test.ts src/lobby/integration/RoomToRanking.test.ts src/lobby/integration/DropIn.test.ts
npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1
npm run typecheck
npm run gate:biome
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run build
npm run build:server
npm run docs:build
npm run docs:fps:build
npx vite-node src/cli/benchmark-collision.ts --stride 1000 --out .cache/renamed-collision-benchmark.json
node .cache/rename-browser.mjs
node .cache/rename-demo.mjs
```

The focused set passed all 18 tests, including real installed-map public/private
lobby-to-ranking checks on washoidm2. A final alias-only rerun passed four tests.
All three renamed maps loaded and rendered in cold real-GPU background probes,
with no HTTP failures. A real old wfdm5 demo rendered on **washoidm5** after the
rename. The collision benchmark opened the original wfdm11 training recording
against the renamed, hash-identical BSP. Existing optional/model warnings remain;
there was no new texture substitution. Complete live play on all maps and a
fresh wdm2 compile are not part of this filename migration.

Migration gate results: all 623 test files passed (5,133 tests, one existing
fixture-dependent skip). Typecheck, Biome, client/server builds, both manual
builds, simulation, physics, tick and 1,000-tick fuzz checks passed.

Source/config files changed for the rename:

- config/maps.json
- config/bot-routes/washoidm2.json (renamed from wdm2.json)
- benchmarks/recipes/wdm2-ffa10.json
- package.json
- scripts/rename-map-packages.mjs
- src/cli/benchmark-collision.ts
- src/cli/bot-analyze.ts
- src/cli/bot-learn.ts
- src/cli/compare-local-vs-server.ts
- src/cli/headless-netserver-v2.ts
- src/cli/map-media.ts
- src/cli/record-demo.ts
- src/cli/ServerRuntimeProbe.ts
- src/cli/test-server-physics.ts
- src/cli/timedemo-fixture.ts
- src/engine/loader/pk3/__tests__/NodePk3.test.ts
- src/lobby/integration/DropIn.test.ts
- src/lobby/integration/RoomToRanking.test.ts
- src/games/fps/client/DemoMapAliases.ts
- src/games/fps/client/DemoService.ts
- src/games/fps/client/__tests__/DemoMapAliases.test.ts
- docs/changelog/v0.9.32.md
- docs/research/media/map_renames.json
- docs/research/media/archive_manifest.json
- docs/research/media_packaging.md
- docs/manual/contributing/index.md
- docs/manual/deployment/web.md
- docs/manual/faq/index.md
- docs/manual/getting-started/index.md
- docs/manual/guides/bsp-system.md
- docs/manual/guides/console-system.md
- docs/manual/guides/headless-mode.md
- docs/manual/guides/map-launching.md
- docs/manual/guides/networking.md
- docs/manual/guides/physics-system.md
- docs/manual/guides/pk3-filesystem.md
- docs/manual/guides/shagged-api.md
- docs/manual/guides/skybox-system.md
- docs/manual/guides/timedemo.md
- docs/manual/index.md
- docs/manual/tools/headless-bsp.md
- docs/manual/tools/headless-game.md
- docs/manual/tools/network-client.md
- docs/manual/tools/network-server.md
- docs/manual/tutorials/advanced/headless-testing.md
- docs/manual/tutorials/beginner/first-map-load.md
- docs/manual/tutorials/beginner/using-console.md
- docs/manual/tutorials/intermediate/fps-skeleton.md
- docs/manual/tutorials/intermediate/isometric-game.md
- docs/manual/tutorials/intermediate/map-viewer.md
- docs/manual/tutorials/quick-recipes.md
- docs/manual/tutorials/recipes/change-skybox.md
- src/games/fps/docs/manual/developer/server-commands.md
- src/games/fps/docs/manual/faq/index.md
- src/games/fps/docs/manual/gametypes/index.md
- src/games/fps/docs/manual/gametypes/maps.md
- src/games/fps/docs/manual/getting-started/index.md
- src/games/fps/docs/manual/getting-started/troubleshooting.md

## Production package prefixes (2026-10-18)

The published PK3 index and manifest were regenerated after these user file moves:

| Previous package | Production package |
| --- | --- |
| z_weapons.pk3 | washoi_weapons.pk3 |
| player_model_vanguard.pk3 | washoi_player_model.pk3 |
| textures.pk3 | washoi_textures.pk3 |
| zz_washoi_legacy_audio.pk3 | washoi_legacy_audio.pk3 |

`config/weapon-models.json` and `config/player-model-vanguard.json` now emit those
names when packaging. `MapLoader` loads the configured weapon bank through the
PK3 loader/search roots rather than requesting a hardcoded data/z_weapons.pk3.
The combined map-media CLI writes `washoi_textures.pk3` and recognizes that bank
when carrying original source attribution forward. Virtual asset paths are
unchanged. The headless missing-player-model message no longer assumes a package
filename; source comments and the model/filesystem guides reflect the new names.
The two audio inventories now report the current package owners.

[package_renames.json](media/package_renames.json) compares the old and regenerated
ownership tables. Renaming the packages caused **no asset or shader precedence
changes** after translating old owner names to their new names.

Two additional user moves archived `solamphi1_compile_props.pk3` and
`solamphi1_lettering.pk3` under archive/media. This removed 14 indexed paths and
one lettering shader. A real BSP dependency audit found the Relay Yard lettering
unresolved. The user chose to keep these banks archived, so solamphi1 is excluded
from the Amphi lobby pool; wamphi1 remains. The player and engine lobby manuals
reflect this choice. The old SolAmphi BSP remains installed for historical/local
use but its archived dependencies are not claimed to be complete.

The active directory has 21 packages, 8 indexed map IDs, and 577.66 MiB of PK3s.
Only six gameplay maps are configured for lobby selection (the UI and archived-
dependency SolAmphi map are also indexed). `effects.pk3`, the soundtrack and map
package names were not renamed by this update.

Validation commands:

```text
npm run tools:pk3-index
npm run typecheck
npm run gate:biome
npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
npm run cli:game -- --exec "bsp load washoidm2; bsp info; quit"
npm run build
npm run docs:build
node --test scripts/__tests__/package-player-model.test.mjs scripts/__tests__/package-weapon-models.test.mjs
npm run tools:map-media -- --maps solamphi1 --audit-only --output-dir .cache/prefix-solamphi
npm run tools:map-media -- --combined --output-dir .cache/prefix-media-rebuild
node .cache/prefix-rebuild-check.mjs
npm run tools:nonfree-audit -- --source-dir archive/media/2026-10-17/sources --output docs/research/media/nonfree_assets.json
node .cache/prefix-demo.mjs
```

Typecheck, Biome, build, docs, simulation, physics, tick, fuzz and indexed BSP load
passed. All three Node packaging tests passed. The staged texture-bank rebuild
kept all 652 runtime files and 76 source records byte-identical. The browser demo
loaded all four renamed banks and the renamed BSP; no package request failed.
The nonfree audit still finds 103 byte-identical sound copies under the renamed
legacy bank. This update does not change their provenance or replace the sounds.

Files changed in this follow-up: config/weapon-models.json,
config/player-model-vanguard.json, config/maps.json, src/cli/map-media.ts,
src/cli/headless-game.ts, src/engine/loader/map/MapLoader.ts,
src/engine/loader/pk3/PK3Loader.ts, src/engine/animation/AnimationLoader.ts,
src/shared/entities/definitions/weapons/voltaic.ts,
docs/manual/guides/model-loading.md, docs/manual/guides/pk3-filesystem.md,
docs/manual/guides/lobby-server.md,
src/games/fps/docs/manual/gametypes/maps.md, docs/changelog/v0.9.32.md,
this report, media/nonfree_assets.json, media/nonfree_usage.json and
media/package_renames.json. The generated index/manifest are local ignored
artifacts and must be deployed with the renamed PK3s. No other user packages were
renamed or restored by the agent.

Production-prefix full gate: 623 test files passed, 5,133 tests passed and one
pre-existing fixture-dependent test skipped. Both manual builds and the dedicated
server bundle build also passed. Browser package requests had zero HTTP failures.
The user-approved pool change leaves only wamphi1 in Amphi. Restart the lobby
process to pick up config/maps.json; deploy both regenerated metadata files with
the renamed packages.

### Subsequent user archival and final metadata refresh

The user additionally archived map_solamphi1_00017.pk3, map_ui.pk3,
models_nate.pk3 and modules_21.pk3. Discovery was regenerated again against the
final live directory: **17 PK3s, six maps, zero indexed paths pointing to missing
packages**. The earlier 21-package snapshot above predates these later moves.
The final ownership comparison is reflected in media/package_renames.json.

A fresh static map-media dependency audit was run for all six configured maps:

```text
npm run tools:pk3-index
npm run tools:map-media -- --maps washoidm2,washoidm5,washoidm11,wamphi1,wbomb2,wbomb6 --audit-only --output-dir .cache/final-map-dependencies
```

The three renamed Duel maps had no resolved map assets/shaders owned by data*
banks. wamphi1 still had 83 references to data0_21 and 25 to data0_21pure;
wbomb2 had 176/62; wbomb6 had 85/71. These counts combine selected asset and
shader records, not network requests or unique package downloads. The actual
Duel demo probe also loaded data0_21pure for shared gameplay content. Therefore
the two data0 banks cannot yet be archived from this configured deployment.
This update refreshed metadata only after the additional user moves; the full
runtime regressions described above preceded those moves. Static dependency
checks cover all six maps, but a fresh full match in each mode was not run.


## Final map IDs with underscores (2026-10-18)

The production IDs are now `washoi_dm2`, `washoi_dm5`, and `washoi_dm11`.
Their archives are `map_washoi_dm2.pk3`, `map_washoi_dm5.pk3`, and
`map_washoi_dm11.pk3`, containing `maps/<id>.bsp`. Matching levelshot, minimap,
and navigation entry basenames were renamed where present. Display names remain
Washoi DM2, Washoi DM5, and Washoi DM11. Earlier sections record the packaging
history; their `washoidm*` names describe the intermediate names, not current IDs.

`scripts/rename-map-packages.mjs` now builds these names directly from the original
archived map packages. ZIP CRCs and every extracted entry's SHA256 are checked;
[the resulting entry manifest](media/map_underscore_renames.json) records all names
and hashes. Original BSP bytes, texture paths, shader paths, and geometry remain
unchanged. `washoi_textures.pk3` still hashes to
`b4e68de1258bac8827a478d9674d296dbd4a894b476c33fdbc7e0717d5151d8e`.

Intermediate packages were moved to
`archive/media/map-renames/pre-underscore/`; the old metadata is backed up in
`.cache/pre-underscore-metadata/`. The active directory still has
17 archives and six maps. Regenerated `pk3_index.json` / `pk3_manifest.json` and
all renamed packages are ignored local deployment artifacts, so deploy them
alongside the source changes. The loose DM2 lobby preview was copied to
`public/data/levelshots/washoi_dm2.jpg`.

Lobby IDs, the learned DM2 route filename/map field, CLI defaults, the timedemo
recipe's map field, and manual examples use the final IDs. Route contents and
historical recording/benchmark filenames are retained. Demo lookup accepts both
`wdm2`/`wfdm5`/`wfdm11` and `washoidm2`/`washoidm5`/`washoidm11`, without
rewriting recording headers or events. Historical map entries remain inactive in
the lobby config for display-name lookup.

### Validation for the map naming and HUD papercuts

The accompanying HUD work defaults the crosshair to 32, synchronizes its empty
red X with the HUD's equipped weapon/ammo, and enlarges the live Tab scoreboard
by 50% on desktop and 15% below 860px. Existing saved crosshair sizes remain
respected. Empty means no usable loaded ammo or reserve; the blade is not empty.
The result screen retains its own scale.

Commands run (logs under `.cache/`):

- `npm run tools:rename-maps -- --output-dir .cache/map-underscore-renames`: pass,
  CRC and per-entry byte hashes verified.
- `npm run tools:pk3-index`: pass, 17 packages / six maps. An initial Windows
  overwrite-rename failure was resolved by archiving the old metadata before
  generating fresh files; the subsequent normal build also regenerated it.
- `npm run typecheck`: pass.
- `npm run gate:biome`: pass, zero errors and 319 warnings against 339 baseline.
- `npm run build`: pass (existing chunk-size warnings).
- `npm run docs:build` and `npm run docs:fps:build`: pass.
- `npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`:
  624 files passed, 5,135 tests passed and one skipped before the final ID change.
- `npm run test:run -- src/games/fps/client/__tests__/CrosshairAmmo.test.ts src/games/fps/client/__tests__/CrosshairLifecycle.test.ts src/games/fps/client/__tests__/ScoreboardSides.test.ts src/games/fps/client/__tests__/ScoreboardPostGame.test.ts`:
  16 tests passed.
- `npm run test:run -- src/games/fps/client/__tests__/DemoMapAliases.test.ts src/engine/loader/pk3/__tests__/NodePk3.test.ts src/lobby/integration/RoomToRanking.test.ts src/lobby/integration/DropIn.test.ts`:
  lobby integration and aliases passed; the uppercase map fixture still used
  the intermediate spelling. Corrected it to `WASHOI_DM2`, then ran
  `npm run test:run -- src/games/fps/client/__tests__/DemoMapAliases.test.ts src/engine/loader/pk3/__tests__/NodePk3.test.ts`:
  all 12 tests passed.
- `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`,
  `npm run server:fuzz -- --ticks 1000`: pass.
- `node .cache/run-map-bsp.mjs`: pass; invokes the project's vite-node headless
  runner with one intact `--exec` argument:
  `bsp load washoi_dm2; bsp info; bsp load washoi_dm5; bsp info; bsp load washoi_dm11; bsp info; quit`.
  Faces: 7,475 / 1,353 / 675. The first shell-quoted attempt split its argument;
  the direct spawn invocation verified actual loading rather than command help.
- `node .cache/run-hud-replay.mjs`: pass; invokes the headless runner with
  `sim replay "W+CROUCH 60; JUMP 1; W 30"; quit`.
- `node .cache/hud-papercut-browser.mjs`: pass; real CSS/canvas in Chrome,
  Duel/FFA/team scoreboards at 480â€“1920px, no horizontal overflow, red X when
  empty and normal green reticle after refill. Desktop deaths 19.5px/ping 18px.

Assumptions: these three IDs are the canonical production IDs; legacy names
remain demo aliases rather than additional installed BSPs. No fresh manual
match or subjective gameplay QA has been done for these papercuts.

Exact source/document paths changed in this follow-up:

- `benchmarks/recipes/wdm2-ffa10.json`
- `config/bot-routes/washoi_dm2.json`
- `config/bot-routes/washoidm2.json`
- `config/maps.json`
- `docs/changelog/v0.9.32.md`
- `docs/manual/contributing/index.md`
- `docs/manual/deployment/web.md`
- `docs/manual/faq/index.md`
- `docs/manual/getting-started/index.md`
- `docs/manual/guides/bsp-system.md`
- `docs/manual/guides/console-system.md`
- `docs/manual/guides/headless-mode.md`
- `docs/manual/guides/map-launching.md`
- `docs/manual/guides/networking.md`
- `docs/manual/guides/physics-system.md`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/manual/guides/shagged-api.md`
- `docs/manual/guides/skybox-system.md`
- `docs/manual/guides/timedemo.md`
- `docs/manual/index.md`
- `docs/manual/tools/headless-bsp.md`
- `docs/manual/tools/headless-game.md`
- `docs/manual/tools/network-client.md`
- `docs/manual/tools/network-server.md`
- `docs/manual/tutorials/advanced/headless-testing.md`
- `docs/manual/tutorials/beginner/first-map-load.md`
- `docs/manual/tutorials/beginner/using-console.md`
- `docs/manual/tutorials/intermediate/fps-skeleton.md`
- `docs/manual/tutorials/intermediate/isometric-game.md`
- `docs/manual/tutorials/intermediate/map-viewer.md`
- `docs/manual/tutorials/quick-recipes.md`
- `docs/manual/tutorials/recipes/change-skybox.md`
- `docs/research/media/map_underscore_renames.json`
- `docs/research/media_packaging.md`
- `scripts/rename-map-packages.mjs`
- `src/cli/ServerRuntimeProbe.ts`
- `src/cli/bot-analyze.ts`
- `src/cli/compare-local-vs-server.ts`
- `src/cli/headless-netserver-v2.ts`
- `src/cli/map-media.ts`
- `src/cli/record-demo.ts`
- `src/cli/test-server-physics.ts`
- `src/cli/timedemo-fixture.ts`
- `src/engine/loader/pk3/__tests__/NodePk3.test.ts`
- `src/games/fps/Game.ts`
- `src/games/fps/client/Crosshair.ts`
- `src/games/fps/client/DemoMapAliases.ts`
- `src/games/fps/client/DemoService.ts`
- `src/games/fps/client/__tests__/CrosshairAmmo.test.ts`
- `src/games/fps/client/__tests__/DemoMapAliases.test.ts`
- `src/games/fps/client/hud/styles/WashikiTheme.css`
- `src/games/fps/docs/manual/developer/server-commands.md`
- `src/games/fps/docs/manual/faq/index.md`
- `src/games/fps/docs/manual/gametypes/index.md`
- `src/games/fps/docs/manual/gametypes/maps.md`
- `src/games/fps/docs/manual/getting-started/index.md`
- `src/games/fps/docs/manual/getting-started/troubleshooting.md`
- `src/games/fps/docs/manual/player/settings.md`
- `src/lobby/integration/DropIn.test.ts`
- `src/lobby/integration/RoomToRanking.test.ts`

Cold browser map check: `node .cache/map-underscore-browser.mjs` passed for
all three canonical IDs. Each fetched its matching map package,
`washoi_textures.pk3`, and `data0_21pure.pk3`, with no failed network requests
or browser errors. The existing 36sky side-image fallback probes remain absent
for DM2/DM5; DM11 probes absent KTX files before finding its other sky formats.
These source-media fallback observations are unchanged by the byte-preserving
rename. Browser report: `.cache/map-underscore-browser-report.json`.



### Loose ammo icon investigation

`public/data/gfx/hud/icons/ammo/` contains nine TGA images. Eight names are
referenced by `ProceduralPickupRecipes.ammoCrates` and `FPSPickup.AMMO_ICONS`:
bulletsammo, riotammo, grenadeammo, rocketammo, plasmaammo, laserammo,
electroammo, and instaammo. They are world ammo-crate side decals, despite their
legacy HUD directory. `createAmmoIconMaterial` resolves an already loaded PK3
texture first, then requests the loose `<path>.tga` fallback. The older MD3
ammo-box renderer follows the same policy. `gunbladeammo.tga` has no current
source reference. No assets were moved or removed in this investigation.


## Shared GFX package (2026-10-18)

The eight referenced ammo-crate icons now ship in `public/data/washoi_gfx.pk3`
(43,606 bytes), preserving their `gfx/hud/icons/ammo/*.tga` paths and image
bytes. The package contains a hash manifest, also recorded in
[media/gfx_package.json](media/gfx_package.json). This is packaging, not an
artwork or licensing replacement. The ninth icon, gunbladeammo, is unused and
not included. All nine originals are archived under
`archive/media/gfx/gfx/hud/icons/ammo/`; no loose icons remain served.

Rebuild: `npm run tools:gfx`, then `npm run tools:pk3-index`. The packager
accepts `-- --source-dir <root> --output <pk3>`; source paths mirror virtual
paths. It validates TGA headers, ZIP CRCs and byte hashes. The published index
now contains 18 archives and six maps. The PK3 and its archived source files are
local media artifacts; deploy the PK3 plus the regenerated metadata with code.

Both the procedural and MD3 ammo renderers call `loadAmmoIconTexture`, which
ensures the index, loads the TGA's owning package, then resolves the texture.
The loose-file fallback remains for custom media. This avoids requiring an
unrelated map's packages to be loaded first.

Files changed for this packaging step:

- `scripts/package-gfx.mjs`
- `package.json`
- `src/games/fps/world/pickups/AmmoIconTexture.ts`
- `src/games/fps/world/FPSPickup.ts`
- `src/games/fps/world/pickups/procedural/ProceduralPickupMaterials.ts`
- `src/games/fps/world/pickups/procedural/__tests__/AmmoIconTexture.test.ts`
- `docs/manual/guides/pk3-filesystem.md`
- `docs/changelog/v0.9.32.md`
- `docs/research/media/gfx_package.json`
- `docs/research/media_packaging.md`

Validation:

- `npm run tools:gfx` and `npm run tools:pk3-index`: pass; eight unchanged icons.
- `npm run test:run -- src/games/fps/world/pickups/procedural/__tests__`: 29 tests
  passed, including indexed-owner loading order and custom loose fallback.
- `npm run typecheck`, `npm run gate:biome`, `npm run build`,
  `npm run docs:build`: pass. The gate caught a formatting issue left by the
  preceding uppercase map-fixture edit; formatting that existing changed test
  restored zero errors / 319 warnings against 339 baseline.
- `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`,
  `npm run server:fuzz -- --ticks 1000`, and `node .cache/run-map-bsp.mjs`:
  pass; the last command loaded all three canonical BSPs through the index.
- `node .cache/gfx-browser.mjs`: pass. Cold Chrome with the real pickup icon
  material rendered all eight images with alpha, loading only `washoi_gfx.pk3`.
  No failed network requests or browser errors; screenshot visually inspected.
  Loose icons were already archived, so they could not mask a missing package.

Assumption: only the eight source-referenced ammo icons belong in this initial
GFX bank. The legacy MD3 branch shares the tested loader but has not been
visually tested in a separate match; the production procedural material was
rendered directly. No gameplay rules or image pixels changed.

Full gate after GFX packaging:
`npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`
passed: 625 files, 5,140 tests passed and one skipped (357.46 seconds).
The run includes expected NullEngine/jsdom diagnostic output from renderer and
canvas fixtures; the test results passed. Log: `.cache/gfx-all-tests.log`.


## Production-ready levelshots packaged (2026-10-18)

The three supplied PNGs now live in map_washoi_dm2/5/11.pk3. Index/build
generation publishes only their small JPG previews (263,903 bytes total),
without restoring deleted artwork. Full-resolution originals remain unchanged
inside the archives. See [LEVELSHOT_PACKAGING.md](LEVELSHOT_PACKAGING.md) for
source paths, changed files, rebuild commands, validation and deployment notes.

## Amphi1 restored under the production map ID (2026-10-18)

Restored `archive/map_wamphi1.pk3` as
`public/data/map_washoi_amphi1.pk3` (1,501,956 bytes), containing
`maps/washoi_amphi1.bsp`. The 8,454,048-byte BSP matches the archived original
exactly: SHA256 `aff34c8869c86192a034a2720637124a34cbe06135406bfe26b80045aae78c0a`.
Texture and shader paths inside it are unchanged. `config/maps.json` now offers
`washoi_amphi1` / **Washoi Amphi1** as the sole Amphi map.

The existing map-media extractor selected 178 assets and 56 shaders from the
archived data packages staged in `.cache/wfbomb1-compile/media`. The only
unresolved reference is the non-rendered `noshader` sentinel; no visible render
material is unresolved. The original map archive has no levelshot or navigation
metadata, and no thumbnail was invented. The UI uses its fallback until artwork
is supplied.

Merged dependencies into the existing **`washoi_textures.pk3`**, rather than
creating another shared texture bank: 103 added entries (including the canonical
`media-manifests/washoi_amphi1.json`) and 17 new shader definitions. Five shared
billboard images differed; the merge retained the existing Washoi images at
`textures/billboard/{bigbill1,bigbill2,bigbill5,bigbill6,neon1}.png`.
All other existing file hashes and shader definitions were verified unchanged
by the merge tool. The previous texture bank is backed up by content hash in
`archive/media/map-texture-merge/`. The resulting bank is 122,191,074 bytes,
SHA256 `2547024324fc7571b03343c5218fedf0aa728ebf859ec985c524e635bfd6b65e`.

Regenerated the published PK3 index/manifest and KTX2 cache: 80 converted,
824 skipped, zero errors. The production map index now advertises
`washoi_amphi1`, `washoi_dm2`, `washoi_dm5`, `washoi_dm11`, `washoi_snd1`.
A production-only dependency extraction also found zero unresolved visible
materials. Archived packages remain outside the served data directory.

Packaging and validation commands (logs `.cache/amphi-*`):

```text
npm run tools:manifest -- --data-dir .cache/wfbomb1-compile/media
npm run tools:map-media -- --data-dir .cache/wfbomb1-compile/media --maps wamphi1 --output-dir .cache/amphi-media
node scripts/rename-map-packages.mjs --rename wamphi1:washoi_amphi1 --source-dir .cache/amphi-media --output-dir public/data --keep-packaged-levelshot
node .cache/amphi-stage.mjs
node scripts/merge-map-textures.mjs --source .cache/amphi-media/tex_washoi_amphi1.pk3 --prefer-existing
npm run tools:manifest
node .cache/billboards/convert.mjs
npm run tools:map-media -- --maps washoi_amphi1 --audit-only --output-dir .cache/amphi-audit
npm run cli:game -- --exec "bsp load washoi_amphi1; bsp info; quit"
npm run test:run -- src/lobby/__tests__/LobbyAmphiMaps.test.ts
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
```

Tracked files changed: `config/maps.json`, `docs/changelog/v0.9.32.md`,
`docs/manual/guides/lobby-server.md`, `docs/research/media_packaging.md`.
PK3 archives, generated indexes/thumbnails and the texture cache are ignored
assets; deploy them alongside the configuration. Assumption: the original
archived Wamphi1 BSP is the desired release geometry. User services were left
running; restart the lobby to reload its playlist. Live multiplayer gameplay
on this restored map has not been tested.

Additional verification: `npm run build`, `npm run gate:biome` and
`npm run docs:build` pass. `node .cache/amphi-headless.mjs` loaded both
`washoi_amphi1` and `washoi_dm2` through the production index and printed their
BSP counts. Amphi has 2,155 faces, 24 entities and eight 512-square lightmaps.
The initial shell-quoted npm CLI invocation ran only command help; the
structured-argument runner corrected that. Its first regression check using
legacy `wdm2` failed because that archive is intentionally absent; the canonical
`washoi_dm2` check passed instead. No compatibility alias was added.

`node .cache/amphi-browser.mjs` exercised the full MapLoader in headless
Edge/WebGL2 on the real GPU. The arena rendered (screenshot
`.cache/amphi-packaging.png`), with 284 meshes, all textures ready and zero HTTP
failures. This was not a clean renderer diagnostic run: WebGL reported repeated
uniform-buffer-size warnings, a glow-overlay lightmap warning and
weapon/ammo model-path and skeleton warnings. These are recorded in
`.cache/amphi-browser-errors.json`; no renderer code changed in this packaging
follow-up. The screenshot was inspected, but this does not certify a complete
live Amphi match or resolve those renderer warnings. The private probe server
and browser were closed; user services remain untouched.
