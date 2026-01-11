# Network Server

Dedicated game server for multiplayer testing and deployment.

## Quick Start

```bash
npm run net:server
```

Output:
```
[Server] Starting SHAG Test Server...
[Server] Port: 7777
[Server] Map: wdm7
[Server] Max clients: 16
[Server] Listening on ws://localhost:7777
[Server] Waiting for connections...
```

## Command Line Options

```bash
npm run net:server -- [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port <n>` | 7777 | Server port |
| `--name <s>` | "SHAG Test Server" | Server name shown to clients |
| `--map <s>` | wdm7 | Map name |
| `--max <n>` | 16 | Maximum concurrent clients |
| `--help` | - | Show help |

## Examples

```bash
# Default settings
npm run net:server

# Custom port and name
npm run net:server -- --port 8080 --name "My Server"

# Specific map with 4 players max
npm run net:server -- --map dm17 --max 4

# Full configuration
npm run net:server -- --port 7777 --name "Tournament Server" --map wdm7 --max 16
```

## Server Output

The server logs connection events:

```
[Server] Client client_1 connected from ::1
[Room room_123] Started at 20 Hz
[Room room_123] Client client_1 joined (1/16)
[Server] Stats: 1 clients, 1 rooms
```

## Architecture

```
GameServer
├── Room (game instance)
│   ├── Simulation (game logic)
│   ├── Clients (connected players)
│   └── Tick loop (20 Hz)
└── WebSocket handler (ws library)
```

## Tick Rate

The server runs at 20 ticks per second (50ms per tick):

- Game state updated 20 times per second
- Snapshots broadcast to all clients each tick
- Input processed as it arrives

## Stopping the Server

Press `Ctrl+C` for graceful shutdown:

```
^C
[Server] Shutting down...
[Server] Stats: 0 clients, 0 rooms
```

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
4. Type: `connect localhost:7777`

## See Also

- [Network Client](./network-client.md) - Headless client tool
- [Networking Guide](../guides/networking.md) - Full networking documentation
