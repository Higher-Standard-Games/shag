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

The server takes `--port`, `--map`, `--gametype`, `--name`, `--maxclients`,
`--snapshotrate`, `--game`, and `--cert`/`--key` for TLS. The
client takes `--connect <url>` and `--name`; it has no `--host` or `--port`.

The dedicated server is a different entry point from `cli:game`; it owns the authoritative simulation and network transport.

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

Treat synthetic anti-cheat calibration numbers as directional until calibrated against real player demos.

## Exit status

Commands that return an explicit `CommandFailure`, unknown commands, and thrown command errors cause batch execution to fail. Automation should check the process exit code rather than scrape human-readable output.

## Constraints

The game runner uses Babylon `NullEngine`. It does not create a WebGL context, and it skips browser-only Havok initialization. Validate rendering in the browser after headless loading and simulation pass.

## Source of truth

- `src/cli/headless-game.ts`
- `src/cli/headless-netclient.ts`
- `src/cli/server-tick.ts`
- scripts in `package.json`
