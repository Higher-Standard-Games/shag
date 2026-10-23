# Match loading audio and first-person readiness

The user reported combat sounds through the match loading screen and clarified
that their own held weapon remained invisible for several seconds after FFA
loaded. This papercut is separate from the engine/game ownership refactor.

The map asset preloader fills pickup sources. The first-person view owns a
separate ModelInstanceCache, initialized at join, and the initial weapon load
was fire-and-forget. The match post-load hold covered audio/collision/camera
setup but not this cache. Washoi now prepares its held weapon IDs, barrels and
material variants before releasing that hold; joining consumes the prepared
view once when its scene/camera still match. Other joins retain normal view
reinitialization. The initial equip is awaited. Normal asynchronous barrel
switch cancellation remains intact; only preload waits for weapon details.
A preparation failure disconnects instead of auto-joining with missing assets.

MapLoadingOverlay owns a temporary, reference-counted SFX mute from show until
hide, including the fade. Music and saved cvars are unchanged. The SFX bus
silences already-playing sounds and loops; muted one-shots and requests delayed
across a mute transition are dropped. Preloading buffers is still allowed.
Rapid restarts cancel stale fade/hide timers. Post-load hold watchdogs start
at map completion and refresh as weapon preparation advances, rather than
counting the preceding map load against the post-load budget.

Initial focused tests caught two implementation issues before final validation:
waiting for barrels in every normal load broke the existing disposal/cancellation
test, so the details wait is now specific to preload; loader camera setup was
resolved before asynchronous setup callbacks so the same camera dependency is
used for prediction and the held view. Focused regression set passed 5 files /
40 tests after these changes. A separate manager test covers overlapping mute
owners and preserved disabled-SFX/music settings.

Validation uses detached engine 4951541e / FPS 094e48a checkouts under
.cache/loading-papercut/checkout, overlaid only with the owned files below.
Dependencies, wasm and assets are linked; generated PK3 index/manifest metadata
is private. Other agents' unfinished team-color work is excluded. The snapshot
includes their already committed team-color fixes at those revisions.

Assumption: the existing FPS freefly and playing views use the same camera;
the prepared view is explicitly rejected if that scene/camera changed. No new
settings, persisted formats, weapon rules or network fields are introduced.
The older separation warmup report is not declared resolved by these changes.

Exact changed paths:

- `src/engine/AudioManager.ts`
- `src/engine/audio/AudioV2Sfx.ts`
- `src/engine/ui/MapLoadingOverlay.ts`
- `src/engine/weapon/WeaponViewManager.ts`
- `src/engine/__tests__/AudioV2Sfx.test.ts`
- `src/engine/__tests__/AudioManagerLoadingMute.test.ts`
- `src/engine/ui/__tests__/MapLoadingOverlayHidden.test.ts`
- `src/games/fps/Game.ts`
- `src/games/fps/client/MatchMapLoader.ts`
- `src/games/fps/client/FPSWeaponPreloader.ts`
- `src/games/fps/client/__tests__/MatchMapLoader.test.ts`
- `src/games/fps/client/__tests__/WeaponViewLoading.test.ts`
- `docs/manual/guides/model-loading.md`
- `src/games/fps`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/LOADING_READINESS_PAPERCUT.md`

Validation commands (isolated checkout unless marked primary):

- `node C:/Users/sundf/Desktop/wash/shag/.cache/loading-papercut/validate.mjs`
  runs `npm.cmd run typecheck`, `npm.cmd run test:run`,
  `npm.cmd run gate:biome`, `npm.cmd run build`,
  `npm.cmd run build:server`, `npm.cmd run docs:build`,
  `npm.cmd run docs:fps:build`, `npm.cmd run test:simulation`,
  `npm.cmd run test:physics`, `npm.cmd run server:tick`,
  `npm.cmd run server:fuzz -- --ticks 1000`, followed by the CLI batches below.
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec "bsp load washoi_dm2; bsp info; quit"`
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'`
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec "help name; name; quit"`
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec "help spectator; help giveweapon; giveweapon rlauncher; quit"`
- `npm.cmd run test:run -- src/engine/__tests__/AudioV2Sfx.test.ts src/engine/ui/__tests__/MapLoadingOverlayHidden.test.ts src/engine/ui/__tests__/MapLoadingOverlayHold.test.ts src/games/fps/client/__tests__/WeaponViewLoading.test.ts src/games/fps/client/__tests__/MatchMapLoader.test.ts`
  (primary): initial failures described above; final focused run passed 40 tests.
- `node C:/Users/sundf/Desktop/wash/shag/.cache/loading-papercut/checkout/.claude/skills/browser-probe/scripts/private-vite.mjs 3100`
- `node .cache/loading-papercut/probe.mjs fixed webgl2` (primary)
- `node .cache/loading-papercut/probe.mjs baseline webgl2` (primary)
- `node .cache/loading-papercut/probe.mjs fixed webgl2` again after restoring
  the fixed snapshot and checking every copied-file hash. Only the disposable
  checkout was swapped to saved originals for the baseline; primary source and
  other agents' edits were never reverted. The private server was restarted
  for each source version and stopped afterward.

All final isolated gates passed: 710 unit files / 5,605 passed tests / one
skipped, Biome zero errors / 47 baseline warnings, client/server builds, both
manual builds, simulation and physics. Tick checksum: 2768943778; 1,000-tick
random-seed fuzz reconciled at 2464602223. BSP: 7,475 faces; replay: 91 ticks.
The extra name/camera batches passed too.

Cold-browser real-GPU WebGL2 comparison on washoi_dm11: before the fix, the SFX
bus stayed at the selected 0.37 while the screen covered the map; no held GLB
sources were prepared at hidden, and the plasma equip imported a source then
(about 212 ms in this run). With the fix, the bus stayed zero while covered,
eight GLB weapon sources were ready at hidden, and plasma equip reused the
view with zero new source imports (about 66 ms in the final run). The remaining
weapon uses its MD3 path. Saved SFX 0.37 / music 0.23 were unchanged and the bus
returned to 0.37 after hiding. The first fixed probe sampled the gain at the
hidden event's exact tick, before WebAudio's parameter ramp settled; that
assertion was corrected to inspect the settled post-hide sample and rerun.
The screenshot was inspected: the held plasma gun is visible. Both browser
versions captured zero runtime exceptions and zero failed asset requests.

Limits: this browser harness uses the real MatchMapLoader with a local host
stand-in, then the same prepared-view handoff and load used by Game joining.
It does not play a live FFA match, test real account/lobby admission, listen to
audible output (headless Edge mutes its device), or validate WebGPU in a browser.
Existing skin-root, missing Instagun texture and world-material-readiness warnings
remain in the receipts; this task does not claim those separate reports fixed.
No user ratings/data or real accounts were changed. No production deployment.

Receipts: .cache/loading-papercut/validation, including gate logs,
baseline-webgl2.json, fixed-webgl2.json and the inspected fixed-webgl2.png.

Game commit: `1cfc111` (`fix: prepare held weapons before finishing match loading`).
