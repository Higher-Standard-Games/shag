# Headless network client

The network client connects to the dedicated WebSocket server, joins with a player name, decodes binary snapshots, acknowledges each snapshot, and sends test input.

## Start

```bash
npm run net:server -- --map washoi_dm2 --port 7777
npm run net:client
```

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `--connect <url>` | `ws://localhost:7777` | Complete WebSocket URL |
| `--name <name>` | random | Player display name |
| `--help` | | Show CLI help |

Example:

```bash
npm run net:client -- --connect ws://127.0.0.1:7777 --name Alice
```

Pass an explicit `ws://` or `wss://` URL. A bare `localhost:7777` value is not normalized by this CLI.

The tool logs every twentieth received snapshot. That is not necessarily once per second; the interval depends on the server snapshot rate.

Use this client for protocol/connectivity smoke tests, not for evaluating browser prediction, rendering, or input feel.
