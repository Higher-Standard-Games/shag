# Pickup System

In-world collectibles — things a player walks over and grabs. SHAG ships an engine-generic `Pickup` base class so any game built on SHAG can implement its own pickup taxonomy (weapons + ammo for a shooter, resources for a building game, potions for an RPG) without re-implementing the underlying mechanics.

## What the Engine Provides

`Pickup` lives at `src/engine/world/Pickup.ts`. It extends Babylon `TransformNode` and owns everything that's truly common across games:

- **Model loading** via the engine's `AssetPreloader` cache, falling back to `ModelLoader`.
- **Optional Havok physics toss** when `options.velocity` is set, with settle detection (auto-freezes the mesh after speed drops below 2 u/s or 3 s elapses).
- **BSP-aware drop-to-ground** when `options.gravity` is true — Babylon visual raycast against the scene first, then a fallback through the collision world via `getCollisionManager().findGround(...)`.
- **Glow pulse** when `options.glowColor` is set.
- **Respawn timer** when `options.respawnTime > 0`.
- **`deactivateFromServer()`** — public entrypoint for server-authoritative deactivation (plays sfx, hides the mesh, freezes physics, schedules respawn).
- **`dispose()`** that cleans up timers, the glow light, the physics body, and the mesh.

## Constructing a Pickup

```typescript
import { Pickup, type PickupOptions } from "@/engine/world/Pickup";

const pickup = new Pickup(name, scene, position, {
  id: "ammo_crate_007",
  modelPath: "models/items/ammo/ammobox/ammobox.md3",
  respawnTime: 30,             // seconds; 0 = no respawn
  scale: 1.5,
  gravity: true,               // drop to BSP floor on spawn
  bobbing: true,
  glowColor: { r: 1, g: 0.8, b: 0.2 },
  velocity: new Vector3(0, 5, 5), // optional initial toss
  entityId: "item_50001",      // network entity id (server-synced)
  pickupId: 7,                 // sequential deterministic id
  pickupSoundKey: "pickup",    // AudioManager sfx key
  metadata: { /* game-specific data */ },
});
```

The `metadata` field is the recommended place to stash game-specific data (weapon id, ammo type, resource amount, …) without touching the engine type.

## Hooks for Subclasses

`Pickup` is meant to be subclassed. The base class exposes five `protected` hooks; override only what your game needs:

| Hook | Called when | Default |
|------|-------------|---------|
| `onConstructed()` | end of the constructor, before async model load | no-op |
| `onProximity(playerPos, inRange)` | every frame from the proximity check | no-op |
| `onAfterDeactivated()` | after the pickup is marked inactive | no-op |
| `getPickupSoundKey()` | when playing the pickup sfx | returns `options.pickupSoundKey ?? "pickup"` |
| `getPlayerPosition()` | to resolve the player position for proximity | active camera/controller position |

The engine generic `Pickup` deliberately defines **no taxonomy** (no `"weapon"` vs `"ammo"` enum, no inventory awareness, no HUD prompts) — those concerns are game-specific.

## Writing a Pickup for Your Game

Subclass `Pickup` in your game submodule. A minimal pattern:

```typescript
// src/games/mygame/world/MyGamePickup.ts
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { Pickup, type PickupOptions } from "@/engine/world/Pickup";

export interface MyGamePickupOptions extends PickupOptions {
  resource: "wood" | "stone" | "water";
  amount: number;
}

export class MyGamePickup extends Pickup {
  declare protected options: MyGamePickupOptions;

  // Use a static registry if you need server-driven deactivation
  private static all: MyGamePickup[] = [];

  constructor(name: string, scene: Scene, position: Vector3, options: MyGamePickupOptions) {
    super(name, scene, position, options);
  }

  protected override onConstructed(): void {
    MyGamePickup.all.push(this);
  }

  protected override getPickupSoundKey(): string {
    return `${this.options.resource}_collect`;
  }

  protected override onProximity(_playerPos: Vector3, inRange: boolean): void {
    if (inRange) {
      // Show a HUD prompt, queue an inventory pickup,
      // or whatever your game does on proximity.
    }
  }

  /** Server-authoritative deactivation lookup. */
  public static deactivateById(id: number): void {
    const pickup = MyGamePickup.all.find((p) => p.options.pickupId === id);
    if (pickup?.isActive) {
      pickup.deactivateFromServer();
    }
  }

  public override dispose(): void {
    const i = MyGamePickup.all.indexOf(this);
    if (i >= 0) MyGamePickup.all.splice(i, 1);
    super.dispose();
  }
}
```

Spawn one wherever your game's entity handlers process map data, on a network event, or directly from console commands during development.

## Server-Authoritative Deactivation

For multiplayer games, pickups should be deactivated by the server. The recommended pattern (used by the FPS reference game) is:

1. **The server** emits an `item_pickup` event with the `pickupId` (and a fallback weapon-id + xyz position).
2. **The client** routes the event to a static method on your subclass (e.g. `MyGamePickup.deactivateById(...)`) which looks up the registry, then calls `pickup.deactivateFromServer()` on the matching instance.
3. **`Pickup.deactivateFromServer()`** plays the sfx, hides the mesh, freezes physics, and schedules respawn if `respawnTime > 0`.

A queue of pending deactivations (for the race where a deactivation event arrives before the client constructs the matching pickup, e.g. during map load) is a common addition — see the FPS reference game's subclass for how it's implemented.

## See Also

- [Map Launching Guide](./map-launching.md) — how server-spawned matches initialise their pickup set
- [Configuration Guide](./configuration.md) — submodule layout for game-specific code
- [Networking Guide](./networking.md) — server-authoritative event flow
