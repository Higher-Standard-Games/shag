# Networking System

SHAG Engine includes a Q3-style authoritative multiplayer networking system. This guide explains the architecture and how to use it in your games.

## Architecture Overview

The networking system follows an authoritative server model:

```
┌─────────────────┐         ┌─────────────────┐
│     Client      │ ──────> │     Server      │
│  (prediction)   │ <────── │  (authoritative)│
└─────────────────┘         └─────────────────┘
     Input                    Snapshots
```

- **Server** runs the authoritative simulation, processes commands, broadcasts state
- **Client** predicts locally for responsiveness, reconciles with server state
- **Binary Protocol** for efficient bandwidth usage
- **Smooth Correction** instead of snap correction for visual quality

## Console Commands

### Connection Commands

```bash
# Connect to a server
connect localhost:7777
connect ws://192.168.1.100:7777
connect wss://game.example.com:443

# Disconnect from server
disconnect

# Network management (alternative syntax)
network connect <url>
network disconnect
network status
network shutdown
```

### Status Commands

```bash
# Show connection status
network status

# Output example:
# Network Status:
#   Initialized: true
#   Mode: network
#   Connected: true
#   Server: ws://localhost:7777
```

## Running a Server

### Quick Start

```bash
# Start a server on port 7777
npm run net:server

# With options
npm run net:server -- --port 8080 --name "My Server" --map dm17
```

### Server Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port <n>` | 7777 | Server port |
| `--name <s>` | "SHAG Test Server" | Server name |
| `--map <s>` | wdm7 | Map name |
| `--max <n>` | 16 | Max clients |

## Running a Client

### Headless Client (Testing)

```bash
# Connect to a server
npm run net:client -- --connect ws://localhost:7777

# With player name
npm run net:client -- --connect ws://localhost:7777 --name Player1
```

### In-Game Connection

Open the console (`~`) and type:
```
connect localhost:7777
```

## NetworkManager API

Games can use the NetworkManager API directly:

```typescript
import { NetworkManager } from './engine/network';

// Get the singleton instance
const nm = NetworkManager.getInstance();

// Connect to a server
await nm.connect('ws://localhost:7777');

// Check connection status
nm.isConnected();     // true/false
nm.getServerUrl();    // 'ws://localhost:7777' or null
nm.getMode();         // 'local' | 'network' | null

// Subscribe to connection changes
const unsub = nm.onConnectionChange((connected, url) => {
  if (connected) {
    console.log(`Connected to ${url}`);
  } else {
    console.log('Disconnected');
  }
});

// Send commands
nm.sendCommand(moveCmd);

// Subscribe to state updates
nm.onStateUpdate((state) => {
  // Handle game state update
});

// Disconnect
await nm.disconnect();
```

## IGameHost Interface

The `IGameHost` interface abstracts local vs networked games:

```typescript
interface IGameHost {
  // Player info
  readonly localPlayerId: PlayerId;
  readonly currentTick: number;

  // Commands
  sendCommand(cmd: Command): void;

  // State
  getLocalState(): GameState;
  getInterpolatedEntity(entityId: string): any;

  // Events
  onStateUpdate(callback: (state: GameState) => void): () => void;
  onEvent(callback: (event: any) => void): () => void;

  // Connection (network hosts only)
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  isConnected?(): boolean;
}
```

### Implementations

| Class | Description |
|-------|-------------|
| `LocalGameHost` | Single-player, runs simulation in-process |
| `NetworkGameHost` | Multiplayer client, connects to remote server |

## Binary Protocol

Messages use a binary format with MessageType prefix:

### Server → Client

| Type | Code | Description |
|------|------|-------------|
| Welcome | 0x01 | Server info on connect |
| JoinAccept | 0x02 | Player accepted |
| JoinReject | 0x03 | Player rejected |
| Snapshot | 0x04 | Game state update |
| PlayerJoined | 0x05 | Another player joined |
| PlayerLeft | 0x06 | Another player left |
| GameStart | 0x07 | Game started |
| Ack | 0x08 | Command acknowledged |

### Client → Server

| Type | Code | Description |
|------|------|-------------|
| Join | 0x81 | Request to join |
| Ready | 0x82 | Player ready |
| Input | 0x83 | Player command |
| Disconnect | 0x84 | Disconnect notice |

## Connection Handshake

```
Client                          Server
   │                               │
   │──── TCP/WS Connect ──────────>│
   │                               │
   │<──── Welcome ─────────────────│  (server info)
   │                               │
   │──── Join ────────────────────>│  (player name)
   │                               │
   │<──── JoinAccept ──────────────│  (client/player/entity IDs)
   │                               │
   │<──── Snapshot ────────────────│  (initial state)
   │                               │
   │──── Input ───────────────────>│  (continuously)
   │<──── Snapshot ────────────────│  (20 Hz)
   │                               │
```

## Client Prediction

The client predicts movement locally for responsiveness:

1. Player presses key → command applied locally immediately
2. Command sent to server
3. Server processes command, broadcasts snapshot
4. Client receives snapshot, reconciles:
   - If small error → smooth correction over time
   - If large error → snap to server position

### Smooth Correction

Instead of snapping (jarring), the client smoothly interpolates:

```typescript
// Error < 0.5 units: no correction needed
// Error 0.5-100 units: smooth correction over ~10 frames
// Error > 100 units: snap immediately (teleport/respawn)
```

## Entity Interpolation

Remote entities (other players) are interpolated between snapshots:

- Buffer stores last N snapshots
- Render 2 ticks behind for smooth interpolation
- Handles packet loss gracefully

## Server Architecture

```
GameServer
├── Room (game instance)
│   ├── Simulation (game logic)
│   ├── Clients (connected players)
│   └── Tick loop (20 Hz)
└── WebSocket handler
```

### Creating Custom Simulations

```typescript
class MySimulation extends Simulation {
  protected createInitialState(): GameState {
    const state = new GameState();
    // Add initial entities
    return state;
  }

  protected registerSystems(): void {
    // Register game systems (physics, AI, etc.)
  }

  protected registerCommandHandlers(): void {
    // Handle player commands
    this.registerHandler('move', (cmd, state) => {
      // Process movement
    });
  }
}
```

## Testing

### Two-Client Test

Terminal 1 (Server):
```bash
npm run net:server
```

Terminal 2 (Client 1):
```bash
npm run net:client -- --name Alice
```

Terminal 3 (Client 2):
```bash
npm run net:client -- --name Bob
```

### In-Game Test

1. Start server: `npm run net:server`
2. Start game: `npm run dev`
3. Open console: `~`
4. Type: `connect localhost:7777`
5. Check: `network status`

## Troubleshooting

### Connection Failed

- Check server is running: `npm run net:server`
- Check firewall allows port 7777
- Verify URL format: `ws://host:port`

### High Latency

- Server tick rate is 20 Hz (50ms snapshots)
- Check network conditions
- Consider geographic proximity

### Desync Issues

- Client prediction may diverge
- Smooth correction handles small errors
- Large desyncs trigger snap correction

## See Also

- [Headless Mode](./headless-mode.md) - CLI testing tools
- [Console System](./console-system.md) - Command registration
- [Command Reference](./command-reference.md) - All commands
