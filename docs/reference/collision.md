# BSP Collision

> Verified against <code>src/shared/collision</code> and <code>src/engine/physics</code> on 2026-08-06.

Client and server use <code>SharedCollisionWorld</code>. It consumes a structural <code>SweepBackend</code>; the engine adapts its Babylon-backed <code>SweepCollisionBackend</code> at the boundary.

<code>CollisionWorld</code> exposes:

- <code>trace(start, end, bounds?, contentMask?)</code>;
- <code>stepSlideMove(start, velocity, deltaTime, bounds)</code>;
- <code>pointContents(point)</code>;
- <code>findEntitiesInRadius()</code> (currently returns no entities);
- <code>getWorldBounds()</code> (currently a fixed broad bound).

Box/swept traces are implemented, not a future feature. <code>SharedCollisionWorld</code> converts velocity to displacement for the backend and converts the clipped result back to velocity. Ground detection covers downward blocking, level floor probes, and ramp ascent.

## Shared Contents

| Flag | Value |
|---|---|
| SOLID | 1 |
| WATER | 2 |
| LAVA | 4 |
| SLIME | 8 |
| PLAYERCLIP | 16 |
| MONSTERCLIP | 32 |
| TRIGGER | 64 |

These are shared values, not raw Q3 flags. Raw BSP contents are translated once in the engine adapter. Read them as bitmasks: a point may be in more than one volume.

<code>MASK_LIQUID</code> combines water, lava, and slime. <code>MASK_SOLID</code> combines solid and player clip. Shots use raw Q3 <code>CONTENTS_SOLID</code> so player-clip brushes do not block projectiles.

## Validation

    npm run test:physics
    npm run test:simulation
    npm run cli:game -- --exec "bsp load wdm2; bsp info; quit"

Use the same shared collision world for prediction and authority; parallel collision implementations cause reconciliation drift.
