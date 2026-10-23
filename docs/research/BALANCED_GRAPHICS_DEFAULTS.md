# Balanced graphics defaults

Balanced selects `r_bloom 0` and `r_anisotropy 4`. RenderVars startup/reset
defaults match. The user's “4× texture detail” is interpreted as the Textures
page's Sharpness setting (anisotropic filtering); `r_picmip` remains 0, keeping
full-resolution map textures. Pretty retains bloom 1.3 and 16× filtering.
Saved settings are retained; selecting Balanced applies the new values to an
existing setup.

PostProcessingManager disables its bloom pass when effective bloom weight is
zero, both through settings updates and the direct intensity setter. Positive
weight restores the pass subject to the existing master/effect switches.
RenderVars initializes postprocessing values during scene-service setup, after
the postprocessing service, so default bloom off is applied before gameplay.
No new listeners or timers are added.

Changed files (including the matching game revision):

- `src/engine/rendering/RenderVars.ts`
- `src/engine/__tests__/RenderVars.test.ts`
- `src/engine/effects/PostProcessingManager.ts`
- `src/engine/effects/__tests__/PostProcessingManager.test.ts`
- `src/games/fps/client/settings/SettingsModel.ts`
- `src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts`
- `src/games/fps/docs/manual/player/settings.md`
- `src/games/fps` (gitlink)
- `docs/manual/guides/render-variables.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/BALANCED_GRAPHICS_DEFAULTS.md`

Validation ran in the primary checkout, whose working trees were clean before
this change. Logs are under `.cache/balanced-defaults/`.

- `npm.cmd run test:run -- src/engine/__tests__/RenderVars.test.ts src/engine/effects/__tests__/PostProcessingManager.test.ts src/games/fps/client/settings/__tests__/SettingsModel.test.ts src/games/fps/client/settings/__tests__/FPSSettingsView.test.ts` passed 4 files / 80 tests after correcting the existing expected anisotropy default and making the direct intensity setter update pass enablement. The first focused run exposed those two failures.
- `npm.cmd run test:run -- src/engine/effects/__tests__/PostProcessingManager.test.ts src/engine/__tests__/RenderVars.test.ts` passed 2 files / 52 tests, including startup application of bloom off and disabling/restoring bloom through both update paths.
- `node .cache/balanced-defaults/validate.mjs` runs `npm.cmd run typecheck`, `npm.cmd run test:run`, `npm.cmd run gate:biome`, `npm.cmd run build`, `npm.cmd run build:server`, `npm.cmd run docs:build`, `npm.cmd run docs:fps:build`, `npm.cmd run test:simulation`, `npm.cmd run test:physics`, `npm.cmd run server:tick` and `npm.cmd run server:fuzz -- --ticks 1000`.
- The runner invokes `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec` with `bsp load washoi_dm2; bsp info; quit`, `sim replay "W+CROUCH 60; JUMP 1; W 30"; quit`, `help name; name; quit` and `help spectator; help giveweapon; giveweapon rlauncher; quit`.

Full-suite result: 711 files passed, one failed (5,613 tests passed, one failed,
one skipped). The failure is the previously logged RemoteWeaponLeak Firefox
case, waiting for weapon roots at line 100. All six cases passed in isolation
with `npm.cmd run test:run -- src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts`.
The cause of the full-run failure is not established; no weapon code or timeout
was changed. The failed full log remains `test-run.log`; the runner resumes
from `gate-biome` for the remaining checks. No clean full-suite pass is claimed.

Remaining checks passed: typecheck, Biome (0 errors / 47 baseline warnings),
client and server builds, both documentation builds, simulation, physics,
server tick and 1,000-tick fuzz. Tick checksum: 2768943778; fuzz checksum:
1471308140. Headless BSP inspection reported 7,475 faces; movement replay
completed 91 ticks. Name and camera-command checks also passed their expected
output assertions. Biome initially required formatting the new startup call;
the scoped formatter corrected it before the passing gate.

Unverified: GPU frame-time/FPS gains, visual browser testing and production
deployment. This change establishes settings and pass enablement; it does not
claim a measured performance improvement on a particular GPU.
