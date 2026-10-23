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
