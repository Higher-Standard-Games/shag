# Physics and collision

SHAG uses two related systems:

- deterministic Quake-style collision and movement for the FPS simulation;
- Babylon Havok physics for scene objects that need rigid-body simulation.

They are not interchangeable backends for the same player controller.

## FPS collision

Client prediction and the authoritative server consume the same shared BSP collision world through client/server adapters. The public collision-manager backend names are:

- `q3` for BSP/Quake tracing;
- `babylon` for Babylon scene collision.

There are no `brush` or `clipbrush` selectable backends.

The collision API provides point-contents tests, box traces, ground queries, and sliding movement. Prefer the Babylon-free contracts under `src/shared/collision/` and the existing FPS movement profile for gameplay code that must remain deterministic.

Useful diagnostics:

```text
developer 1
bsp collision point
freefly_collision
freefly_collision test
debug collision
```

`freefly_collision` with no argument reports the current state and backend; it
takes an explicit `0`/`1` (or `off`/`on`) to toggle, and refuses anything else
rather than reading it as off.

`bsp collision point` reports the contents flags at the active camera. Use `help bsp` and `help freefly_collision` for the complete diagnostics in the build being tested.

## Havok

Havok is initialized through `PhysicsSystem` and is primarily for physics bodies in a Babylon scene:

```text
developer 1
physics info
physics init
physics on
physics gravity 800
physics debug
```

`physics gravity` also updates `sv_gravity`. Player movement still follows the deterministic movement simulation rather than a Havok character body.

## Coordinate and flag caution

BSP contents and surface flags originate in Quake data. Keep raw BSP bit flags at loader/collision boundaries and convert them to shared gameplay contents explicitly. Do not mix `src/engine/physics/ContentFlags.ts` values with the `Contents` mask in `src/shared/collision/CollisionWorld.ts`.

## Validation

Collision or movement changes should be checked headlessly:

```bash
npm run test:simulation
npm run test:physics
npm run cli:game -- --exec 'bsp load wdm2; bsp info; quit'
```

Renderer or networking changes require the wider regression set described in the repository `AGENTS.md`.

## Source of truth

- `src/engine/physics/`
- `src/shared/collision/`
- `src/engine/network/systems/movement/`
- `src/games/fps/simulation/`
