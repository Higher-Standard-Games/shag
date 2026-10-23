# Engine/game separation implementation log

The [source audit and plan](./ENGINE_GAME_SPLIT.md) and its inventory describe
the pre-refactor snapshot. This log tracks implementation separately so that
the original dependency counts remain useful as a baseline.

Each dependency removal gets its own commit, including its documentation.
Keep the installed Washoi game, tracked gitlink and production deployment
unchanged until the final assembly and game-free validation gates pass.

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
