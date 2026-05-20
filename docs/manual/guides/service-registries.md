# Service Registries

A pattern SHAG uses for engine extension points: small, single-slot registries that let a game inject its specific behaviour into engine code without the engine ever importing the game.

## Why

The engine doesn't know about any specific game. But the engine ships UI and console code that needs to do things only a game can do — connect to a server, launch a gameplay session, etc. The registry pattern keeps the dependency arrow pointing the right way:

```
engine code            (knows nothing about games)
   │
   │ consults
   ▼
┌──────────────┐       (single-slot, set at boot)
│  registry    │
└──────────────┘
   ▲
   │ registers
   │
game code              (knows about the engine, provides the implementation)
```

At runtime, engine UI consults the registry and gets the game's implementation. At compile time, the engine never imports anything from `src/games/*`.

## The Pattern

A registry is a few lines:

```typescript
// engine-side
export interface SomeService {
  doThing(arg: string): Promise<void>;
}

let registered: SomeService | null = null;

export function registerSomeService(impl: SomeService): void {
  registered = impl;
}

export function getSomeService(): SomeService | null {
  return registered;
}

export function clearSomeService(): void {
  registered = null;
}
```

Calling `register` twice replaces the previous registration — useful for tests and for re-init flows where a new game module is mounted.

`clear*` is provided primarily for tests.

## Registries in SHAG

### `NetworkConnector`

`src/engine/ui/components/NetworkConnector.ts`

The lobby `ConnectingOverlay` (the engine-shipped "GAME STARTING" UI) needs to start a network connection but doesn't know how a given game does it. The registered `NetworkConnector` does:

```typescript
export interface NetworkConnector {
  isConnected(): boolean;
  connect(serverUrl: string, options?: NetworkConnectOptions): Promise<void>;
}
```

Without a registered connector, `ConnectingOverlay` falls through to a clear "NO NETWORK ADAPTER" error state.

### `GameplayMapLauncher`

`src/engine/console/GameplayMapLauncher.ts`

The engine `map <name> [gametype]` console command needs to start gameplay but doesn't know what gameplay means. The registered `GameplayMapLauncher` does — typically by spawning a dedicated game server via the lobby and connecting the client to it. See the [Map Launching Guide](./map-launching.md) for the full flow.

```typescript
export interface GameplayMapLauncher {
  launch(mapName: string, gametype: string): Promise<GameplayMapLaunchResult>;
  unload(): Promise<void> | void;
}
```

Without a registered launcher, `map` returns `"No gameplay map launcher registered. Use bsp commands for map inspection."` and the engine genuinely has no opinion on what gameplay should do.

## Boot-Time Registration

Application bootstrap (typically `src/main.ts`) is the right place to register. Dynamic import keeps the engine bundle free of the game module's eager dependencies:

```typescript
import { registerEngineCommands } from "@/engine/console/commands";
import { registerNetworkConnector } from "@/engine/ui/components/NetworkConnector";
import { registerGameplayMapLauncher } from "@/engine/console/GameplayMapLauncher";

await registerEngineCommands();

// Load the selected game module
const gameModule = await import("./games/mygame");

// The game also exposes its own command registration hook
await gameModule.registerMyGameCommands();

// Wire the game's adapters into the engine registries
registerNetworkConnector(gameModule.myGameNetworkConnector);
registerGameplayMapLauncher(gameModule.myGameMapLauncher);
```

`registerEngineCommands` runs first (it registers `map`, `bsp`, `audio`, etc.), then the game's adapters fill the registries before any UI consults them.

## Test Hygiene

If you write tests that exercise engine UI which consults a registry, remember to clear the registry in `afterEach`:

```typescript
import { afterEach } from "vitest";
import { clearNetworkConnector } from "@/engine/ui/components/NetworkConnector";

afterEach(() => {
  clearNetworkConnector();
});
```

Otherwise a test that calls `registerNetworkConnector` will leak the registration into the next test.

## ServiceLocator vs Service Registries

SHAG also has a `ServiceLocator` (`src/engine/core/ServiceLocator.ts`) used internally by the engine for its own services (`TextureManager`, `ModelLoader`, `PostProcessingManager`, …). That's a heavier framework with a topological init order, phase-aware dependencies, and a coordinated dispose pass.

The service-registry pattern is the **simpler** alternative for one-off engine→game injection points. Use it when:

- The registry has at most one slot.
- The game provides the implementation; the engine consumes it.
- You don't need an init phase or dependency graph.
- You want the wiring code to be one line in `main.ts`.

For engine-internal services that need lifecycle management or have dependencies on each other, use `ServiceLocator` instead. The two coexist — `ServiceLocator` for engine-internal plumbing, single-slot registries for the engine→game seam.

## See Also

- [Map Launching Guide](./map-launching.md) — `GameplayMapLauncher` in context
- [Configuration Guide](./configuration.md) — game submodule layout
- [Console System Guide](./console-system.md) — `registerEngineCommands` and friends
