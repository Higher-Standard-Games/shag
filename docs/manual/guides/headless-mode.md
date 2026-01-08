# Headless Mode

Running SHAG Engine without a GPU using NullEngine.

## Overview

Headless mode allows running the engine without WebGL/GPU, useful for:

- **CI/CD pipelines** - Automated testing
- **Map validation** - Verify BSP parsing
- **Asset checking** - Validate PK3 contents
- **Scripting** - Batch operations

## How It Works

```
Normal Mode              Headless Mode
┌─────────────┐         ┌─────────────┐
│   Browser   │         │   Node.js   │
├─────────────┤         ├─────────────┤
│  WebGL GPU  │         │ NullEngine  │ ← No GPU
├─────────────┤         ├─────────────┤
│ Babylon.js  │         │ Babylon.js  │
├─────────────┤         ├─────────────┤
│ SHAG Engine │         │ SHAG Engine │
└─────────────┘         └─────────────┘
```

NullEngine is a Babylon.js engine that simulates rendering without a GPU.

## CLI Tools

### Headless Game

Full engine with all systems:

```bash
npm run cli:game
```

Features:
- All 45+ console commands
- PK3 loading
- Shader parsing
- BSP loading
- Interactive REPL

### Headless BSP

BSP loader only (faster startup):

```bash
npm run cli:bsp -- info ./path/to/map.bsp
```

Features:
- Direct BSP file loading
- Entity extraction
- Geometry statistics

## Usage Examples

### Validate a Map

```bash
npm run cli:game -- \
  --command "map wdm7" \
  --command "bsp info" \
  --command "quit"
```

### Extract Entities

```bash
npm run cli:game -- \
  --command "map wdm7" \
  --command "bsp entities" \
  --command "quit"
```

### Check Shader Count

```bash
npm run cli:game -- \
  --command "shader count" \
  --command "quit"
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Validate Assets

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          
      - run: npm ci
      
      - name: Validate Maps
        run: |
          npm run cli:game -- \
            --command "map wdm7" \
            --command "bsp info" \
            --command "quit"
```

### GitLab CI

```yaml
validate:
  image: node:22
  script:
    - npm ci
    - npm run cli:game -- --command "shader count" --command "quit"
```

## Programmatic Usage

```typescript
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';

// Create headless engine
const engine = new NullEngine();
const scene = new Scene(engine);

// Load systems
const pk3 = PK3Loader.getInstance();
await pk3.indexDirectory('./public/game');

// Load shaders
const shaders = Q3ShaderRegistry.getInstance();
await shaders.loadFromPK3();

// Load map
const mapLoader = new MapLoader(scene);
await mapLoader.load('wdm7');

// Access data
console.log(mapLoader.getBspData().entities);
```

## Limitations

Headless mode cannot:

- Render to screen
- Load textures (skipped)
- Play audio
- Handle user input
- Display UI

## What Works

| Feature | Headless |
|---------|----------|
| PK3 loading | ✅ |
| Shader parsing | ✅ |
| BSP parsing | ✅ |
| Entity extraction | ✅ |
| Console commands | ✅ |
| Mesh creation | ✅ |
| Collision data | ✅ |
| Texture loading | ❌ |
| Rendering | ❌ |
| Audio | ❌ |

## Related

- [Tool: Headless Game](../tools/headless-game.md)
- [Tutorial: Headless Testing](../tutorials/advanced/headless-testing.md)
