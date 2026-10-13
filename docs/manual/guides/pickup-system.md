# Pickup system

`src/engine/world/Pickup.ts` provides a game-neutral Babylon pickup base. The active FPS module supplies taxonomy, authoritative state, and inventory/combat meaning.

## Engine base

`Pickup` extends `TransformNode` and coordinates:

- model loading through engine caches/loaders;
- optional tossed Havok presentation;
- drop-to-ground support;
- bob/glow presentation;
- server-driven deactivate/respawn presentation;
- cleanup of timers, lights, physics, and meshes.

```ts
import { Pickup, type PickupOptions } from '../../../src/engine/world/Pickup';

const pickup = new Pickup(name, scene, position, options);
```

Confirm `PickupOptions` in source when constructing one; model paths, deterministic IDs, network entity IDs, respawn time, sound keys, and game metadata have different ownership.

## Game subclass

From a file such as `src/games/mygame/world/MyPickup.ts`:

```ts
import { Pickup } from '../../../engine/world/Pickup';

export class MyPickup extends Pickup {
  protected override onAfterDeactivated(): void {
    // Update game presentation only.
  }
}
```

Hooks allow game presentation without adding a weapon/ammo/resource enum to engine code.

FPS procedural pickups use a cosmetic hover offset of 30 world units above the
fixed anchor. Clearance accounts for server-landed anchors (about 4 units above
the floor), model size and the full downward bob. The bob runs at 1.2 times the
recipe frequency; pickup positions and collection ranges remain authoritative.

## Authority

The server decides whether a player collected a pickup, applies the effect, and replicates active state. The client should not grant inventory based only on visual proximity. `deactivateFromServer()` is the presentation entry point after authoritative confirmation.

## Lifecycle

- use stable deterministic IDs from map/entity processing;
- unregister any game-side lookup when disposing;
- allow map cleanup to dispose all pickup nodes;
- clear respawn timers and physics resources;
- test repeated pickup/respawn and late-join active-set reconciliation.

Useful diagnostics:

```text
pickup_audit                        # FPS: what the client thinks it has
spawn_pickable_entity <entity_id>   # developer-gated; place one to look at
```

Respawn intervals belong to the gametype, not to the pickup: each one carries
`weaponRespawnTime`, `ammoRespawnTime`, `armorRespawnTime`, `healthRespawnTime`
and `megaHealthRespawnTime`, and a round-based mode can return everything at the
round boundary instead.

See the FPS game manual for concrete weapon/ammo pickup behavior.
