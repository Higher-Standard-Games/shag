# Engine-to-game service registries

Small single-slot registries keep generic engine code from importing the active game.

## Current seams

- `GameplayMapLauncher`: engine console to browser game/lobby launch;
- `NetworkConnector`: engine UI to the selected game network client, and the
  `scene empty` command's connection-state check before enabling freefly controls;
- `GameFrameHook`: engine camera controllers to the game's per-frame work, so a
  freefly or spectator camera can tick the network and draw remote players
  without importing the game.

The first two expose register, get and clear; `GameFrameHook` uses
`setGameFrameHook(hook)` and clears by passing `null`. The application composition root owns registration:

```ts
// From src/main.ts
import { registerGameplayMapLauncher } from './engine/console/GameplayMapLauncher';
import { registerNetworkConnector } from './engine/ui/components/NetworkConnector';

registerGameplayMapLauncher(fpsMapLauncher);
registerNetworkConnector(fpsNetworkConnector);
```

Engine consumers must handle a missing adapter without importing an FPS fallback.
Actions that require a game report a useful error. For the `scene empty`
connection-state check, a missing adapter means no active network connection.

## Test hygiene

```ts
afterEach(() => {
  clearGameplayMapLauncher();
  clearNetworkConnector();
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
