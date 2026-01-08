# Recipe: Extract Entities from BSP

Parse all entities from a map file.

## Console Command

```
bsp entities
```

## Code

```typescript
import { parseEntities } from '../../engine/loader/bsp/EntityParser';

// After loading BSP
const entities = parseEntities(bspData.entities);

// Filter by type
const lights = entities.filter(e => e.classname === 'light');
const triggers = entities.filter(e => e.classname?.startsWith('trigger_'));
const items = entities.filter(e => e.classname?.startsWith('item_'));
const weapons = entities.filter(e => e.classname?.startsWith('weapon_'));

console.log('Lights:', lights.length);
console.log('Triggers:', triggers.length);
console.log('Items:', items.length);
console.log('Weapons:', weapons.length);
```

## Common Entity Types

| Classname | Description |
|-----------|-------------|
| `info_player_deathmatch` | Player spawn |
| `info_player_start` | Player spawn (SP) |
| `light` | Point light |
| `item_health_*` | Health pickups |
| `item_armor_*` | Armor pickups |
| `weapon_*` | Weapon pickups |
| `ammo_*` | Ammo pickups |
| `trigger_*` | Trigger volumes |
| `func_*` | Brush entities |
| `target_*` | Target entities |

## Entity Properties

```typescript
interface Entity {
  classname: string;
  origin?: string;      // "x y z"
  angle?: string;       // Facing angle
  targetname?: string;  // For targeting
  target?: string;      // What it targets
  model?: string;       // Brush model index
  [key: string]: string | undefined;
}
```

## Parse Origin Helper

```typescript
function parseOrigin(origin: string): { x: number; y: number; z: number } {
  const [x, y, z] = origin.split(' ').map(Number);
  return { x: x || 0, y: y || 0, z: z || 0 };
}
```
