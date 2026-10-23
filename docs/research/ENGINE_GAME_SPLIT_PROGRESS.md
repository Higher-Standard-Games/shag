# Engine/game separation implementation log

The [source audit and plan](./ENGINE_GAME_SPLIT.md) and its inventory describe
the pre-refactor snapshot. This log tracks implementation separately so that
the original dependency counts remain useful as a baseline.

Each dependency removal gets its own commit, including its documentation.
Keep the installed Washoi game, tracked gitlink and production deployment
in place until the final assembly and game-free validation gates pass. Adapter
changes can advance the gitlink to a matching Washoi commit; removing the
gitlink and changing production checkout ownership happen later.

## 1. Scene command connection-state check

- **Dependency:** `src/engine/console/commands/SceneCommand.ts` imported
  `src/games/fps/Game.ts` lazily and called
  `Game.getInstance().isConnectedToServer()`.
- **Purpose:** `scene empty` must not install freefly controls while a network
  connection is active.
- **Replacement:** read `getNetworkConnector()?.isConnected() === true` from
  the existing engine registry. Washoi's adapter already delegates to the
  identical `Game` method; `src/main.ts` registers it during bootstrap.
- **Missing game:** a missing adapter means no active game network connection,
  so the command installs its local freefly controls.
- **Scope:** no network transport, protocol, renderer loop, game implementation
  or submodule metadata changes. Other dependencies inside the scene command's
  imported engine modules are separate work.
- **Assumption:** the application composition root owns adapter registration;
  engine tools do not construct a game singleton as a fallback.
- **Validation:** all commands below passed. Browser execution of `scene empty`
  with connected/disconnected clients has not yet been verified. These checks
  establish the existing application baseline, not a game-free build.

Validation commands executed on October 23, 2026:

```powershell
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build
npm.cmd run docs:build
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
node .cache/engine-game-split/validate-headless-step1.mjs
git -C C:/Users/sundf/Desktop/wash/shag diff --check
```

The full suite passed 695 files / 5,541 tests, with one skipped test. Biome
remained at zero errors / 47 warnings. Tick and fuzz determinism checks passed.
The final documentation build was rerun after the manual clarification.

The local headless runner invokes `node_modules/vite-node/vite-node.mjs` using
Node's executable and explicit argument arrays, avoiding command-shell quoting.
Its argument vectors after the executable are:

```json
["node_modules/vite-node/vite-node.mjs", "src/cli/headless-game.ts", "--", "--exec", "bsp load washoi_dm2; bsp info; quit"]
["node_modules/vite-node/vite-node.mjs", "src/cli/headless-game.ts", "--", "--exec", "sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit"]
```

Both exited zero, with output assertions for 7,475 BSP faces and 91 replay
ticks. The first command-shell wrapper incorrectly printed help for these two
checks despite exiting zero; those runs are not counted as passes. The corrected
`wdm2` attempt failed because that shorthand BSP is not installed locally;
`washoi_dm2` is the installed canonical map and passed through the PK3 index.
No map aliases or asset loading code were changed. Local logs are under
`.cache/engine-game-split/step1-validation/`.

Changed files for this dependency:

- `src/engine/console/commands/SceneCommand.ts`
- `docs/manual/guides/service-registries.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`

## 2. Join command participation request

- **Dependency:** `src/engine/console/commands/JoinCommand.ts` imported Washoi's
  `Game` singleton to call `isConnectedToServer()` and `joinGame()`.
- **Replacement:** the existing `NetworkConnector` interface has an optional
  `join(): Promise<void>` capability. The engine checks the registered adapter's
  connection state, then awaits `connector.join()`. The Washoi adapter delegates
  to the same `Game.getInstance().joinGame()` call with no arguments.
- **Ownership:** seat admission and requests, team preferences, loadout selection,
  pending-join guards and retries stay in Washoi. This callback uses the existing
  connection and does not invoke `connect()` or `claimSeat()` itself.
- **Compatibility:** existing adapters can omit `join`. A missing or disconnected
  adapter returns the existing no-connection response. A connected adapter
  without this capability gets an explicit unsupported response. Washoi retains
  its existing `Join requested` and `Failed to join: ...` response strings.
  `join` remains available without developer mode; its command definition is
  unchanged. The callback completing means the game handled the request, not
  that the server has granted a seat or a loadout picker has been completed.
- **Assumption:** the application continues registering Washoi's adapter at boot.
  This change does not claim that the rest of the engine can build without a game.
- **Commit boundary:** this one dependency needs a game adapter/test commit and
  an engine interface/command/test/docs commit pinning that game revision.
  Build and validate the pair together. For bisect or rollback, update the game
  checkout to the selected engine commit's gitlink too; the new game adapter
  requires the matching engine interface at typecheck time.
- **Validation:** the focused join-command, game team-selection and connecting
  overlay suite passed 3 files / 14 tests. The full suite passed 696 files /
  5,546 tests, with one skipped test. All gates and headless regressions passed.
  No browser playtest or production deployment has been performed for this step.
- **Washoi commit:** `69caa47` exposes the join callback and validates the lobby
  team handoff through the real adapter. The engine commit for this step pins it.

Validation commands executed on October 23, 2026:

```powershell
npm.cmd run test:run -- src/engine/console/__tests__/JoinCommand.test.ts src/games/fps/client/__tests__/GameJoinTeam.test.ts src/engine/ui/components/__tests__/ConnectingOverlayAdmission.test.ts
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build
npm.cmd run docs:build
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
node .cache/engine-game-split/validate-step2.mjs
node .cache/engine-game-split/validate-step2.mjs gate-biome
git -C C:/Users/sundf/Desktop/wash/shag diff --check
git -C C:/Users/sundf/Desktop/wash/shag/src/games/fps diff --check
```

The local runner invokes npm's CLI with explicit argument arrays. It performs
the listed gates and the same direct vite-node BSP/replay invocations documented
for step 1, asserting 7,475 faces for `washoi_dm2` and 91 replay ticks. Logs are
under `.cache/engine-game-split/step2-validation/`.

The first Biome gate found one formatting error in the new engine test: its
no-connection string declaration needed to occupy one line. After that
formatting-only correction, validation resumed at Biome; it passed at zero
errors / 47 warnings. Typechecking and the full suite had already passed before
the formatting correction. Simulation, physics, tick, 1,000-tick fuzz, canonical
DM2 loading and the movement replay all passed. No runtime source changed after
the full suite ran.

Changed files for this dependency:

- `src/engine/console/commands/JoinCommand.ts`
- `src/engine/console/__tests__/JoinCommand.test.ts`
- `src/engine/ui/components/NetworkConnector.ts`
- `src/games/fps/client/FpsNetworkConnector.ts` (Washoi repository)
- `src/games/fps/client/__tests__/GameJoinTeam.test.ts` (Washoi repository)
- `src/games/fps` gitlink (pins the matching Washoi revision)
- `docs/manual/guides/service-registries.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`

## 3. Freefly camera input ownership

- **Dependency:** `FreeflyController` imported Washoi's `FPSActions` module,
  called `registerFPSActions()` on attach, and read seven hardcoded FPS action
  IDs every frame.
- **Replacement:** engine-owned `FreeflyInput` specifies seven action IDs and an
  idempotent `prepare()` callback. The controller prepares/selects the mapping
  on attach and reads its action states through the same `InputSystem` each frame.
- **Washoi wiring:** `fpsFreeflyInput` maps movement to the identical FPS actions,
  rise to `FPS.JUMP`, sink to `FPS.CROUCH`, and boost to `FPS.SPRINT`.
  `src/main.ts` registers it before commands/UI can attach a camera, without
  eagerly initializing FPS actions. `registerFPSActions()` also registers the
  mapping for game initialization and direct game consumers. Its existing
  action/context registration guard remains in place; repeated preparation
  does not reset bindings or replace the active game context.
- **Game-free tools:** a missing adapter prepares engine-local `freefly_*`
  actions and a `freefly` context. Defaults remain WASD, Space, C/Ctrl/middle
  mouse and Shift. Registration is idempotent; the fallback context is only
  pushed if it is absent from the context stack. Global input action/context
  definitions persist across camera cuts, like the other input definitions.
- **Preservation:** the collision, speed/boost, smoothing, mouse-look and
  pointer-lock algorithms are unchanged. `GameFrameHook` still drives snapshots
  and remote-player rendering, including while pointer lock is released. The
  controller still removes its render observer on detach. No input context,
  saved binding key, action ID or gameplay movement rule is renamed in Washoi.
- **Assumptions:** one active game's mapping is registered before camera attach;
  changing the mapping takes effect on the next attach. Existing input-context
  definitions are preserved, including the distinction between FPS jump/crouch
  and the separately defined spectator fly actions. This step does not redesign
  those contexts or claim the whole engine can build without Washoi.
- **Validation:** focused NullEngine input, rebinding, focus-recovery, camera
  reuse, spectator and cinematic demo tests passed 6 files / 89 tests. Full
  gates and headless regressions passed; details below. No browser playtest or
  production deployment has been performed for this step.
- **Washoi commit:** `0ec70d1` supplies and exports the mapping and covers player
  rebindings with the real camera. The engine commit pins this game revision;
  bisect and rollback should restore both revisions together.
- **User playtest:** after engine commit `51b447b7`, the user confirmed that
  freefly worked as a spectator in a match. Map and gametype were not specified.

Validation commands executed on October 23, 2026:

```powershell
npm.cmd run test:run -- src/engine/camera/__tests__/FreeflyMovement.test.ts src/engine/camera/__tests__/ReusableFreeCamera.test.ts src/games/fps/client/__tests__/FreeflyBindings.test.ts src/engine/input/__tests__/InputFocusRecovery.test.ts src/games/fps/client/__tests__/SpectateView.test.ts src/games/fps/client/__tests__/CinematicDemoPlayer.test.ts
node node_modules/@biomejs/biome/bin/biome check src/engine/camera/FreeflyInput.ts src/engine/camera/controllers/FreeflyController.ts src/engine/camera/__tests__/FreeflyMovement.test.ts src/games/fps/client/FPSActions.ts src/games/fps/index.ts src/games/fps/client/__tests__/FreeflyBindings.test.ts src/main.ts
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build
npm.cmd run docs:build
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
node .cache/engine-game-split/validate-step3.mjs
git -C C:/Users/sundf/Desktop/wash/shag diff --check
git -C C:/Users/sundf/Desktop/wash/shag/src/games/fps diff --check
```

The full suite passed 697 files / 5,564 tests, with one skipped test. Biome
passed at zero errors / 47 warnings. The targeted preflight check initially
requested sorting the new game barrel export; that was corrected before the
full gates. Typecheck, build, documentation build, simulation, physics, tick
and 1,000-tick fuzz all passed. The runner uses explicit argument arrays,
including the same direct vite-node headless commands recorded for step 1:
`washoi_dm2` loaded through the PK3 index with 7,475 faces, and the movement
replay completed 91 ticks. Output assertions passed. Logs are under
`.cache/engine-game-split/step3-validation/`. The final whitespace check also
caught and corrected an extra blank line at the end of this implementation log.

Changed files for this dependency:

- `AGENTS.md` (remaining imports and registry guidance)
- `src/engine/camera/FreeflyInput.ts`
- `src/engine/camera/controllers/FreeflyController.ts`
- `src/engine/camera/__tests__/FreeflyMovement.test.ts`
- `src/main.ts`
- `src/games/fps/client/FPSActions.ts` (Washoi repository)
- `src/games/fps/client/__tests__/FreeflyBindings.test.ts` (Washoi repository)
- `src/games/fps/index.ts` (Washoi repository)
- `src/games/fps` gitlink (matching Washoi revision)
- `docs/manual/guides/camera-system.md`
- `docs/manual/guides/service-registries.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`

## 4. Concrete FPS controller and its dependents

- **Dependency:** the engine's `FPSController` imported Washoi's Game,
  FPSActions, InventoryManager, GibSystem and DamageNumbers. Engine camera
  barrels exported the concrete class. PlayerVisuals and two engine commands
  also depended on it.
- **Move:** `FPSController` and `components/PlayerVisuals` now live under
  `src/games/fps/camera`. Their controller ID remains `fps`. The game owns
  `spectator` and `giveweapon` through its existing command discovery. All
  production callers, type imports, lazy imports and test mocks use the new
  paths. The engine barrel no longer re-exports the concrete controller.
- **Engine capability:** `debug player` uses the already-existing optional
  `ICameraController.getPlayerPosition()` method, preserving its `fps` type
  gate, messages, dimensions, marker positions and observer cleanup. Binding
  the method preserves its receiver inside the render observer.
- **Headless composition:** the FPS headless game CLI explicitly registers the
  two moved commands after engine command discovery, preserving their previous
  availability without enabling all other FPS browser commands in the CLI.
  It imports their classes eagerly, matching their former eager discovery.
- **Initialization parity:** both old controllers registered
  `cam_freefly_speed`. A baseline probe imported the engine camera barrel and
  concrete FPS controller, then set this cvar to 333: FPS stayed 200, freefly
  became 333. The first moved version flipped ownership: FPS became 333 and
  freefly stayed 200. The redundant registration was removed from FPSController;
  the engine FreeflyController keeps the identical cvar registration. The
  corrected probe again gives FPS 200 / freefly 333, and a regression test
  covers this ownership. Other FPS debug cvar registrations stay with the class.
- **Preservation evidence:** the pre-move engine commit is `51b447b7`, with
  Washoi `0ec70d1`. An isolated detached checkout under
  `.cache/engine-game-split/step4-baseline` supplies the old graph. The four
  moved files have matching normalized AST hashes after excluding static
  imports/comments, canonicalizing only dynamic/type import paths, and excluding
  the one duplicate cvar registration. This covers their method bodies and
  data literals; it is not a claim of complete browser/runtime parity.
- **Findings during validation:** the first rebasing script incorrectly
  treated the `.fps-hud-bottom-center` CSS selector as a module path. The focused
  crosshair test caught the invalid selector. It was restored, and both the
  rebaser and preservation check were restricted to actual relative module
  paths. The debug-overlay test initially checked removal before Babylon's
  deferred observer cleanup; the assertion now waits one event-loop turn.
  The corrected focused run passed 7 files / 21 tests. No gameplay cleanup or
  movement tuning was folded into the move.
- **Headless startup finding:** the first broad run passed the full unit suite,
  build, documentation, simulation, physics, tick and fuzz checks, but BSP startup
  failed with `ERR_CLOSED_SERVER` while loading FPSHud's raw CSS. The new lazy
  command imports ran after vite-node began closing its loader because the CLI
  launches through `void runCli(main)`. Eagerly importing the two command classes
  restores the old load timing without modifying the CLI harness. The targeted
  BSP/replay/command checks then passed, with the original 53 registered commands
  and the original help/response text. Final gates run on that corrected source.
- **Assumptions and limits:** assemble matching engine/game revisions and
  update the game checkout when bisecting or reverting. Generic camera/input,
  viewport and animation-provider interfaces remain in the engine. Pickup
  ownership in EntityManager is separate work. The user's previous in-match
  freefly confirmation covers step 3, not this controller move. No new browser
  playtest, production migration or game-free application build is claimed.
- **Validation:** the final frozen-source run passed typecheck, all 700 test
  files (5,569 passed / one skipped), Biome (zero errors / 47 warnings), build,
  docs build, simulation, physics, deterministic tick and 1,000-tick fuzz.
  Canonical DM2 loading asserted 7,475 faces; the replay asserted 91 ticks;
  both moved CLI commands retained their help text and response. All exited
  zero. Receipts and proof hashes are under
  `.cache/engine-game-split/step4-validation/`.
- **Washoi commit:** `b315c7a` owns the controller, helper, commands and rewritten
  callers. The engine commit for this step pins it. Build/revert/bisect the
  engine and the pinned game revision together.

Validation commands executed on October 23, 2026:

```powershell
npm.cmd run test:run -- src/engine/console/__tests__/DebugPlayerCapability.test.ts src/games/fps/console/__tests__/CameraCommandRegistration.test.ts src/games/fps/client/__tests__/FPSControllerOwnership.test.ts src/games/fps/client/__tests__/CrosshairAmmo.test.ts src/games/fps/client/__tests__/MatchMapLoader.test.ts src/games/fps/__tests__/FPSPlayerBeamAmmo.test.ts src/engine/__tests__/CameraControllerDecoupling.test.ts
node .cache/engine-game-split/prove-step4.mjs
node node_modules/vite-node/vite-node.mjs .cache/engine-game-split/probe-init-step4.ts
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build
npm.cmd run docs:build
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
node .cache/engine-game-split/validate-step4.mjs
node .cache/engine-game-split/validate-step4.mjs bsp
git -C C:/Users/sundf/Desktop/wash/shag diff --check
git -C C:/Users/sundf/Desktop/wash/shag/src/games/fps diff --check
```

The baseline cvar probe also ran as `node node_modules/vite-node/vite-node.mjs
probe-init.ts`, with its working directory set to
`.cache/engine-game-split/step4-baseline`. The validation runner invokes npm's
CLI directly with argument arrays and performs the same BSP/replay checks
documented for step 1. It additionally executes this headless command batch:
`help spectator; help giveweapon; giveweapon rlauncher; quit`, asserting both
command descriptions and the unchanged inactive-FPS response. After the CLI
import correction the complete gates were rerun on frozen runtime source.

Changed files for this dependency (old engine files are removed, not shims):

- `AGENTS.md`
- `src/engine/camera/controllers/FPSController.ts` (removed)
- `src/engine/camera/controllers/components/PlayerVisuals.ts` (removed)
- `src/engine/camera/controllers/index.ts`
- `src/engine/console/commands/SpectatorCommand.ts` (removed)
- `src/engine/console/commands/GiveWeaponCommand.ts` (removed)
- `src/engine/console/commands/DebugCommand.ts`
- `src/engine/console/__tests__/DebugPlayerCapability.test.ts`
- `src/engine/__tests__/CameraControllerDecoupling.test.ts`
- `src/main.ts`
- `src/cli/headless-game.ts`
- `src/games/fps` gitlink
- `src/games/fps/camera/FPSController.ts`
- `src/games/fps/camera/components/PlayerVisuals.ts`
- `src/games/fps/console/commands/SpectatorCommand.ts`
- `src/games/fps/console/commands/GiveWeaponCommand.ts`
- `src/games/fps/console/__tests__/CameraCommandRegistration.test.ts`
- `src/games/fps/client/__tests__/FPSControllerOwnership.test.ts`
- `src/games/fps/FPSPlayer.ts`
- `src/games/fps/Game.ts`
- `src/games/fps/world/FPSPickup.ts`
- `src/games/fps/client/DroppedWeaponRenderer.ts`
- `src/games/fps/client/MatchMapLoader.ts`
- `src/games/fps/client/__tests__/CrosshairAmmo.test.ts`
- `src/games/fps/client/__tests__/MatchMapLoader.test.ts`
- `src/games/fps/__tests__/FPSPlayerBeamAmmo.test.ts`
- `docs/manual/guides/camera-system.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT.md` (links the audit snapshot to implementation progress)
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`
