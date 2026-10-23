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
