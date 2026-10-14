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
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
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
npm run net:server -- --map wdm2 --port 7777
npm run net:client -- --connect ws://localhost:7777
npm run server:tick
npm run server:fuzz -- --ticks 1000
```

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
npm run demo:record -- --map wdm12 --bots 2 --seconds 30
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
recordings are v5, whose frames also carry each player's view. Standalone
recordings are public. The reader accepts v1–v5; an older browser build cannot
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
