# Engine-to-game service registries

Small single-slot registries keep generic engine code from importing the active game.

## Current seams

- `GameplayMapLauncher`: engine console to browser game/lobby launch;
- `NetworkConnector`: engine UI and the `join` command to the selected game
  network client, and the
  `scene empty` command's connection-state check before enabling freefly controls;
- `GameFrameHook`: engine camera controllers to the game's per-frame work, so a
  freefly or spectator camera can tick the network and draw remote players
  without importing the game.
- `FreeflyInput`: a game's movement action mapping and input preparation for
  the engine freefly camera; game-free tools receive engine-local defaults.
- `GameMapEntities`: game-owned definition initialization, entity-handler
  registration and map-entity disposal at the map loader's lifecycle boundaries.
- `WeaponIdResolver`: a game's compatibility-ID mapping for engine weapon views;
  absent a resolver, IDs pass through unchanged. The composition root calls
  `registerWeaponIdResolver`; tests release it with `clearWeaponIdResolver`.

`GameplayMapLauncher`, `NetworkConnector`, `FreeflyInput` and `GameMapEntities` expose register,
get and clear; `GameFrameHook` uses
`setGameFrameHook(hook)` and clears by passing `null`. The application composition root owns registration:

```ts
// From src/main.ts
import { registerGameplayMapLauncher } from './engine/console/GameplayMapLauncher';
import { registerNetworkConnector } from './engine/ui/components/NetworkConnector';
import { registerFreeflyInput } from './engine/camera/FreeflyInput';

registerGameplayMapLauncher(fpsMapLauncher);
registerNetworkConnector(fpsNetworkConnector);
registerFreeflyInput(fpsFreeflyInput);
```

Engine consumers must handle a missing adapter without importing an FPS fallback.
Actions that require a game report a useful error. For the `scene empty`
connection-state check, a missing adapter means no active network connection.

`NetworkConnector.join?()` requests participation on the existing connection.
The game owns admission, seat requests, team choice and any loadout selection.
The `join` command checks `isConnected()`, then awaits this callback without
reconnecting. A disconnected or missing adapter reports no server connection;
a connected adapter without `join` reports that joining is unsupported.
Games that only provide connection functionality can omit this capability.

`FreeflyInput` provides seven action IDs (`forward`, `backward`, `left`, `right`,
`up`, `down`, `sprint`) and `prepare()`. Register it before attaching cameras.
The controller prepares and selects the mapping on attach, without changing
game-owned contexts itself. Clearing the registry selects engine-local defaults
for the next attach; it does not change an already attached controller's mapping.

## Game map entities

Register `GameMapEntities` before loading gameplay maps. `MapLoader` calls its
synchronous `initializeDefinitions()` before entity-model dependency discovery,
then `registerHandlers()` after the built-in BSP handlers and before entity
dispatch. Entity handlers still await their visual work through
`EntityHandlerRegistry`. On unload, `disposeMapEntities()` runs before preloaded
models and BSP materials are released. Background-only loads skip definition
initialization and handler registration. Without an adapter, these game-owned
steps are skipped; built-in BSP handling remains available. Keep the adapter
registered until its map entities have been disposed.

Washoi supplies `fpsMapEntities` from `src/games/fps/world/FpsMapEntities.ts` in
the browser and FPS headless composition roots. Its concrete pickup manager
lives at `src/games/fps/world/EntityManager.ts`; it is not an engine export.

## Test hygiene

Tests that register the map-entity adapter clear it with `clearGameMapEntities()`.

```ts
afterEach(() => {
  clearGameplayMapLauncher();
  clearNetworkConnector();
  clearFreeflyInput();
  setGameFrameHook(null);
});
```

Use the clear functions from the same registry modules. Registrations are process-global singleton state.

## When to use a registry

Use this pattern when:

- there is one selected implementation;
- game code provides it and engine code consumes it;
- no dependency graph or phased initialization is needed;
- bootstrap can wire it explicitly.

Use `ServiceLocator` for engine-owned services with initialization order, scene phases, and coordinated disposal. Use `EventBus` for events with zero or multiple listeners. Use direct dependencies inside one subsystem.

## Dependency direction

```text
game/bootstrap -> register adapter -> engine interface
engine consumer -> get adapter -> call interface
```

The interface module stays game-agnostic. Never make the interface implementation silently reach back into a hard-coded game module.
