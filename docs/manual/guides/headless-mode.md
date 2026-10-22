# Headless mode

SHAG provides CLI entry points for map inspection, deterministic simulation, server testing, networking, and demo verification. Use these before browser-only testing.

## Game console runner

Beyond the engine commands, this runner registers `sim`, `anim`, `headless`,
`leaktest` and `trace_test`, which exist nowhere else.

Start an interactive REPL:

```bash
npm run cli:game
```

Run a batch:

```bash
npm run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'
```

`--command` is accepted as an alias for `--exec`. The runner does not have a `--map` option.

The headless composition registers engine commands but not the browser gameplay map launcher. Use `bsp load`, not `map`, for map inspection in this runner.

## Deterministic movement

```bash
npm run cli:game -- --exec 'sim replay "W+CROUCH 60; JUMP 1; W 30"; quit'
npm run test:simulation
npm run test:physics
```

A batch is split on semicolons and newlines, except inside double quotes — so a
multi-sequence `sim replay` has to be quoted, as above, or its sequences are
read as separate console commands.

## Dedicated server

```bash
npm run net:server -- --map washoi_dm2 --port 7777
npm run net:client -- --connect ws://localhost:7777
npm run server:tick
npm run server:fuzz -- --ticks 1000
```

`net:server` builds and runs the production artifact with Node 24 or newer;
`net:server:node` selects Node explicitly. `net:server:bun` is an experimental
alternative requiring the Bun version recorded in `.bun-version`. Bun is
optional for normal server startup. Game servers launched by a lobby inherit
that lobby's runtime. `net:server:dev` retains the Vite runner. npm owns
dependencies and the lockfile. `npm run build:server` builds only the server
artifacts — match server, lobby and bot server — into `dist-server/`, swapping
the new build in only once it is complete.

### Server memory profiling

Build first, then run an equivalent-artifact comparison:

```bash
npm run build:server
npm run benchmark:server-memory -- --runtimes node,bun --maps washoi_dm2,washoi_dm5,washoi_dm11 --warmup 10 --seconds 15 --repeats 3 --out .cache/server-memory/report.json
npm run benchmark:server-memory -- --runtimes node,bun --maps washoi_dm11 --clients 8 --recording --warmup 15 --seconds 1800 --repeats 1 --out .cache/server-soak/report.json
npm run test:runtime-equivalence
npm run test:server-runtime
```

The memory runner launches real dedicated processes on temporary free ports.
`--clients 0` is idle; positive counts (up to 16) drive real WebSocket clients,
inputs, snapshot decoding and acknowledgements from the benchmark's parent
process. Driver memory is separate from the measured server. `--recording`
requires at least two clients and cycles through 60-second matches, with demos
written beside the report. Without it, clients stay in warmup and no demo is
recorded. Runtime/lobby smoke tests use temporary account/result databases.

`--runtimes node-vite,node,bun` also measures the development runner.
`--entry <file>` selects a built artifact, including a saved baseline;
`--bun <executable>` selects an installed Bun binary. Windows npm Bun shims
are resolved to their native executable for process accounting and shutdown.
The report includes runtime versions, artifact/map hashes, phase snapshots,
sampled RSS and JS memory counters, and Windows private bytes after warm-up.
Private bytes, RSS and JS heap are different measures: ArrayBuffer bytes are
included in external memory, and neither should be added to RSS.

The diagnostic preload (`scripts/server-memory-preload.mjs`) is opt-in through
`SHAG_SERVER_PROFILE`. It records bootstrap, imports, BSP extraction/parse,
collision initialization and listening, plus periodic samples. The runner
configures it automatically. `--diagnostic-gc` forces a collection in disposable
replicas; `SHAG_SERVER_PROFILE_HEAP` additionally writes a heap snapshot during
that diagnostic. Keep these runs separate from normal benchmark trials.
`SHAG_DEMO_DIR` overrides server recording output without changing demo formats.

RSS peaks are sampled, not OS high-water measurements. Single-process trials
do not establish ten-match capacity, Linux PSS, or packet-latency performance.
The periodic tick-rate logs measure actual rate and maximum work per diagnostic
window; the sampler's delay is not a per-tick deadline measurement.

The server's options are listed in the [network server reference](../tools/network-server.md). The
client takes `--connect <url>` and `--name`.

The dedicated server is a different entry point from `cli:game`; it owns the authoritative simulation and network transport.

## Ranking tools

```bash
npm run ranking:simulate
npm run ranking:acceptance
```

`ranking:simulate` runs reproducible synthetic Duel, ten-player FFA and shuffled
5v5 matches (seed 927, 500 matches per scenario) without opening a database or
starting a server. It prints the versioned TrueSkill policy, rating and
uncertainty checkpoints, and the match where each simulated player leaves
provisional status. These are numerical checks of the policy, not real player
or bot ratings. `ranking:acceptance` runs real lobby and game-server result
handoffs in isolation.

The lobby's stored results and ratings can be inspected without starting it:

```bash
npm run lobby:server -- --results-info --data-dir ./server-data
npm run lobby:server -- --ratings-info --data-dir ./server-data
npm run lobby:server -- --ratings-verify --data-dir ./server-data
npm run lobby:server -- --results-recover --data-dir ./server-data
```

The first three open storage read-only; `--ratings-verify` replays every applied
rating update and exits non-zero if the replay diverges. `--results-recover`
commits signed results still waiting in the result outbox. Standalone game and
demo tools do not produce account-backed results. See
[Lobby server](./lobby-server.md#diagnosing-empty-boards) for what each reports,
and how bots are rated as their preset accounts in the Private pools.

## Demos and anti-cheat tools

```bash
npm run demo:record -- --map washoi_dm2 --bots 2 --seconds 30
npm run demo:verify -- path/to/bundle.shagverify
npm run anticheat:calibrate -- --trials 40 --ticks 1500
```

`demo:record` starts a server, connects AI bots and records one match. It takes
`--map`, `--bots`, `--seconds`, `--gametype`, `--difficulty`, `--port` and
`--models <dir>`; with `--models` the bots play with those trained weights, which
is how a trained model gets watched in a real match. Its recordings carry no
verified players, so training reads them only with `--include-bots`.

`demo:verify` replays a re-simulation bundle (`.shagverify`, distinct from a
`.shagdemo` playback file) through the deterministic simulation and checks that
its recorded per-tick checksums reconcile: exit 0 when they do, 1 when they
diverge. Treat `anticheat:calibrate` numbers as directional until they are
calibrated against real player demos.

Lobby-spawned private matches pass `--private-match` to `net:server`, and the
game server writes that privacy into the demo header (format v4 and later). New
recordings are v6, retaining each player's view and adding optional persistent
S&D brush-model state. Standalone recordings are public. The reader accepts v1–v6; an older browser build cannot
play a newer recording until it is updated.

## Exit status

Commands that return an explicit `CommandFailure`, unknown commands, and thrown command errors cause batch execution to fail. Automation should check the process exit code rather than scrape human-readable output.

## Constraints

The game runner uses Babylon `NullEngine`. It does not create a WebGL context, and it skips browser-only Havok initialization. Validate rendering in the browser after headless loading and simulation pass.

## Source of truth

- `src/cli/headless-game.ts`
- `src/cli/headless-netclient.ts`
- `src/cli/server-tick.ts`
- scripts in `package.json`
