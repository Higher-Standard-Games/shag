# Spectator freefly and levelshot HUD controls

2026-10-18. Work remains on the existing media/papercut branch.

## Changes

FPS spectator entry disables freefly collision and explicitly enables its
controller before activating it. Controllers are reused: automated camera and
editor flows can disable a controller, and attach does not reset that state.
Mouse look has its own handler, so a disabled controller can rotate while its
movement update returns immediately. This was reproduced deliberately in the
browser and recovered through the real SpectateView transition. The original
reported match transition has not been reproduced in a fresh multiplayer match.

Freefly's default collision flag is now false, matching its documented default.
`freefly_collision` remains available for explicit debugging. Entering spectator
freefly resets collision to off even if debug collision was enabled previously.
The collision backend and player movement rules are unchanged.

`cl_hud 0` hides gameplay HUD, crosshair, phase/ready banners, chat, damage and
bomb overlays, pickup prompt, spectator hints, demo controls, FPS and debug
readouts. `cl_hud 1` restores their existing visibility states. The setting is
not persisted, defaults to 1, and keeps menus/console usable. It does not hide
the weapon model or the interactive postgame screen. Close the console before
capturing a levelshot. The CSS rule applies to overlays created later too.

## Exact files changed for these two papercuts

- `src/engine/camera/controllers/FreeflyController.ts`
- `src/engine/camera/__tests__/FreeflyMovement.test.ts`
- `src/games/fps/client/SpectateView.ts`
- `src/games/fps/client/__tests__/SpectateView.test.ts`
- `src/games/fps/client/HudVisibility.ts`
- `src/games/fps/client/FPSHud.ts`
- `src/games/fps/client/hud/styles/WashikiTheme.css`
- `src/games/fps/client/__tests__/HudVisibility.test.ts`
- `src/games/fps/docs/manual/player/settings.md`
- `docs/manual/guides/camera-system.md`
- `docs/changelog/v0.9.32.md`
- `docs/research/SPECTATOR_HUD_PAPERCUTS.md`

Earlier uncommitted media/HUD work is separate from this list.

## Validation

Headless before browser:

- `npm run test:run -- src/engine/camera/__tests__/FreeflyMovement.test.ts src/engine/camera/__tests__/ReusableFreeCamera.test.ts src/games/fps/client/__tests__/SpectateView.test.ts src/games/fps/client/__tests__/HudVisibility.test.ts src/engine/input/__tests__/InputFocusRecovery.test.ts`: pass, 37 tests.
- `npm run typecheck`: pass.
- `npm run gate:biome`: pass, zero errors / 319 warnings versus 339 baseline.
- `npm run test:simulation`: pass.
- `npm run test:physics`: pass, Y position maintained.
- `npm run server:tick`: pass.
- `npm run server:fuzz -- --ticks 1000`: pass.
- `node .cache/run-map-bsp.mjs`: pass; direct headless argv equivalent to
  `npm run cli:game -- --exec "bsp load washoi_dm2; bsp info; bsp load washoi_dm5; bsp info; bsp load washoi_dm11; bsp info; quit"`.
- `node .cache/run-hud-replay.mjs`: pass; headless
  `sim replay "W+CROUCH 60; JUMP 1; W 30"; quit`.
- `npm run build`: pass, existing bundle-size warnings.
- `npm run docs:build` and `npm run docs:fps:build`: pass.

Browser: `node .cache/spectator-hud-browser.mjs` passed on the private Vite
server at port 3162. The fixture loaded washoi_dm5 using real MapLoader code,
registered its freefly controller with CameraSystem, disabled it, then invoked
the real SpectateView.switchToFreeflyCamera. Held W moved zero units while
disabled and approximately 102 units after recovery over 500ms. Enabled=true,
collision=false. Real HUD CSS hid/restored twelve representative root overlays
and left the match menu visible. No failed HTTP requests or page errors.
Report: `.cache/spectator-hud-browser.json`; hidden-HUD screenshot inspected.
This tests the transition and CSS directly, not a full match menu interaction.

Initial scratch browser probes omitted Babylon's collision-coordinator import
and halted their render loop when enabling debug collision; corrected the
fixture before measuring. An empty-room headless check and map browser check
showed normal key binding input. The collision-on isolated map probe did not
reproduce the user's original symptom, so collision alone is not a confirmed
root cause. Explicit enabling is a guard against reused disabled controllers.

Assumptions: spectator freefly should be noclip; cl_hud is a session-only
screenshot tool. Exact original multiplayer reproduction and manual QA remain
unverified. No new timers or EventBus subscriptions were added to production.

Full gate: `npm run test:run -- --poolOptions.forks.singleFork=false --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1`
passed all 627 files: 5,143 tests passed, one skipped, 372.09 seconds.
Log: `.cache/spectator-hud-all-tests.log`. The screenshot CSS uses a scoped lint
exception for `!important`, required to override widgets' inline display states;
Biome stays at zero errors and 319 warnings with the existing baseline unchanged.
