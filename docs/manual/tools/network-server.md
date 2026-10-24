# Network server

The dedicated game server, for multiplayer testing and deployment.

## Quick start

These examples run from the assembled SHAG root, with the game checked out at
`src/games/fps` and dependencies installed at the root. Inside the game folder,
use `npm run net:server` instead. Both forms run with the SHAG root as cwd, so
media, certificates and output paths resolve there. The command builds the
server bundle before starting Node.

```bash
npm --prefix src/games/fps run net:server
```

Washoi owns the entry point at `src/games/fps/cli/headless-netserver-v2.ts`
in the assembled checkout. It boots a `GameServer` with a BSP collision world,
a gametype and a WebSocket listener. Its game-owned `HeadlessMapLoader.ts`
combines SHAG's indexed BSP/collision tools with Washoi's pickups.

Run commands from the assembled project root. `net:server:dev` follows the
source entry; the server build publishes the same
`dist-server/headless-netserver-v2.mjs` artifact used by production commands
and the lobby spawner.

## Command-line options

```bash
npm --prefix src/games/fps run net:server -- [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port <n>` | `7777` | Server port |
| `--map <name>` | `washoi_dm2` | Map to load (also `--map=<name>`) |
| `--gametype <name>`, `-g` | `Deathmatch` | `Deathmatch`, `TeamDeathmatch`, `Duel`, `Amphi` or `SnD`. An unknown name falls back to Deathmatch |
| `--name <s>`, `--hostname` | `SHAG Server v2` | Server name shown to clients |
| `--max <n>`, `--maxclients` | `16` | Maximum players; up to eight spectators connect beyond it |
| `--snapshotrate <n>` | `60` | Snapshot broadcast rate in Hz |
| `--game <path>` | `./game` | Game data path |
| `--cert <path>` | `./certs/localhost.pem` | TLS certificate for `wss://` |
| `--key <path>` | `./certs/localhost-key.pem` | TLS private key for `wss://` |
| `--shutdown` | off | Exit when the last client disconnects |
| `--single-match` | off | One match per server: post-game is final, players return to the lobby, bots are released and the process exits |
| `--private-match` | off | Mark recorded demos as private; the lobby sets this for private rooms |
| `--training-demo <name>` | – | Record a training demo: warmup never ends and every tick is recorded, saved to `public/data/demos/training/<map>_<name>.shagdemo` |
| `--help`, `-h` | – | Show help |

The first two bare arguments are read as the map and the gametype, so `npm --prefix src/games/fps run net:server -- washoi_dm2 Duel` also works.

`SHAG_GAME_CERT_PATH` and `SHAG_GAME_KEY_PATH` replace the default certificate paths, which is how servers spawned by the lobby find them.

## Examples

```bash
# Default settings
npm --prefix src/games/fps run net:server

# Custom port and name
npm --prefix src/games/fps run net:server -- --port 8080 --name "My Server"

# Search & Destroy on a bomb map, 10 players
npm --prefix src/games/fps run net:server -- --map wbomb1 --gametype SnD --max 10

# One-shot match server, exits when the match ends
npm --prefix src/games/fps run net:server -- --map washoi_dm2 --gametype Duel --single-match
```

## TLS

When both certificate files exist, the server accepts secure WebSocket (`wss://`) connections, which a page served over HTTPS requires. When either file is missing, the server prints a warning and serves plain `ws://`, which is enough for local development.

To create development certificates:

```bash
mkcert -install && mkcert localhost
# move localhost.pem and localhost-key.pem into ./certs/
```

## Server output

The server logs each connection and join, for example:

```text
[GameServer] WebSocket connected: client_1
[GameServer] Join request from: Alice
```

## Architecture

```text
GameServer
├── Simulation           # Authoritative world state, 125 Hz fixed tick
├── GametypeController   # Match state, scoring, respawn, spawn selection
├── ClientManager        # Connected players, input queues
├── SnapshotBuilder      # Per-client snapshot assembly (PVS-scoped)
├── SnapshotBroadcaster  # Delta-compressed fan-out at the snapshot rate
├── LagCompensation      # Server-side rewind for hit detection
└── Transport            # WebSocket (ws:// or wss://)
```

## Tick rate

The server simulates at **125 Hz** (8 ms per tick) and broadcasts snapshots at **60 Hz** by default, roughly every other tick. The tick rate is fixed: movement and weapon timings are tuned against 125 Hz, and the game server refuses any other rate. The snapshot rate is configurable with `--snapshotrate`.

- Physics runs one fixed `dt` per tick, with no variable-step integration.
- Input is applied on the tick it belongs to, not on arrival.
- Snapshots are delta-compressed per client against the last state that client acknowledged.

## Stopping the server

Press `Ctrl+C` for a graceful shutdown:

```text
^C
[Server] Shutting down...
```

Alternatively, start it with `--shutdown` to exit once the last client leaves, or with `--single-match` to exit after one completed match.

## Testing

### Single client

Terminal 1:

```bash
npm --prefix src/games/fps run net:server
```

Terminal 2:

```bash
npm run net:client
```

### Multiple clients

```bash
# Terminal 1: server
npm --prefix src/games/fps run net:server

# Terminals 2-4: clients
npm run net:client -- --name Alice
npm run net:client -- --name Bob
npm run net:client -- --name Charlie
```

### From the game

1. Start the server: `npm --prefix src/games/fps run net:server`
2. Start the game: `npm run dev`
3. Open the console with backquote/tilde
4. Type `connect ws://localhost:7777`

## See also

- [Network client](./network-client.md): the headless client tool
- [Networking guide](../guides/networking.md): the full networking documentation
