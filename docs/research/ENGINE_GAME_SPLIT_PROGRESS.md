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

### Step 4 browser follow-up: intermittent warmup failure

After the controller move, the user reported a DM11 loading-screen freeze at
effect warmup, a TypeError reading `0` from undefined rethrown at `main.ts:384`,
uniform-buffer draw errors, and an expired postload hold. The user subsequently
reported that the map loaded. Their later console capture does not contain the
original TypeError or uniform-buffer error. The original failing stack and the
reason the next load succeeded remain unverified; neither a regression fix nor
an HMR/cache explanation has been established.

Fresh headless Edge WebGL2 probes against the unchanged step-4 revisions
(engine `0030c2f1`, FPS `b315c7a`) did not reproduce either error. Direct DM11
loading completed 5,307 frames; connected probes with one local server bot
completed 5,261 frames on a private no-HMR Vite server and 5,489 frames on the
existing port-3000 dev server. Each captured zero window errors/unhandled
rejections, and the console captures contain neither original failure.
Connected probes reached map rendering, but the server reported the clients as
spectators: these results do not verify joining and playing a match. Earlier
connected spectator probes, including `r_pickupProcedural 0`, also rendered
without captured exceptions. All probes used local `washoi_dm11`; no lobby,
rating database or production server was used. Headless validation preceded
these browser checks as recorded above.

The later user log still identifies a real readiness concern: 57 world meshes
were unready when the overlay closed. `MapLoader` explicitly permits a bounded
GPU-readiness wait and diagnoses unready world meshes on the overlay-hidden
event. This can expose holes until materials become ready; the capture does
not establish whether they remained unready. Missing ammo-model and projectile
texture warnings identify unresolved asset lookups. Babylon's skin common-root
warning continues into bone loading, rather than throwing at that warning.
Repeated entity/effect registrations replace existing map entries (effects
dispose their predecessors). WebTransport's invalid `ws` URL is caught by the
transport factory, which falls back to WebSocket. These observations do not
identify the original TypeError's cause.

Investigation commands (scratch probe source and JSON/PNG receipts are ignored
under `.cache/engine-game-split/`):

```powershell
node .claude/skills/browser-probe/scripts/private-vite.mjs 3100
node node_modules/vite-node/vite-node.mjs src/cli/headless-netserver-v2.ts -- --map washoi_dm11 --port 17777
node .cache/engine-game-split/freeze-probe.mjs before
node .cache/engine-game-split/freeze-probe.mjs connected-before
node .cache/engine-game-split/freeze-probe.mjs connected-bot-before
node .cache/engine-game-split/freeze-probe.mjs connected-bot-models-before
node .cache/engine-game-split/freeze-probe.mjs connected-auto-before
node .cache/engine-game-split/freeze-probe.mjs connected-shared-before
```

The scratch server console received `spawn_bots 1`. No runtime code was changed
for this investigation. On October 23, 2026, the user requested that separation
continue and this issue be investigated afterwards. This is an open, deferred
follow-up, not a resolved regression: capture the original TypeError's full
stack, reproduce the warmup/postload failure and uniform-buffer errors, and
check whether the 57 unready world materials eventually become drawable.
Joining and playing a match also needs verification. Preserve the step-4
revisions and probe receipts above when comparing subsequent separation steps.

## 5. Game-owned pickup manager and map lifecycle

The concrete `EntityManager`, its pickup-landing regression test and the
`spawn_pickable_entity` command move from the engine into Washoi. SHAG's
`GameMapEntities` registry exposes three synchronous callbacks. `MapLoader`
calls definition initialization at the original point before model dependency
discovery, handler registration after built-in BSP handlers and before entity
dispatch, and disposal before releasing preloaded models. A missing adapter
skips these game-owned callbacks. Both the browser and FPS headless composition
roots register `fpsMapEntities`; the headless runner explicitly registers the
moved command, preserving its availability. No compatibility reexport remains
at the old engine paths.

The manager's executable logic and command behavior are unchanged. A normalized
TypeScript comparison checks all three moved files against their original
sources, resolving imports to their relocated targets and ignoring comments,
import ordering and formatting/trailing commas. This preserves classname
aliases, shared pickup IDs, landing, suspended items, deterministic weapon yaw,
visual-factory selection, `whenReady()` awaits and entity disposal. The shared
definition tables/extractor and the remaining media dependency policy are
separate ownership work, not part of this step. Removal of direct engine-to-game
imports does not imply that all indirect Washoi dependencies are gone.

Tests cover real Washoi definition/alias registration, the loader's definition
→ dependency discovery → preload → handler registration → dispatch order,
pickup-before-model disposal, no-adapter disposal, and command discovery,
developer gating and spawn coordinates. The moved landing tests continue to
compare client positions/IDs against the shared server computation. The earlier
freefly cvar probe still reports `fps: 200, freefly: 333` after setting freefly
speed to 333. Initial validation caught a missing developer-mode setup and an
incomplete camera fixture type assertion in the new command test; both test
fixtures were corrected. An initial sandboxed Vitest launch failed with
`spawn EPERM`; subsequent runs allow its build/worker subprocesses.

Validation commands (October 23, 2026; scratch runner and receipts under
`.cache/engine-game-split/step5-validation`):

```powershell
npm.cmd run test:run -- src/engine/loader/map/__tests__/MapLoaderDispose.test.ts src/engine/loader/bsp/__tests__/PVSCuller.test.ts src/games/fps/world/__tests__/EntityManagerPickupLanding.test.ts src/games/fps/world/__tests__/FpsMapEntities.test.ts src/games/fps/console/__tests__/CameraCommandRegistration.test.ts
npm.cmd run test:run -- src/games/fps/console/__tests__/CameraCommandRegistration.test.ts
node .cache/engine-game-split/prove-step5.mjs
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
node .cache/engine-game-split/validate-step5.mjs
node .cache/engine-game-split/validate-step5.mjs test-run
```

The runner invokes npm's CLI with argument arrays for these gates/regressions.
It also runs the following headless batches through
`node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec`
with each batch supplied as one argument, avoiding PowerShell quote loss:

- `bsp load washoi_dm2; bsp info; quit` (canonical indexed name for wdm2;
  requires `Faces: 7475` in the output).
- `sim replay "W+CROUCH 60; JUMP 1; W 30"; quit` (requires 91 replay ticks).
- `help spectator; help giveweapon; giveweapon rlauncher; quit` (checks command
  descriptions and the unchanged inactive-FPS response).

The full unit rerun passed: 701 files, 5,572 tests passed and one skipped.
Biome passed at the existing baseline (zero errors, 47 warnings).

Build, docs build, simulation, physics, server tick, 1,000-tick fuzz, indexed BSP
load, replay and command checks all passed. Tick determinism checksum:
`2768943778`; fuzz checksum: `3719501268`. The additional command
`node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec
"help spawn_pickable_entity; developer 1; spawn_pickable_entity rlauncher; quit"`
confirmed the pickup command's help and retained 53 headless commands. With no
gameplay map loaded, definitions are empty and the manual spawn reports its
existing invalid-ID response; this is not a successful pickup-spawn test.
The command unit test separately verifies successful dispatch and coordinates.

After headless checks, `node .claude/skills/browser-probe/scripts/private-vite.mjs
3100` and `node .cache/engine-game-split/pickup-step5-probe.mjs` exercised a direct
local DM11 load in headless Edge WebGL2 with lobby connections disabled. The
probe observed 1,226 completed frames, all 30 map pickups matching the shared
table count with unique IDs, and zero captured errors/unhandled rejections.
Unloading left zero managed pickups and table entries, and every tracked pickup
node reported disposed. The screenshot shows the rendered map and a weapon
pickup; receipts are `browser.json` and `pickups.png` in the scratch validation
directory. The private server/browser were closed afterwards. This direct load
does not verify multiplayer joining, active masks or playing a match, nor does
it resolve the deferred step-4 warmup issue. No gametype or network match was
started by this probe.

A concurrent chat-size change landed as engine `a9e80a9e` / FPS `ca5212a` during
validation. Those commits are retained. The engine chat-size commit also picked
up the already-written pickup-separation changelog entry; the remaining step-5
changes are committed separately on top, with only their explicit paths staged.
The game-side step-5 commit is `3392457`; the matching engine commit pins it.

After step 5, the user reported successfully starting a server through the lobby
and inviting a bot. Record these two flows as user-reported manual checks.
The map, gametype and whether the user joined and played were not specified.
This does not resolve the deferred warmup issue or establish match-play parity.

Final whitespace checks:

```powershell
git -C C:/Users/sundf/Desktop/wash/shag diff --check
git -C C:/Users/sundf/Desktop/wash/shag/src/games/fps diff --check
```

Changed files for this dependency:

- `AGENTS.md`
- `src/engine/entities/EntityManager.ts` (removed)
- `src/engine/entities/__tests__/EntityManagerPickupLanding.test.ts` (removed)
- `src/engine/console/commands/SpawnPickupCommand.ts` (removed)
- `src/engine/loader/map/GameMapEntities.ts`
- `src/engine/loader/map/MapLoader.ts`
- `src/engine/loader/map/__tests__/MapLoaderDispose.test.ts`
- `src/engine/loader/bsp/__tests__/PVSCuller.test.ts`
- `src/main.ts`
- `src/cli/headless-game.ts`
- `src/games/fps` gitlink
- `src/games/fps/world/EntityManager.ts`
- `src/games/fps/world/FpsMapEntities.ts`
- `src/games/fps/world/__tests__/EntityManagerPickupLanding.test.ts`
- `src/games/fps/world/__tests__/FpsMapEntities.test.ts`
- `src/games/fps/console/commands/SpawnPickupCommand.ts`
- `src/games/fps/console/__tests__/CameraCommandRegistration.test.ts`
- `src/games/fps/index.ts`
- `docs/manual/guides/service-registries.md`
- `docs/manual/guides/bsp-system.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`

## 6. Washoi shared definition catalog

Concrete weapon, projectile, ammo and item definitions, their lookup table and
initializer move from SHAG's shared folder to
`src/games/fps/shared/entities/`. Both Washoi client and server still import
one catalog. Generic interfaces/defaults and EntityRegistry stay under
`src/shared/entities/`; its barrel no longer re-exports the concrete catalog.
All client, server and bot consumers are rebased. Four presentation integration
tests using concrete Washoi weapons move from the engine to game tests, retaining
the same assertions; the loading test also gains an alias integration case.

WeaponViewManager's two compatibility-normalization calls now use the engine's
WeaponIdResolver. Browser and FPS headless composition roots register Washoi's
unchanged canonicalWeaponId function. Direct loads and animated switches retain
`lasergun` -> `voltaic`; absent a selected-game resolver, IDs pass through
unchanged. The resolver has no Babylon dependency and tests clear it after use.
No weapon values, asset URLs, serialized fields or registration order change.

This dependency does not move pickup classname extraction, BspDataLoader, item
physics, lobby/bot application ownership or media recipes. PickupTable's sole
change is a comment pointing at the relocated catalog. Those ownership passes
remain separate. The deferred step-4 warmup investigation remains open; the
user-reported lobby creation/bot invitation receipt above is retained.

Validation receipts are under `.cache/engine-game-split/step6-validation/`.
Before/after JSON captures match exactly across all 31 registered definitions,
their registration order, 14 weapon table keys, alias object-identity groups and
case-sensitive normalization examples. SHA-256 of both captures:
`e7f1790ee4e1ce51a3c88d0f589c62670ec010dd2f2b583a5b65b5764ec335f9`.
A normalized TypeScript comparison also matches all 31 relocated catalog files,
three unchanged relocated tests and their rebased consumers (59 files total).
It resolves old/new imports to the same destinations and ignores comments,
import/export declaration ordering, whitespace and trailing commas. The shared
barrel, engine resolver calls and expanded loading test are reviewed separately.

Focused tests passed: six files, 26 tests. The full unit gate passed: 702 files,
5,575 tests passed, one skipped. Typecheck passed; Biome passed at the existing
baseline of zero errors and 47 warnings. The freefly initialization probe still
reports `fps: 200, freefly: 333`. The initial scratch catalog probe needed
absolute dynamic import paths for vite-node; that was corrected before capturing
the baseline and before moving source files.

Validation commands (October 23, 2026):

```powershell
node node_modules/vite-node/vite-node.mjs .cache/engine-game-split/catalog-step6.ts
node node_modules/vite-node/vite-node.mjs .cache/engine-game-split/catalog-step6.ts after
node .cache/engine-game-split/prove-step6.mjs
node node_modules/vite-node/vite-node.mjs .cache/engine-game-split/probe-init-step4.ts
npm.cmd run test:run -- src/engine/weapon/__tests__/WeaponIdResolver.test.ts src/games/fps/client/__tests__/WeaponViewLoading.test.ts src/games/fps/client/__tests__/WeaponAdsTiming.test.ts src/games/fps/client/__tests__/WeaponViewManagerBeamRouting.test.ts src/games/fps/client/__tests__/ProjectileManagerModelReload.test.ts src/games/fps/world/__tests__/FpsMapEntities.test.ts
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build
npm.cmd run build:server
npm.cmd run docs:build
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
node .cache/engine-game-split/validate-step6.mjs
```

The scratch runner invokes npm's CLI with argument arrays and additionally runs
three batches through `node node_modules/vite-node/vite-node.mjs
src/cli/headless-game.ts -- --exec`, passing each batch as one argument:

- `bsp load washoi_dm2; bsp info; quit` (canonical indexed wdm2; asserts 7,475 faces).
- `sim replay "W+CROUCH 60; JUMP 1; W 30"; quit` (asserts 91 ticks).
- `help spectator; help giveweapon; giveweapon rlauncher; quit` (asserts metadata
  and the unchanged inactive-FPS response).

All remaining gates passed: build, server bundles, engine docs, simulation,
physics, server tick, fuzz, indexed BSP load, 91-tick replay and command metadata.
The fixed tick checksum remains `2768943778`. Default-seed fuzz passed with
checksum `3225111177`; its default seed comes from Date.now(), so this is not a
cross-step comparison. Repeating the previous step's seed `1792752672000` gives
its identical checksum `3719501268`, with zero errors. The updated game manual
also builds successfully.

Additional validation commands:

```powershell
npm.cmd run docs:fps:build
node node_modules/vite-node/vite-node.mjs src/cli/server-fuzz.ts -- --ticks 1000 --seed 1792752672000
node .claude/skills/browser-probe/scripts/private-vite.mjs 3100
node .cache/engine-game-split/catalog-step6-probe.mjs
git -C C:/Users/sundf/Desktop/wash/shag diff --check
git -C C:/Users/sundf/Desktop/wash/shag/src/games/fps diff --check
```

Headless Edge WebGL2, after the headless checks, loaded local DM11 and observed
1,200 completed frames, 30 pickups with unique shared IDs and a successful real
weapon-model load of `lasergun` as `voltaic`. An unknown ID passes through the
registered resolver unchanged. Unload leaves zero managed entities/table rows
and every tracked pickup disposed; final captured exception/rejection count is
zero. The probe blocks lobby sockets and starts no network match or gametype.
Receipts: `browser.json` and `pickups.png` in the scratch validation directory.

Two initial probe runs successfully loaded the map/weapon but captured
`Error: No camera defined` after disposing their temporary weapon view. The
probe had replaced the host's camera pair and failed to restore it. It now
restores both host camera fields synchronously after disposing its own view;
the rerun passes. No production teardown code was changed. The failure receipt
is retained as `browser-probe-camera-failure.json`. This error differs from the
deferred warmup TypeError and does not explain or resolve it. The private browser
and Vite server were closed after probing.

Assumptions: the composition root registers the selected-game resolver before
weapon presentation; Washoi client/server use the same installed catalog and
engine revision. Unverified here: joining/playing, firing and active-set behavior
in a live match, demo playback, and the deferred warmup failure. Catalog parity,
headless regressions and the direct browser checks do not substitute for those
broader playtests or the final game-free engine acceptance gate.

The game-side catalog commit is `84306f6`; the matching engine commit pins it.
While finishing, concurrent lobby/bot changes appeared after the completed unit
run. They were excluded from this dependency's staging. They then landed
separately as engine `105c4359` and FPS `be0b7cf`, which are retained. The
concurrent engine commit also picked up this step's already-written catalog
changelog entry. The full gate results above apply to this catalog change at
validation time, not to those later edits; the combined branch after the
concurrent commits was not revalidated by this task. The paths identified at
the initial staging audit are captured in `unowned-at-commit.json`:

- `docs/manual/guides/lobby-server.md`
- `src/engine/ui/components/MatchLobbyView.ts`
- `src/engine/ui/components/__tests__/MatchLobbyView.test.ts`
- `src/engine/ui/components/styles/MatchLobbyView.css`
- `src/lobby/LobbyServer.ts`
- `src/lobby/integration/PrivateBotInvite.test.ts`
- `src/lobby/types.ts`
- `src/games/fps/docs/manual/getting-started/index.md`
- `src/games/fps/docs/manual/multiplayer/connecting.md`
- `src/games/fps/docs/manual/multiplayer/lobby.md`
- `src/games/fps/docs/manual/player/first-match.md`
- `src/games/fps/docs/manual/tools/bot-server.md`

Changed files for this dependency (including removed paths and the FPS gitlink):

- `AGENTS.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/manual/guides/service-registries.md`
- `docs/manual/guides/weapon-system.md`
- `docs/manual/tutorials/advanced/entity-system.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`
- `src/bot/BotWeaponProfile.ts`
- `src/bot/goals/considerations/ItemFacts.ts`
- `src/cli/headless-game.ts`
- `src/engine/__tests__/ProjectileManagerModelReload.test.ts` (removed)
- `src/engine/__tests__/WeaponAdsTiming.test.ts` (removed)
- `src/engine/__tests__/WeaponViewLoading.test.ts` (removed)
- `src/engine/__tests__/WeaponViewManagerBeamRouting.test.ts` (removed)
- `src/engine/weapon/WeaponIdResolver.ts`
- `src/engine/weapon/WeaponViewManager.ts`
- `src/engine/weapon/__tests__/WeaponIdResolver.test.ts`
- `src/games/fps`
- `src/games/fps/Game.ts`
- `src/games/fps/camera/FPSController.ts`
- `src/games/fps/client/AmmoStatus.ts`
- `src/games/fps/client/Crosshair.ts`
- `src/games/fps/client/FPSCombatAudio.ts`
- `src/games/fps/client/FPSReloadAudio.ts`
- `src/games/fps/client/FollowedViewWeapon.ts`
- `src/games/fps/client/GameEvents.ts`
- `src/games/fps/client/RemotePlayerRenderer.ts`
- `src/games/fps/client/SnapshotStateStore.ts`
- `src/games/fps/client/__tests__/CrosshairAmmo.test.ts`
- `src/games/fps/client/__tests__/DroppedWeaponLeak.test.ts`
- `src/games/fps/client/__tests__/ProjectileManagerModelReload.test.ts`
- `src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts`
- `src/games/fps/client/__tests__/WeaponAdsTiming.test.ts`
- `src/games/fps/client/__tests__/WeaponViewLoading.test.ts`
- `src/games/fps/client/__tests__/WeaponViewManagerBeamRouting.test.ts`
- `src/games/fps/client/hud/widgets/AmmoCounter.ts`
- `src/games/fps/client/hud/widgets/LoadoutPicker.ts`
- `src/games/fps/docs/manual/developer/adding-a-weapon.md`
- `src/games/fps/docs/manual/getting-started/project-structure.md`
- `src/games/fps/docs/manual/player/weapons.md`
- `src/games/fps/index.ts`
- `src/games/fps/server/index.ts`
- `src/games/fps/server/systems/ProjectileSystem.ts`
- `src/games/fps/server/systems/WeaponSystem.ts`
- `src/games/fps/server/systems/__tests__/HitLocation.test.ts`
- `src/games/fps/server/systems/__tests__/PlasmaSelfDamage.test.ts`
- `src/games/fps/server/systems/__tests__/ProjectileSystem.test.ts`
- `src/games/fps/server/systems/__tests__/WeaponAds.test.ts`
- `src/games/fps/server/systems/__tests__/WeaponSpread.test.ts`
- `src/games/fps/server/systems/__tests__/WeaponSystem.test.ts`
- `src/games/fps/shared/entities/definitions/ammo/electrobolt.ts`
- `src/games/fps/shared/entities/definitions/ammo/glauncher.ts`
- `src/games/fps/shared/entities/definitions/ammo/index.ts`
- `src/games/fps/shared/entities/definitions/ammo/instagun.ts`
- `src/games/fps/shared/entities/definitions/ammo/lasergun.ts`
- `src/games/fps/shared/entities/definitions/ammo/machinegun.ts`
- `src/games/fps/shared/entities/definitions/ammo/plasmagun.ts`
- `src/games/fps/shared/entities/definitions/ammo/riotgun.ts`
- `src/games/fps/shared/entities/definitions/ammo/rlauncher.ts`
- `src/games/fps/shared/entities/definitions/ammo/voltaic.ts`
- `src/games/fps/shared/entities/definitions/index.ts`
- `src/games/fps/shared/entities/definitions/items.ts`
- `src/games/fps/shared/entities/definitions/projectiles/blade_blast.ts`
- `src/games/fps/shared/entities/definitions/projectiles/grenade.ts`
- `src/games/fps/shared/entities/definitions/projectiles/index.ts`
- `src/games/fps/shared/entities/definitions/projectiles/plasma_bolt.ts`
- `src/games/fps/shared/entities/definitions/projectiles/rocket.ts`
- `src/games/fps/shared/entities/definitions/weapons/WeaponsTable.ts`
- `src/games/fps/shared/entities/definitions/weapons/__tests__/electrobolt.test.ts`
- `src/games/fps/shared/entities/definitions/weapons/blade.ts`
- `src/games/fps/shared/entities/definitions/weapons/electrobolt.ts`
- `src/games/fps/shared/entities/definitions/weapons/glauncher.ts`
- `src/games/fps/shared/entities/definitions/weapons/index.ts`
- `src/games/fps/shared/entities/definitions/weapons/instagun.ts`
- `src/games/fps/shared/entities/definitions/weapons/lasergun.ts`
- `src/games/fps/shared/entities/definitions/weapons/machinegun.ts`
- `src/games/fps/shared/entities/definitions/weapons/plasmagun.ts`
- `src/games/fps/shared/entities/definitions/weapons/riotgun.ts`
- `src/games/fps/shared/entities/definitions/weapons/rlauncher.ts`
- `src/games/fps/shared/entities/definitions/weapons/voltaic.ts`
- `src/games/fps/shared/entities/index.ts`
- `src/games/fps/shared/entities/initEntityDefs.ts`
- `src/games/fps/world/FpsMapEntities.ts`
- `src/main.ts`
- `src/shared/bsp/PickupTable.ts`
- `src/shared/entities/definitions/ammo/electrobolt.ts` (removed)
- `src/shared/entities/definitions/ammo/glauncher.ts` (removed)
- `src/shared/entities/definitions/ammo/index.ts` (removed)
- `src/shared/entities/definitions/ammo/instagun.ts` (removed)
- `src/shared/entities/definitions/ammo/lasergun.ts` (removed)
- `src/shared/entities/definitions/ammo/machinegun.ts` (removed)
- `src/shared/entities/definitions/ammo/plasmagun.ts` (removed)
- `src/shared/entities/definitions/ammo/riotgun.ts` (removed)
- `src/shared/entities/definitions/ammo/rlauncher.ts` (removed)
- `src/shared/entities/definitions/ammo/voltaic.ts` (removed)
- `src/shared/entities/definitions/index.ts` (removed)
- `src/shared/entities/definitions/items.ts` (removed)
- `src/shared/entities/definitions/projectiles/blade_blast.ts` (removed)
- `src/shared/entities/definitions/projectiles/grenade.ts` (removed)
- `src/shared/entities/definitions/projectiles/index.ts` (removed)
- `src/shared/entities/definitions/projectiles/plasma_bolt.ts` (removed)
- `src/shared/entities/definitions/projectiles/rocket.ts` (removed)
- `src/shared/entities/definitions/weapons/WeaponsTable.ts` (removed)
- `src/shared/entities/definitions/weapons/__tests__/electrobolt.test.ts` (removed)
- `src/shared/entities/definitions/weapons/blade.ts` (removed)
- `src/shared/entities/definitions/weapons/electrobolt.ts` (removed)
- `src/shared/entities/definitions/weapons/glauncher.ts` (removed)
- `src/shared/entities/definitions/weapons/index.ts` (removed)
- `src/shared/entities/definitions/weapons/instagun.ts` (removed)
- `src/shared/entities/definitions/weapons/lasergun.ts` (removed)
- `src/shared/entities/definitions/weapons/machinegun.ts` (removed)
- `src/shared/entities/definitions/weapons/plasmagun.ts` (removed)
- `src/shared/entities/definitions/weapons/riotgun.ts` (removed)
- `src/shared/entities/definitions/weapons/rlauncher.ts` (removed)
- `src/shared/entities/definitions/weapons/voltaic.ts` (removed)
- `src/shared/entities/index.ts`
- `src/shared/entities/initEntityDefs.ts` (removed)

## 7. Washoi pickup taxonomy, map data and item rules

Washoi commit: `a39ae1f` (`refactor: own shared pickup taxonomy and item rules`).

After this step, the user reported starting FFA successfully. This is a
user-reported assembled-game check; other modes, a complete match and the
deferred warmup issue were not confirmed by that report.

Move PickupTable and its tests, BspDataLoader, ItemThrow, ItemRespawn and the
real-collision ItemThrow test into Washoi's shared bsp/items folders. Client,
server, bot and Node tools still use one source for pickup taxonomy, IDs,
positions and timing. All 36 affected source files retain identical syntax
apart from module references, comments and formatting. The generic BSP parser,
NodePk3 resolver, collision and Babylon Pickup base remain in SHAG. Old shared
paths are removed without compatibility reexports. The GameState edit updates
only a source-path comment; snapshot fields and wire formats are unchanged.

The game-specific Node helper's indexed-first resolution, legacy fallback and
spawn-point semantics are retained. This step does not add filesystem search
paths, retune landing/grants, change map pools or implement another gametype.
Other game-owned shared item data, media recipes and application services remain
for subsequent ownership work. The deferred step-4 warmup issue stays open.

A baseline on all five installed maps captures classname tables, raw extraction,
weapon-only IDs, exact map fingerprints, landed server pickup entries, node map
data and respawn values. The relocated output matches byte for byte: DM2 18,
DM5 25, DM11 30, Amphi1 14 and S&D1 40 pickups. Receipt SHA-256:
`91d093179e413ac0f6e9bf24f478cf2cfe49f2b8c0e63c9786c244904cbd6b4f`.
The actual createBotVision path also loads all five maps and matches original
server pickup IDs/positions, map fingerprints and the original bot spawn points.
The bot probe compares the same JSON representation as the saved baseline,
which omits undefined optional fields.

The first bot-path probe caught an agent relocation-script mistake: eight
cwd-relative path.resolve strings in BspDataLoader were rebased as though they
were imports. They were restored before commit. Import normalization in the
proof is now limited to actual module references, and a negative check verifies
it detects the bad cwd path. A new BspDataLoader regression test checks indexed
resolution uses process data directories regardless of module location. The
previous catalog step was audited as well: none of its 35 moved files had
changed non-module relative call literals. The initial full unit pass did not
exercise this I/O path; its build was stopped and the corrected snapshot's full
gates rerun. Pre-correction gate logs are retained separately.

The user identified concurrent UI work. Validation therefore runs in detached
checkouts under .cache/engine-game-split/step7-checkout, based on engine
14d944f0 / FPS 84306f6, overlaid with only this dependency's explicit paths.
Existing node_modules, public/data and public/wasm are linked for validation;
source files are copied and hashed in snapshot-files.json. Primary branches and
UI edits are left in place. Gate results apply to this isolated pickup change,
not to uncommitted or later UI work in the shared tree.

Focused extractor/landing/pickup/bot tests passed (six files, 62 tests). The new
indexed-directory regression test passed separately. Validation receipts and
exact commands are recorded below as checks complete.

Final isolated validation passed: typecheck, full unit suite (702 files,
5,575 passed / one skipped), Biome (zero errors, 47 baseline warnings), client
and server builds, both manuals, simulation, physics, tick and 1,000-tick fuzz.
The new indexed-directory test was added after the full runner enumerated its
files; it passed separately (one test) and was included in build/typechecking
and Biome. Tick checksum: 2768943778; random-seed fuzz checksum: 4093331467.
The BSP command reported 7,475 faces; replay completed 91 ticks.

The private WebGL2 browser loaded DM11, spawned 30 unique pickups with exact
baseline landed entries, loaded lasergun as voltaic and preserved unknown IDs.
Unload left zero entities/table entries and disposed every captured pickup.
No runtime exceptions were captured. The screenshot was inspected. This probe
disabled lobby connections; it does not verify a multiplayer match, the UI
agent's changes, or resolution of the original deferred warmup report.

Commands (from the isolated checkout unless indicated):

- `node C:/Users/sundf/Desktop/wash/shag/.cache/engine-game-split/validate-step7-isolated.mjs`
  runs `npm.cmd run typecheck`, `npm.cmd run test:run`,
  `npm.cmd run gate:biome`, `npm.cmd run build`, `npm.cmd run build:server`,
  `npm.cmd run docs:build`, `npm.cmd run docs:fps:build`,
  `npm.cmd run test:simulation`, `npm.cmd run test:physics`,
  `npm.cmd run server:tick`, `npm.cmd run server:fuzz -- --ticks 1000`.
  It also runs the following CLI batches directly through vite-node.
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec "bsp load washoi_dm2; bsp info; quit"`
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'`
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec "help spectator; help giveweapon; giveweapon rlauncher; quit"`
- `npm.cmd run test:run -- src/games/fps/shared/bsp/__tests__/BspDataLoader.test.ts`
- Scratch parity scripts and exact invocations are retained with gate logs in
  `.cache/engine-game-split/step7-validation`; five-map receipts are
  `pickups-before.json` and `pickups-after.json`, bot results `bot-parity.log`.
- `node .cache/engine-game-split/prove-step7.mjs` (primary checkout):
  36 source files preserve syntax apart from module references.
- `node C:/Users/sundf/Desktop/wash/shag/.cache/engine-game-split/step7-checkout/.claude/skills/browser-probe/scripts/private-vite.mjs 3100`
- `node .cache/engine-game-split/pickups-step7-probe.mjs` (primary checkout):
  browser assertions passed; receipts `browser.json` and `pickups.png`.
  Private Vite was stopped after the check.

Changed files (including removed paths and the FPS gitlink):

- `AGENTS.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/manual/guides/bsp-system.md`
- `docs/manual/guides/pickup-system.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`
- `src/bot/BotMovementAnalyzer.ts`
- `src/bot/BotNavGraph.ts`
- `src/bot/BotPerception.ts`
- `src/bot/BotVision.ts`
- `src/bot/LearnedRoutes.ts`
- `src/bot/RouteLearner.ts`
- `src/bot/__tests__/BotPerception.test.ts`
- `src/bot/__tests__/Considerations.test.ts`
- `src/bot/__tests__/Directives.test.ts`
- `src/bot/__tests__/ItemGoalPlanner.test.ts`
- `src/bot/__tests__/ItemGoalSource.test.ts`
- `src/bot/__tests__/NavTravelCost.test.ts`
- `src/bot/__tests__/WeightProfiles.test.ts`
- `src/bot/goals/BotGoal.ts`
- `src/bot/goals/ItemGoalPlanner.ts`
- `src/bot/goals/ItemGoalSource.ts`
- `src/cli/HeadlessMapLoader.ts`
- `src/engine/__tests__/ItemThrow.test.ts` (removed)
- `src/games/fps`
- `src/games/fps/bench/fixtures.ts`
- `src/games/fps/docs/manual/developer/adding-a-weapon.md`
- `src/games/fps/docs/manual/player/pickups-and-inventory.md`
- `src/games/fps/server/GameServer.ts`
- `src/games/fps/server/__tests__/MatchStartReset.test.ts`
- `src/games/fps/server/gametypes/Amphi.ts`
- `src/games/fps/server/gametypes/Deathmatch.ts`
- `src/games/fps/server/gametypes/SearchAndDestroy.ts`
- `src/games/fps/server/gametypes/__tests__/Loadouts.test.ts`
- `src/games/fps/server/systems/DroppedWeaponSystem.ts`
- `src/games/fps/server/systems/PickupSystem.ts`
- `src/games/fps/server/systems/__tests__/DroppedWeaponSystem.test.ts`
- `src/games/fps/server/systems/__tests__/PickupSystem.test.ts`
- `src/games/fps/shared/bsp/BspDataLoader.ts`
- `src/games/fps/shared/bsp/PickupTable.ts`
- `src/games/fps/shared/bsp/__tests__/BspDataLoader.test.ts`
- `src/games/fps/shared/bsp/__tests__/PickupTable.test.ts`
- `src/games/fps/shared/items/ItemRespawn.ts`
- `src/games/fps/shared/items/ItemThrow.ts`
- `src/games/fps/shared/items/__tests__/ItemThrow.test.ts`
- `src/games/fps/world/EntityManager.ts`
- `src/games/fps/world/__tests__/EntityManagerPickupLanding.test.ts`
- `src/shared/bsp/BspDataLoader.ts` (removed)
- `src/shared/bsp/PickupTable.ts` (removed)
- `src/shared/bsp/__tests__/PickupTable.test.ts` (removed)
- `src/shared/items/ItemRespawn.ts` (removed)
- `src/shared/items/ItemThrow.ts` (removed)
- `src/shared/net/GameState.ts`

## 8. Washoi health/armor grants and powerup rules

Washoi commit: `c9a556d` (`refactor: own shared item grants and powerup rules`).

Move ItemGrants, Powerups and both test suites from engine shared/items into
Washoi shared/items. Client audio/presentation, snapshot construction, combat,
pickup handling and bot planning consume the same relocated functions. Four
files move without compatibility reexports. The engine ECS component retains
expiry storage and its create/clone/clear functions; its expiry map accepts
string IDs without importing Washoi. The original grantPowerup function moves
unchanged into the game's shared/items/PowerupGrant.ts and uses the same
absolute-tick extension rule. Existing game callers import that helper.

Assumption: game-specific health/armor amounts and timed effects belong to
Washoi even though client, server and bots share them. The runtime component
shape stays { expiry: { [id]: absoluteTick } }. Snapshot fields, packing order,
Quad bit 0, demo versions and all grant/timing/damage values are unchanged.
The BinaryProtocol and SnapshotBuffer edits only remove stale source paths
from comments. Generic create/clone/clear functions have identical syntax;
14 moved/rebased files and the PickupSystem body also preserve syntax apart
from imports/comments/formatting. A new integration test covers grant/extend,
copy isolation, mask expiry and clearing damage effects through ECS storage.

Concurrent UI edits in PlayerModelVisualSettings and RemotePlayerRenderer
were present at the start. Only the latter's Powerups import belongs to this
step. Validation uses detached engine cade8d5a / FPS a39ae1f checkouts under
.cache/engine-game-split/step8-checkout, with only owned changes overlaid;
the renderer file uses the committed baseline plus that import change.
Existing node_modules and public/data/public/wasm are linked. Validation does
not cover the other agent's unfinished UI code. The deferred warmup report
remains open; the user's successful FFA start is recorded in step 7.

Before/after pure-rule receipts match for 13,123 sampled results: health and
armor values from 0 through 250 in quarter increments, all pickup kinds,
overheal rates, expiry boundaries, grant tick rates, masks and damage effects.
Receipt SHA-256: b43d188ac43dcf3dae8765a847fd6ceaa37a3aeaac0fb30dae22e318cc3d7fcf.
The comparison transpiles the saved pre-move modules and relocated modules
independently and evaluates the same inputs; it does not replace server tests.

Initial full-suite finding: 704 files passed and one test failed in
RemoteWeaponLeak's Firefox/WebGL material-ownership case, waiting for weapon
roots (line 100). All six cases passed when run alone on both the changed
checkout and the pre-change step-7 checkout. This does not establish the cause
of the full-run timeout. No weapon code/test timeout was changed to mask it.
The first Biome run found one import-order error in RemotePlayerRenderer;
the import was sorted before final validation. Both initial logs are retained.

Exact changed paths (including removed paths and gitlink):

- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/manual/guides/pickup-system.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`
- `src/bot/goals/ItemGoalPlanner.ts`
- `src/bot/goals/considerations/ItemFacts.ts`
- `src/bot/goals/considerations/ItemValue.ts`
- `src/engine/network/client/SnapshotBuffer.ts`
- `src/games/fps`
- `src/games/fps/client/FPSPowerupAudio.ts`
- `src/games/fps/client/RemotePlayerRenderer.ts`
- `src/games/fps/client/__tests__/RemotePlayerRenderParity.test.ts`
- `src/games/fps/server/SnapshotBuilder.ts`
- `src/games/fps/server/gametypes/__tests__/AmphiRoundReset.test.ts`
- `src/games/fps/server/systems/CombatSystem.ts`
- `src/games/fps/server/systems/PickupSystem.ts`
- `src/games/fps/server/systems/__tests__/CombatSystemQuad.test.ts`
- `src/games/fps/shared/items/ItemGrants.ts`
- `src/games/fps/shared/items/ItemRespawn.ts`
- `src/games/fps/shared/items/PowerupGrant.ts`
- `src/games/fps/shared/items/Powerups.ts`
- `src/games/fps/shared/items/__tests__/ItemGrants.test.ts`
- `src/games/fps/shared/items/__tests__/PowerupGrant.test.ts`
- `src/games/fps/shared/items/__tests__/Powerups.test.ts`
- `src/shared/items/ItemGrants.ts`
- `src/shared/items/Powerups.ts`
- `src/shared/items/__tests__/ItemGrants.test.ts`
- `src/shared/items/__tests__/Powerups.test.ts`
- `src/shared/net/BinaryProtocol.ts`
- `src/shared/server/simulation/components/PowerupComponent.ts`

Validation commands (isolated step-8 checkout unless stated otherwise):

- `npm.cmd run typecheck`
- `node C:/Users/sundf/Desktop/wash/shag/.cache/engine-game-split/validate-step8-isolated.mjs test-run`
  runs `npm.cmd run test:run`, `npm.cmd run gate:biome`,
  `npm.cmd run build`, `npm.cmd run build:server`,
  `npm.cmd run docs:build`, `npm.cmd run docs:fps:build`,
  `npm.cmd run test:simulation`, `npm.cmd run test:physics`,
  `npm.cmd run server:tick`, `npm.cmd run server:fuzz -- --ticks 1000`,
  then the same BSP/replay/camera batches listed below. The initial run stopped
  after the unit failure; a separate gate-biome invocation stopped at the
  import-order diagnostic. The final runner starts again at test-run.
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec "bsp load washoi_dm2; bsp info; quit"`
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'`
- `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec "help spectator; help giveweapon; giveweapon rlauncher; quit"`
- `npm.cmd run test:run -- src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts`
  on the step-8 and step-7 checkouts: six tests passed on each.
- `node .cache/engine-game-split/prove-step8.mjs` (primary checkout).
- `node .cache/engine-game-split/item-rules-step8.mjs` (primary checkout).

Receipts and isolated source hashes are in .cache/engine-game-split/step8-validation.
No fresh browser or multiplayer check was performed for this pure-rule move;
the user's FFA report predates this step. No production deploy was performed.

Final results: typecheck passed. Full unit rerun passed 705 files / 5,582 tests,
with one skipped. Biome passed at zero errors / 47 baseline warnings. Client
and server builds, engine and game docs builds, simulation and physics passed.
Server tick checksum was 2768943778; 1,000-tick random-seed fuzz reconciled at
2008373838. Indexed BSP loading reported 7,475 faces and movement replay
completed 91 ticks. Camera command responses passed. These are isolated-change
results, not a full revalidation of the concurrent palette UI commit.

The first build stopped before compilation: Windows refused a rename replacing
pk3_manifest.json through the shared data junction (EPERM). Validation's data
junction was replaced with a private directory: generated manifest/index files
are private copies, existing asset files are hard-linked and data subfolders
remain junctions. The build then passed. The shared-rename cause was not proven;
this setup avoids shared generated metadata during concurrent work. The failed
build log remains build-shared-manifest-error.log. No production source was
changed for this validation-environment issue.

## 9. Washoi account-aware name command

Washoi commit: `ed7d71d` (`refactor: own account-aware name command`).
Separate engine fixture fix: `223f4712` (`test: complete local reflection renderer fixture`).

The user reported testing an FFA game successfully after step 8. This is a
user-reported assembled-game playtest; no duration, final result or other modes
were specified. It does not close the earlier warmup report.

Move NameCommand intact from engine console commands into Washoi's discovered
command folder. The command's syntax is identical apart from imports and
formatting. It keeps the same name, usage, description, ungated availability,
name validation, local-profile persistence, awaited account rename and response
strings. No account or network service implementation, wire format, renderer
or UI style changes belong to this step. The engine command glob no longer
imports AccountSession/PlayerIdentity through NameCommand. Washoi still uses
the existing lobby services; their broader ownership move remains separate.

This clears a prerequisite for relocating shared bot-name policy: otherwise
PlayerIdentity would give the engine command a new dependency into the game.
Generic player profiles remain in SHAG. The existing game command registration
test now verifies name is absent after engine registration and present after
Washoi registration; five new cases cover local/account display, local save,
invalid input, awaited account completion and refused renames. The focused
suite (these tests plus the real account-session tests) passed 3 files / 27 tests.

The user identified concurrent team-color papercuts. The validation checkout
.cache/engine-game-split/step9-checkout is detached at engine 2ccab9da / FPS
c9a556d, with only the four owned source/manual files overlaid and the old
command removed. Existing dependencies, wasm and asset files are linked;
generated PK3 manifest/index metadata is private to this checkout. Team-color
files are not copied, formatted, staged or committed by this step.

Assumption: account-aware naming is Washoi application behavior. An engine-only
composition has no name command; the assembled browser
continues discovering it through registerFpsCommands. The FPS headless CLI
registers the same class explicitly alongside its other game commands. No online account is
renamed by the validation commands, and no stored user profile is edited.

Exact changed paths (including removal and gitlink):

- `src/games/fps/console/commands/NameCommand.ts`
- `src/games/fps/console/commands/__tests__/NameCommand.test.ts`
- `src/games/fps/console/__tests__/CameraCommandRegistration.test.ts`
- `docs/manual/guides/console-system.md`
- `src/engine/console/commands/NameCommand.ts`
- `src/games/fps`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`

Validation commands (step-9 isolated checkout unless stated otherwise):

- `npm.cmd run test:run -- src/games/fps/console/commands/__tests__/NameCommand.test.ts src/games/fps/console/__tests__/CameraCommandRegistration.test.ts src/lobby/__tests__/AccountSession.test.ts` ? passed 27 tests.
- `node C:/Users/sundf/Desktop/wash/shag/.cache/engine-game-split/validate-step9-isolated.mjs`
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
- `node .cache/engine-game-split/prove-step9.mjs` (primary checkout) ? identical relocated syntax.

Gate logs and copied-file hashes are under .cache/engine-game-split/step9-validation.
No new browser test, real account rename or production deployment was performed.

Initial full-suite finding: 706 files / 5,590 tests passed, one skipped and
LocalWaterReflection.test.ts failed at RemotePlayerRenderer.dispose reading
ffaColors.clear. The test constructs a partial renderer via Object.create and
omitted that field from the committed palette implementation. A focused run
against the current primary renderer reproduced the same error. Adding only
`ffaColors: { clear: vi.fn() }` to that partial test fixture made the focused
case pass. This is an engine test-only fix, committed separately from the
name-command dependency; no renderer/team-color implementation was changed.
The first full log is retained as test-run-before-fixture-fix.log. The final
full run includes this one-line fixture correction. This is distinct from the
deferred warmup report and step 8's weapon-test timeout.

Additional changed file, separate test-fixture commit:

- `src/engine/__tests__/LocalWaterReflection.test.ts`

Additional command: `npm.cmd run test:run -- src/engine/__tests__/LocalWaterReflection.test.ts`
failed on the primary committed renderer before the fixture correction and
passed in the isolated checkout afterward (one test). Final gate runner resumes
at `test-run` after the correction; typecheck had already passed.

The CLI source inspection found it registers selected game commands explicitly,
rather than calling registerFpsCommands. Its NameCommand import/registration
was added before the final CLI/build gates. The full unit rerun was already
running at that point; the final build typechecks this CLI source. Additional
owned path: `src/cli/headless-game.ts`.

Final isolated results: all 707 unit files passed, 5,591 tests passed and one
skipped. Biome passed at zero errors / 47 baseline warnings. Typecheck, client
build (including the final CLI registration), server build, both docs builds,
simulation and physics passed. Server tick reconciled at 2768943778; 1,000-tick
random-seed fuzz reconciled at 252136202. Indexed BSP loading reported 7,475
faces, replay completed 91 ticks, and name/camera command batches passed.
The source proof still reports identical relocated command syntax. No fresh
browser/real-account rename or team-color UI revalidation is claimed.

## 10. Washoi shared bot names and behavior profiles

Washoi commit: `8fae018` (`refactor: own shared bot names and behavior profiles`).

Move `BotNames.ts` and `WeightProfiles.ts` from `src/shared/bot/` into
`src/games/fps/shared/bot/`. Lobby name reservation, bot configuration/chat,
the goal planner and server bot-name allocation import the same game-owned
policy. These modules stay shared across processes and contain no Babylon or
browser APIs. All names, suffix reservation, weights, fallback values and
gametype/role/round-state selection remain identical. Existing bot integration
tests stay beside the bot implementation; only their imports change.

Assumption: these are Washoi product policies. The bot and lobby application
implementations still live in the outer repository pending their separate
ownership steps. This is not yet a game-free engine build. The engine has no
direct imports of either policy, PlayerIdentity or AccountSession. No new
registry is needed for consumers that already belong to the Washoi application.

`BotRatingIdentity.behaviorDigest` hashes TypeScript source paths and contents
across the source tree, excluding tests and files named BotNames.ts. Relocating
WeightProfiles and rebasing imports therefore changes the behavior fingerprint,
as other source refactors do. Its algorithm, persisted records and rating rules
are unchanged; an unchanged behavior fingerprint is not claimed.

Validation uses an isolated checkout at engine `5de11ddb` / FPS `1cfc111`,
with only this step's source/manual changes overlaid. The engine baseline
already includes the other agent's committed muzzle-flash fix; this step
does not edit that implementation. Dependencies/wasm and immutable media are
linked, with private generated PK3 index/manifest metadata.

Exact changed paths (including removals and gitlink):

- `src/shared/bot/BotNames.ts` (removed)
- `src/shared/bot/WeightProfiles.ts` (removed)
- `src/games/fps/shared/bot/BotNames.ts`
- `src/games/fps/shared/bot/WeightProfiles.ts`
- `src/games/fps/server/BotNames.ts`
- `src/games/fps/server/__tests__/BotNames.test.ts`
- `src/bot/BotConfig.ts`
- `src/bot/StateMachineBrain.ts`
- `src/bot/chat/BotChat.ts`
- `src/bot/goals/Consideration.ts`
- `src/bot/goals/ItemGoalPlanner.ts`
- `src/bot/__tests__/Considerations.test.ts`
- `src/bot/__tests__/Directives.test.ts`
- `src/bot/__tests__/WeightProfiles.test.ts`
- `src/lobby/PlayerIdentity.ts`
- `src/games/fps` (gitlink)
- `docs/manual/guides/lobby-server.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`

Validation receipts: `.cache/engine-game-split/step10-validation/`.
The source proof, `node .cache/engine-game-split/prove-step10.mjs`, compares
all 13 affected source files with their saved originals, normalizing relocated
module paths and import ordering. It reports identical syntax; the ownership
comment is the only non-import source edit. Biome's scoped check initially
identified four import-order errors; its safe formatter corrected those files,
then the proof passed again.

The isolated runner is
`node C:/Users/sundf/Desktop/wash/shag/.cache/engine-game-split/validate-step10-isolated.mjs`.
It runs these exact npm scripts:

```powershell
npm.cmd run typecheck
npm.cmd run test:run
npm.cmd run gate:biome
npm.cmd run build
npm.cmd run build:server
npm.cmd run docs:build
npm.cmd run docs:fps:build
npm.cmd run test:simulation
npm.cmd run test:physics
npm.cmd run server:tick
npm.cmd run server:fuzz -- --ticks 1000
```

It also invokes `node node_modules/vite-node/vite-node.mjs
src/cli/headless-game.ts -- --exec` with each of these single argument values:

```text
bsp load washoi_dm2; bsp info; quit
sim replay "W+CROUCH 60; JUMP 1; W 30"; quit
help name; name; quit
help spectator; help giveweapon; giveweapon rlauncher; quit
```

Typecheck passed in the sandbox; Vitest could not spawn workers (EPERM).
The runner resumed from `test-run` with subprocess permission. This initial
environment failure is not counted as a test pass. No new browser playtest,
live bot invitation, production deployment or game-free build is claimed.
The earlier deferred warmup/asset warnings remain open, separately from the
completed loading-audio/held-weapon papercut documented in
[its report](./LOADING_READINESS_PAPERCUT.md).

Final results: typecheck, all 710 unit files (5,606 passed tests, one skipped),
Biome (zero errors / 47 baseline warnings), client/server builds, both docs
builds, simulation and physics passed. Server tick reconciled at 2768943778;
the 1,000-tick random-seed fuzz run reconciled at 3131391883. Indexed BSP loading
reported 7,475 faces; movement replay completed 91 ticks. Validated source/manual
hashes match the primary checkout. Both name/camera CLI batches passed.
Next candidate: replace EntityCatalog's
direct Washoi entities.def import with a game-supplied catalog, retaining the
engine parser/compiler classes and the assembled game's palette semantics.

## 11. SHAGGED gameplay catalog registration

Washoi commit: `05b9f30` (`refactor: register Washoi editor entity catalog`).

`EntityCatalog` no longer imports Washoi's raw NetRadiant definitions. It keeps
the parser, generic lookup/required-key helpers, compiler point/brush classes
and compiler model reference. `registerGameEntityCatalog` replaces the active
gameplay point/brush catalog, preserving exported array identities; clearing
restores compiler classes and neutral markers for unknown classnames. Register
before opening sessions or running reports. An already open session is not
reactively refreshed. There are no new listeners or timers.

Washoi's `registerFpsEditorCatalog` supplies the same parsed definitions. The
browser composition root, scripting CLI, MCP and standalone editor-service
entry points register it explicitly. Map Health builds classname sets for each
inspection, so importing that module before registration does not freeze the
compiler-only state. Gameplay entries still precede compiler entries; compiler
definitions keep the existing last-entry precedence for classname lookup.

Assumption: the outer editor entry points still assemble Washoi until their
application ownership pass. The source `editor/gamepacks/washoi.game/` remains
in place for existing NetRadiant users. The game adapter reads that file;
relocating the whole gamepack/compiler profile and shader-tag metadata is a
separate step. This removes the engine catalog's direct product-asset import,
not all editor/game dependencies or the tracked FPS requirement. The original
warmup/asset warnings remain deferred; no gameplay/audio changes belong here.

Five existing Washoi-dependent catalog/entity, editor DOM and API suites move
to the game's editor tests and explicitly register/clear the game catalog.
Their assertions and mocks are unchanged apart from relocated module paths
and registration/cleanup. The trigger suite creates its fixture per test after
registration rather than during suite collection. Three engine tests exercise a synthetic game catalog,
compiler-only defaults, retained references, late registration, replacement,
required-key lookup, Map Health and cleanup without importing Washoi.

Exact changed paths (including removals and gitlink):

- `src/engine/editor/EntityCatalog.ts`
- `src/engine/editor/MapHealth.ts`
- `src/engine/editor/__tests__/GameEntityCatalog.test.ts`
- `src/engine/editor/__tests__/EditorEntities.test.ts` (moved)
- `src/engine/editor/__tests__/EditorSession.test.ts` (moved)
- `src/games/fps/editor/FpsEditorCatalog.ts`
- `src/games/fps/editor/__tests__/EditorEntities.test.ts`
- `src/games/fps/editor/__tests__/EditorSession.test.ts`
- `src/engine/editor/api/__tests__/Operations.test.ts` (moved)
- `src/engine/editor/api/__tests__/ConnectStairs.test.ts` (moved)
- `src/engine/editor/api/__tests__/Triggers.test.ts` (moved)
- `src/engine/editor/api/__tests__/fixtures/two-rooms.ops.json` (moved)
- `src/games/fps/editor/api/__tests__/Operations.test.ts`
- `src/games/fps/editor/api/__tests__/ConnectStairs.test.ts`
- `src/games/fps/editor/api/__tests__/Triggers.test.ts`
- `src/games/fps/editor/api/__tests__/fixtures/two-rooms.ops.json`
- `src/games/fps/index.ts`
- `src/main.ts`
- `src/cli/shagged.ts`
- `src/cli/shagged-mcp.ts`
- `src/cli/shagged-server.ts`
- `src/games/fps` (gitlink)
- `docs/manual/guides/service-registries.md`
- `docs/manual/guides/shagged-editor.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`

Validation checkout: `.cache/engine-game-split/step11-checkout`, detached at
engine `bff86a6a` / FPS `5d7455b`, with only owned source/manual files overlaid.
The baseline includes the other agent's committed Voltaic beam fixes; this
step does not edit those files. Dependencies/wasm/media are linked; generated
PK3 index/manifest metadata is private. Receipts are under
`.cache/engine-game-split/step11-validation`.

Commands and evidence:

- `npm.cmd run test:run -- src/engine/editor/__tests__/GameEntityCatalog.test.ts src/games/fps/editor/__tests__/EditorEntities.test.ts src/games/fps/editor/__tests__/EditorSession.test.ts src/engine/editor/__tests__/MapHealth.test.ts src/engine/editor/__tests__/CompilerEntityCatalog.test.ts` passed 5 files / 62 tests in the primary checkout.
- `node .cache/engine-game-split/prepare-proof-step11.mjs` proves all existing catalog parser/helper functions unchanged against HEAD. Its first sandbox run could not spawn git (EPERM); the permitted subprocess run passed.
- `node .cache/engine-game-split/prove-step11-tests.mjs` proves both moved test suites unchanged after normalizing module paths, import ordering and registration/cleanup hooks.
- `node .cache/engine-game-split/prove-step11-api-tests.mjs` proves the three API suites unchanged after normalizing module paths, import ordering, registration/cleanup and per-test fixture setup. The two-room fixture is moved byte-for-byte.
- `node node_modules/vite-node/vite-node.mjs .cache/catalog-parity.ts` in the isolated checkout, first before overlay, then with `SHAG_CATALOG_GAME=1` after overlay. `SHAG_CATALOG_OUTPUT` selects the before/after receipt file. The serialized results match exactly: all 56 gameplay points, 59 total point entries, 10 brush entries, lookup objects, Map Health diagnostics and map export bytes.
- `node .cache/engine-game-split/probe-step11-entrypoints.mjs` invokes the actual `shagged health` CLI on a scratch spawn/teleporter document and the actual MCP `shagged_entity_classes` tool. Both passed: the CLI recognizes game classes and requires the teleporter target; MCP returns all 69 point/brush entries including weapons and the required trigger key. No compiler run or user document write is involved.
- `npm.cmd run shagged:server -- --help` in the isolated checkout passed, loading the standalone service entry point without starting a listener.
- `node C:/Users/sundf/Desktop/wash/shag/.cache/engine-game-split/validate-step11-isolated.mjs` runs `npm.cmd run typecheck`, `npm.cmd run test:run`, `npm.cmd run gate:biome`, `npm.cmd run build`, `npm.cmd run build:server`, `npm.cmd run docs:build`, `npm.cmd run docs:fps:build`, `npm.cmd run test:simulation`, `npm.cmd run test:physics`, `npm.cmd run server:tick`, `npm.cmd run server:fuzz -- --ticks 1000`.
- The runner invokes `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec` with each batch: `bsp load washoi_dm2; bsp info; quit`, `sim replay "W+CROUCH 60; JUMP 1; W 30"; quit`, `help name; name; quit`, and `help spectator; help giveweapon; giveweapon rlauncher; quit`.

Unverified: fresh browser/GPU editor rendering, external NetRadiant operation,
a native compiler build, live FFA, production deployment and a game-free build.
The exact catalog/export comparison and headless DOM interactions cover this
step's behavior; they do not establish those broader outcomes.

Initial full-suite finding: 708 files passed and three API suites failed
(ConnectStairs, Operations and Triggers), each from unregistered gameplay
classes reported as unknown. This exposed more tests relying on implicit
Washoi initialization. Moving those integrations and their two-room fixture
to the game, with explicit catalog setup, passed the focused command
`npm.cmd run test:run -- src/games/fps/editor/api/__tests__/Operations.test.ts src/games/fps/editor/api/__tests__/ConnectStairs.test.ts src/games/fps/editor/api/__tests__/Triggers.test.ts`
(3 files / 23 tests). The full runner restarts at typecheck afterward. The
initial failure log is retained as `test-run-before-explicit-api-catalog.log`.
No production logic changed in response to these test setup failures.

Final isolated results: typecheck and all 711 test files passed (5,610 tests
passed, one skipped). Biome stayed at zero errors / 47 baseline warnings.
Client/server builds, both docs builds, simulation and physics passed. Tick
determinism reconciled at 2768943778; the 1,000-tick random-seed fuzz run at
4097236016. Indexed BSP loading reported 7,475 faces; movement replay completed
91 ticks. Name/camera CLI batches passed. All 17 source/manual/fixture hashes
match the isolated checkout; the moved map fixture also matches its original
git blob. Nothing was pushed. Next editor seams are the compiler/gamepack
configuration, shader-tag inputs and game-specific map-analysis providers.

## 12. Game-supplied compiler profile and recipe

Washoi commit: `656420d` (`refactor: own editor compiler profile and recipes`).

SHAGGED's Node compiler resolution and recipe wrapper consume a registered
`GameCompilerProfile`. The game supplies the profile ID/display name, local
toolchain root and quality-specific argument arrays. The engine retains binary
discovery, configuration overrides, media roots, executable-adjacent profile
installation, fingerprints, queueing, native execution and publication. Missing
registration reports compilation unavailable; recipe lookup throws an explicit
error. Install before resolving configuration/creating jobs and keep the same
profile installed until the jobs finish. No timers or listeners were added.

Washoi owns `FpsCompilerProfile.ts` and the unchanged recipe body. Its four Node
editor entry points register it explicitly. The resolved CompilerConfig shape
and property order remain unchanged; profile ID, source profile path, installed
profile path, toolchain cwd, flags and error text stay identical for Washoi.
BuildFingerprint and CompileJobs implementations are untouched. Config/profile
files are still at their existing installation paths. Moving the physical
NetRadiant gamepack and shader-tag assets remains separate from this step.

Assumption: the outer Node entry points still compose Washoi pending their
application ownership move. The browser does not import this Node-only adapter.
This is not yet an independent engine build. No production files, deployed
tools, accounts or user map documents are migrated by this source change.

Five Washoi compiler/configuration integration suites move to the game and
register/clear its compiler profile. Three engine job/reliability/HTTP suites
use a synthetic compiler policy. Two new engine cases cover absent registration,
alternate profile ID/path/recipe, local installation and cleanup. The initial
focused run found the synthetic test recipe did not vary by quality, violating
the existing fingerprint test. Adding a quality argument to that fixture fixed
it; the engine fingerprint algorithm was not changed. The repeated focused
command passed 5 files / 18 tests:

```powershell
npm.cmd run test:run -- src/engine/editor/server/__tests__/GameCompilerProfile.test.ts src/engine/editor/server/__tests__/CompileJobs.test.ts src/engine/editor/server/__tests__/BuildReliability.test.ts src/engine/editor/server/__tests__/ShaggedHttpServer.test.ts src/games/fps/editor/server/__tests__/CompilerConfig.test.ts
```

Exact changed paths (including removal and gitlink):

- `src/engine/editor/server/GameCompilerProfile.ts`
- `src/engine/editor/server/BuildRecipe.ts`
- `src/engine/editor/server/CompilerConfig.ts`
- `src/engine/editor/server/__tests__/GameCompilerProfile.test.ts`
- `src/engine/editor/server/__tests__/fixtures/TestCompilerProfile.ts`
- `src/engine/editor/server/__tests__/CompileJobs.test.ts`
- `src/engine/editor/server/__tests__/BuildReliability.test.ts`
- `src/engine/editor/server/__tests__/ShaggedHttpServer.test.ts`
- `src/engine/editor/server/__tests__/CompilerConfig.test.ts` (moved)
- `src/engine/editor/server/__tests__/NaturalCompile.test.ts` (moved)
- `src/engine/editor/server/__tests__/PlaytestCompile.test.ts` (moved)
- `src/engine/editor/server/__tests__/ConvexCompile.test.ts` (moved)
- `src/engine/editor/server/__tests__/RoundPatchCompile.test.ts` (moved)
- `src/games/fps/editor/server/FpsCompilerProfile.ts`
- `src/games/fps/editor/server/__tests__/CompilerConfig.test.ts`
- `src/games/fps/editor/server/__tests__/NaturalCompile.test.ts`
- `src/games/fps/editor/server/__tests__/PlaytestCompile.test.ts`
- `src/games/fps/editor/server/__tests__/ConvexCompile.test.ts`
- `src/games/fps/editor/server/__tests__/RoundPatchCompile.test.ts`
- `src/cli/shagged.ts`
- `src/cli/shagged-mcp.ts`
- `src/cli/shagged-server.ts`
- `src/cli/shagged-compile.ts`
- `src/games/fps` (gitlink)
- `docs/manual/guides/service-registries.md`
- `docs/manual/guides/shagged-api.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`

Isolated validation checkout: `.cache/engine-game-split/step12-checkout`,
detached at engine `7c314925` / FPS `05b9f30`, with only owned files overlaid.
It has private copies of native MakeBSP/MakeLight binaries, adjacent profiles
and runtime DLLs, so native integration tests can execute. Dependencies/wasm
and media are linked; generated PK3 index/manifest metadata is private. Native
jobs publish only into their test scratch roots. Receipts are under
`.cache/engine-game-split/step12-validation`.

Validation commands and proofs:

- `node .cache/engine-game-split/prove-step12-recipe.mjs` compares the Washoi recipe body with the committed original; identical.
- `node .cache/engine-game-split/probe-step12-entrypoints.mjs` invokes the real `shagged-server.ts` and `shagged-compile.ts` entry points with `--check-config --media-root <scratch-media>`; both report the registered compiler available, without starting a listener or compiling a user map.
- `node .cache/engine-game-split/prove-step12-tests.mjs` compares all five moved suites after normalizing import paths/order and profile setup/cleanup; identical.
- `node node_modules/vite-node/vite-node.mjs .cache/compiler-parity.ts` in the isolated checkout, before overlay and afterward with `SHAG_COMPILER_GAME=1`. `SHAG_COMPILER_OUTPUT` selects each receipt file. With the same private tools, paths and scratch media, the resolved configuration, argv and content fingerprints match exactly for fast/default/release. Compiler availability was asserted before capture.
- `node C:/Users/sundf/Desktop/wash/shag/.cache/engine-game-split/validate-step12-isolated.mjs` runs `npm.cmd run typecheck`, `npm.cmd run test:run`, `npm.cmd run gate:biome`, `npm.cmd run build`, `npm.cmd run build:server`, `npm.cmd run docs:build`, `npm.cmd run docs:fps:build`, `npm.cmd run test:simulation`, `npm.cmd run test:physics`, `npm.cmd run server:tick`, `npm.cmd run server:fuzz -- --ticks 1000`.
- The runner invokes `node node_modules/vite-node/vite-node.mjs src/cli/headless-game.ts -- --exec` with each batch: `bsp load washoi_dm2; bsp info; quit`, `sim replay "W+CROUCH 60; JUMP 1; W 30"; quit`, `help name; name; quit`, and `help spectator; help giveweapon; giveweapon rlauncher; quit`.

Unverified: fresh browser/GPU editor operation, external NetRadiant use,
production deployment and a game-free build. The earlier warmup/asset report
remains deferred. Physical gamepack/shader-tag ownership and game-specific
map-analysis providers remain separate editor work.

Initial full-suite result: 711 files passed, one failed in
RemoteWeaponLeak's Firefox/WebGL material ownership case, waiting for weapon
roots at line 100. This is the same previously logged step-8 failure location.
All six cases passed when run alone in this isolated checkout with
`npm.cmd run test:run -- src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts`.
That does not establish the full-run failure's cause. No weapon source or test
timeout was changed. The initial log is retained as
`test-run-weapon-wait-failure.log`; one unchanged full-suite stability rerun
starts at `test-run` before the remaining gates.

The unchanged full-suite rerun passed all 712 files: 5,612 tests passed and
one skipped. All four native compiler suites executed (five compile cases),
covering convex collision/UVs, natural texture repetition, publication/indexed
BSP resolution and round patches. Convex fixtures printed LightGrid dimension
warnings; their geometry/collision/UV assertions passed. This does not validate
production lighting appearance. Biome remained at zero errors / 47 baseline
warnings. The original weapon-wait finding remains recorded rather than being
treated as fixed by the passing rerun.

Final gates: typecheck, client/server builds, both documentation builds,
simulation and physics passed. Tick determinism reconciled at 2768943778;
1,000-tick random-seed fuzz at 2934923152. Indexed BSP loading reported 7,475
faces and replay completed 91 ticks. Name/camera CLI batches passed. All 20
owned source/manual hashes match the isolated checkout. Nothing was pushed.


## 13. Game-owned browser composition and engine example

Washoi commit: `511c12b` (`refactor: own browser startup and application descriptor`).

The repository boundary is SHAG having no mandatory Washoi code dependency.
Games may require an assembled SHAG checkout to execute; standalone game
packaging is not required. Reusable server, lobby and editor infrastructure
should stay in SHAG where game-specific policy can be supplied by the game.
This step separates browser startup; it does not claim the entire repository
or its Node tooling is independent yet.

Washoi owns `client/main.ts`, `client/registerServices.ts`, `index.html` and
`browser.json`. The existing initialization sequence, lobby/player flow,
loading-screen behavior, editor return flow, diagnostics and render loop are
preserved. The game initializes GamePaths from its own descriptor, with the
same values as the former engine.json configuration. It imports SHAG runtime
helpers; SHAG's browser entry does not import the game.

`BrowserRuntime` exposes renderer creation, scene policy setup and scene-service
initialization as separate phases. The application creates the active camera
between scene creation and service initialization. Renderer backend/fallback
policy, texture/lighting setup and physics handling retain their behavior.
The neutral `src/main.ts` renders a box with a free camera. Its new resize
listener is removed when the scene is disposed. Existing application listeners
and lifecycle ownership move with the application; no new game listeners or
timers are introduced by the extraction.

The generic build helper selects an application directory from shell `SHAG_APP`,
then ignored `.shag-application.json`, otherwise the engine example. `engine`
is the explicit neutral selection. The selected directory declares its module
entry and HTML in browser.json; the root HTML hook installs only that entry.
No game code is glob-imported or used as a fallback. The local selection in
this development checkout is Washoi, preserving `npm run dev`/`build` here.
The checked-in default is the engine example. Browser selection replaces the
old GAME selection; whole-project aliases/Node wrappers are a later boundary.
Static public media and production deployment are not migrated in this step.

Exact changed paths (including matching game revision):

- `AGENTS.md`
- `.env.example`
- `.gitignore`
- `index.html`
- `package.json`
- `vite.config.ts`
- `scripts/browser-application.ts`
- `scripts/check-browser-boundary.mjs`
- `src/engine/core/GamePaths.ts` (documentation comment)
- `src/main.ts`
- `src/__tests__/BrowserApplication.test.ts`
- `src/engine/runtime/BrowserRuntime.ts`
- `src/games/fps/browser.json`
- `src/games/fps/index.html`
- `src/games/fps/client/main.ts`
- `src/games/fps/client/registerServices.ts`
- `src/games/fps/docs/manual/getting-started/index.md`
- `src/games/fps` (gitlink)
- `docs/manual/guides/configuration.md`
- `docs/manual/guides/service-registries.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`

Validation runs in the primary checkout; both repositories were clean before
this step. Receipts are under `.cache/engine-game-split/step13-validation`.

- `npm.cmd run test:run -- src/__tests__/BrowserApplication.test.ts src/__tests__/ViteBabylonDeps.test.ts` passed the initial 6 cases. The first sandbox attempt could not spawn esbuild (EPERM); the permitted subprocess run passed. An external application path case was subsequently added.
- `npm.cmd run check:browser:engine` typechecks the browser dependency graph with all src/games files virtually unavailable, then builds the neutral entry and rejects any game modules in Rollup's complete module graph. Explicit ambient roots include DebugGlobals and the Electron preload's Window declaration. The first narrow typing probe omitted that host declaration and reported four electronAPI diagnostics; adding the existing declaration root resolved them. The no-game check does not rename or remove a real checkout. Its bundle omits copied public media and lives under `.cache/browser-engine-check`.
- `node .cache/engine-game-split/prove-step13.mjs` compares the application tail, scene-service sequence and adapter registrations against the committed original using TypeScript printing with comments/import paths normalized. All match. Moved HTML matches after normalizing line endings, blank-line whitespace and replacing the old script tag with the entry marker. Runtime path configuration matches exactly.
- `node .cache/engine-game-split/validate-step13.mjs` runs `npm.cmd run typecheck`, `npm.cmd run test:run`, `npm.cmd run gate:biome`, `npm.cmd run build`, `npm.cmd run build:server`, `npm.cmd run docs:build`, `npm.cmd run docs:fps:build`, `npm.cmd run test:simulation`, `npm.cmd run test:physics`, `npm.cmd run server:tick`, and `npm.cmd run server:fuzz -- --ticks 1000`. It also invokes the headless CLI for indexed BSP inspection, the 91-tick movement replay, and name/camera command checks as in step 12.

Initial whole-project typecheck found two ES2020 compatibility diagnostics in
the selector's replaceAll calls. Regex replacements fixed them; the restarted
typecheck passed. An initial PowerShell redirected boundary-build invocation
reported a shell error on stderr warnings despite completing its build; a Node
subprocess wrapper captured a definitive zero exit, zero typing diagnostics
and zero game modules. Logs retain both runs.

Remaining boundary work includes Node/application services, fixed whole-project
aliases and roots, game-owned assets/policy, CI/deployment and final gitlink
cutover. A passing browser boundary does not establish those broader outcomes.


All initial gates passed: 713 test files, 5,619 tests passed and one skipped;
Biome remained at zero errors / 47 baseline warnings. Client/server and both
documentation builds passed. Simulation/physics passed; tick checksum was
2768943778 and 1,000-tick fuzz checksum 4081417247. Indexed BSP inspection
reported 7,475 faces; movement replay completed 91 ticks. Name/camera CLI
checks passed. The full test run includes all five selector tests.

The first real-browser probe exposed a dependency-scanning issue: HTML entry
injection alone did not feed the game entry to Vite's scanner. It discovered
Capacitor dependencies during startup and replaced optimized shader/audio chunks,
leaving the running page with stale chunk URLs. The log showed new dependencies
and a dependency-cache reload, followed by three 404 chunk requests. That probe
rendered geometry but lost the network connection and is not counted as a pass.
The report is retained as `browser-before-explicit-scan.json`.

The fix explicitly sets optimizeDeps.entries to the selected application entry.
Fresh-cache probe servers then booted both compositions without dependency chunk
failures or a cache reload. A focused rerun of the selection/dependency tests
passed 2 files / 7 tests. Typecheck and both browser production builds are rerun
after this configuration correction; the earlier complete regression results
remain recorded above. The browser-only boundary continues to reject game
modules and hidden-game type dependencies.


Final post-scan results: whole-project typecheck and Washoi production build
passed; the engine boundary build passed with zero diagnostics and zero game
modules. The command wrapper was `node .cache/engine-game-split/step13-after-scan.mjs`
(invoking typecheck, build and scripts/check-browser-boundary.mjs); logs are
`*-after-scan.log`.

Real browser validation used headless Edge on WebGL2, private no-HMR Vite
servers at 3107 (engine) and 3108 (Washoi), and a scratch lobby at 9017. No bot
server was needed. Scratch storage was `.cache/engine-game-split/step13-validation/lobby-data`.
The private launcher was `node .cache/engine-game-split/step13-vite.mjs <engine|src/games/fps> <port>`;
`node .cache/engine-game-split/step13-browser.mjs` drove the probes through CDP.
The compiled lobby ran with `node dist-server/lobby-server.mjs --port 9017 --data-dir <scratch>`.

- Engine example: visible box, active example camera, WebGL2; frame ID advanced from 3 to 169. No collected errors or failed requests.
- Washoi: title, lobby and player initialized. `developer 1`, `editor open`, `editor status`, `editor close` passed; the lobby returned after closing the editor.
- `map washoi_dm2 ffa` spawned the local game server. The loadout confirmation entered connected `playing` state at position (230, 24.03125, -270). The scene contained 136 BSP meshes and advanced from frame 2853 to 3003 while remaining connected.
- `disconnect` closed the game connection and reloaded startup. The probe dismissed startup again and confirmed the lobby was visible. The game server auto-exited when empty.
- Final report: `browser.json`; inspected screenshots: `engine-example.png` and `washoi-ffa.png`. No HTTP error responses or stale dependency chunks in the final probe. The editor status request to 9010 was refused because no standalone editor HTTP service was started; browser editor open/close still passed. Pointer-lock notice in the screenshot is expected from a programmatic click without user activation.

Existing missing model/texture, common-skeleton-root, duplicate registration and
world-readiness warnings remain visible where applicable. They are part of the
deferred loading/asset investigation, not claimed fixed here. No WebGPU/mobile/
Electron packaging or human mouse/audio playtest was performed. No production
server, deployment, real account data or release configuration was changed.
Production assembly still needs an explicit application selection before the
repository cutover; it must not assume the neutral default launches Washoi.

Private Vite/lobby processes and headless browsers were stopped. Ports 3107,
3108, 9017 and the probe game port 7777 were confirmed closed. The scratch
lobby account database/secret directory was removed; validation logs remain.


## 14. Published-map analysis supplied by the game

Washoi commit: `536f8cb` (`refactor: own published-map reachability analysis`).

Goal remains independent Git checkouts with documented assembly, not two
standalone runnable applications. Generic editor/server infrastructure stays
in SHAG; Washoi behavior is supplied through engine-owned contracts.

The refreshed tracked-TypeScript audit found zero direct production imports
from src/engine into Washoi, but one transitive path: AgentPipeline loaded
BotVision/BotNavGraph, whose implementations depend on FPS movement and data.
That dependency is used by the map-report validation tool, not by the editor's
editing/rendering UI. It loads compiled collision data for the player walk
flood and builds a bot graph to report unreachable pickups/disconnected spawns.

SHAG now defines a GameMapAnalysis registry and MapReachabilityResult contract.
AgentPipeline delegates to its registered provider. Without a provider it
returns an explicit false player verdict with an analysis-unavailable error;
compilation can still operate with a compiler profile. Provider exceptions
propagate. Washoi owns FpsMapAnalysis, whose analysis body is unchanged after
normalizing module paths; its four existing Node editor composition roots
register the provider. Those outer composition roots still import Washoi and
must be moved or selected explicitly before final repository cutover.

Generic PlayerReach, WalkFlood and graph-report helpers remain in SHAG. The
existing fixed 45-unit hop, collision inputs, bot graph, result fields, ordering
and overall report verdict logic are unchanged. No new listeners or timers.
No browser startup, networking, simulation or rendering algorithms changed.

Exact changed paths:

- `src/engine/editor/server/GameMapAnalysis.ts`
- `src/engine/editor/server/AgentPipeline.ts`
- `src/engine/editor/server/__tests__/GameMapAnalysis.test.ts`
- `src/games/fps/editor/server/FpsMapAnalysis.ts`
- `src/cli/shagged.ts`
- `src/cli/shagged-mcp.ts`
- `src/cli/shagged-server.ts`
- `src/cli/shagged-compile.ts`
- `src/games/fps` (gitlink)
- `docs/manual/guides/service-registries.md`
- `docs/manual/guides/shagged-api.md`
- `docs/research/ENGINE_GAME_SPLIT_INVENTORY.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`
- `docs/changelog/v1.0.0-alpha.3.md`

Both working trees were clean at the start. Validation runs in the primary
checkout against engine 79becbae / Washoi e739f8e, after the requested metadata
rewrite; no historical timestamps or receipts were rewritten again. Receipts
are under `.cache/engine-game-split/step14-validation`.

- `node docs/research/engine-game-split-audit.mjs` ran before and after extraction. The post-change scan includes the staged new files, reading the candidate working tree at the listed base revisions. The regenerated inventory has 1,799 TypeScript files and **zero direct or indirect production src/engine-to-Washoi code paths**. This is a source/type graph claim, not a complete repository-independence claim.
- `npm.cmd run test:run -- src/engine/editor/server/__tests__/GameMapAnalysis.test.ts src/engine/editor/server/__tests__/PlayerReach.test.ts src/engine/editor/api/__tests__/Reachability.test.ts src/engine/editor/server/__tests__/DocumentInspection.test.ts` passed 4 files / 15 tests. Cases cover missing provider, exact input/result forwarding, cleanup, failure propagation and generic reachability behavior.
- `node .cache/engine-game-split/prove-step14.mjs` compares the original/extracted function bodies through TypeScript printing, normalizing import paths; identical.
- `node node_modules/vite-node/vite-node.mjs .cache/engine-game-split/step14-parity.ts` runs the original and registered provider against indexed washoi_dm2 with real collision and bot navigation. Complete serialized results match: 6 spawns, 18 items, 10,533 player flood positions, 97 bot nodes and 477 edges, including identical existing unreachable-item/spawn findings. No compile, map publication or user document write occurs.
- `node .cache/engine-game-split/step14-types.mjs` typechecks the Node editor pipeline with game directories virtually unavailable. Zero diagnostics and zero game source files. It includes existing engine/browser/host ambient declaration roots; it does not claim the whole repository typechecks without the game.
- `node .cache/engine-game-split/validate-step14.mjs` runs typecheck, the full test suite, Biome, client/server builds, both documentation builds, simulation, physics, server tick, 1,000-tick fuzz and indexed BSP/replay/name/camera CLI checks, using the same exact npm/CLI commands as step 13.

Remaining dependency groups after this step:

- 21 outer bot production files import game movement, weapon/item policy or client/server helpers (41 sites).
- 23 outer CLI production files import game code (55 sites, including explicit editor composition registrations). Keep reusable implementations generic; make the game own its entry/composition policy.
- Two lobby files import game policy: LobbyServer's demo-map aliases and PlayerIdentity's bot-name classification. Generic account/room/server infrastructure can remain in SHAG.
- Five engine test files still directly import FPS integrations/actions; retain their coverage in game-owned tests or use neutral fixtures where behavior is engine-owned. Outer bot/lobby tests also require the same ownership pass.
- Historical probes, water-visual-scene, raw game media recipes, fixed aliases/build roots, native/platform metadata, CI and deployment require their separate configuration audit. The nonliteral TypeScript calls are TFBackend's package selection and Electron's game.json lookup; the latter is already documented as a stale packaging path.
- The tracked gitlink and .gitmodules remain until those dependencies and the documented assembly procedure are ready. No repository attachment was removed and no code was pushed.

Unverified here: fresh browser/GPU behavior, production deployment, Electron/
mobile packaging and whole-repository checks without Washoi. Existing deferred
loading/asset findings remain separate. The real-map before/after report and
headless tests validate this Node-only delegation step.


Full-suite finding: 713 files passed and one failed (5,621 tests passed, one
failed and one skipped). The failure is RemoteWeaponLeak's Firefox/WebGL
material ownership case at line 100, waiting for weapon roots: the same location
recorded in steps 8/12 and the Balanced-default work. All six cases passed in
isolation with `npm.cmd run test:run -- src/games/fps/client/__tests__/RemoteWeaponLeak.test.ts`.
The full-run cause is not established; no weapon code or timeout changed.
No clean full-suite pass is claimed. Remaining gates resume at gate-biome.
The first Biome run found CRLF formatting in the newly written provider after
a comment edit; the scoped formatter normalized it and the repeated gate
passed at zero errors / 47 baseline warnings.


Final remaining results: client/server builds and both documentation builds
passed. Simulation and physics passed; tick checksum 2768943778 and 1,000-tick
fuzz checksum 785138479 reconciled. Indexed BSP inspection reported 7,475 faces;
movement replay completed 91 ticks. Name/camera CLI checks passed. The full-suite
weapon-root wait finding above remains open; these passes do not resolve it.

Additional configuration search used rg over scripts, workflows, config,
package/TypeScript/Vite/Vitest files, engine.json, Electron builder and
.gitmodules. Concrete remaining references include the tracked gitlink,
recursive CI checkout/token, fixed aliases, browser-neutral versus game build
selection, benchmark game fixtures and Electron game metadata. Postinstall's
current Havok/TensorFlow fixups do not themselves fetch a game checkout; their
ownership/dependency packaging can be reviewed with the bot application pass.

## Server ownership plan — 2026-10-23

The next stages are planned in
[Repository split: server ownership plan](./ENGINE_GAME_SPLIT_SERVER_PLAN.md).
This is a planning checkpoint, not an implemented separation step. Source was
checked against engine `8d070ebc` / Washoi `536f8cb`; both trees were clean
before the documentation work.

Start by making game-server entry locations explicit inputs to the reusable
spawner/runtime, preserving the existing locations and process behavior. Prove
that wiring before moving the concrete launcher, map-loader composition and
application build recipe. Later patches address lobby policy, bots/tools,
tests/configuration and finally fresh-checkout proof and Git detachment.

The plan records process, admission, result, shutdown/demo and deterministic
simulation contracts, validation checkpoints and rollback. No runtime code,
server artifact, database, Git attachment or running service changed here.
The previous full-suite weapon-root wait finding remains open. Runtime gates
listed in the plan have not been rerun for this documentation-only checkpoint.

## 15. Explicit dedicated-server application entries

Washoi supplies `FPS_SERVER_APPLICATION` with the existing source and bundled
entry paths. The lobby CLI and real-server integration tests pass it to
`GameServerSpawner`; the reusable spawner/runtime no longer contain a concrete
game-server entry path. A spawner without entries remains constructible for
lobby-only use, but rejects a spawn request before allocating a port, issuing
admission grants or preparing result delivery. The generic runtime accepts
absolute entries or entries relative to the assembled root.

This implements phase 1 of the
[server ownership plan](./ENGINE_GAME_SPLIT_SERVER_PLAN.md). The launcher,
mixed map loader, lobby application and build recipe have not moved. The two
lobby policy imports, bot/tool ownership, test/configuration cleanup and final
Git cutover remain pending. Adding explicit game composition to the lobby CLI
adds an expected direct CLI import; it does not make reusable lobby code
import the game.

### Scope and assumptions

Validation starts from engine `8d070ebc` / Washoi `536f8cb`, with only the prior
planning documents uncommitted. The assembled root stays the working directory;
the source entry and `dist-server/headless-netserver-v2.mjs` artifact stay the
same. Node 24.21.0 and the pinned Bun 1.4.3 are installed. Runtime selection,
child flags/environment, readiness, ports, admission, results, shutdown,
simulation and game rules retain their configured behavior. Direct consumers
of the spawner must now supply application entries if they request a process.

Private baseline/after server bundles are built under
`.cache/engine-game-split/step15-validation/{baseline,after}/dist-server`.
Their probes use temporary account/result databases, dynamically allocated
ports and explicit scratch demo output paths. They do not replace the default
server bundles or restart a live service. Probe databases are retained by the
existing probe for inspection. Normal test-suite fixtures retain their own
temporary data and demo cleanup behavior.

### Baseline finding and probe correction

Before production edits, the bundled Node probe reached room creation/join but
timed out without requesting a child. Source inspection confirmed that its
two-player fixture no longer met FFA's four-player minimum. Updating account
creation alone also left its original single join unchanged; that incomplete
fixture timed out too. The corrected probe creates four accounts, joins all
four to the room, and checks four result rows. No minimum, gameplay rule,
timeout or assertion was weakened. Both original failure logs are retained
alongside the corrected baseline logs.

The initial sandbox test invocation could not start its subprocess (`EPERM`);
the authorized subprocess run succeeded. The private runner also initially
used the Windows Bun shim as a native executable (`ENOENT`); it now uses the
existing `bunExecutable` resolver. These are validation harness findings, not
server behavior failures.

### Files changed

Outer repository:

- `src/lobby/ServerRuntime.ts`
- `src/lobby/GameServerSpawner.ts`
- `src/cli/lobby-server.ts`
- `src/cli/ServerRuntimeProbe.ts`
- `src/lobby/__tests__/ServerRuntime.test.ts`
- `src/lobby/__tests__/GameServerSpawnerAdmission.test.ts`
- `src/lobby/integration/SpawnedResult.test.ts`
- `src/lobby/integration/RoomToRanking.test.ts`
- `src/lobby/integration/DropIn.test.ts`
- `docs/manual/guides/lobby-server.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_SERVER_PLAN.md`
- `docs/research/ENGINE_GAME_SPLIT_INVENTORY.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`
- `src/games/fps` gitlink, advanced to game commit `7d2743b`.

Washoi repository:

- `server/FpsServerApplication.ts`

### Validation evidence

Receipts and complete logs are under
`.cache/engine-game-split/step15-validation`. The orchestration command is
`node .cache/engine-game-split/validate-step15.mjs <baseline|after|gates>`;
each receipt records exact executable, arguments, cwd and exit status. The
baseline resumes for corrected private builds/probes are recorded separately
in the retained per-check logs.

- Before/after targeted command:
  `npm.cmd run test:run -- src/lobby/__tests__/ServerRuntime.test.ts src/lobby/__tests__/SpawnerPorts.test.ts src/lobby/__tests__/SpawnAbandon.test.ts src/lobby/__tests__/GameServerSpawnerAdmission.test.ts`.
  Baseline: 4 files / 15 tests passed. After: 4 files / 21 tests passed, including
  missing/incomplete configuration, paths with spaces, absolute entry paths,
  inherited runtimes and rejection before resource preparation.
- Before/after `npm.cmd run server:tick`: checksum `2768943778`.
- Before/after `npm.cmd run server:fuzz -- --ticks 1000 --seed 42`:
  checksum `2481546443`.
- Before/after `npm.cmd run test:runtime-equivalence`: 10,000 ticks, seed 42,
  checksum `507638786` under both Node and Bun.
- Private server builds:
  `node scripts/build-servers.mjs .cache/engine-game-split/step15-validation/baseline/dist-server`
  and the corresponding `after/dist-server` command. Both passed. Artifact
  SHA-256 receipts show the dedicated-server, bot-server and benchmark bundles
  are byte-identical; lobby and runtime-probe wiring changes are expected.
- Each private `dist-server/ServerRuntimeProbe.mjs` was run with Node and the
  resolved native Bun executable, with its parent directory as cwd. All four
  corrected baseline/after runs passed: actual executable inheritance, ticketed
  four-player FFA, signed result delivery to four rows, emptied pending delivery
  and graceful child exit. These two-second matches are below the existing
  demo retention floor; they do not establish persistence of a keepable demo.
- `node .cache/engine-game-split/prove-step15.mjs`: 16 old/new runtime/path
  launch contexts match. Nine other spawner methods are identical; `spawnOn`
  has identical statements except receiving its preselected launch command.
  Launcher, map loader, result outbox/delivery and admission/signing files are
  unchanged. This is a source parity check, not a substitute for process tests.
- `node .cache/engine-game-split/receipt-step15.mjs`: recorded baseline/after
  revisions, runtime versions, artifact hashes and successful probe summaries.
- `node docs/research/engine-game-split-audit.mjs`: 1,800 candidate tracked
  TypeScript files; zero direct or indirect production engine-to-Washoi code
  paths. Root source still has 21 bot files / 41 sites, 24 CLI files / 57 sites
  and two lobby policy files / two sites importing game code.

Final gate/regression commands and results:

| Command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run test:run` | 714 files passed; 5,628 tests passed, one skipped |
| `npm.cmd run gate:biome` | Passed, zero errors / 47 baseline warnings |
| `npm.cmd run build` | Passed, including prebuild index and postbuild sourcemap relocation |
| `npm.cmd run docs:build` | Passed |
| `npm.cmd run docs:fps:build` | Passed |
| `npm.cmd run test:simulation` | Passed |
| `npm.cmd run test:physics` | Passed |
| `npm.cmd run server:tick` | Passed, same baseline checksum |
| `npm.cmd run server:fuzz -- --ticks 1000 --seed 42` | Passed, same baseline checksum |
| `npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Passed; indexed FBSP, 7,475 faces |
| `npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'` | Passed; 91 ticks |

The initial BSP invocation used `bsp load wdm2`, which failed because the
installed indexed package is `map_washoi_dm2.pk3`, not `map_wdm2.pk3`. The
corrected command above passed; no alias, loader or game data was changed to
make it pass. Its failure log and initial gate receipt are retained. The
server plan's example now names the installed map, matching the regression
procedure. The earlier `RemoteWeaponLeak` failure did not reproduce in this
complete suite run; that pass does not establish the cause of earlier failures.

No browser/GPU session, production deployment, live-service restart, platform
packaging, live TLS/WebTransport session or independent-checkout cutover is
claimed for this step. The real-process probes exercised FFA; the later cutover
still requires the planned assembled browser checks across all four modes.

## 16. Washoi-owned dedicated launcher and map loader

This checkpoint implements the launcher/map-loader portion of phase 2 from the
[server ownership plan](./ENGINE_GAME_SPLIT_SERVER_PLAN.md). The exact path and
caller checklist was written before the move. The user confirmed that FFA
starts after step 15; this step begins from clean engine `c7e2054d` and game
`7d2743b` trees.

The dedicated launcher and map loader move from outer `src/cli/` into the
game's `cli/` directory. Static, dynamic and inline type import paths are
rebased to the same modules; source examples/help follow the new location.
The former engine paths are removed, with no compatibility wrappers. The
game descriptor, development command, map-loader callers and source-mode
memory benchmark follow the moved files.

`scripts/build-servers.mjs` now explicitly names all five output entries.
Simply changing one entry's directory would make esbuild infer a different
common source root and change output paths. Explicit names retain the same
five top-level artifacts under `dist-server/`; output staging/swap/rollback
code is unchanged. Lobby startup and build-recipe ownership stay in the outer
repository for the next checkpoint.

### Preserved contracts and assumptions

The assembled project root remains the working directory. Default map/game
paths, TLS fallback, flags, gametype aliases, admission/result environment and
stdio, readiness, process runtime inheritance, shutdown, map loading,
simulation and telemetry retain their implementations. The reusable spawner,
runtime selector, collision helper, CLI runner, memory marker and result outbox
are unchanged. Existing account keys, demos, databases and protocol formats
need no conversion.

The engine manual's server default-map table said `wdm7`; source/help already
defaulted to `washoi_dm2`. The table is corrected while updating ownership and
source paths. No runtime default changed. Historical research and prior
validation commands remain historical.

### Exact files changed

Outer repository:

- `src/cli/headless-netserver-v2.ts` (removed; moved to game)
- `src/cli/HeadlessMapLoader.ts` (removed; moved to game)
- `src/cli/record-demo.ts`
- `src/cli/timedemo-fixture.ts`
- `scripts/build-servers.mjs`
- `scripts/benchmarks/server-memory.mjs`
- `package.json`
- `docs/manual/tools/network-server.md`
- `docs/manual/guides/lobby-server.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_SERVER_PLAN.md`
- `docs/research/ENGINE_GAME_SPLIT_INVENTORY.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`
- `src/games/fps` (matching game revision `0e11f0d`)

Washoi repository:

- `cli/headless-netserver-v2.ts` (moved from outer repository)
- `cli/HeadlessMapLoader.ts` (moved from outer repository)
- `server/FpsServerApplication.ts`
- `docs/manual/developer/adding-a-gametype.md`

### Validation evidence

Logs and receipts live under `.cache/engine-game-split/step16-validation`.
The scratch runner is
`node .cache/engine-game-split/validate-step16.mjs <baseline|after|gates>`.
Receipts record the exact executable, arguments, cwd and status for each check.
No default `dist-server/` build is replaced: before/after builds go into private
`baseline/dist-server` and `after/dist-server` directories under that location.
Real probes use temporary account/result databases, explicit scratch demo output
paths and available ports; the probe retains its databases for inspection.

- Before/after
  `npm.cmd run test:run -- src/lobby/__tests__/ServerRuntime.test.ts src/lobby/__tests__/SpawnerPorts.test.ts src/lobby/__tests__/SpawnAbandon.test.ts src/lobby/__tests__/GameServerSpawnerAdmission.test.ts`:
  4 files / 21 tests passed on each side.
- Before/after `npm.cmd run server:tick`: checksum `2768943778`.
- Before/after `npm.cmd run server:fuzz -- --ticks 1000 --seed 42`:
  checksum `2481546443`.
- Before/after `npm.cmd run test:runtime-equivalence`: Node and Bun both
  produce `507638786` over 10,000 ticks with seed 42. Runtimes are Node 24.21.0
  and the pinned Bun 1.4.3.
- Private builds use `node scripts/build-servers.mjs` with each private output
  directory as the argument. Both passed, retaining `headless-netserver-v2.mjs`,
  `lobby-server.mjs`, `bot-server.mjs`, `ServerBenchmarkClient.mjs` and
  `ServerRuntimeProbe.mjs` at the same relative output paths.
- Each private `dist-server/ServerRuntimeProbe.mjs` ran under Node and native
  Bun from its parent directory: four successful before/after real-process
  runs, verifying runtime inheritance, ticketed four-player FFA, signed results
  delivered to four rows, emptied pending delivery and graceful child shutdown.
  These short matches are below the demo retention floor.
- `node .cache/engine-game-split/source-smoke-step16.mjs`: Node and Bun launch
  the moved source directly, load indexed `washoi_dm2`, become ready, accept
  `status`/`quit` and exit zero. Commands/executables are recorded in the source
  receipt; no game clients or persistent match data are created by these runs.
- `npm.cmd run net:server:dev -- --help`: passed through the public npm command.
- `node .cache/engine-game-split/prove-step16.mjs`: both moved files have
  identical bodies/import bindings after canonical module-target, import-order
  and source/help-path normalization. Six generic files are unchanged. The build script changes
  only its `entryPoints` value, preserving atomic publication behavior.
- `node .cache/engine-game-split/receipt-step16.mjs`: four bundle syntax trees
  match after source/help-path and comment normalization; bot/benchmark bundles
  are byte-identical. Import sorting changes the dedicated bundle's declaration
  order and generated `fs`/`path` aliases, so exact whole-tree equality is not
  claimed for that artifact. Artifact hashes and runtime probe summaries are
  retained in `baseline-and-after.json`.
- `node .cache/engine-game-split/bundle-parity-step16.mjs`: dedicated bundle's
  29 import bindings and all 715 top-level statements match after resolving
  imported aliases by TypeScript symbol and accounting for declaration order;
  all 19 top-level expression statements also match in order. This verifies
  the code comparison, not identical declaration/initialization ordering. The
  real source/bundled probes, map-data parity and full suite are repeated after
  the import sorting to exercise the final module order.
- `node .cache/engine-game-split/prepare-map-parity-step16.mjs`, then
  `node node_modules/vite-node/vite-node.mjs .cache/engine-game-split/map-parity-step16.ts`:
  old/new loaders return identical serialized data, excluding the collision
  instance. The collision factory and its imports are unchanged and are also
  exercised by source startup and regression tests. Map bytes SHA-256 is
  `f1cab8f8abdff75aca24c180c0979a13c8caeaf63273a4b8b17f8f18cb6b6da5`;
  the complete returned-data hash is
  `e47148f3001421b95ca9ba77a361a1a8e17a0b0c8fc3418283986e48972f86f6`.
  Both report six spawns, 18 pickups, five triggers, 116 entities, six models
  and retained PVS data.
- `node docs/research/engine-game-split-audit.mjs`: candidate inventory contains
  1,800 TypeScript files, with zero direct/indirect production engine-to-Washoi
  paths. Remaining outer source imports are 21 bot files / 41 sites, 22 CLI
  files / 49 sites, and two lobby files / two sites.

The initial full-suite run passed 714 files / 5,628 tests, with one skipped.
The following Biome gate failed on four import-order diagnostics introduced by
rebasing imports (the two moved files and two map-loader callers). Scoped
`biome check --write` corrected those four files; the scoped check then passed.
No baseline, assertion or timeout was relaxed. The successful earlier suite
and failed lint logs are retained. All parity/probe checks and the full gate
sequence are repeated against the sorted final source.

Final full-suite, build and headless gate results (after import sorting):

| Command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run test:run` | 714 files passed; 5,628 tests passed, one skipped |
| `npm.cmd run gate:biome` | Passed; zero errors / 47 baseline warnings |
| `npm.cmd run build` | Passed, including index generation and sourcemap relocation |
| `npm.cmd run docs:build` | Passed |
| `npm.cmd run docs:fps:build` | Passed |
| `npm.cmd run test:simulation` | Passed |
| `npm.cmd run test:physics` | Passed |
| `npm.cmd run server:tick` | Passed; same baseline checksum |
| `npm.cmd run server:fuzz -- --ticks 1000 --seed 42` | Passed; same baseline checksum |
| `npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Passed; 7,475 faces |
| `npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'` | Passed; 91 ticks |

Browser/GPU play, four-mode browser cutover, live TLS/WebTransport, production
deployment and platform packaging are not claimed. The Git attachment remains;
lobby/build ownership, policies, bots/tools, tests/configuration and independent
checkout proof still follow the plan.

## 17. Washoi-owned lobby startup and server build recipe

This completes phase 2b of the
[server ownership plan](./ENGINE_GAME_SPLIT_SERVER_PLAN.md). Starting from clean
SHAG `6b43a141` / Washoi `0e11f0d`, the user confirmed FFA starts after step 16.
The path/caller/root-resolution checklist was recorded before editing.

`src/cli/lobby-server.ts` moves to the game's `cli/lobby-server.ts` and
`scripts/build-servers.mjs` moves to the game's `scripts/build-servers.mjs`.
No engine wrappers remain. The outer `build:server` and `lobby:server:dev`
commands delegate to the new paths. The recovery test's explicit CLI path also
follows the move. Existing CI invokes the npm build command and the preserved
artifact filenames, so that workflow requires no path change in this step.

### Scope and preserved behavior

The moved build recipe resolves the assembled root four parents above its
script directory, matching the old recipe's root one parent above its old
directory. Root resolution remains independent of invocation cwd. Its optional
output argument remains absolute or root-relative, with `dist-server` as the
default. Its lobby source entry follows the move; the same five output names,
dependency/build options and staging/swap/rollback statements are preserved.

Lobby parsing, defaults, data selection, account/result/settings stores,
configured child spawner, readiness logging and signal handlers retain their
code bodies. Import targets are rebased and imports/formatting follow Biome.
No protocol, account-key, database, rating, transport or simulation format
changes. Eight generic lobby/runtime/store files are unchanged. The assembled
layout remains SHAG with Washoi under `src/games/fps`; lobby commands still run
from the assembled root.

### Exact files changed

Outer repository:

- `src/cli/lobby-server.ts` (removed; moved to game)
- `scripts/build-servers.mjs` (removed; moved to game)
- `package.json`
- `src/lobby/__tests__/ResultDelivery.test.ts`
- `docs/manual/guides/lobby-server.md`
- `docs/manual/guides/headless-mode.md`
- `docs/changelog/v1.0.0-alpha.3.md`
- `docs/research/ENGINE_GAME_SPLIT_SERVER_PLAN.md`
- `docs/research/ENGINE_GAME_SPLIT_INVENTORY.md`
- `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`
- `src/games/fps` (matching game revision `a71ce9e`)

Washoi repository:

- `cli/lobby-server.ts` (moved from outer repository)
- `scripts/build-servers.mjs` (moved from outer repository)
- `docs/manual/getting-started/project-structure.md`

### Validation evidence

Complete logs/receipts are in `.cache/engine-game-split/step17-validation`.
`node .cache/engine-game-split/validate-step17.mjs <baseline|after|gates>` records
each executable, argument array, cwd and exit status. Private builds target
`baseline/dist-server` and `after/dist-server` beneath that directory, leaving
the default server bundles alone. Match probes use temporary databases,
available ports and explicit scratch demo paths; their short matches remain
below the recording retention floor. The existing probe retains temporary
databases for inspection.

- Before/after
  `npm.cmd run test:run -- src/lobby/__tests__/ResultDelivery.test.ts src/lobby/__tests__/ServerRuntime.test.ts src/lobby/__tests__/SpawnerPorts.test.ts src/lobby/__tests__/SpawnAbandon.test.ts src/lobby/__tests__/GameServerSpawnerAdmission.test.ts`:
  five files / 32 tests passed on both sides, including real offline CLI
  recovery, missing-storage refusal and runtime/admission handling.
- Before/after `npm.cmd run server:tick`: checksum `2768943778`.
- Before/after `npm.cmd run server:fuzz -- --ticks 1000 --seed 42`:
  checksum `2481546443`.
- Before/after `npm.cmd run test:runtime-equivalence`: checksum `507638786`
  under Node 24.21.0 and pinned Bun 1.4.3 over 10,000 ticks, seed 42.
- Baseline private build uses `node scripts/build-servers.mjs <private-output>`;
  after uses `node src/games/fps/scripts/build-servers.mjs <private-output>`.
  Both pass and publish the same five filenames. The corresponding private
  `ServerRuntimeProbe.mjs` runs pass under Node and native Bun: ticketed
  four-player FFA, inherited runtime executable, signed results delivered to
  four rows, pending delivery cleared and graceful child shutdown.
- `node .cache/engine-game-split/prove-step17.mjs`: lobby body/import bindings
  match after canonical target/import-order normalization. The build recipe's
  ordered structural syntax matches after the root-depth/lobby-entry changes
  and formatting normalization. Its actual resolved root matches the workspace;
  private output paths are bounded to the validation directory. Generic `LobbyServer`,
  `GameServerSpawner`, `ServerRuntime`, `ServerData`, `PlayerStore`,
  `MatchResultStore`, `RatingStore` and `SettingsStore` are unchanged.
- `node .cache/engine-game-split/cli-smoke-step17.mjs`: four actual CLI starts
  (Node/Bun, source/bundle) pass readiness and account welcome using private
  databases/free ports. Source cases verify relative `--data-dir` and
  `--max-players` override conflicting environment values. Bundle cases verify
  `SERVER_DATA_DIR` / `SHAG_LOBBY_MAX_PLAYERS` fallbacks. Each creates its
  private database/bot-secret file and leaves the ignored directory absent.
  No match is created in these CLI-startup checks; their owned lobby process
  is terminated afterward. These checks do not claim graceful OS signal
  delivery on Windows. The full match probes exercise awaited lobby/child stop.
- That script also runs the recipe from another cwd with a root-relative output
  argument. It publishes under the same verified assembled root, rather than
  relative to the caller's cwd. Output stays in the private `outside-cwd` area.
- `npm.cmd run build:server -- .cache/engine-game-split/step17-validation/npm-dist-server`:
  passed through the public npm redirect, with only private output written.
- `npm.cmd run lobby:server:dev -- --help`: passed through the public development
  command without opening a server or real data directory.
- `node .cache/engine-game-split/receipt-step17.mjs`: four non-lobby bundles are
  byte-identical to baseline. The lobby's 824 top-level statements match as a
  multiset after source comments/import order are accounted for; all 113
  top-level expression statements match in order. Import sorting relocates the
  game-entry descriptor declaration, so identical declaration order is not
  claimed. Direct, public-npm and outside-cwd builds have byte-identical copies
  of all five final artifacts.
- `node docs/research/engine-game-split-audit.mjs`: 1,800 candidate TypeScript
  files; zero direct/indirect production engine-to-Washoi paths. Remaining outer
  imports: 21 bot files / 41 sites, 21 CLI files / 48 sites and two lobby files /
  two sites. JavaScript/build inputs remain outside this TypeScript graph claim.

Validation harness findings: the initial printer-text comparison retained
formatting/trailing-comma layout, so it rejected the formatter-only build-script
layout change. The check now compares structural syntax, retaining declaration
flags, literal values and statement order. An initial CLI probe asserted the
cap immediately after the readiness chunk; its final log already contained the
correct cap. The probe now waits for the complete cap line before asserting,
without changing timeouts, expected values or application code. The initial
chunk-race log is retained.

Final gate results:

| Command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run test:run` | 714 files passed; 5,628 tests passed, one skipped |
| `npm.cmd run gate:biome` | Passed; zero errors / 47 baseline warnings |
| `npm.cmd run build` | Passed, including index generation and sourcemap relocation |
| `npm.cmd run docs:build` | Passed |
| `npm.cmd run docs:fps:build` | Passed |
| `npm.cmd run test:simulation` | Passed |
| `npm.cmd run test:physics` | Passed |
| `npm.cmd run server:tick` | Passed; same baseline checksum |
| `npm.cmd run server:fuzz -- --ticks 1000 --seed 42` | Passed; same baseline checksum |
| `npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Passed; 7,475 faces |
| `npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'` | Passed; 91 ticks |

Browser/GPU play, live TLS/WebTransport, production deployment, platform builds
and independent-checkout cutover are not claimed. The Git attachment remains.
The two lobby policies, bots/game tools, remaining tests/configuration and
fresh-checkout proof still follow the plan; root npm/CI wiring still assumes
the assembled game until that later cutover.

## Step 18 — application-supplied lobby policies (2026-10-23)

Scope: remove the two remaining production lobby imports into Washoi. Generic
account validation/storage and demo scanning stay in SHAG. Washoi supplies its
existing bot-name predicate and demo-map resolver through explicit arguments;
there is no mutable global registration.

SHAG files changed:

- `src/lobby/PlayerIdentity.ts`: optional `PlayerNameReservation` predicate;
  syntax and default-name validation retain their original ordering.
- `src/lobby/PlayerStore.ts`: constructor/open accept a per-store predicate.
- `src/lobby/AccountSession.ts`: login accepts the browser's predicate for
  carrying a pre-account profile name into a new account.
- `src/lobby/LobbyServer.ts`: in-memory reservation input and demo media
  resolver option; default resolver only normalizes a recorded map name.
- `src/lobby/__tests__/PlayerIdentity.test.ts`, `PlayerStore.test.ts`,
  `AccountSession.test.ts`, `LobbyAuth.test.ts` and `DemoOwnership.test.ts`:
  explicit neutral reservation fixtures, store isolation and login coverage;
  generic levelshots use normalization. Game alias coverage is in Washoi.
- `docs/manual/guides/lobby-server.md`, the living changelog, server plan,
  dependency inventory and this progress log.

Washoi files changed:

- `cli/lobby-server.ts`: durable `PlayerStore.open(dataDir, isBotName)` and
  `resolveDemoMap: resolveFPSDemoMap`.
- `client/FpsLobbyService.ts`: predicate on initial login and refused-key
  fallback login; `client/IdentityFields.ts`: same predicate for typed names.
- `server/__tests__/FpsLobbyPolicies.test.ts`: every bot name, lowercase and
  numbered variants against durable accounts and browser validation; all six
  legacy aliases through real recorded demos and lobby scanning, preserving
  recorded map identities; generic normalization/default behavior also checked.
- `docs/manual/getting-started/project-structure.md`: composition inputs.

Assumptions: the assembled checkout selects Washoi, Node 24.21.0 and Bun 1.4.3
are installed, and indexed `washoi_dm2` data is available. Account key formats,
schema, migrations, hashing, profanity checks, same-name case changes, auth,
ratings, match protocol, process management and simulation are not redesigned.
Bot names and alias tables themselves are unchanged. A caller supplying its own
account store must supply that store's reservation predicate; the lobby's
in-memory option does not override a supplied store.

Validation and receipts:

- Before edits, existing five targeted server files / 32 tests, fixed-seed tick,
  fuzz and runtime equivalence, private build and real Node/Bun runtime probes
  passed. The existing step-17 runner was reused; those latest baseline logs
  live under `.cache/engine-game-split/step17-validation/after`.
- `node .cache/engine-game-split/validate-step18.mjs after`: the same five
  targeted files / 32 tests, private build and real Node/Bun four-player match
  probes passed. Tick checksum `2768943778`, 1,000-tick seed-42 fuzz checksum
  `2481546443`, 10,000-tick seed-42 Node/Bun checksum `507638786` match baseline.
- `node .cache/engine-game-split/cli-smoke-step18.mjs`: Node/Bun source and
  bundle startup with private data; CLI/environment selection, readiness,
  account auth, rejection of `Ramen_2`, acceptance of `Ramenya` passed. The
  recipe also built from a different cwd. These startup-only probes do not
  create matches or claim graceful OS-signal handling on Windows.
- `node docs/research/engine-game-split-audit.mjs`: zero production engine
  direct/transitive and lobby direct imports into Washoi; remaining production
  `src` importers are 21 bot files / 41 sites and 21 CLI files / 48 sites.
  Non-TypeScript/config/build/test dependencies remain later work.
- `node .cache/engine-game-split/check-lobby-boundary-step18.mjs`: bundled
  `LobbyServer` (37 inputs), browser `AccountSession` (17) and `PlayerIdentity`
  (one), rejecting every game source load; all three graphs passed. The first
  harness invocation lacked Vite's raw CSS treatment; setting the CSS loader
  to text resolved that harness error without application changes.

The first broader targeted run found one `PlayerStore` test still relying on
implicit Washoi reservations (`Gyoza_3`). Its reservation fixture is now explicit,
with an added assertion that a neutral second store accepts that name. Exact
Washoi reservations are covered in the game test; no expectation or timeout was
weakened. A sandboxed audit invocation failed with `spawnSync git EPERM`; the
same read-only audit passed with subprocess permissions.

`node .cache/engine-game-split/validate-step18.mjs gates` passed all checks:

| Exact command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run test:run` | 716 files passed; 5,635 tests passed, one skipped |
| `npm.cmd run gate:biome` | Passed; zero errors / 47 baseline warnings |
| `npm.cmd run build` | Passed, including PK3 index and sourcemap relocation |
| `npm.cmd run docs:build` | Passed |
| `npm.cmd run docs:fps:build` | Passed |
| `npm.cmd run test:simulation` | Passed |
| `npm.cmd run test:physics` | Passed |
| `npm.cmd run server:tick` | Passed; same baseline checksum |
| `npm.cmd run server:fuzz -- --ticks 1000 --seed 42` | Passed; same baseline checksum |
| `npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Passed; 7,475 faces |
| `npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'` | Passed; 91 ticks |

After the full suite, the new demo-policy fixture was adjusted to supply and
close its settings store explicitly. The two affected test files were checked
with `npm.cmd run test:run -- src/games/fps/server/__tests__/FpsLobbyPolicies.test.ts src/lobby/__tests__/PlayerStore.test.ts`:
20 tests passed. Production source was unchanged by that cleanup.

Washoi commit: `df17840` (`refactor: supply Washoi lobby policies explicitly`).

Concurrent projectile/rendering work was observed and excluded from this
checkpoint's ownership changes. Whole-tree gates also see that shared work.
Browser/GPU play, production TLS/WebTransport, deployment, platform packaging
and independent-checkout proof remain unverified here. Bot/tool migration,
remaining tests/configuration, documented assembly proof and Git detachment
remain; the submodule attachment is still present.

## Step 19 — game-owned bot application and launcher (2026-10-23)

The complete bot application moved from `src/bot/` to Washoi's `bot/`, with
startup from `src/cli/bot-server.ts` to `src/games/fps/cli/bot-server.ts`.
No forwarding modules remain in SHAG. This is an ownership/import-path move,
not a bot, network, training, protocol or ranking algorithm change.

The [exact 120-file move manifest](./ENGINE_GAME_SPLIT_BOT_MOVE.md) lists every
source/destination pair and every TypeScript caller rebased. It includes all
bot tests plus the bot reward/input/HybridBrain tests from engine tests and
the real private-invite integration test from lobby tests. The tests moved
with their game-specific subjects; their assertions and timing limits remain.

Other files changed:

- `package.json`: bot development startup and ranking acceptance follow the
  game-owned paths. The relocated private-invite test is selected explicitly
  to preserve its former inclusion through the lobby directory filter.
- Washoi `scripts/build-servers.mjs`: bot source entry changes; artifact name,
  externals, staging/swap, target runtime and other entries are unchanged.
- `AGENTS.md` and `.claude/skills/protocol-change/SKILL.md`: directory/test paths.
- `docs/manual/guides/lobby-server.md`; Washoi manual pages
  `getting-started/project-structure.md`, `tools/bot-server.md` and `faq/index.md`.
- Washoi `server/gametypes/SearchAndDestroy.ts`: comment path only.
- Living changelog, dependency inventory, server plan, move manifest and this log.

Bot clients/brains, control authentication, invite cancellation, team assignment,
navigation, inference/training formats, model/cache/route paths and simulation
retain their implementations. The editor's Washoi analysis provider imports
its colocated bot modules. Generic SHAG transports, lobby, accounts, ratings
and result storage remain in SHAG.

Assumptions: assembled checkout at the documented paths; Node 24.21.0 and Bun
1.4.3; indexed `washoi_dm2`; TensorFlow and its Windows native fixup installed
at the assembled root. Source and bundled bot identity still discover that root
from package.json. The fingerprint includes source paths/content and thus can
change when source moves; no stored identities, results or ratings are migrated.
See the manifest for the deferred TensorFlow/install ownership audit.

Validation receipts are under `.cache/engine-game-split/step19-validation/`:

- `node .cache/engine-game-split/validate-step19.mjs baseline` and `after`:
  **59 files / 440 tests passed** on each side, including the whole bot suite,
  three formerly engine-owned bot tests, real private-room invite integration,
  and five server launch/result/admission files. Fixed-seed tick/fuzz/runtime
  equivalence, private builds and real Node/Bun ticketed match/result/child-exit
  probes all passed on both sides. Tick `2768943778`; fuzz 1,000 / seed 42
  `2481546443`; Node/Bun 10,000 / seed 42 `507638786`.
- `node .cache/engine-game-split/bot-cli-smoke-step19.mjs baseline` and `after`:
  Node/Bun source/bundle startup, private data selection and bot-secret creation,
  loopback control, missing/wrong secret close code 1008, authenticated empty
  status and interactive `status` passed. Startup-only child processes were
  terminated after checks; no graceful Windows OS-signal claim is made.
- `node .cache/engine-game-split/run-bot-match-step19.mjs baseline` and `after`:
  private FFA with a human protocol client and three real invited bots passed;
  ticketed handoff into the spawned server, nonempty player ids and active
  brains verified. Bots stopped, sockets closed and owned server shutdown
  completed. Nav caches and demos use private scratch paths.
- `node .cache/engine-game-split/prove-step19.mjs`: 128 changed TypeScript files
  match the prepared relocation's imported bindings and ordered code bodies,
  ignoring comments, formatting and import declaration/binding ordering.
- Four non-bot server artifacts are **byte-identical** before/after: dedicated
  server, lobby, benchmark client and runtime probe. The bot artifact changes
  with source paths/import ordering and is covered by source proof and runtime
  checks; it is not claimed byte-identical.
- `node .cache/engine-game-split/fingerprint-step19.mjs`: Node/Bun source/bundle
  bot rating references are identical within the after-move source snapshot.
- `node .cache/engine-game-split/check-ranking-selection-step19.mjs`: Vitest's
  actual listing matches all **54** originally selected ranking-acceptance test
  files, mapped through the move manifest. Test assertions also ran in the
  targeted and full suites. The initial listing helper treated the optional
  `--json` value as an output filename; supplying an explicit private JSON
  output path corrected the helper without application/test changes.
- `node docs/research/engine-game-split-audit.mjs`: zero production engine,
  lobby or outer bot imports into Washoi. Remaining production `src` imports
  are in **24 CLI files / 71 sites**; historical executable research probes,
  one experiment and a visual script also retain explicit game imports.

Harness findings: the first real-bot match probe counted lobby entries and
their game-client entries together, then timed out on its incorrect total.
It now counts the three lobby-source entries, preserving the expected number
of bots and timeout; no application change was needed. PowerShell also treated
expected diagnostic stderr as a shell error on an otherwise passing probe;
the runner now captures stdout/stderr directly and records the actual child
exit code (zero before and after). The initial failed-harness log is retained.

`node .cache/engine-game-split/validate-step19.mjs gates` passed all checks:

| Exact command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run test:run` | 718 files passed; 5,639 tests passed, one skipped |
| `npm.cmd run gate:biome` | Passed; zero errors / 47 baseline warnings |
| `npm.cmd run build` | Passed, including PK3 index and sourcemap relocation |
| `npm.cmd run docs:build` | Passed |
| `npm.cmd run docs:fps:build` | Passed |
| `npm.cmd run test:simulation` | Passed |
| `npm.cmd run test:physics` | Passed |
| `npm.cmd run server:tick` | Passed; same baseline checksum |
| `npm.cmd run server:fuzz -- --ticks 1000 --seed 42` | Passed; same baseline checksum |
| `npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Passed; 7,475 faces |
| `npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'` | Passed; 91 ticks |

The baseline targeted command selects `src/bot`, the three engine bot test files
and `src/lobby/integration/PrivateBotInvite.test.ts`, plus
`src/lobby/__tests__/{ResultDelivery,ServerRuntime,SpawnerPorts,SpawnAbandon,GameServerSpawnerAdmission}.test.ts`.
The after command selects their game-owned destinations from the manifest and
the same five generic server files. Both run via `npm.cmd run test:run --` with
individual path arguments; the private runner receipts record the complete
argument arrays. `npm.cmd run test:runtime-equivalence` also passed before/after.
Native `@tensorflow/tfjs-node` loaded in both targeted runs.

Washoi commit: `4faf62d` (`refactor: own bot application and launcher`).

Browser/GPU play, production deployment/TLS, packaged deployment without source,
independent-checkout proof and native TensorFlow installation from scratch are
not claimed. Remaining game CLI/editor composition, dependency/build/test/CI
and asset/platform recipes, assembly documentation/proof and Git detachment
remain later steps. The submodule attachment remains. Concurrent projectile/
explosion papercuts and another agent's changelog edits are excluded from this
checkpoint; whole-tree gates also see the concurrent work present when run.

## Step 20 — game-owned bot development tools (2026-10-24)

Moved these entry points intact, rebasing imports and direct invocation/help
paths. No SHAG forwarding files remain:

| SHAG source | Washoi destination in the assembled checkout |
| --- | --- |
| `src/cli/bot-analyze.ts` | `src/games/fps/cli/bot-analyze.ts` |
| `src/cli/bot-learn.ts` | `src/games/fps/cli/bot-learn.ts` |
| `src/cli/bot-train.ts` | `src/games/fps/cli/bot-train.ts` |
| `src/cli/bot-bench.ts` | `src/games/fps/cli/bot-bench.ts` |

Other files changed: root `package.json` (same four npm command names, new
source paths); `docs/manual/guides/lobby-server.md`; Washoi manual
`tools/bot-training.md` and `getting-started/project-structure.md`; the living
changelog, dependency inventory, server plan and this progress log.

Assumptions: execution from the assembled root, Node 24.21.0 and Bun 1.4.3,
installed indexed `washoi_dm2`, and the existing native TensorFlow installation.
Argument parsing, defaults, error codes, corpus selection, model/training
formats, route algorithms, cache/output locations and relative cwd behavior
are unchanged. No server implementation or build recipe was edited. The four
files' imported bindings and ordered code bodies match the prepared relocation
after allowing import ordering, comments and formatter layout.

Before/after receipts: `.cache/engine-game-split/step20-validation/`.

- `node .cache/engine-game-split/validate-step20.mjs baseline` and `after`:
  `npm.cmd run test:run -- src/games/fps/bot` passed **54 files / 408 tests**
  on both sides. Fixed tick, 1,000-tick seed-42 fuzz and 10,000-tick seed-42
  Node/Bun runtime equivalence retain checksums `2768943778`, `2481546443`
  and `507638786`. Private server builds and real Node/Bun four-player
  ticketed match/result/child-shutdown probes passed before/after.
- `node .cache/engine-game-split/tool-smoke-step20.mjs baseline` and `after`
  run the actual npm recipes. `bot:analyze -- --help`, `bot:train -- --help`
  and `bot:bench -- --help` passed; `bot:learn` without inputs keeps its
  expected usage exit 1. Real analysis used `--map washoi_dm2 --out <private
  report> --rebuild`, followed by a cache-hit run. Reports contain the same
  graph, opportunities, rejections, fingerprint and deterministic metrics,
  excluding generated timestamp and measured vision/analysis milliseconds.
- A private two-recording fixture was created through the real `DemoRecorder`
  with verified human and bot roster entries, 40/12 frames and the installed
  map name. `bot:learn -- <private first.shagdemo> --dry-run` has identical
  output before/after and saves no routes. `bot:train -- --demo <private corpus>
  --epochs 1 --batch 8 --models <private models>` fits and saves models with
  **40 training / 12 held-out frames**, two matches and no blind maps. Model
  topology/weight manifests and provenance match. Training timestamps, random
  weights and learned skill scores are not treated as deterministic outputs;
  this small synthetic corpus validates command plumbing, not model quality.
- `bot:bench -- --bots 2 --decisions 100` completed with native TensorFlow on
  both sides. No performance improvement claim is made from those timings.
- `node .cache/engine-game-split/compare-tools-step20.mjs` passed the report,
  cache, help/usage, route dry-run, training-provenance and model-topology
  comparisons. `node .cache/engine-game-split/prove-step20.mjs` passed all four
  source structural comparisons. All **five production server artifacts are
  byte-identical** before/after.
- `node docs/research/engine-game-split-audit.mjs`: no production engine/lobby/
  outer-bot path into Washoi. Remaining production `src` imports are now
  **20 CLI files / 49 sites**. Historical executable research, an experiment,
  one visual script and game-dependent tests/configuration still require work.

`node .cache/engine-game-split/validate-step20.mjs gates` passed all checks:

| Exact command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run test:run` | 718 files passed; 5,639 tests passed, one skipped |
| `npm.cmd run gate:biome` | Passed; zero errors / 47 baseline warnings |
| `npm.cmd run build` | Passed, including PK3 index and sourcemap relocation |
| `npm.cmd run docs:build` | Passed |
| `npm.cmd run docs:fps:build` | Passed |
| `npm.cmd run test:simulation` | Passed |
| `npm.cmd run test:physics` | Passed |
| `npm.cmd run server:tick` | Passed; same baseline checksum |
| `npm.cmd run server:fuzz -- --ticks 1000 --seed 42` | Passed; same baseline checksum |
| `npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Passed; 7,475 faces |
| `npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'` | Passed; 91 ticks |

Washoi commit: `8dab9ee` (`refactor: own bot development CLI tools`).

All generated reports, nav caches, recordings and model weights remain in
private `.cache/engine-game-split/step20-validation/` directories. Real player
storage, production models and learned routes were not modified. Browser play,
live self-play training against a production server, production deployment,
native installation from scratch and independent checkout proof are unverified.
The game CLI/editor composition and repository configuration/cutover remain
later steps. Other agents' renderer, benchmark and changelog edits are excluded;
whole-tree gates also see concurrent work present when run.
