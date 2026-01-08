# Headless Testing & CI/CD

**Time:** 30 minutes  
**Level:** Advanced

Automate testing and validation in CI/CD pipelines.

## Prerequisites

- [Guide: Headless Mode](../../guides/headless-mode.md)
- Basic CI/CD knowledge

## Why Headless Testing?

- **Validate maps** without manual inspection
- **Check shaders** load correctly
- **Verify assets** are present
- **Automate** regression testing
- **No GPU required** in CI

## Basic Validation Script

Create a test script:

```typescript
// scripts/validate-assets.ts
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { PK3Loader } from '../src/engine/loader/pk3/PK3Loader';
import { Q3ShaderRegistry } from '../src/engine/loader/shader/Q3ShaderRegistry';
import { BspLoader } from '../src/engine/loader/bsp/BspLoader';

async function validate() {
  console.log('=== Asset Validation ===\n');
  
  const engine = new NullEngine();
  const scene = new Scene(engine);
  
  // Load PK3s
  const pk3 = PK3Loader.getInstance();
  const pk3Count = await pk3.indexDirectory('./public/game');
  console.log(`✓ Loaded ${pk3Count} PK3 archives`);
  
  // Load shaders
  const shaders = Q3ShaderRegistry.getInstance();
  const shaderCount = await shaders.loadFromPK3();
  console.log(`✓ Parsed ${shaderCount} shaders`);
  
  // Validate specific maps
  const mapsToTest = ['wdm2', 'wdm7', 'wdm11'];
  
  for (const mapName of mapsToTest) {
    try {
      const bspData = await pk3.getFile(`maps/${mapName}.bsp`);
      if (!bspData) {
        console.log(`✗ Map not found: ${mapName}`);
        continue;
      }
      
      const bsp = await BspLoader.load(bspData);
      console.log(`✓ Map ${mapName}: ${bsp.vertices.length} vertices, ${bsp.faces.length} faces`);
    } catch (err) {
      console.log(`✗ Map ${mapName} failed: ${err}`);
      process.exit(1);
    }
  }
  
  console.log('\n=== Validation Complete ===');
  process.exit(0);
}

validate().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
```

Run with:

```bash
npx vite-node scripts/validate-assets.ts
```

## GitHub Actions Workflow

```yaml
# .github/workflows/validate.yml
name: Validate Assets

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Validate assets
        run: npx vite-node scripts/validate-assets.ts
      
      - name: Run headless tests
        run: |
          npm run cli:game -- \
            --command "shader count" \
            --command "quit"
```

## GitLab CI Pipeline

```yaml
# .gitlab-ci.yml
stages:
  - validate
  - build

validate-assets:
  stage: validate
  image: node:22
  script:
    - npm ci
    - npx vite-node scripts/validate-assets.ts
  only:
    - merge_requests
    - main

build:
  stage: build
  image: node:22
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
```

## Testing Specific Features

### Shader Parsing Test

```typescript
async function testShaderParsing() {
  const shaders = Q3ShaderRegistry.getInstance();
  
  // Test specific shader exists
  const skyShader = shaders.getShader('textures/wdm7/sky');
  if (!skyShader) {
    throw new Error('Sky shader not found');
  }
  
  // Test shader properties
  if (!skyShader.surfaceParms.has('sky')) {
    throw new Error('Sky shader missing sky surfaceparm');
  }
  
  console.log('✓ Shader parsing tests passed');
}
```

### Entity Extraction Test

```typescript
async function testEntityExtraction() {
  const pk3 = PK3Loader.getInstance();
  const bspData = await pk3.getFile('maps/wdm7.bsp');
  const bsp = await BspLoader.load(bspData!);
  
  const entities = parseEntities(bsp.entities);
  
  // Check for spawn points
  const spawns = entities.filter(e => 
    e.classname === 'info_player_deathmatch'
  );
  
  if (spawns.length === 0) {
    throw new Error('No spawn points found');
  }
  
  console.log(`✓ Found ${spawns.length} spawn points`);
}
```

## Pre-commit Hook

Add validation before commits:

```bash
# .husky/pre-commit
#!/bin/sh
npx vite-node scripts/validate-assets.ts
```

## Best Practices

1. **Fast feedback** - Keep tests quick
2. **Clear output** - Use ✓/✗ for pass/fail
3. **Exit codes** - Return non-zero on failure
4. **Incremental** - Only test changed assets
5. **Parallel** - Run independent tests in parallel

## Next Steps

- [Performance Optimization](./performance.md)
- [Guide: Headless Mode](../../guides/headless-mode.md)
