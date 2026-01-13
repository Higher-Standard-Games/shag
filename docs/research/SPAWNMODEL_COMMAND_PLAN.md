# SpawnModel Command Design

> **Status: IMPLEMENTED** - See `src/engine/console/commands/SpawnModelCommand.ts`

Design document for the `spawnmodel` developer command and underlying `ModelLoader` enhancements for animation support.

## Background

### Problem

When developing games or testing assets, there's no easy way to:
- Preview 3D models in the actual game environment
- Test how models look with scene lighting (clustered lights, shadows)
- Quickly iterate on model scale and positioning
- Verify model imports without writing code
- Test model animations interactively

Additionally, the current `ModelLoader` doesn't expose animation groups, limiting its usefulness for production game code that needs animated models.

### Solution

A two-part approach:

1. **Enhance ModelLoader** - Return animation groups and skeletons, add animation playback helpers. This creates a production-ready API for games.

2. **Implement spawnmodel command** - Developer tool that wraps the enhanced ModelLoader, serving as both a testing tool and reference implementation for game scripting.

### Dual-Purpose Design

| Use Case | Benefits |
|----------|----------|
| **Dev Tool** | Test models, animations, lighting, scale interactively |
| **Production API** | Games spawn enemies, items, props with animations |
| **Console Scripting** | Cutscenes, triggers, events via console commands |
| **Mod Support** | Load custom models at runtime |

## Part 1: ModelLoader Enhancements

### Enhanced Result Interface

```typescript
// Current (limited)
export interface ModelLoadResult {
  root: TransformNode;
  meshes: Mesh[];
}

// Enhanced (production-ready)
export interface ModelLoadResult {
  root: TransformNode;
  meshes: Mesh[];
  animationGroups: AnimationGroup[];  // NEW: All animations from model
  skeletons: Skeleton[];              // NEW: For skinned/rigged meshes
}
```

### Animation Helper Methods

Add to `ModelLoader` class:

```typescript
/**
 * Play an animation on a loaded model
 * @param result - The ModelLoadResult from loadModel()
 * @param name - Animation name or index
 * @param options - Playback options
 */
public playAnimation(
  result: ModelLoadResult,
  name: string | number,
  options?: {
    loop?: boolean;      // Default: true
    speed?: number;      // Default: 1.0
    from?: number;       // Start frame
    to?: number;         // End frame
  }
): AnimationGroup | null;

/**
 * Stop an animation
 */
public stopAnimation(
  result: ModelLoadResult,
  name?: string | number  // If omitted, stops all
): void;

/**
 * Get list of animation names
 */
public getAnimationNames(result: ModelLoadResult): string[];

/**
 * Check if model has animations
 */
public hasAnimations(result: ModelLoadResult): boolean;
```

### Production Game Usage Example

```typescript
// Spawn enemy with idle animation
const enemy = await modelLoader.loadModel("/games/default/models/zombie.glb", {
  position: spawnPoint,
  scale: 1.5,
});
modelLoader.playAnimation(enemy, "Idle", { loop: true });

// On player detection - switch to attack animation
modelLoader.stopAnimation(enemy, "Idle");
modelLoader.playAnimation(enemy, "Attack", { loop: false });

// On attack complete - back to idle
modelLoader.playAnimation(enemy, "Idle", { loop: true });
```

### Required Babylon.js Imports

```typescript
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
```

## Part 2: SpawnModel Command

### Command Specification

#### Syntax

```
spawnmodel <model> [scale] [x y z] [angle]
```

#### Arguments

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `model` | string | Yes | - | Model filename (with or without extension) |
| `scale` | number | No | 1.0 | Uniform scale multiplier (0.01 - 100.0) |
| `x y z` | numbers | No | Camera front | World position (Babylon coords) |
| `angle` | number | No | 0 | Y-axis rotation in degrees |

#### Examples

```bash
# Spawn model at camera position, default scale
spawnmodel car

# Spawn model with scale
spawnmodel car.glb 0.5

# Spawn model at position with scale
spawnmodel car 2.0 100 0 50

# Spawn model with position and rotation
spawnmodel car 1.0 100 0 50 45
```

#### Developer Mode Requirement

Command is only available when `developer 1` is set. Uses `developer: true` flag in CommandDef.

### Subcommands

#### `spawnmodel list`

List available model files in the game directory:

```
spawnmodel list

Available models:
  car.glb (123 KB)
  barrel.glb (45 KB)
  models/zombie.glb (234 KB) - 3 animations
```

#### `spawnmodel clear`

Remove all models spawned via this command:

```
spawnmodel clear

Cleared 3 spawned models
```

#### `spawnmodel info <model|index>`

Show detailed information about a model or spawned instance:

```
spawnmodel info car

Model: car.glb
  Path: /games/default/car.glb
  Meshes: 3 (body, wheel_fl, wheel_fr, wheel_rl, wheel_rr)
  Triangles: 12,450
  Materials: 2 (car_body_mat, wheel_mat)
  Bounding box: (-2.1, 0, -4.5) to (2.1, 1.8, 4.5)
  Animations: 2
    [0] "Idle" - 2.5s, loop
    [1] "Drive" - 1.0s, loop
  Skeletons: 0
```

For spawned instances (by index):

```
spawnmodel info 0

Spawned model #0: car.glb
  Position: (100, 0, 50)
  Rotation: 45 degrees
  Scale: 2.0
  Playing: "Idle" (looping)
```

#### `spawnmodel anim <index> <animation> [loop|once|stop]`

Control animation on a spawned model:

```bash
# Play animation (loops by default)
spawnmodel anim 0 Drive

# Play animation once
spawnmodel anim 0 Attack once

# Loop animation explicitly
spawnmodel anim 0 Idle loop

# Stop animation
spawnmodel anim 0 stop

# Stop specific animation
spawnmodel anim 0 Drive stop
```

#### `spawnmodel rotate <index> <angle>`

Rotate a spawned model:

```bash
# Set absolute rotation (degrees)
spawnmodel rotate 0 90

# Rotate relative (prefix with + or -)
spawnmodel rotate 0 +45
spawnmodel rotate 0 -30
```

#### `spawnmodel move <index> <x y z>`

Move a spawned model:

```bash
# Set absolute position
spawnmodel move 0 100 0 50

# Move relative (prefix any axis with + or -)
spawnmodel move 0 +10 0 0
```

#### `spawnmodel scale <index> <scale>`

Change scale of spawned model:

```bash
spawnmodel scale 0 2.0
```

#### `spawnmodel remove <index>`

Remove a specific spawned model:

```bash
spawnmodel remove 0
```

### Command Structure

```typescript
export default class SpawnModelCommand extends Command {
  readonly definition: CommandDef = {
    name: 'spawnmodel',
    aliases: ['sm'],
    description: 'Spawn and manipulate 3D models for testing',
    usage: 'spawnmodel <model> [scale] [x y z] [angle]',
    developer: true,
    subcommands: [
      { name: 'list', description: 'List available models' },
      { name: 'clear', description: 'Remove all spawned models' },
      { name: 'info', description: 'Show model or instance info', args: [{ name: 'model|index', type: 'string', required: true }] },
      { name: 'anim', description: 'Control animation', args: [{ name: 'index', type: 'number', required: true }, { name: 'animation', type: 'string', required: true }, { name: 'mode', type: 'enum', options: ['loop', 'once', 'stop'] }] },
      { name: 'rotate', description: 'Rotate spawned model', args: [{ name: 'index', type: 'number', required: true }, { name: 'angle', type: 'string', required: true }] },
      { name: 'move', description: 'Move spawned model', args: [{ name: 'index', type: 'number', required: true }, { name: 'x', type: 'number', required: true }, { name: 'y', type: 'number', required: true }, { name: 'z', type: 'number', required: true }] },
      { name: 'scale', description: 'Scale spawned model', args: [{ name: 'index', type: 'number', required: true }, { name: 'scale', type: 'number', required: true }] },
      { name: 'remove', description: 'Remove specific model', args: [{ name: 'index', type: 'number', required: true }] },
    ],
  };

  private spawnedModels: SpawnedModel[] = [];

  async execute(args: string[]): Promise<string | void> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'list': return this.listModels();
      case 'clear': return this.clearSpawned();
      case 'info': return this.showInfo(args.slice(1));
      case 'anim': return this.controlAnimation(args.slice(1));
      case 'rotate': return this.rotateModel(args.slice(1));
      case 'move': return this.moveModel(args.slice(1));
      case 'scale': return this.scaleModel(args.slice(1));
      case 'remove': return this.removeModel(args.slice(1));
      default: return this.spawnModel(args);
    }
  }

  getCompletions(input: string, args: string[]): string[] {
    // Return list of available model files for first arg
    // Return animation names for anim subcommand
  }
}

interface SpawnedModel {
  result: ModelLoadResult;  // Full result with animations
  path: string;             // Original model path
  spawnIndex: number;       // For reference
}
```

## Model Discovery

### Search Paths

Models are searched in the following order:

1. **Exact path** - If argument contains `/`, treat as relative path from game root
2. **Game root** - `GamePaths.game(<model>)`
3. **Models subdirectory** - `GamePaths.game('models/<model>')`

### Supported Formats

Per `ModelLoader.isModelFile()`:
- `.glb` (preferred - binary glTF)
- `.gltf` (JSON glTF)
- `.obj` (Wavefront)
- `.babylon` (Babylon.js native)

### Extension Handling

If no extension provided, try in order:
1. `<model>.glb`
2. `<model>.gltf`
3. `<model>` (as-is)

## Position Calculation

### Default: In Front of Camera

When no position specified, spawn model in front of the active camera:

```typescript
// Get camera position and direction
const camera = CameraSystem.getInstance().getCamera();
const cameraPos = camera.position.clone();

// For FreeCamera: use forward direction
// For ArcRotateCamera: direction from camera to target
const forward = camera.getDirection(Vector3.Forward());

// Spawn 5 units in front of camera
const spawnDistance = 5;
const spawnPos = cameraPos.add(forward.scale(spawnDistance));
```

### Explicit Position

When `x y z` coordinates provided, use directly as Babylon.js world coordinates.

## Scale Handling

### Scale Parameter

- **Range**: 0.01 to 100.0 (clamped)
- **Default**: 1.0 (original model size)
- **Type**: Uniform scale (same on X, Y, Z)

### Design Decision: Absolute vs Relative

**Chosen: Absolute multiplier** (not 0.0-1.0 normalized)

Rationale:
- Models come in various original sizes (some huge, some tiny)
- A 0.0-1.0 range would require knowing the model's original size
- Absolute multiplier is more intuitive: 0.5 = half size, 2.0 = double size
- Matches Babylon.js scaling convention

## Implementation Plan

### Phase 1: ModelLoader Enhancement

1. Update `ModelLoadResult` interface to include `animationGroups` and `skeletons`
2. Modify `loadModel()` to capture and return animation data from `SceneLoader.ImportMeshAsync`
3. Add animation helper methods (`playAnimation`, `stopAnimation`, `getAnimationNames`)
4. Update any existing code that uses `ModelLoadResult`

**Files to modify:**
- `src/engine/loader/model/ModelLoader.ts`

### Phase 2: Core SpawnModel Command

1. Create `SpawnModelCommand.ts` in `src/engine/console/commands/`
2. Implement basic spawn with position, scale, angle
3. Track spawned models for later manipulation
4. Register command in DebugConsole

**Files to create:**
- `src/engine/console/commands/SpawnModelCommand.ts`

**Files to modify:**
- `src/engine/debug/DebugConsole.ts` (register command)

### Phase 3: Subcommands

1. Implement `list` - scan game directory for model files
2. Implement `clear` - dispose all tracked models
3. Implement `info` - show model/instance details
4. Implement `remove` - dispose specific model

### Phase 4: Animation Control

1. Implement `anim` subcommand
2. Wire up to ModelLoader animation helpers
3. Track current animation state per spawned model

### Phase 5: Transform Manipulation

1. Implement `rotate` subcommand (absolute and relative)
2. Implement `move` subcommand (absolute and relative)
3. Implement `scale` subcommand

### Phase 6: Autocomplete

1. Implement `getCompletions()` for model files
2. Add completion for animation names in `anim` subcommand
3. Cache file list for performance

## Error Handling

| Error | Message |
|-------|---------|
| No model specified | `"Usage: spawnmodel <model> [scale] [x y z] [angle]"` |
| Model not found | `"Model not found: <path>. Use 'spawnmodel list' to see available models."` |
| Invalid scale | `"Scale must be a number between 0.01 and 100"` |
| Invalid position | `"Position must be 3 numbers: x y z"` |
| Invalid index | `"No spawned model at index <n>. Use 'spawnmodel list' to see spawned models."` |
| Animation not found | `"Animation '<name>' not found. Available: Idle, Walk, Run"` |
| No animations | `"Model has no animations"` |
| ModelLoader not initialized | `"ModelLoader not available"` |
| No active camera | `"No active camera for position calculation"` |

## Testing Plan

### Headless Testing

```bash
# Test command registration (developer mode)
npm run cli:game -- --command "developer 1; help spawnmodel; quit"

# Test ModelLoader animation methods exist
npm run cli:game -- --command "developer 1; spawnmodel list; quit"
```

### Browser Testing

1. Enable developer mode: `developer 1`
2. Load a map: `map wdm7`
3. Test spawning: `spawnmodel car`
4. Test with scale: `spawnmodel car 0.5`
5. Test with position: `spawnmodel car 1 0 100 0`
6. Test with rotation: `spawnmodel car 1 0 100 0 45`
7. Test listing: `spawnmodel list`
8. Test info: `spawnmodel info car`
9. Test animation: `spawnmodel anim 0 Idle loop`
10. Test transform: `spawnmodel rotate 0 +45`
11. Test cleanup: `spawnmodel clear`

## Future Enhancements

### Potential Extensions

1. **Named instances**: `spawnmodel car as mycar` for reference by name
2. **Shadow casting**: `spawnmodel car --shadow` to add to shadow generator
3. **Collision toggle**: `spawnmodel car --collision` to enable collision
4. **Hot reload**: Watch model file for changes, auto-reload
5. **Prefab creation**: Save spawned model position/scale/rotation as prefab
6. **Scene export**: Export all spawned models as scene file
7. **Animation blending**: Crossfade between animations
8. **Animation speed**: `spawnmodel anim 0 Run speed 2.0`

### Console Scripting Examples

```bash
# Cutscene script
spawnmodel npc 1 0 0 0; spawnmodel anim 0 WaveHello once
# Wait for animation...
spawnmodel anim 0 Walk loop; spawnmodel move 0 +50 0 0

# Spawn wave of enemies
spawnmodel zombie 1 -10 0 0; spawnmodel zombie 1 0 0 0; spawnmodel zombie 1 10 0 0
spawnmodel anim 0 Idle loop; spawnmodel anim 1 Idle loop; spawnmodel anim 2 Idle loop
```

## Dependencies

### Required Imports (ModelLoader)

```typescript
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
```

### Required Imports (SpawnModelCommand)

```typescript
import { Command, CommandDef } from '../Command';
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
```

### Dynamic Imports (in execute)

```typescript
const { ModelLoader } = await import('../../loader/model/ModelLoader');
const { CameraSystem } = await import('../../camera/CameraSystem');
const { GamePaths } = await import('../../core/GamePaths');
```

## File Locations

| Component | Path |
|-----------|------|
| SpawnModelCommand | `src/engine/console/commands/SpawnModelCommand.ts` |
| ModelLoader | `src/engine/loader/model/ModelLoader.ts` |
| CameraSystem | `src/engine/camera/CameraSystem.ts` |
| GamePaths | `src/engine/core/GamePaths.ts` |
| Command base | `src/engine/console/Command.ts` |
| DebugConsole | `src/engine/debug/DebugConsole.ts` |

## References

- Existing SpawnCommand: `src/engine/console/commands/SpawnCommand.ts`
- ModelLoader API: `src/engine/loader/model/ModelLoader.ts`
- Command system: `docs/research/console-architecture.md`
- Babylon.js AnimationGroup: https://doc.babylonjs.com/typedoc/classes/BABYLON.AnimationGroup
- Babylon.js SceneLoader: https://doc.babylonjs.com/typedoc/classes/BABYLON.SceneLoader
