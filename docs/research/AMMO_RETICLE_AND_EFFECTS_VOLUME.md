# Empty-ammo reticle and effects volume

Date: 2026-10-18. Branch: `v0.9.32-media-packaging`.

The red X renderer and shared `getAmmoStatus()` calculation were working, but
`FPSController.update()` drew the crosshair again after
`Game.renderRemotePlayers()`. That second call omitted `outOfAmmo`, clearing
the X and replacing it with the normal reticle in the same frame. Removed the
camera's duplicate initialization/draw block. `Game` already initializes the
overlay and updates it from the HUD's equipped weapon/ammo state every frame;
demo playback retains its existing separate update path.

The default `s_sfxvolume` is now 1 (100%), as is the audio backend's initial
volume. Registration uses a fixed default rather than the current volume, and
applies the saved Cvar value immediately. Existing custom levels therefore
remain effective and do not become the reset default. Audio page reset returns
effects to 100%. Existing users can select 100% or reset Audio to adopt it.

## Files

- `src/engine/camera/controllers/FPSController.ts`: remove the second reticle draw.
- `src/engine/AudioManager.ts`: full-volume default and apply saved effects volume.
- `src/engine/audio/AudioV2Sfx.ts`: full-volume backend initialization.
- `src/engine/__tests__/AudioManagerDefaults.test.ts`: defaults, saved levels and reset.
- `src/games/fps/client/__tests__/CrosshairAmmo.test.ts`: full camera-frame regression.
- `docs/changelog/v0.9.32.md`, `docs/manual/guides/camera-system.md`,
  `src/games/fps/docs/manual/player/settings.md`: behavior and defaults.

## Validation

`npx vitest run src/games/fps/client/__tests__/CrosshairAmmo.test.ts src/engine/__tests__/AudioManagerDefaults.test.ts`
passes five tests. The new camera-frame case draws an empty Voltaic through the
game callback, runs the rest of the real FPS controller update, checks the red
X remains, refills the weapon, and checks normal rendering returns. Restoring
only the old camera block makes this case fail (one fail, two pass), confirming
the cause; the fixed source was restored immediately afterwards.

A headless browser probe uses the real FPS controller and Canvas2D reticle,
with a controlled game callback and ammo state. After a full frame, empty ammo
produces 372 red pixels and zero green pixels. Refilling produces zero red and
16 green pixels. Browser effects default and applied level both report 1.
Screenshot: `.cache/ammo-red-x-fixed.png`; report:
`.cache/ammo-volume-browser-report.json`. The only browser warning is a
Canvas2D readback optimization hint from pixel measurement; no requests fail.
This is a controlled frame reproduction, not a live multiplayer match.

Commands run:

- `npm run typecheck`, `npm run gate:biome`, `npm run build`.
- `npm run test:run`.
- `npm run test:simulation`, `npm run test:physics`, `npm run server:tick`,
  `npm run server:fuzz -- --ticks 1000`.
- `node .cache/run-map-bsp.mjs`: headless load/info for `washoi_dm2`,
  `washoi_dm5`, `washoi_dm11` through the production index, then quit.
- `npm run docs:build`, `npm run docs:fps:build`.

Typecheck, Biome, build, both manual builds and all listed gameplay/server/BSP
regressions pass. The full suite has 5,165 passing tests and one skipped, with
the same five editor compiler failures in four files: `ConvexCompile.test.ts`
(two), `NaturalCompile.test.ts`, `PlaytestCompile.test.ts` and
`RoundPatchCompile.test.ts`. Their archived `textures/blx/blx_grid` material is
missing (`noshader` also appears in convex fixture errors). These failures
predate this change; no tests were weakened or editor banks restored.

Assumptions: the X remains hidden when the player disables the crosshair or HUD,
and saved volume choices should be preserved. No gameplay/network protocol or
weapon balance changes are made.
