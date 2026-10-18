# Sound pack replacement

Date: 2026-10-18. Branch: `v0.9.32-media-packaging`.

## Installed result

`public/data/washoi_sounds.pk3` contains **290 audio files**:

| Source bank | Files | Use |
| --- | ---: | --- |
| CC0 | 246 | Player voices, world, pickups, announcers, kill confirmation, UI aliases |
| CC BY-SA 3.0 US | 44 | Weapons and reload alias, using strong variants where offered |
| CC BY-SA 4 Warsow | 0 | Not selected |
| Padpork | 0 | All 16 recordings explicitly excluded |

The original `washoi_legacy_audio.pk3` is preserved outside the served directory
at `archive/media/sound-replacement/washoi_legacy_audio.pk3`. The initial all-CC0
bank is backed up as `washoi_sounds.before-team-voices.pk3` in the same folder.
Production discovery lists only the new bank. Music, models and textures remain
separate; this report does not claim that all game media has these licenses.

## Provenance and license mapping

Source: [TeamForbiddenLLC/warfork-free-soundpacks](https://github.com/TeamForbiddenLLC/warfork-free-soundpacks),
revision `8005f47869cbac20608f1d606621e4b8fcdec574`, read from the Desktop checkout.
Only the `cc0/` and `cc-by-sa-30-us/` directories are used.

- `cc0/warfork_assets_cc0.txt` applies CC0 1.0 Universal to that directory,
  with Team Forbidden's waiver. Upstream credits Caine and MaxCarnage.
- `cc-by-sa-30-us/warfork_assets_cc-by-sa-30-us.txt` applies CC Attribution-
  ShareAlike 3.0 United States. Its attribution is **Michael 'Tenshihan' Quinn**,
  copyright Team Forbidden LLC. The notice links the license and legal code.

Both upstream notices are embedded under `licenses/`. The embedded manifest and
tracked `config/sound-package.json` identify every file's source, SHA-256,
license and modifications. Recordings are byte-identical to upstream; the only
changes are filename aliases. The package is not labeled wholly CC0. Retain its
notices and attribution when distributing it; its per-file license mapping
identifies the CC BY-SA recordings.

Staged build inputs are under ignored `assets-source/sounds/`, preserving the
upstream license-directory prefixes. The Desktop checkout was not modified.

## Weapon selection

All 44 packaged `sounds/weapons/` destinations use CC BY-SA 3.0 US sources.
Firing selectors already choose these strong versions:

| Weapon | Firing recording |
| --- | --- |
| Blade | `blade_strike1/2/3.ogg`; projectile impacts use `bladegun_strong_hit_1/2/3.ogg` |
| Machinegun | `machinegun_fire.ogg` (no separate strong-named variant) |
| Riotgun | `riotgun_fire_strong.ogg` |
| Grenade Launcher | `grenlaunch_strong.ogg` |
| Rocket Launcher | `rocket_fire_strong.ogg` |
| Plasma Gun | `plasmagun_strong1/2/3.ogg` |
| Voltaic | `laser_strong_fire.ogg` |
| Electrobolt | `electrobolt_strong.ogg` |
| Instagun | `instagun_strong.ogg` |

Projectile impacts, flight/hum and supported compatibility paths also use the
CC3 recordings. No weak weapon variants were added. Blade remains CC3, as the
final user choice; no CC4 restoration was performed.

## What is actually used

See the complete **[file/status matrix](./media/sound_replacement_matrix.md)** and
**[machine-readable inventory](./media/sound_replacement.json)**. The matrix also
includes 16 explicit removed rows for Padpork. Each retained row records source,
license, hash, replacement status, preload membership, code and BSP references.

| Classification | Files | Meaning |
| --- | ---: | --- |
| Supported FPS cue/preload bank | 112 | Combat, announcers, player voices, movement, pickups, liquids, powerups, bomb mode and reload |
| Preload without playback | 2 | `underwater.ogg`, `underlava.ogg`; submerged loops are not wired |
| Additional literal code references | 4 | Teleport entry and three default lift/door cues |
| UI aliases | 2 | Existing extensionless click/button keys |
| Compatibility only | 170 | No current exact caller or expanded preload found; retained supported bank paths |
| **Packaged total** | **290** | **246 CC0 + 44 CC BY-SA 3.0 US** |

The audit executes the real FPS preloader with audio output stubbed, scans
TypeScript string literals outside tests, and reads entities/lift definitions
from `washoi_dm2`, `washoi_dm5` and `washoi_dm11` through the PK3 resolver. These
BSPs add no sound paths. There are zero unmatched expanded preload/BSP paths.
Preloading proves availability, not that every cue plays in each match. S&D
announcers remain supported despite the current Duel/FFA production map pool.
Dynamically selected player voices are expanded by `FPS_PLAYER_SOUND_PATHS`.

Generic weather code still references loose `/sounds/rain.mp3` and
`/sounds/thunderstorm.mp3`. They were not in the old bank, are not supplied by
these sound packs, and are not added here. Announcer stem strings reported in
`otherCodePaths` expand to real preloaded variants, rather than missing assets.
Static auditing cannot prove coverage of arbitrary future map/script paths.

## Player voice preferences

Gameplay settings, **Who's who**, has a **Sounds** dropdown beside each side's
color row: **Male**, **Female**, **Bobot**. Defaults:

| Side | Default | Persisted cvar |
| --- | --- | --- |
| Your side | Male | `cl_team_ally_sounds` |
| Enemies | Bobot | `cl_team_enemy_sounds` |

These apply immediately to existing pain, death and jump cues, and to local
player drowning. Footsteps, weapon sounds and world splashes remain shared.
Your own player uses your side's bank; teammates use the same bank through the
same canonical team aliases as colors. In FFA, every other player is an enemy.
Spectator/demo playback uses the followed player's perspective; free spectators
with no followed player treat everyone as enemies. Invalid stored/console
values fall back to Male/Bobot and cannot become arbitrary file paths.

The choices save through the normal Cvar preference system. Gameplay reset
restores Male/Bobot. All three banks' eight currently used voice cues are
preloaded, so switching does not depend on downloading a new bank. Their other
recordings remain compatibility media; this does not add new walljump/dash/fall
sound events. Padpork is removed from the recipe, PK3 and UI choices.

## Reload and kill echo

There is no dedicated reload-named recording in the supplied packs.
`sounds/weapons/reload.ogg` aliases the **CC3** `weapon_switch.ogg` recording:
0.666 seconds, peak 0.341. It is a mechanical reload-start cue, not bespoke
magazine-change foley. The reload observer uses the existing authoritative
`weapon_state.reloading` field for clip weapons. Viewed players use 2D audio;
others use their world transform. Repeated snapshots do not repeat the cue.
State is pruned on despawn and reset on map cleanup/demo discontinuities; seek
landings prime it silently. No protocol change or extra timers are needed.

Kill echo was already wired: a death event where the viewed player is the killer
and not the victim plays `sounds/misc/kill.wav`. It now uses CC0: 0.833 seconds,
peak 0.819, RMS 0.354. It uses the `hits` channel and `cg_volume_hitsound`, under
the effects volume. There is no extra duplicate trigger. Subjective mix and
sound character still require human listening; muted browser playback verifies
successful loading and sound-instance creation rather than auditory approval.

UI aliases remain CC0: `ui_click.wav` uses `sounds/menu/mouseover.wav`;
`button_press.wav` uses `sounds/menu/ok.wav`.

## Build and deploy

1. Stage the recipe's files/notices from the pinned upstream checkout under
   `assets-source/sounds/`, including the license-directory prefixes.
2. Run `npm run tools:sounds`. Source hashes are checked before output is written;
   the ZIP is CRC/hash checked on readback. Identical inputs rebuild identical bytes.
3. Keep older sound banks outside `public/data`; run `npm run tools:pk3-index`.
4. Run `npm run tools:sounds:audit` to regenerate the matrix.

Package: **9,835,485 bytes**, 290 audio files, two license notices and one
manifest. SHA-256:
`95595848220c626ff1cc5068286d5a46dc6622edc4eb4daf38ce08d15d6a900b`.
The original legacy bank was 7,189,575 bytes. Different recordings and compatibility
content account for the size; there are no duplicate source PK3s mounted.

Binary media, staged sources and published metadata are gitignored. Deployment
must include the installed PK3 and regenerated discovery metadata alongside code.

## Validation

[Decode measurements](./media/sound_decode.json) and
[package verification](./media/sound_package_verification.json) record current
hashes and browser results. All 290 files decode, none are silent at a peak
threshold of 0.001, all output/source hashes match, all index owners resolve to
`washoi_sounds.pk3`, and the legacy bank is absent. The real Babylon Audio V2
probe decodes 116 buffers (114 FPS plus two UI aliases), creates kill/reload/UI
voices, and reports no load warnings. Browser settings screenshots verify the
two dropdowns beside the color rows; defaults are Male/Bobot.

Commands for this update:

- `npx vitest run src/games/fps/client/__tests__/FPSPlayerAudio.test.ts src/games/fps/client/__tests__/FPSCombatAudio.test.ts src/games/fps/client/__tests__/FPSMovementAudio.test.ts src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts` — 28 passing.
- `npm run typecheck`, `npm run gate:biome`, `npm run build` — pass.
- `npm run docs:build`, `npm run docs:fps:build` — pass.
- `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`,
  `npm run server:fuzz -- --ticks 1000` — pass.
- `node .cache/run-map-bsp.mjs` — all three production BSPs load/info/quit pass.
  It passes `bsp load washoi_dm2; bsp info; bsp load washoi_dm5; bsp info; bsp load
  washoi_dm11; bsp info; quit` as one CLI argument.
- `npm run test:run` — **5,162 pass, 1 skipped; five existing editor failures** in
  `ConvexCompile.test.ts` (two), `NaturalCompile.test.ts`, `PlaytestCompile.test.ts`,
  `RoundPatchCompile.test.ts`. Missing archived `textures/blx/blx_grid`
  (`noshader` also reported in convex fixtures); no tests weakened or editor
  media restored. The full suite is not completely green.
- `npm run tools:sounds`, `npm run tools:sounds:audit`, `npm run tools:pk3-index`
  — pass; zero unmatched bank/BSP paths.
- `node scripts/package-sounds.mjs --output .cache/washoi_sounds.rebuild.pk3`
  — byte-identical verified rebuild.

Assumptions: client-only voice preferences, unchanged game
rules, existing event coverage, and the current three-map production pool.
No subjective loudness comparison or multiplayer listening session is claimed.

## Files for the player-voice and CC3 update

Engine: `config/sound-package.json`, `scripts/package-sounds.mjs`,
`src/cli/audit-sounds.ts`, `docs/changelog/v0.9.32.md`,
`docs/manual/guides/pk3-filesystem.md`, this report and its four linked
`docs/research/media/sound_*` matrix/measurement/verification files.

FPS: `client/FPSPlayerAudio.ts`, `client/FPSAudio.ts`, `client/FPSCombatAudio.ts`,
`client/FPSMovementAudio.ts`, `client/FPSLiquidAudio.ts`, `client/GameEvents.ts`,
`client/settings/{GameplayPage.ts,FPSSettingsView.ts,FPSSettingsView.css,SettingsModel.ts}`,
`client/__tests__/{FPSPlayerAudio.test.ts,FPSCombatAudio.test.ts}`,
`client/settings/__tests__/FPSSettingsView.test.ts`, `docs/manual/player/settings.md`.

Other uncommitted projectile/plasma/halo/lobby-return and initial sound-reload
work remains preserved. No commits or pushes were made for this update.
