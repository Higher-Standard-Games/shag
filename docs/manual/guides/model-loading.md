# Model Loading System

Load and display glTF/GLB 3D models in your game scenes.

## Overview

The engine supports loading standard glTF 2.0 models (`.glb` and `.gltf` files) through the `ModelLoader` system. Models can be:

- Spawned interactively via the `spawnmodel` console command
- Loaded programmatically via the `ModelLoader` API
- Used for game entities, props, characters, and more

## Console Command: spawnmodel

The `spawnmodel` command is a developer tool for testing models in-game.

### Enable Developer Mode

```
developer 1
```

### Basic Spawning

```
spawnmodel <model> [scale=100] [x y z] [angle]
```

| Argument | Description | Default |
|----------|-------------|---------|
| `model` | Model filename (with or without `.glb`) | Required |
| `scale` | Uniform scale factor | 100 |
| `x y z` | World position | Camera front |
| `angle` | Y-axis rotation in degrees | 0 |

### Examples

```bash
# Spawn at camera position with default scale
spawnmodel <model>

# Spawn with custom scale
spawnmodel <model> 50

# Spawn at specific position
spawnmodel <model> 100 0 100 0

# Spawn with position and rotation
spawnmodel <model> 100 0 100 0 45
```

### Subcommands

#### List Spawned Models
```
spawnmodel list
```

#### Get Model Info
```
spawnmodel info <index>
```
Shows position, rotation, scale, mesh count, and available animations.

#### Clear All Models
```
spawnmodel clear
```

#### Remove Specific Model
```
spawnmodel remove <index>
```

### Transform Manipulation

```bash
# Rotate (absolute degrees)
spawnmodel rotate 0 90

# Rotate (relative)
spawnmodel rotate 0 +45
spawnmodel rotate 0 -30

# Move (absolute position)
spawnmodel move 0 100 50 200

# Move (relative)
spawnmodel move 0 +10 0 0

# Scale
spawnmodel scale 0 150
```

### Animation Control

```bash
# Play animation (loops by default)
spawnmodel anim 0 Idle

# Play animation once
spawnmodel anim 0 Attack once

# Stop all animations
spawnmodel anim 0 stop
```

## Programmatic API: ModelLoader

For game code, use `ModelLoader` directly:

```typescript
import { ModelLoader } from './engine/loader/model/ModelLoader';
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Get singleton instance
const loader = ModelLoader.getInstance();

// Load a model
const result = await loader.loadModel('/games/default/mymodel.glb', {
  position: new Vector3(0, 0, 0),
  scale: 100,
  angle: 45,
  hasCollision: false,
  receiveShadows: true,
  castShadows: false,
});

if (result) {
  console.log(`Loaded ${result.meshes.length} meshes`);
  console.log(`Animations: ${result.animationGroups.map(a => a.name)}`);
}
```

### ModelLoadResult

```typescript
interface ModelLoadResult {
  root: TransformNode;        // Root transform node
  meshes: Mesh[];             // All meshes in the model
  animationGroups: AnimationGroup[];  // Available animations
  skeletons: Skeleton[];      // Skeletons for rigged models
}
```

### Animation Helpers

```typescript
// Play animation
loader.playAnimation(result, 'Idle', { loop: true, speed: 1.0 });

// Stop animation
loader.stopAnimation(result, 'Idle');
loader.stopAnimation(result);  // Stop all

// Get animation names
const names = loader.getAnimationNames(result);

// Check if model has animations
if (loader.hasAnimations(result)) {
  // ...
}

// Get animation info
const info = loader.getAnimationInfo(result, 'Idle');
// { name, from, to, isPlaying, speedRatio }
```

## Scale and Units

**Important:** glTF models are typically authored in meters, while BSP/Quake maps use much smaller units (roughly 1 unit = 1 inch).

| Scale | Effect |
|-------|--------|
| 1 | Raw glTF size (usually tiny in BSP world) |
| 40 | Accurate meter-to-inch conversion |
| 100 | Default, good for most models |
| 200+ | For very small source models |

The default scale of 100 works well for most standard glTF models in BSP environments.

## Model Placement

### Game Directory

Place models in your game's public directory:

```
public/
└── games/
    └── <gamename>/
        ├── mymodel.glb
        ├── models/
        │   ├── character.glb
        │   └── props/
        │       └── barrel.glb
```

### Path Resolution

The `spawnmodel` command searches in order:
1. Game root: `/games/<gamename>/<model>.glb`
2. Models subdirectory: `/games/<gamename>/models/<model>.glb`

```bash
spawnmodel mymodel              # Finds /games/default/mymodel.glb
spawnmodel props/barrel         # Finds /games/default/props/barrel.glb
```

## Best Practices

1. **Use GLB format** - Binary glTF is more efficient than JSON glTF
2. **Optimize models** - Use Draco compression for large models
3. **Test scale first** - Use `spawnmodel` to find the right scale before coding
4. **Dispose when done** - Call `result.root.dispose()` to clean up

## Troubleshooting

### Model appears tiny
Increase scale (default 100, try 200-500).

### Model doesn't appear
Check browser console for loading errors. Verify file path is correct.

### "Unexpected magic" error
The GLB file may be corrupted or the path is returning a 404 HTML page.

### Model moves with camera
This was a bug in earlier versions. Update to latest and ensure `ModelLoader` is properly initialized with the scene.

## BSP LightGrid Integration

When a model is spawned, it automatically receives lighting from the BSP lightgrid:

- **Ambient light** - Base illumination sampled from the lightgrid
- **Directional light** - A per-model DirectionalLight created from lightgrid data
- **Trilinear interpolation** - Smooth lighting transitions between grid points

### How It Works

1. Model position is converted to Q3 coordinate space
2. Lightgrid is sampled with trilinear interpolation
3. Ambient color is applied to material `ambientColor`
4. A DirectionalLight is created with `includedOnlyMeshes` set to only this model
5. Light direction is decoded from Q3's spherical (lat/long) format

### Refresh Lighting

If you move a model significantly, refresh its lighting:

```bash
spawnmodel lighting <index>
```

### Debug Lightgrid

Visualize lightgrid data around your position:

```bash
bsp debug_grid        # Spawn debug spheres
bsp debug_grid clear  # Remove debug spheres
bsp lightgrid         # Show values at camera position
```

### Fallback Lighting

If no BSP is loaded or the map lacks lightgrid data, models receive fallback lighting:
- Neutral gray ambient (0.3, 0.3, 0.3)
- Warm directional light angled downward

## See Also

- [Command Reference](./command-reference.md) - Full console command reference
- [BSP System](./bsp-system.md) - Loading Quake 3 maps
