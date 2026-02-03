# AGENTS.md - AI Assistant Instructions for SHAG Engine

> **Goal**: This file should contain enough information that an AI agent can create a complete game from a single prompt like *"make me a bunny hop racing game with checkpoints"*.

## Quick Reference

| I want to... | Do this |
|--------------|---------|
| Load a map | `ConsoleSystem.getInstance().execute('map wdm2')` |
| Change camera | `CameraSystem.getInstance().setMode('fps')` |
| Play sound | `AudioManager.getInstance().playSound('weapons/rocket/fire')` |
| Spawn entity | Use `EntityManager.getInstance().spawn(...)` |
| Add command | `CommandRegistry.getInstance().register(...)` |
| Check key | `InputSystem.getInstance().isKeyDown('w')` |
| Connect server | `ConsoleSystem.getInstance().execute('connect localhost:7777')` |

---

## Project Overview

**SHAG Engine** is a Babylon.js game engine for Quake 3 / Warsow style games:
- BSP map loading (Q3, FBSP/Warsow)
- PK3 virtual filesystem
- Q3 shader system
- Server-authoritative multiplayer
- FPS movement (strafe jumping, bunny hop, wall jump)

📚 **Full Manual**: `docs/manual/`

---

## Directory Structure

```
src/
├── engine/           # Game-agnostic engine code
│   ├── core/         # GamePaths, EventBus, GameTimer
│   ├── camera/       # Camera controllers
│   ├── console/      # Commands, cvars
│   ├── loader/       # BSP, PK3, textures, models
│   ├── network/      # Client networking
│   ├── server/       # Headless server, ECS
│   ├── physics/      # BSP collision, Havok
│   ├── movement/     # Character controllers
│   └── ui/           # HUD, menus
├── games/            # Game submodules
│   ├── fps/          # → wash-fps repo
│   └── tower/        # → tower repo
└── cli/              # Headless tools

public/
├── engine/           # Engine assets (fonts)
├── data/             # Game data (gitignored)
└── wasm/             # Havok (auto-copied)
```

---

## 🎮 Creating a New Game

### Minimal Game Template

```typescript
// src/games/mygame/MyGame.ts
import { Scene } from "@babylonjs/core/scene";
import { CameraSystem } from "@/engine/camera";
import { ConsoleSystem } from "@/engine/console";

export class MyGame {
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  async init(): Promise<void> {
    // Set camera mode
    CameraSystem.getInstance().setMode('freefly');
    
    // Load a map
    await ConsoleSystem.getInstance().execute('map wdm2');
    
    // Register custom commands
    this.registerCommands();
  }

  private registerCommands(): void {
    CommandRegistry.getInstance().register('hello', async () => {
      return 'Hello from MyGame!';
    }, { description: 'Say hello' });
  }
}
```

### Game Entry Point

```typescript
// src/games/mygame/index.ts
export { MyGame } from './MyGame';
```

### Metadata

```json
// src/games/mygame/game.json
{
  "name": "mygame",
  "title": "My Awesome Game",
  "version": "0.1.0"
}
```

📚 **Guide**: `docs/manual/guides/configuration.md`

---

## 📷 Camera System

| Mode | Use Case | Features |
|------|----------|----------|
| `fps` | First-person | Mouse look, weapon view |
| `freefly` | Spectator/debug | WASD + mouse, noclip optional |
| `isometric` | RTS/RPG | Top-down, zoom, pan |
| `sidescroll` | 2.5D platformer | Fixed horizontal view |
| `follow` | Third-person | Follow target mesh |

```typescript
const cam = CameraSystem.getInstance();
cam.setMode('fps');
cam.setFOV(90);

// Get Babylon camera
const camera = cam.getCamera();
```

📚 **Guide**: `docs/manual/guides/camera-system.md`

---

## 🕹️ Input System

```typescript
const input = InputSystem.getInstance();

// Keyboard
if (input.isKeyDown('w')) { /* move forward */ }
if (input.wasKeyPressed('space')) { /* jump */ }

// Mouse
const delta = input.getMouseDelta(); // { x, y }
const pos = input.getMousePosition(); // { x, y }
```

### Key Names
`w`, `a`, `s`, `d`, `space`, `shift`, `control`, `escape`, `tab`, `enter`, `1`-`9`

---

## 🎵 Audio System

```typescript
const audio = AudioManager.getInstance();

// Play sound effect
audio.playSound('weapons/rocket/fire');

// Play music
audio.playMusic('music/track01');

// Volume
audio.setVolume(0.8);
audio.mute();
```

📚 **Guide**: `docs/manual/guides/audio-system.md` (if exists)

---

## 💬 Console Commands

### Registering Commands

```typescript
import { CommandRegistry } from "@/engine/console/CommandRegistry";

CommandRegistry.getInstance().register('mycommand', async (args) => {
  const subcommand = args[0];
  
  switch (subcommand) {
    case 'start':
      return 'Game started!';
    case 'stop':
      return 'Game stopped!';
    default:
      return 'Usage: mycommand <start|stop>';
  }
}, {
  description: 'My custom command',
  usage: 'mycommand <start|stop>',
  category: 'game'
});
```

### Executing Commands

```typescript
const console = ConsoleSystem.getInstance();
await console.execute('map wdm2');
await console.execute('noclip');
```

📚 **Guide**: `docs/manual/guides/command-reference.md`

---

## 📦 Asset Loading

### PK3 Virtual Filesystem

```typescript
import { PK3Loader } from "@/engine/loader/pk3";

const pk3 = PK3Loader.getInstance();

// Load texture
const texture = await pk3.loadTexture('textures/base/floor');

// List files
const maps = pk3.listFiles('maps/*.bsp');
```

### Loading Models

```typescript
import { ModelLoader } from "@/engine/loader/model";

const mesh = await ModelLoader.loadGLB('models/weapons/rocket.glb', scene);
mesh.position.set(0, 1, 0);
```

📚 **Guide**: `docs/manual/guides/pk3-filesystem.md`

---

## 🌍 BSP Maps

```typescript
import { MapRenderer } from "@/engine/MapRenderer";

// Load map
await ConsoleSystem.getInstance().execute('map wdm2');

// Get collision world
const collision = MapRenderer.getInstance().getCollisionWorld();

// Trace ray
const result = collision.trace(start, end, radius);
if (result.fraction < 1.0) {
  // Hit something
  console.log('Hit at', result.endPos);
}
```

### Spawn Points

```typescript
import { SpawnPointManager } from "@/engine/spawn/SpawnPointManager";

const spawns = SpawnPointManager.getInstance();
const spawnPoint = spawns.getRandomSpawnPoint();
player.position = spawnPoint.position.clone();
```

📚 **Guide**: `docs/manual/guides/bsp-system.md`

---

## 🏃 Movement (Q3 Physics)

### Using FPS Movement Profile

```typescript
import { FPSMovementProfile } from "@game/simulation/FPSMovementProfile";

const movement = new FPSMovementProfile();

// Configure
movement.maxSpeed = 320;
movement.jumpVelocity = 270;
movement.gravity = 800;
movement.airControl = 150; // Warsow-style

// Each frame
const newState = movement.move(currentState, input, deltaTime, collisionWorld);
```

### Movement CVars

| Cvar | Default | Description |
|------|---------|-------------|
| `sv_speed` | 320 | Base speed |
| `sv_jumpheight` | 270 | Jump velocity |
| `sv_gravity` | 800 | Gravity |
| `sv_aircontrol` | 150 | Air turning |
| `sv_autohop` | 1 | Bunny hop |

📚 **Guide**: `docs/manual/guides/movement-system.md`

---

## 🌐 Networking

### Client Connection

```typescript
await ConsoleSystem.getInstance().execute('connect localhost:7777');
```

### V2NetworkClient (FPS Prediction)

```typescript
import { V2NetworkClient } from "@game/client/V2NetworkClient";

const client = new V2NetworkClient(tickRate);

// Each frame
client.update(deltaTime, inputState);

// Get predicted position
const pos = client.getPosition();
```

### Running Dedicated Server

```bash
npm run net:server -- --map wdm2 --port 7777
```

📚 **Guide**: `docs/manual/guides/networking.md`

---

## 📡 EventBus

```typescript
import { EventBus } from "@/engine/core/EventBus";

// Subscribe (store unsubscribe!)
const unsub = EventBus.on('player:spawn', (data) => {
  console.log('Player spawned at', data.position);
});

// Emit
EventBus.emit('player:death', { playerId: 1, killerId: 2 });

// Cleanup
unsub(); // IMPORTANT: call in dispose()
```

### Common Events

| Event | Data | When |
|-------|------|------|
| `map:loaded` | `{ mapName }` | Map finished loading |
| `map:unloaded` | `{ mapName }` | Map cleared |
| `player:spawn` | `{ position }` | Player respawned |
| `player:death` | `{ playerId }` | Player died |
| `weapon:fire` | `{ weapon }` | Weapon fired |
| `pickup:collected` | `{ type, playerId }` | Item picked up |

---

## 🛠️ Headless Testing

**Always test with headless mode before asking user to test in browser!**

```bash
# Interactive REPL
npm run cli:game

# Run command
npm run cli:game -- --command "map wdm7; bsp info; quit"

# Memory leak test
npm run cli:game -- --command "leaktest maprenderer 5"

# Dedicated server
npm run net:server -- --map wdm2
```

---

## ⚠️ Common Gotchas

### 1. Babylon.js Imports

```typescript
// ✅ CORRECT
import { Scene } from "@babylonjs/core/scene";

// ❌ WRONG (UMD bundle)
import { Scene } from "babylonjs";
```

### 2. Side-Effect Imports

```typescript
// Some features need these:
import "@babylonjs/core/Animations/animatable";
import "@babylonjs/core/Collisions/collisionCoordinator";
```

### 3. Memory Leaks

```typescript
// ❌ WRONG - Can't unsubscribe
EventBus.on("event", handler);

// ✅ CORRECT
this.unsub = EventBus.on("event", handler);
// Later: this.unsub();
```

### 4. Map Object Cleanup

```typescript
// Tag objects for map cleanup
mesh.metadata = { mapOwned: true };
```

---

## 📚 Documentation Links

| Topic | Location |
|-------|----------|
| All console commands | `docs/manual/guides/command-reference.md` |
| BSP/PK3 loading | `docs/manual/guides/bsp-system.md` |
| Camera modes | `docs/manual/guides/camera-system.md` |
| Movement physics | `docs/manual/guides/movement-system.md` |
| Multiplayer networking | `docs/manual/guides/networking.md` |
| Configuration | `docs/manual/guides/configuration.md` |
| Shader system | `docs/manual/guides/shader-system.md` |
| Architecture deep-dives | `docs/research/` |
| Changelog | `docs/changelog/` |

---

## 🎯 Game Ideas to Try

1. **Bunny Hop Racer** - Checkpoints, timer, strafe jump to win
2. **Gun Game** - Kill to upgrade weapon, first to final weapon wins
3. **Trick Arena** - Score points for strafe jump distance/height
4. **Hide & Seek** - One seeker, spectator camera for dead players
5. **Rocket Arena** - Rockets only, instagib

---

*Made with ❤️ and probably too much coffee. Happy game making!*
