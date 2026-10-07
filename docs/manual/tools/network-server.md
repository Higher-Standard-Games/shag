# Network Server

Dedicated game server for multiplayer testing and deployment.

## Quick Start

```bash
npm run net:server
```

The entry point is `src/cli/headless-netserver-v2.ts`. It boots a `GameServer`
with a BSP collision world, a gametype, and a WebSocket (or WebTransport)
listener.

## Command Line Options

```bash
npm run net:server -- [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port <n>` | `7777` | Server port |
| `--map <name>` | `wdm7` | Map to load (also accepts `--map=<name>`) |
| `--gametype <name>` | `Deathmatch` | `Deathmatch`, `TeamDeathmatch`, `Duel`, `Amphi` or `SnD`. An unknown name falls through to Deathmatch rather than failing |
| `--name <s>` | `"SHAG Server v2"` | Server name shown to clients |
| `--max <n>` | `16` | Maximum concurrent clients |
| `--snapshotrate <n>` | `60` | Snapshot broadcast rate in Hz |
| `--game <path>` | `./game` | Game data path |
| `--cert <path>` | `./certs/localhost.pem` | TLS certificate (WebTransport) |
| `--key <path>` | `./certs/localhost-key.pem` | TLS private key (WebTransport) |
| `--shutdown` | off | Auto-exit when all clients disconnect |
| `--single-match` | off | One match per server: post-game is terminal, players return to the lobby, bots are released, process exits |
| `--help`, `-h` | – | Show help |

`SHAG_GAME_CERT_PATH` and `SHAG_GAME_KEY_PATH` override the default TLS paths
for servers spawned by the lobby.

## Examples

```bash
# Default settings
npm run net:server

# Custom port and name
npm run net:server -- --port 8080 --name "My Server"

# Search & Destroy on a bomb map, 10 players
npm run net:server -- --map wbomb1 --gametype SnD --max 10

# One-shot match server, exits when the match ends
npm run net:server -- --map wdm2 --gametype Duel --single-match
```

## WebTransport Setup

WebTransport needs TLS certificates. For development:

```bash
mkcert -install && mkcert localhost
# move localhost.pem and localhost-key.pem into ./certs/
```

Without certificates the server still serves WebSocket clients, which is the
default transport.

## Server Output

The server logs connection events:

```
[Server] Client client_1 connected from ::1
[Server] Client client_1 joined (1/16)
[Server] Stats: 1 clients
```

## Architecture

```
GameServer
├── Simulation           # Authoritative world state, 125 Hz fixed tick
├── GametypeController   # Match state, scoring, respawn, spawn selection
├── ClientManager        # Connected players, input queues
├── SnapshotBuilder      # Per-client snapshot assembly (PVS-scoped)
├── SnapshotBroadcaster  # Delta-compressed fan-out at 60 Hz
├── LagCompensation      # Server-side rewind for hit detection
└── Transport            # WebSocket (default) or WebTransport
```

## Tick Rate

The server simulates at **125 Hz** (8 ms per tick) and broadcasts snapshots at
**60 Hz** — roughly every other tick. The tick rate is fixed: movement and
weapon timings are tuned against 125 Hz, and the game server refuses any other
rate. The snapshot rate is configurable with `--snapshotrate`.

- Physics runs one fixed `dt` per tick — no variable-step integration
- Input is applied on the tick it belongs to, not on arrival
- Snapshots are delta-compressed per client against their last acknowledged state

## Stopping the Server

Press `Ctrl+C` for graceful shutdown:

```
^C
[Server] Shutting down...
```

Or start it with `--shutdown` to exit automatically once the last client
leaves, and `--single-match` to exit after one completed match.

## Testing

### Single Client Test

Terminal 1:
```bash
npm run net:server
```

Terminal 2:
```bash
npm run net:client
```

### Multiple Clients

```bash
# Terminal 1: Server
npm run net:server

# Terminal 2-4: Clients
npm run net:client -- --name Alice
npm run net:client -- --name Bob
npm run net:client -- --name Charlie
```

### In-Game Connection

1. Start server: `npm run net:server`
2. Start game: `npm run dev`
3. Open console: `~`
4. Type: `connect ws://localhost:7777`

## See Also

- [Network Client](./network-client.md) - Headless client tool
- [Networking Guide](../guides/networking.md) - Full networking documentation
