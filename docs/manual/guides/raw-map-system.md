# Raw text-map system

SHAG contains a parser and renderer for Quake-family text `.map` data. This is an extension path, not the primary FPS map-loading route.

## Current status

- `MapParser` parses entity properties, classic brush planes, Valve-style planes, `brushDef`, and `patchDef2`.
- `MapRenderer` can turn supported raw-map entities and brushes into Babylon scene objects.
- `EntityHandlerRegistry` lets game code add handlers without introducing engine-to-game imports.
- The active `MapLoader.loadMap` path currently resolves indexed BSP maps; its local text-map branch is TODO.

Do not describe raw maps as hot-reloadable playable FPS maps until that composition path is wired and tested.

## Parsing

```ts
import { MapParser } from '../../../src/engine/loader/map/MapParser';

const parsed = MapParser.parse(sourceText);
```

Inspect the exported types in `MapParser.ts` before depending on the result shape; raw-map entities are distinct from parsed BSP entities.

## Custom entity handlers

```ts
import { EntityHandlerRegistry } from '../../../src/engine/core/EntityHandlerRegistry';

EntityHandlerRegistry.register('example_marker', async (entity, scene) => {
  const node = createMarker(entity.properties.origin, scene);
  return { handled: true, node };
});

// During teardown:
EntityHandlerRegistry.unregister('example_marker');
```

The registry API is static; there is no `getInstance()`. A handler receives the entity, scene, and optional render options, and returns an object containing at least `handled`.

Pre- and post-render hooks are also available. Remove registrations or call the registry cleanup method when a game composition is disposed.

## Built-in coverage

`MapRenderer` recognizes world geometry and selected visual/extension entities, including lights, street lamps, models, sprites, and registered custom handlers. The presence of parsed entity data does not imply working door, trigger, NPC, or gameplay behavior.

BSP brush entities use a separate path in `src/engine/loader/bsp/BspEntityHandlers.ts`.

## Source of truth

- `src/engine/loader/map/MapParser.ts`
- `src/engine/MapRenderer.ts`
- `src/engine/core/EntityHandlerRegistry.ts`
- `src/engine/loader/map/MapLoader.ts`
