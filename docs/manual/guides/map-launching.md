# Map launching

SHAG has separate inspection and gameplay paths.

| Path | Command/API | Result |
| --- | --- | --- |
| BSP inspection | `bsp load <name>` | Parsed map data; optionally render with `bsp render` |
| Browser gameplay | `map <name> [gametype]` | Ask the registered game launcher to start/connect a match |
| Dedicated server | `npm --prefix src/games/fps run net:server -- --map <name>` | Authoritative server process |

## Browser gameplay command

```text
developer 1
map washoi_dm2 duel
```

`MapCommand` is engine-owned, but it does not import the FPS game. It calls the single registered `GameplayMapLauncher`.

```ts
export interface GameplayMapLauncher {
  launch(mapName: string, gametype: string): Promise<GameplayMapLaunchResult>;
  unload(): Promise<void> | void;
}
```

Application bootstrap registers the game adapter:

```ts
// From src/main.ts
import { registerGameplayMapLauncher } from './engine/console/GameplayMapLauncher';

registerGameplayMapLauncher(fpsMapLauncher);
```

The FPS adapter uses the lobby/development-server flow and then initializes the network client. Without a registration, `map` reports that no gameplay launcher is available.

## Other map operations

```text
map list
map current
map load <name>
map reload
map unload
```

These refer to the gameplay launcher state, not the lower-level `BspManager` inspection state.

## Headless behavior

`cli:game` registers engine commands but not the browser gameplay launcher:

```bash
npm --prefix src/games/fps run cli:game -- --exec 'bsp load washoi_dm2; bsp info; quit'
```

For a real network smoke test, run:

```bash
npm --prefix src/games/fps run net:server -- --map washoi_dm2 --port 7777
npm run net:client -- --connect ws://127.0.0.1:7777
```

## Test cleanup

Call `clearGameplayMapLauncher()` in tests or composition teardown when the registration must not leak. A game shutdown should disconnect the client, remove the loaded map, and dispose match-owned state.

See [Networking](./networking.md), [BSP system](./bsp-system.md), and [Service registries](./service-registries.md).
