# BSP Triggers

> Verified against <code>src/shared/bsp/TriggerTable.ts</code> on 2026-08-06.

The current FPS trigger table supports two brush triggers:

| Classname | Type | Destination |
|---|---|---|
| <code>trigger_teleport</code> | Teleport | Target origin plus exit yaw |
| <code>trigger_push</code> | Jumppad | Ballistic target point |

Each trigger references a BSP submodel through <code>model=*N</code>. Its volume is that submodel's axis-aligned bounds; trigger entities do not need an origin. <code>target</code> resolves to the first accepted entity with matching <code>targetname</code>.

Accepted destination classes are <code>target_position</code>, <code>misc_teleporter_dest</code>, <code>info_teleport_destination</code>, <code>target_location</code>, and <code>info_notnull</code>. This allow-list reflects shipped map usage.

Extraction is deterministic and shared by client prediction and server authority. Accepted triggers receive stable BSP-order ids. Invalid models, missing targets, unresolved destinations, and invalid origins warn and are dropped.

Quake coordinates are converted to Babylon coordinates. Teleport destination angles use the engine FPS yaw convention; Q3 special vertical angles are treated as zero for yaw-only exits.

The old generic <code>trigger_multiple</code> dialog/map-switch/prefab workflow is not an implemented FPS trigger system. Raw-map interactive meshes are separate extension APIs.

Validate triggers with shared table tests and movement/simulation regressions:

    npm --prefix src/games/fps run test:simulation
    npm --prefix src/games/fps run test:physics
