# Manual accuracy audit

This is a rolling source audit of the SHAG and Washoi manuals. A successful
VitePress build checks links and rendering, not the truth of a page's claims.
Pages below received targeted corrections; they are not certified in full.

## First pass: setup, application selection and mode entry

Work started on the matching `staging` branches after v1.0.0-beta.9.
No gameplay, renderer or networking code was changed. Existing bugfix work
in `src/games/fps/client/RemotePlayerRenderer.ts` was left to its owner.

| Manual area | Facts checked | Source evidence |
| --- | --- | --- |
| Engine getting started, building, introduction and guide index | Browser defaults, application selection, game command ownership, PK3 metadata generation, developer-gated BSP commands | `scripts/browser-application.ts`, `vite.config.ts`, `src/main.ts`, both `package.json` files, `src/games/fps/scripts/run-in-engine.mjs`, `scripts/generate-pk3-manifest.js`, `scripts/generate-pk3-index.mjs`, `src/engine/console/commands/BspCommand.ts` |
| Engine desktop deployment | Application selection, product metadata and package output | `electron-builder.config.cjs`, root and game `package.json` |
| Game setup and troubleshooting | Pinned runtime, index generation, WebSocket TLS behavior | `.nvmrc`, package scripts, `src/games/fps/cli/headless-netserver-v2.ts`, `src/games/fps/server/GameServer.ts`, `src/engine/server/network/transport/WebSocketTransport.ts` |
| Game mode overview, Amphi map list, Maps, S&D map guidance and introduction | Configured pools, installed-package filtering, revisioned names, map eligibility | `config/maps.json`, `src/lobby/LobbyServer.ts` (`_loadMapsConfig`, `handleDevSpawnServer`), `src/shared/bsp/BombSiteTable.ts`, `src/games/fps/client/FpsMapLauncher.ts` |
| Duel and FFA rule tables; first-match spawn/death advice | Countdown, spawn kit and respawn intervals, Amphi round respawns | `src/games/fps/server/gametypes/{Duel,Deathmatch,Amphi,SearchAndDestroy,PlayerLoadouts}.ts` |
| S&D item guidance | Excluded weapons/Quad, round pickup reset | `src/games/fps/server/gametypes/SearchAndDestroy.ts` (`getItemSpawnRules`) |

## Remaining audit

- Verify player controls, movement values, weapon statistics, damage, pickup
  behavior and HUD descriptions against their implementations.
- Verify lobby/account/rating, timeout, reconnect and demo instructions against
  server admission and result rules, including ticketless dedicated servers.
- Audit engine tutorials and recipes: imports, constructors and command snippets
  need checking against the separation of game and engine ownership.
- Audit the full console/cvar reference, tool CLI flags, bot training, editor,
  deployment and subsystem/API guides.
- Recheck map-data claims that require inspecting packaged BSPs. This pass used
  the configured pools and eligibility code; it did not survey every map's
  geometry, item placement or entities.

Browser behavior, native installers and the minimum runtime below the pinned
Node 24 were not tested in this documentation pass.

## Changed files in the first pass

Engine repository:

- `docs/manual/deployment/desktop.md`
- `docs/manual/getting-started/building.md`
- `docs/manual/getting-started/index.md`
- `docs/manual/guides/index.md`
- `docs/manual/introduction/index.md`
- `docs/changelog/v1.0.0-beta.10.md`
- `docs/research/manual-accuracy-audit.md`
- `src/games/fps` (pin to the game documentation commit)

Game repository (paths relative to `src/games/fps`):

- `docs/manual/gametypes/amphi.md`
- `docs/manual/gametypes/deathmatch.md`
- `docs/manual/gametypes/duel.md`
- `docs/manual/gametypes/index.md`
- `docs/manual/gametypes/maps.md`
- `docs/manual/gametypes/search-and-destroy.md`
- `docs/manual/getting-started/index.md`
- `docs/manual/getting-started/troubleshooting.md`
- `docs/manual/introduction/index.md`
- `docs/manual/player/first-match.md`

## Validation of the first pass

Commands were run from the assembled engine root. Assumptions: installed
`washoi_dm2` data for BSP/physics checks; the standalone headless simulator for
movement; mode rules from authoritative server configuration. No live
single-player practice server or networked match was exercised.

```powershell
npm run docs:build
npm --prefix src/games/fps run docs:build
npm --prefix src/games/fps run cli:game -- --exec "developer 1; bsp load washoi_dm2; bsp info; quit"
npm --prefix src/games/fps run test:simulation
npm --prefix src/games/fps run test:physics
node .cache/manual-audit-replay.mjs
```

Both manual builds passed. The BSP command loaded FBSP v1 with 116 entities
and 7,475 faces and exited successfully. Simulation initialization and physics
checks exited successfully; physics loaded the indexed map and reported
`[OK] Y position maintained`. Simulation initialization warns that its collision
manager is not initialized, so that check does not cover map collision.

The ignored replay wrapper calls the game runner with the exact argument
`--exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'` through Node's
`spawnSync` with `shell: false`. It completed 91 ticks. An earlier direct
PowerShell invocation stripped the inner quotes and ran one tick; that result
was discarded. The runner logs a caught `localStorage is not defined` warning
under Node during both CLI checks. Initial sandboxed builds and the BSP check
failed to spawn esbuild (`EPERM`); reruns outside the sandbox succeeded.

Only documentation and the submodule pin changed. Application code gates and
renderer/network regression suites were not run for this documentation pass.
