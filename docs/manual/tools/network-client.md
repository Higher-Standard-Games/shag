# Network Client

Headless network client for testing multiplayer connectivity.

## Quick Start

```bash
npm run net:client
```

Output:
```
[Client] Connecting to ws://localhost:7777...
[Client] Connected! Waiting for welcome...
[Client] Received welcome:
         Server: SHAG Test Server
         Map: wdm7
         Tick rate: 20 Hz
         Players: 1/16
[Client] Join accepted:
         Client ID: client_1
         Player ID: player_client_1
         Entity ID: entity_client_1
[Client] Tick 20: 1 entities, 1 players (50ms)
```

## Command Line Options

```bash
npm run net:client -- [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--connect <url>` | ws://localhost:7777 | Server URL |
| `--name <s>` | Random | Player name |
| `--help` | - | Show help |

## Examples

```bash
# Connect to local server
npm run net:client

# Connect to specific server
npm run net:client -- --connect ws://192.168.1.100:7777

# Connect with player name
npm run net:client -- --name Alice

# Full options
npm run net:client -- --connect ws://game.example.com:7777 --name Player1
```

## URL Formats

```bash
# Local server (default port)
--connect localhost:7777

# WebSocket URL
--connect ws://192.168.1.100:7777

# Secure WebSocket
--connect wss://game.example.com:443
```

## Client Output

The client shows connection progress and game ticks:

```
[Client] Connecting to ws://localhost:7777...
[Client] Player name: Alice
[Client] Connected! Waiting for welcome...
[Client] Received welcome:
         Server: SHAG Test Server
         Map: wdm7
         Tick rate: 20 Hz
         Players: 1/16
[Client] Sending join request...
[Client] Join accepted:
         Client ID: client_1
         Player ID: player_client_1
         Entity ID: entity_client_1
[Client] Tick 20: 1 entities, 1 players (50ms)
[Client] Tick 40: 1 entities, 1 players (52ms)
```

## Tick Logging

- Logs every 20th tick (once per second at 20Hz)
- Shows entity count, player count, and tick interval
- Useful for monitoring server performance

## Stopping the Client

Press `Ctrl+C` to disconnect:

```
^C
[Client] Shutting down...
[Client] Disconnected
```

## Testing Scenarios

### Basic Connectivity

```bash
# Terminal 1: Start server
npm run net:server

# Terminal 2: Connect client
npm run net:client
```

### Multiple Players

```bash
# Terminal 1: Server
npm run net:server

# Terminals 2-4: Clients
npm run net:client -- --name Alice
npm run net:client -- --name Bob
npm run net:client -- --name Charlie
```

### Remote Server

```bash
# Connect to remote server
npm run net:client -- --connect ws://192.168.1.100:7777 --name Player1
```

## Protocol Verification

The client validates the binary protocol:

1. Connects via WebSocket
2. Receives `Welcome` message (0x01)
3. Sends `Join` message (0x81)
4. Receives `JoinAccept` message (0x02)
5. Receives `Snapshot` messages (0x04) at 20Hz
6. Sends `Ack` for each snapshot
7. Sends test `Input` messages (0x83)

## Troubleshooting

### Connection Refused

```
[Client] Connection error: connect ECONNREFUSED
```

- Verify server is running: `npm run net:server`
- Check port is correct

### Connection Timeout

```
[Client] Connection error: timeout
```

- Check firewall settings
- Verify server URL is reachable

### Protocol Error

```
[Client] Failed to handle message: Expected Welcome message
```

- Server may be incompatible version
- Check server logs for errors

## See Also

- [Network Server](./network-server.md) - Dedicated server tool
- [Networking Guide](../guides/networking.md) - Full networking documentation
