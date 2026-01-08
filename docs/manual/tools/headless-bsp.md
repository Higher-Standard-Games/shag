# Headless BSP CLI

Load and inspect BSP files directly without the full engine.

## Overview

A lightweight CLI for BSP-only operations. Faster startup than the full headless game.

## Usage

```bash
npm run cli:bsp -- <command> <bsp-file>
```

## Commands

### Info

Show BSP file statistics:

```bash
npm run cli:bsp -- info ./public/game/maps/wdm7.bsp
```

Output:
```
=== BSP Info ===
Format: FBSP
Version: 1
Vertices: 12,456
Faces: 8,234
Textures: 89
Lightmaps: 45
Entities: 42
Brushes: 1,234
```

### Entities

Extract entity data:

```bash
npm run cli:bsp -- entities ./public/game/maps/wdm7.bsp
```

Output:
```
=== Entities (42) ===
info_player_deathmatch @ 256 128 64
info_player_deathmatch @ 512 256 32
light @ 0 0 128 (intensity: 300)
item_health_large @ 384 192 48
...
```

### Textures

List referenced textures:

```bash
npm run cli:bsp -- textures ./public/game/maps/wdm7.bsp
```

Output:
```
=== Textures (89) ===
textures/base_wall/concrete
textures/base_floor/metal
textures/wdm7/sky
...
```

### Validate

Check BSP for common issues:

```bash
npm run cli:bsp -- validate ./public/game/maps/wdm7.bsp
```

Output:
```
=== Validation ===
✓ Header valid
✓ All lumps readable
✓ Entity string parseable
✓ 42 entities parsed
✓ Vertex data valid
✓ Face data valid
✓ No issues found
```

## Loading from PK3

Extract BSP from PK3 first or use the full headless game:

```bash
# Extract from PK3
unzip -p public/game/map_wdm7.pk3 maps/wdm7.bsp > wdm7.bsp

# Then use headless-bsp
npm run cli:bsp -- info wdm7.bsp
```

Or use the full headless game for PK3 support:

```bash
npm run cli:game -- --command "map wdm7" --command "bsp info"
```

## Programmatic Usage

```typescript
import { BspLoader } from '../engine/loader/bsp/BspLoader';
import { readFileSync } from 'fs';

const buffer = readFileSync('./path/to/map.bsp');
const bsp = await BspLoader.load(buffer);

console.log('Vertices:', bsp.vertices.length);
console.log('Faces:', bsp.faces.length);
console.log('Entities:', bsp.entities);
```

## Use Cases

- **Quick validation** - Check BSP before adding to game
- **Asset auditing** - List textures used by map
- **Build automation** - Validate maps in CI/CD
- **Map analysis** - Extract entity data for tools

## Comparison

| Feature | cli:bsp | cli:game |
|---------|---------|----------|
| Startup time | Fast | Slower |
| PK3 support | No | Yes |
| Shader loading | No | Yes |
| Full commands | No | Yes |
| BSP inspection | Yes | Yes |

Use `cli:bsp` for quick BSP inspection, `cli:game` for full engine features.

## Related

- [Headless Game CLI](./headless-game.md)
- [Guide: Headless Mode](../guides/headless-mode.md)
- [Guide: BSP System](../guides/bsp-system.md)
