# Map launching

SHAG has separate inspection and gameplay paths.

| Path | Command/API | Result |
| --- | --- | --- |
| BSP inspection | `bsp load <name>` | Parsed map data; optionally render with `bsp render` |
| Browser gameplay | `map <name> [gametype]` | Ask the registered game launcher to start/connect a match |
| Dedicated server | `npm --prefix src/games/fps run net:server -- --map <name>` | Authoritative server process |

## Browser gameplay command

```text
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
// From src/games/fps/client/registerServices.ts
registerGameplayMapLauncher(fpsModule.fpsMapLauncher);
```

The FPS adapter asks the lobby for a server (`dev:spawn_server`) and then initializes the network client. Without a registration, `map` reports that no gameplay launcher is available.

## Practice and developer servers

`map` needs no `developer 1`. What the lobby starts depends on where the
request comes from:

| Requested from | Server |
| --- | --- |
| The lobby's own machine (loopback) | A developer server: any installed map, any gametype, the gametype's player count, and `training_demo` recording |
| Anywhere else | A practice server: one of the lobby's maps, for that player alone |

A practice server takes only maps in a gametype's map pool. The requested
gametype is used when its pool has the map, otherwise the first gametype whose
pool does. It admits one player (`--max 1`) and no bots. A player has one
practice server at a time, counted by account and by address, and starts at
most three a minute from one address. Like every spawned server, it exits when
its player leaves, or after two minutes if nobody joins.

Neither kind has admission seats, so their results are never stored and never
rated. A refusal (an unknown map, a second server, the rate limit) comes back
as the command's error.

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
