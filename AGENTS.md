# AGENTS.md - AI Assistant Instructions for SHAG Engine

This file provides context and instructions for AI assistants working on this codebase.

## Project Overview

**SHAG Engine** is a Babylon.js-based 3D game engine supporting:
- Quake 3 / Warsow BSP map loading with FBSP support
- PK3 asset archives with virtual filesystem
- Q3 shader system with animations
- Multiple camera modes (isometric, FPS, sidescroll, freefly)
- Server-authoritative multiplayer with client prediction
- Cross-platform deployment (web, Android, Electron desktop)

## Directory Structure

```
src/
├── engine/           # Reusable engine code (game-agnostic)
│   ├── core/         # EventBus, GamePaths, GameTimer
│   ├── camera/       # CameraSystem and controllers (FPS, isometric, etc.)
│   ├── console/      # Console system, commands, cvars
│   ├── loader/       # BSP, PK3, shader, texture, model loading
│   ├── network/      # Client networking, prediction, protocol
│   ├── server/       # Headless server, ECS, lag compensation
│   ├── physics/      # BSP collision, Havok integration
│   ├── movement/     # Character controllers, Q3 physics
│   ├── ui/           # UI framework, HUD system
│   └── effects/      # Weather, post-processing
├── games/            # Game implementations (git submodules)
│   └── fps/          # → submodule: wash-fps
├── cli/              # Headless CLI tools
└── shared/           # Shared types (client/server)

public/
├── engine/           # Engine assets (fonts) - IN GIT
├── data/             # Game data - GITIGNORED
│   └── *.pk3, maps, textures
└── wasm/             # Havok WASM - GITIGNORED (auto-copied on install)
```

## Headless Mode - USE THIS FOR TESTING

**IMPORTANT**: When testing changes, validating code, or debugging issues, **always use headless mode** instead of asking the user to test manually in the browser.

### Running Headless Commands

```bash
# Interactive REPL
npm run cli:game

# Single command
npm run cli:game -- --command "shader count"

# Load and inspect a map
npm run cli:game -- --command "map wdm7; bsp info; quit"

# Dedicated server (multiplayer)
npm run net:server -- --map wdm2 --port 7777
```

> **Windows Note**: For complex commands, use npx directly:
> ```bash
> npx vite-node src/cli/headless-game.ts --exec "shader info models/weapons/plasmagun/plasmagun"
> ```

### Key Test Commands

```bash
# Verify build works
npm run build

# TypeScript check (no emit)
npx tsc --noEmit

# Memory leak test (ALWAYS run after disposal changes)
npm run cli:game -- --command "leaktest maprenderer 10"

# Load and inspect a map
npm run cli:game -- --command "map wdm7; bsp info; quit"
```

## Babylon.js ES6 Imports (Tree-Shaking)

**CRITICAL**: This project uses `@babylonjs/core` ES6 modules for tree-shaking. Never use the UMD `babylonjs` package.

```typescript
// ✅ CORRECT - Granular ES6 imports
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

// ❌ WRONG - UMD bundle (defeats tree-shaking)
import { Scene, Vector3, Mesh } from "babylonjs";
```

### Common Import Paths

| Class | Import Path |
|-------|-------------|
| `Scene` | `@babylonjs/core/scene` |
| `Engine` | `@babylonjs/core/Engines/engine` |
| `NullEngine` | `@babylonjs/core/Engines/nullEngine` |
| `Vector3`, `Matrix` | `@babylonjs/core/Maths/math.vector` |
| `Color3`, `Color4` | `@babylonjs/core/Maths/math.color` |
| `Mesh` | `@babylonjs/core/Meshes/mesh` |
| `StandardMaterial` | `@babylonjs/core/Materials/standardMaterial` |

### Side-Effect Imports

Some Babylon.js features require side-effect imports:

```typescript
// ClusteredLightContainer requires its scene component
import "babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent";

// scene.beginAnimation requires animatable
import "@babylonjs/core/Animations/animatable";

// Camera collision requires coordinator
import "@babylonjs/core/Collisions/collisionCoordinator";
```

## Singleton Pattern with Disposal

All major systems use singleton pattern with proper lifecycle management:

```typescript
class MySystem {
  private static instance: MySystem;
  private scene: Scene | null = null;
  private unsubscribe: (() => void) | null = null;

  public static getInstance(): MySystem {
    if (!MySystem.instance) {
      MySystem.instance = new MySystem();
    }
    return MySystem.instance;
  }

  init(scene: Scene): void {
    this.scene = scene;
    this.unsubscribe = EventBus.on("some:event", this.handler);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.scene = null;
  }
}
```

## Console Commands

Commands are registered via `CommandRegistry`:

```typescript
import { CommandRegistry } from "./engine/console/CommandRegistry";

const registry = CommandRegistry.getInstance();

registry.register("mycommand", async (args: string[]) => {
  return "Output string shown to user";
}, {
  description: "Brief description",
  usage: "mycommand <args>",
  category: "game"
});
```

## Networking Architecture

Server-authoritative with client prediction:

```
Client                          Server
  │                               │
  │── Input (sequence #) ───────→│
  │   Predict locally             │ Process input
  │                               │ Run simulation
  │←── Snapshot (ack sequence) ──│
  │   Reconcile prediction        │
```

Key files:
- `src/games/fps/client/V2NetworkClient.ts` - Client prediction
- `src/engine/server/` - Headless server infrastructure
- `src/engine/network/protocol/` - Binary protocol

## Common Gotchas

### 1. Forgetting Side-Effect Imports
Runtime error about "needs to be imported before" → add side-effect import.

### 2. EventBus Without Unsubscribe (Memory Leak)
```typescript
// ❌ WRONG
EventBus.on("event", handler);

// ✅ CORRECT
this.unsubscribe = EventBus.on("event", handler);
// In dispose(): this.unsubscribe?.();
```

### 3. Observable Without Removal (Memory Leak)
```typescript
// ❌ WRONG
scene.onBeforeRenderObservable.add(() => { ... });

// ✅ CORRECT
this.observer = scene.onBeforeRenderObservable.add(() => { ... });
// In dispose(): scene.onBeforeRenderObservable.remove(this.observer);
```

### 4. Map Objects Without Metadata
Objects created during map loading must be tagged with `mapOwned: true` for `clearMap()` to dispose them.

## Testing Checklist

Before submitting changes:

1. `npx tsc --noEmit` - No TypeScript errors
2. `npm run build` - Production build succeeds
3. `npm run cli:game -- --command "leaktest maprenderer 5"` - No memory leaks (if touching disposal)
4. Test affected console commands in headless mode

## Key Documentation

- `docs/manual/guides/` - System guides
- `docs/research/` - Architecture deep-dives
- `docs/changelog/` - Version history

## Don't

- Don't use `babylonjs` UMD package
- Don't create inline event handlers without storing references
- Don't forget to dispose scene-scoped resources
- Don't ask user to test in browser when headless mode can verify
- Don't create files over 1000 lines
- Don't use `as any` without good reason
