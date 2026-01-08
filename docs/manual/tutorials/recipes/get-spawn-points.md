# Recipe: Get Player Spawn Points

Extract spawn locations from a loaded map.

## Console Command

```
bsp entities
```

Look for `info_player_deathmatch` or `info_player_start`.

## Code

```typescript
import { parseEntities } from '../../engine/loader/bsp/EntityParser';

interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  angle: number;
}

function getSpawnPoints(entityString: string): SpawnPoint[] {
  const entities = parseEntities(entityString);
  
  return entities
    .filter(e => 
      e.classname === 'info_player_deathmatch' ||
      e.classname === 'info_player_start'
    )
    .map(e => {
      const [x, y, z] = (e.origin || '0 0 0').split(' ').map(Number);
      const angle = parseFloat(e.angle || '0');
      return { x, y, z, angle };
    });
}

// Usage after loading map
const spawns = getSpawnPoints(bspData.entities);
console.log('Spawn points:', spawns);

// Pick random spawn
const randomSpawn = spawns[Math.floor(Math.random() * spawns.length)];
```

## Spawn at Location

```typescript
function spawnCamera(camera: Camera, spawn: SpawnPoint) {
  camera.position.set(spawn.x, spawn.y + 56, spawn.z);
  camera.rotation.y = (spawn.angle * Math.PI) / 180;
}
```

Note: `+ 56` is approximate eye height.
