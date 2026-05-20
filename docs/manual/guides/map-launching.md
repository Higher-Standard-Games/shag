# Map Launching

SHAG has two distinct map-loading paths and one game-specific extension point that wires them together. This guide explains all three.

## Two Paths

| Path | Console | What It Does | When |
|------|---------|--------------|------|
| **Inert render** | `bsp load <name>` | Renders the BSP mesh into the scene. No simulation, no server, no game systems. | Map inspection, shader debug, screenshots, headless testing. |
| **Server-backed gameplay** | `map <name> [gametype]` | Asks the lobby to spawn a dedicated game server with the requested map + gametype, then connects this client to it. | Quick local play during development. Real players go through the lobby UI. |

The fundamental rule: if you want to *see* the map, `bsp load`. If you want to *play* the map, `map` (or use the lobby UI).

The split avoids the "two gameplay paths" pitfall — there is exactly one place game logic runs (the dedicated server), and the client connects to it the same way whether it was spawned by a dev console or by a real lobby match.

## The Inert Render Path: `bsp load`

```
bsp load wdm7        # render the map
bsp info             # show stats about the rendered BSP
bsp entities         # list all entities (spawn points, lights, triggers, ...)
bsp textures         # list referenced textures
bsp lightgrid        # LightGrid sample at the current camera position
bsp render           # re-render the currently-loaded BSP
bsp clear            # unload
```

The pure render path is implemented by `loadClientMap(name)` in `src/engine/loader/map/ClientMapLoader.ts`. It runs `MapLoader.loadMap`, applies BSP-required scene settings (ambient color, material-dirty mechanism), reloads worldspawn-derived sky lighting, teleports the active camera to the BSP's `info_player_deathmatch` / `info_player_start`, and emits `map:loaded` on the EventBus.

This is the path the network host (`Game.onServerInfo`) uses internally when it receives `serverInfo` from a dedicated server — the server tells the client *which* map to render; the client uses `loadClientMap` to render it without any local gameplay simulation.

## The Server-Backed Path: `map`

`map <name> [gametype]` is a **developer command**. It's the path you use during development for a one-keystroke "play this map right now" flow. It's not the path real players take — they use the lobby UI's "Play" button.

```
map wdm2             # default gametype (duel)
map wdm2 duel
map wdm2 dm          # alias for ffa / deathmatch (game-specific)
map wdm2 tdm         # alias for team deathmatch
map reload           # relaunch last (map, gametype)
map unload           # disconnect and tear down the client mesh
map current          # report both gameplay map and rendered map
map list             # list maps discovered in the PK3 index
```

### What happens under the hood

```
┌──────────────┐  1. console:               ┌──────────────────┐
│ user types   │ ─ map wdm2 duel ─────────▶ │ MapCommand       │
│ "map wdm2"   │                            │ (engine)         │
└──────────────┘                            └────┬─────────────┘
                                                 │ 2. delegate to
                                                 ▼
                                            ┌──────────────────┐
                                            │ GameplayMap      │
                                            │ Launcher         │
                                            │ (game-provided)  │
                                            └────┬─────────────┘
                                                 │ 3. dev-spawn request
                                                 ▼
                                            ┌──────────────────┐
                                            │ Lobby Server     │
                                            │ (Node, npm run   │
                                            │  lobby:server)   │
                                            └────┬─────────────┘
                                                 │ 4. child_process
                                                 ▼
                                            ┌──────────────────┐
                                            │ Dedicated Game   │
                                            │ Server           │
                                            │ (ws://host:port) │
                                            └────┬─────────────┘
                                                 │ 5. ws URL
                                                 ▼
                                            ┌──────────────────┐
                                            │ Client connects  │
                                            │ via              │
                                            │ initializeNetwork│
                                            └──────────────────┘
```

### Prerequisites

- **Lobby server running**: `npm run lobby:server` (in a separate terminal).
- **Loopback restriction**: the lobby's dev-spawn endpoint only accepts requests from `localhost` / `127.0.0.1` / `::1`. Cross-LAN dev-spawn is rejected explicitly. This is intentional: dev-spawn is a developer affordance, not a public API.
- **PK3 data available**: the dedicated server needs the same PK3 files the client does. Put them under `public/data/`.

### Environment variables

Set in `.env` at repo root (see [Configuration Guide](./configuration.md)):

| Variable | Purpose |
|----------|---------|
| `VITE_LOBBY_URL` | URL the browser uses to reach the lobby. Default `ws://localhost:9000`. |
| `SHAG_PUBLIC_GAME_PROTOCOL` | `ws` or `wss`. Used when the lobby returns a spawned game server's URL. |
| `SHAG_PUBLIC_GAME_HOST` | The host clients should use to reach the spawned game server. Default `localhost` — change to a LAN IP if you want other devices to reach it. |

## The `GameplayMapLauncher` Extension Point

The engine `MapCommand` doesn't know how a game starts gameplay — it delegates to a registered launcher. Games register their launcher at boot.

```typescript
// src/engine/console/GameplayMapLauncher.ts (engine-shipped)
export interface GameplayMapLaunchResult {
  serverUrl: string;
  map: string;
  gametype: string;
  matchId?: string;
}

export interface GameplayMapLauncher {
  launch(mapName: string, gametype: string): Promise<GameplayMapLaunchResult>;
  unload(): Promise<void> | void;
}

export function registerGameplayMapLauncher(launcher: GameplayMapLauncher): void;
export function getGameplayMapLauncher(): GameplayMapLauncher | null;
export function clearGameplayMapLauncher(): void;
```

A game submodule provides the implementation. For a multiplayer game the typical implementation is:

1. Connect to the lobby (or re-use an existing connection).
2. Call `lobbyClient.spawnDevServer(map, gametype)` and await the spawned-server reply.
3. Call `Game.initializeNetwork(spawned.serverUrl, { autoJoin: true })` to connect the local client.
4. Return `{ serverUrl, map, gametype, matchId }` so `MapCommand` can report it.

`unload()` typically calls `Game.shutdown()`.

Boot wiring (in your application's `main.ts`):

```typescript
import { registerGameplayMapLauncher } from "@/engine/console/GameplayMapLauncher";

const myGameModule = await import("./games/mygame");
registerGameplayMapLauncher(myGameModule.myGameMapLauncher);
```

Without a registered launcher, `map` returns `"No gameplay map launcher registered. Use bsp commands for map inspection."` — the engine is genuinely game-agnostic.

## The Lobby Dev-Spawn API

For completeness, the wire-level shape. Two message types between client and lobby:

**Client → Lobby:**
```typescript
interface DevSpawnServerMessage {
  type: "dev:spawn_server";
  requestId: string;
  map: string;
  gametype: string;
}
```

**Lobby → Client:** one of
```typescript
interface DevServerSpawnedMessage {
  type: "dev:server_spawned";
  requestId: string;
  matchId: string;
  serverUrl: string;
  map: string;
  gametype: string;
}

interface DevServerSpawnFailedMessage {
  type: "dev:server_spawn_failed";
  requestId: string;
  error: string;
}
```

The lobby's `GameServerSpawner` (Node-only, uses `child_process.spawn`) is the same machinery that handles real matchmaking — dev-spawn is just an additional entry point with the loopback-only guard.

## Headless / CI Usage

The headless CLI (`npm run cli:game`) doesn't currently register a `GameplayMapLauncher` by default — only `bsp load` works. This is intentional: headless tests want determinism and shouldn't depend on a separate lobby process.

For headless tests that actually exercise the network code, run a real dedicated server in one process (`npm run net:server -- --map wdm2 --port 7777`) and connect from headless test code (`npm run net:client`).

## See Also

- [Configuration Guide](./configuration.md) — env vars, submodule layout
- [Networking Guide](./networking.md) — what happens after connect
- [Headless Mode Guide](./headless-mode.md) — running without a GPU / browser
- [Pickup System Guide](./pickup-system.md) — example of engine/game extension
