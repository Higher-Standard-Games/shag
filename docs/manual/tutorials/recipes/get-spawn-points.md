# Recipe: get BSP spawn points

```text
bsp entities info_player details
```

In code:

```ts
const bsp = BspManager.getInstance().getBsp();
if (!bsp) throw new Error('Load a BSP first');

const spawnClassnames = new Set([
  'info_player_deathmatch',
  'info_player_start',
  'info_player_team1',
  'info_player_team2',
]);

const spawns = bsp.entities
  .filter((entity) => spawnClassnames.has(entity.classname))
  .map((entity) => {
    const origin = (entity.properties.origin ?? '0 0 0')
      .trim()
      .split(/\s+/)
      .map(Number);

    return {
      classname: entity.classname,
      origin,
      angle: Number(entity.properties.angle ?? 0),
    };
  });
```

Keep these values in Quake coordinates until passing them through the existing BSP coordinate conversion. Do not add an approximate eye height or swap axes in entity parsing.

For actual respawning, use the FPS server spawn-selection path so collision, team rules, and authoritative state remain consistent.
