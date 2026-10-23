# Game CLI ownership checkpoint

Date: 2026-10-24. Application commands execute from the assembled SHAG root.
This moves composition into Washoi; generic engine/editor/server code stays in
SHAG. Package/configuration and independent-checkout work remain separate.

## Exact source moves

Each basename below moves from `src/cli/` to `src/games/fps/cli/`, with no
forwarding file left in SHAG. Imported bindings and ordered AST bodies match
the prepared relocation, allowing import order, comments and formatting.

| Basename | Responsibility |
| --- | --- |
| `ServerRuntimeProbe.ts` | Real lobby/child match/result probe |
| `anticheat-calibrate.ts` | Game combat calibration |
| `audit-sounds.ts` | Game preload/source/map sound audit |
| `benchmark-collision.ts` | Recorded-position collision benchmark with game map aliases |
| `demo-verify.ts` | Game re-sim verification bundle CLI |
| `headless-game.ts` | NullEngine console and game command composition |
| `measure-viewlag.ts` | Game server/socket latency probe |
| `record-demo.ts` | Game server and bot recording composition |
| `server-fuzz.ts` | Game deterministic fuzz harness |
| `server-tick.ts` | Game fixed tick harness |
| `shagged-compile.ts` | Compiler CLI with game providers |
| `shagged-mcp.ts` | Editor MCP with game providers |
| `shagged-server.ts` | Editor HTTP application with game providers |
| `shagged.ts` | Editor scripting application with game providers |
| `test-fps-simulation.ts` | Existing simulation startup check |
| `test-server-physics.ts` | Existing map/physics check |
| `timedemo-fixture.ts` | Game benchmark fixture composition |

Other exact files changed:

- `package.json`: supported npm commands keep their names, flags and cwd;
  update source entry paths and remove two obsolete aliases.
- `src/games/fps/scripts/build-servers.mjs`: move the runtime probe entry;
  all five artifact names remain.
- `scripts/shagged-mcp.mjs`: moved MCP entry, same stdio filtering.
- `scripts/benchmarks/create-fixture.mjs` and
  `scripts/benchmarks/runtime-equivalence.mjs`: moved fixture/fuzz entries.
- `experiments/shagged/mcp-smoke.mjs`: moved editor CLI caller.
- `docs/manual/guides/bsp-system.md` and `headless-mode.md`: invocation paths
  and ownership; game manual `getting-started/project-structure.md`: CLI scope.
- `AGENTS.md`: replace the removed `debug:spawn` recipe with retained physics checks.
- `docs/changelog/v1.0.0-alpha.3.md`,
  `docs/research/ENGINE_GAME_SPLIT_PROGRESS.md`,
  `docs/research/ENGINE_GAME_SPLIT_INVENTORY.md`, and this checkpoint.

## Obsolete diagnostic removals

Removed `src/cli/compare-local-vs-server.ts` and `debug:compare`. It ran only
one server movement profile, compared no client result, asserted nothing and
searched legacy asset directories. Real reset/replay parity assertions remain
in Washoi `server/__tests__/ReconcileParity.test.ts`.

Removed `src/cli/test-spawn.ts` and `debug:spawn`. It hardcoded
`public/games/default/map_wdm14.pk3` and printed positions without asserting
physics success. Keep `test:physics`, `server:tick`, `server:fuzz` and the
assertion-based `src/engine/__tests__/SharedCollisionGrounding.test.ts`.
The old map-specific printed trace is not preserved.

Removed `src/cli/debug-pickup-gravity.ts`. No executable caller/npm alias was
found. It used a dummy model and printed failures without failing the command.
Placement assertions remain in engine `world/__tests__/PickupPlacement.test.ts`
and Washoi `world/__tests__/EntityManagerPickupLanding.test.ts`; those cover
placement behavior, not every timing detail of the old diagnostic.

The mandated `test:simulation` check remains. Its catch-and-log failure handling
deserves separate improvement; relocation does not silently change that behavior.

## Verification receipts and limits

Private receipts live under `.cache/engine-game-split/step21-validation/`.
Preparation stayed under ignored `.cache/` until the user confirmed benchmarking
had finished. All originals were rechecked before applying.

`node .cache/engine-game-split/validate-step21.mjs gates` runs the full gate set:

| Exact command | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run test:run` | 719 files; 5,644 passed, one skipped |
| `npm.cmd run gate:biome` | Passed; zero errors, 47 baseline warnings |
| `npm.cmd run build` | Passed, including PK3 index and sourcemap relocation |
| `npm.cmd run docs:build` | Passed |
| `npm.cmd run docs:fps:build` | Passed |
| `npm.cmd run test:simulation` | Passed |
| `npm.cmd run test:physics` | Passed |
| `npm.cmd run server:tick` | Passed; same checksum |
| `npm.cmd run server:fuzz -- --ticks 1000 --seed 42` | Passed; same checksum |
| `npm.cmd run cli:game -- --exec "bsp load washoi_dm2; bsp info; quit"` | Passed; 7,475 faces |
| `npm.cmd run cli:game -- --exec 'sim replay \"W+CROUCH 60; JUMP 1; W 30\"; quit'` | Passed; 91 ticks |

`node .cache/engine-game-split/prove-step21.mjs` verifies imported bindings and
ordered AST bodies against the prepared relocation. The preparation checker
verified 125 static relative imports. No game algorithms, protocols, recording
formats or database schemas changed.

`node .cache/engine-game-split/validate-step21.mjs baseline` and `after` run:

- `npm.cmd run test:run -- src/games/fps/server/__tests__/ReconcileParity.test.ts src/engine/__tests__/SharedCollisionGrounding.test.ts src/engine/world/__tests__/PickupPlacement.test.ts src/games/fps/world/__tests__/EntityManagerPickupLanding.test.ts`: 4 files / 24 tests passed on both sides.
- `npm.cmd run server:tick`: checksum `2768943778` on both sides.
- `npm.cmd run server:fuzz -- --ticks 1000 --seed 42`: checksum `2481546443` on both sides.
- `npm.cmd run test:runtime-equivalence`: Node/Bun 10,000 ticks / seed 42,
  checksum `507638786` before and after.
- `node src/games/fps/scripts/build-servers.mjs <private phase/dist-server>`:
  both builds passed. Match, lobby, bot and benchmark-client bundles are
  byte-identical. Runtime-probe source comments and bundled declaration ordering
  change with the relocated/formatted entry; no byte-identity claim for that probe.
- `node <private phase/dist-server/ServerRuntimeProbe.mjs>` and
  `bun <private phase/dist-server/ServerRuntimeProbe.mjs>`: real private four-player
  ticketed match, SQLite result and child shutdown passed before and after.

`node .cache/engine-game-split/smoke-step21.mjs` exercises actual npm recipes:
`shagged`, `shagged:server`, `shagged:compile`, `demo:record` and
`benchmark:fixture` with `--help`; `benchmark:fixture -- --dry-run --recipe
benchmarks/recipes/wdm2-ffa10.json`; `shagged` new/info/health/export on a private
room; `anticheat:calibrate -- --trials 2 --ticks 100`; `demo:verify` without a
bundle (expected usage exit 1); `net:viewlag`; and `demo:record -- --map
washoi_dm2 --bots 2 --seconds 12 --gametype duel --port 17937` with an actual
saved private recording. The MCP launcher connected and exposed 16 tools,
including `shagged_report`.

`node node_modules/vite-node/vite-node.mjs .cache/engine-game-split/bundle-step21.ts`
created real 125-tick re-sim bundles. Running the moved `demo-verify.ts` accepted
the valid bundle (exit 0) and rejected a checksum corrupted at tick 50 (exit 1).
`node .cache/engine-game-split/extra-smoke-step21.mjs` passed the collision
benchmark on the private recording (stride 64) and the sound audit in a private
working directory; reports did not overwrite tracked media research.

With `SHAGGED_MAPS_ROOT` and `SHAGGED_PUBLISH_ROOT` set to the private smoke
directories, `node node_modules/vite-node/vite-node.mjs
src/games/fps/cli/shagged-compile.ts --check-config` found the native toolchain.
`node node_modules/vite-node/vite-node.mjs src/games/fps/cli/shagged.ts compile
.cache/engine-game-split/step21-validation/smoke/room.json --quality fast`
compiled a playable, nonleaking room with zero warnings/errors/missing assets.
`node node_modules/vite-node/vite-node.mjs src/games/fps/cli/shagged-compile.ts
qa_cli_split --quality fast` returned the same playable package through reuse.
Published packages and map documents stayed in the private directories.

No performance claim follows from smoke timings or calibration scores.
SHAGGED HTTP serving and full timedemo fixture generation were not exercised
end to end in this checkpoint. Browser play, production deployment,
fresh dependency installation and independent checkout are unverified.
Other clients' renderer/fog/preloading/changelog work is excluded from this
change, although whole-tree gates see concurrent code present when they run.
