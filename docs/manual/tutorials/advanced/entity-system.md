# Extending entities

SHAG has multiple entity representations. Choose the one that matches the loading/simulation boundary.

## BSP entities

`BspLoader.load` returns parsed entities in `bsp.entities`. Geometry-affecting BSP classnames and brush models are handled by `BspEntityHandlers.ts`; the playable FPS path also maps supported entities into game/shared systems.

Adding a classname requires deciding whether it is:

- visual and client-only;
- authoritative gameplay state;
- a brush model with collision;
- static metadata such as a spawn point.

Do not put authoritative trigger or damage decisions in a client-only Babylon node.

## Raw-map extension handlers

```ts
EntityHandlerRegistry.register('example_marker', async (entity, scene) => {
  const node = createMarker(entity.properties, scene);
  return { handled: true, node };
});

// Teardown:
EntityHandlerRegistry.unregister('example_marker');
```

`EntityHandlerRegistry` is a static registry used by `MapRenderer` for raw text-map extensions. It is not the shared gameplay ECS.

## Shared and gameplay entities

Generic definition interfaces, stable entity types and the registry live under
`src/shared/entities/`. Washoi's concrete definitions live in
`src/games/fps/shared/entities/`, shared by its client and server. Its pickup
manager is `src/games/fps/world/EntityManager.ts`; the engine map loader calls it
through the registered `GameMapEntities` adapter. FPS-specific authoritative
behavior belongs in `src/games/fps/server/`.

When adding networked state:

1. define its shared serialized representation;
2. update authoritative spawning and tick behavior;
3. update snapshot/replication paths;
4. add client presentation;
5. test late join, cleanup, and map reload.

## Cleanup

- mark map-created Babylon objects with map ownership metadata where the loader expects it;
- unsubscribe EventBus listeners;
- remove scene observers and timers;
- unregister raw-map extension handlers;
- ensure authoritative entities are destroyed on match/map teardown.

## Verification

```bash
npm run test:simulation
npm run test:physics
npm run server:tick
npm run server:fuzz -- --ticks 1000
```

Use `bsp entities <classname> details` to verify source map data before debugging behavior.
