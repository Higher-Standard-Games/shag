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
npm run cli:game -- -- \
  --command "bsp load wdm7" \
  --command "bsp info" \
  --command "quit"
```

### Extract Entities

```bash
npm run cli:game -- -- \
  --command "bsp load wdm7" \
  --command "bsp entities" \
  --command "quit"
```

### Check Shader Count

```bash
npm run cli:game -- -- \
  --command "shader count" \
  --command "quit"
```

### Memory Leak Testing

Test for resource leaks across map load/unload cycles:

```bash
# Test MapRenderer create/clear (fast, no PK3 needed)
npm run cli:game -- -- --command "leaktest maprenderer 10"

# Test full map cycle (requires maps in PK3)
npm run cli:game -- -- --command "leaktest mapcycle 10 wdm7 wdm1"
```

The leak tests compare resource counts (meshes, nodes, lights, materials, textures) before and after each iteration. They exit with code 1 on failure.

### Batch Commands

Execute multiple commands in one invocation:

```bash
npm run cli:game -- -- --command "bsp load wdm7; bsp info; quit"
```

Commands can be separated by `;` or newlines.

::: warning Windows Users
npm has issues passing quoted arguments on Windows. For complex commands with quotes, use npx directly:
```bash
npx vite-node src/cli/headless-game.ts --exec "shader info models/weapons/plasmagun/plasmagun"
```
:::

## Recording Demos {#recording-demos}

Record a `.shagdemo` for playback / highlight analysis. Recording is
server-authoritative: it captures the real match snapshots plus **all** events
(kills, damage, projectiles, chains) and only spans the **active** match —
warmup/countdown are never recorded. Demos land in `public/data/demos/`.

### One command (server + AI bots)

```bash
npm run demo:record -- --map wdm12 --bots 2 --seconds 30
# options: --gametype duel|ffa|tdm   --difficulty easy|medium|hard   --port <n>
```

Starts a headless `GameServer` (map resolved via the pk3 index), connects N AI
bots through `BotServer` (they load map vision + a navgraph and join as
players), forces the match Active so recording starts immediately, records for
`--seconds`, then saves the demo and prints its path.

- Produces **movement-rich** demos (bots roam the map) — ideal for exercising
  remote-player locomotion in playback.
- **Caveat:** the headless bots navigate but don't currently engage in combat
  (their vision doesn't flag enemies), so these demos have movement but no
  `weapon_fire`/`death` events yet. This is a BotVision limitation, not a map
  issue — changing maps doesn't change it.

### Manual (server + bots, or play it yourself)

```bash
# terminal 1 — dedicated server (maps load via the pk3 index)
npm run net:server -- --map wdm12 --gametype duel --port 7777
# terminal 2 — AI bots that connect and roam
npm run bot:server -- --auto ws://localhost:7777 --count 2
```

Or connect from the browser and play vs a bot yourself. Recording auto-starts
when the match goes Active and **finalizes when the last player leaves** (or the
server stops) — so a match you played (with your own shooting, which *does*
produce `weapon_fire`/`death`) is written the moment you disconnect. Demos
shorter than ~10s are discarded (anti-flood; tunable via
`DemoConfig.minDurationMs`).

### Under the hood

- **Map resolution** is unified through the pk3 index
  (`resolveMapBspViaIndex` in `src/engine/loader/pk3/NodePk3.ts`) — the same
  lookup the game uses; no ad-hoc BSP path search.
- **Recording fidelity:** the server builds each snapshot once and hands the
  *same instance* to the broadcaster and the recorder, so one-shot events aren't
  lost (`GameServer.tick` → `SnapshotBroadcaster` + `DemoRecorder`).
- **Playback / highlights:** `DemoReader` → `DemoAnalyzer` /
  `CinematicDemoPlayer` (`src/games/fps/client/`). Watch in-game with
  `demolist` → `demo <n>` → `demoplay`.

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
          npm run cli:game -- -- \
            --command "bsp load wdm7" \
            --command "bsp info" \
            --command "quit"

      - name: Memory Leak Test
        run: npm run cli:game -- -- --command "leaktest maprenderer 10"
```

### GitLab CI

```yaml
validate:
  image: node:22
  script:
    - npm ci
    - npm run cli:game -- -- --command "shader count" --command "quit"
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
| Leak testing | ✅ |
| Texture loading | ❌ |
| Rendering | ❌ |
| Audio | ❌ |

## Related

- [Tool: Headless Game](../tools/headless-game.md)
- [Tutorial: Headless Testing](../tutorials/advanced/headless-testing.md)
