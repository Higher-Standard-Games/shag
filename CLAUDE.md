# CLAUDE.md - AI Assistant Instructions for SHAG Engine

This file provides context and instructions for AI assistants (Claude, etc.) working on this codebase.

## Project Overview

**SHAG Engine** (Standards, High And Games) is a Babylon.js-based 3D game engine supporting:
- Quake 3 BSP map loading
- PK3 asset archives
- Q3 shader system
- Multiple camera modes (isometric, FPS, sidescroll, freefly)
- Cross-platform deployment (web, Android, Electron desktop)

## Directory Structure

```
src/
├── engine/           # Reusable engine code (game-agnostic)
│   ├── core/         # EventBus, Subsystem, ServiceLocator, GameTimer
│   ├── camera/       # CameraSystem and controllers
│   ├── loader/       # BSP, PK3, shader, texture loading
│   ├── lighting/     # SkyLight, StreetLamp systems
│   ├── physics/      # Collision backends
│   ├── sprites/      # Billboard sprites
│   ├── effects/      # Weather, post-processing
│   ├── ui/           # UI framework, HUD system
│   └── debug/        # Console, commands
├── games/            # Game implementations
│   └── default/      # Default game (moved from src/game/)
├── cli/              # Headless CLI tools
└── data/             # JSON configuration files

public/
├── engine/           # Engine assets (fonts, shaders)
└── games/
    └── default/      # Game assets
        └── basewsw/  # PK3 files, maps
```

## Headless Mode - USE THIS FOR TESTING

**IMPORTANT**: When testing changes, validating code, or debugging issues, **always use headless mode** instead of asking the user to test manually in the browser.

Headless mode runs the full engine with NullEngine (no GPU required) and provides:
- All console commands
- PK3/BSP loading
- Shader parsing
- Collision testing
- **Memory leak testing**

### Running Headless Commands

```bash
# Interactive REPL
npm run cli:game

# Single command
npm run cli:game -- --command "shader count"

# Multiple commands (semicolon or newline separated)
npm run cli:game -- --command "map wdm7; bsp info; quit"

# Batch with exit
npm run cli:game -- --command "map wdm7" --command "bsp entities" --command "quit"
```

### Key Test Commands

```bash
# Verify build works
npm run build

# TypeScript check (no emit)
npx tsc --noEmit

# Memory leak test (ALWAYS run after disposal changes)
npm run cli:game -- --command "leaktest maprenderer 10"
npm run cli:game -- --command "leaktest mapcycle 5 wdm7"

# Load and inspect a map
npm run cli:game -- --command "map wdm7; bsp info; quit"

# Check shader count
npm run cli:game -- --command "shader count; quit"

# List available maps
npm run cli:game -- --command "map list; quit"
```

### When to Use Headless Mode

- After modifying disposal/cleanup code → run `leaktest`
- After changing BSP/map loading → run `map <name>; bsp info`
- After shader changes → run `shader list` or `shader info <name>`
- After adding console commands → test them directly
- To verify PK3 loading → check startup output

## Babylon.js ES6 Imports (Tree-Shaking)

**CRITICAL**: This project uses `@babylonjs/core` ES6 modules for tree-shaking. Never use the UMD `babylonjs` package.

### Import Patterns

```typescript
// ✅ CORRECT - Granular ES6 imports
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

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
| `MeshBuilder` | `@babylonjs/core/Meshes/meshBuilder` |
| `StandardMaterial` | `@babylonjs/core/Materials/standardMaterial` |
| `PBRMaterial` | `@babylonjs/core/Materials/PBR/pbrMaterial` |
| `Texture` | `@babylonjs/core/Materials/Textures/texture` |
| `PointLight` | `@babylonjs/core/Lights/pointLight` |
| `Animation` | `@babylonjs/core/Animations/animation` |
| `Ray` | `@babylonjs/core/Culling/ray` |

### Side-Effect Imports

Some Babylon.js features require side-effect imports to register with the engine:

```typescript
// ClusteredLightContainer requires its scene component
import { ClusteredLightContainer } from "@babylonjs/core/Lights/Clustered/clusteredLightContainer";
import "@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent"; // REQUIRED

// scene.beginAnimation requires animatable
import { Animation } from "@babylonjs/core/Animations/animation";
import "@babylonjs/core/Animations/animatable"; // REQUIRED

// Camera collision requires coordinator
import "@babylonjs/core/Collisions/collisionCoordinator"; // REQUIRED for moveWithCollisions
```

**If you see runtime error**: `"XYZ needs to be imported before as it contains a side-effect"` → add the side-effect import.

## Singleton Pattern with Disposal

All major systems use singleton pattern with proper lifecycle management:

```typescript
class MySystem {
  private static instance: MySystem;
  private scene: Scene | null = null;
  private resizeHandler: (() => void) | null = null;
  private unsubscribeEvent: (() => void) | null = null;

  public static getInstance(): MySystem {
    if (!MySystem.instance) {
      MySystem.instance = new MySystem();
    }
    return MySystem.instance;
  }

  init(scene: Scene): void {
    this.scene = scene;

    // Store handler reference for removal
    this.resizeHandler = () => this.onResize();
    window.addEventListener("resize", this.resizeHandler);

    // Store unsubscribe function from EventBus
    this.unsubscribeEvent = EventBus.on("some:event", this.handler);
  }

  dispose(): void {
    // Remove DOM listeners
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // Unsubscribe EventBus
    this.unsubscribeEvent?.();
    this.unsubscribeEvent = null;

    // Clear scene reference
    this.scene = null;
  }
}
```

### Service Lifetimes

| Lifetime | Scope | Examples |
|----------|-------|----------|
| **App** | Entire session | `EngineSettings`, `AudioManager` |
| **Scene** | Per Babylon scene | `CameraSystem`, `InputSystem`, `SpriteManager` |
| **Game** | Per save slot | `GameState`, `PlantSystem`, `OrderSystem` |
| **Map** | Per loaded map | Meshes, lights, prefabs (use metadata tagging) |

### Map Ownership Tagging

When creating objects during map loading, tag them for reliable cleanup:

```typescript
mesh.metadata = {
  mapOwned: true,
  mapName: "wdm7"
};

// MapRenderer.clearMap() disposes by this metadata
```

## EventBus Conventions

```typescript
import { EventBus } from "../engine/core/EventBus";

// Naming: "system:action"
EventBus.emit("plant:harvested", { yield: 100 });
EventBus.emit("order:completed", { orderId, reward });

// Always store unsubscribe for cleanup
const unsubscribe = EventBus.on("player:levelup", handler);
// Later: unsubscribe();
```

## Console Commands

Commands are registered via `CommandRegistry`:

```typescript
import { CommandRegistry } from "../engine/debug/CommandRegistry";

const registry = CommandRegistry.getInstance();

registry.register("mycommand", async (args: string[]) => {
  const subcommand = args[0]?.toLowerCase();
  // ... handle command
  return "Output string shown to user";
}, {
  description: "Brief description",
  usage: "mycommand <subcommand>",
  category: "game" // or "rendering", "physics", etc.
});
```

## Common Gotchas

### 1. Forgetting Side-Effect Imports
Runtime error about "needs to be imported before" → add side-effect import.

### 2. Inline Event Handlers (Memory Leak)
```typescript
// ❌ WRONG - Cannot remove later
window.addEventListener("resize", () => this.onResize());

// ✅ CORRECT - Store reference
this.handler = () => this.onResize();
window.addEventListener("resize", this.handler);
// Later: window.removeEventListener("resize", this.handler);
```

### 3. EventBus Without Unsubscribe (Memory Leak)
```typescript
// ❌ WRONG - No way to unsubscribe
EventBus.on("event", handler);

// ✅ CORRECT - Store unsubscribe function
this.unsubscribe = EventBus.on("event", handler);
// In dispose(): this.unsubscribe?.();
```

### 4. Observable Without Removal (Memory Leak)
```typescript
// ❌ WRONG
scene.onBeforeRenderObservable.add(() => { ... });

// ✅ CORRECT
this.observer = scene.onBeforeRenderObservable.add(() => { ... });
// In dispose(): scene.onBeforeRenderObservable.remove(this.observer);
```

### 5. Map Objects Without Metadata
Objects created during map loading must be tagged with `mapOwned: true` for `clearMap()` to dispose them.

### 6. `as any` Type Assertions
Avoid `as any`. If Babylon.js types are incomplete, create proper interfaces or use type guards.

## File Size Guidelines

- Keep files under 500 lines when possible
- Files over 1000 lines should be split by domain
- `EngineCommands.ts` was 5000+ lines - now split into modular command classes

## Testing Checklist

Before submitting changes:

1. `npx tsc --noEmit` - No TypeScript errors
2. `npm run build` - Production build succeeds
3. `npm run cli:game -- --command "leaktest maprenderer 5"` - No memory leaks (if touching disposal)
4. Test affected console commands in headless mode

## Key Documentation

- `docs/reference/ARCHITECTURE.md` - Architecture patterns
- `docs/manual/guides/headless-mode.md` - Headless testing guide
- `docs/research/OPTIMIZATION_0.8.17.md` - Memory optimization findings
- `docs/changelog/` - Version history

## Don't

- Don't use `babylonjs` UMD package
- Don't create inline event handlers without storing references
- Don't forget to dispose scene-scoped resources
- Don't add features without disposal logic
- Don't ask user to test in browser when headless mode can verify
- Don't create files over 1000 lines
- Don't use `as any` without good reason
