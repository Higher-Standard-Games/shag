# Recipe: get BSP spawn points

```text
developer 1
bsp entities
```

In code, use `BspManager` from `src/engine/loader/bsp/BspManager.ts` and the
`extractSpawnPoints` / `extractSpawnFacings` helpers from
`src/shared/bsp/SpawnPointTable.ts`. Resolve imports relative to the calling module.

```ts
const bsp = BspManager.getInstance().getBsp();
if (!bsp) throw new Error('Load a BSP first');

const spawns = extractSpawnPoints(bsp.entities);
const facings = extractSpawnFacings(bsp.entities);
```

Both helpers include registered generic and team-tagged spawns and skip invalid
origins. Positions are already in the game's Y-up coordinates, with the 24-unit
player-origin height offset applied. `facings` adds each spawn's game yaw in radians.

For actual respawning, use the FPS server spawn-selection path so collision, team rules, and authoritative state remain consistent.
