# Camera System

How the camera system works in SHAG Engine.

## Overview

The camera system provides multiple camera controllers for different game types, with runtime switching via console commands.

## Architecture

```
CameraSystem (Singleton)
    │
    ├── currentCamera (Babylon.js Camera)
    │
    └── controllers/
        ├── FreeflyController
        ├── IsometricController
        ├── SidescrollController
        └── FollowController
```

## Using CameraSystem

```typescript
import { CameraSystem } from './engine/camera/CameraSystem';

const cameraSystem = CameraSystem.getInstance();

// Initialize with scene
cameraSystem.init(scene);

// Set controller
cameraSystem.setController('freefly');
cameraSystem.setController('isometric');

// Get current camera
const camera = cameraSystem.getCamera();

// Set height
cameraSystem.setHeight(500);
```

## Controllers

### FPSController

Full first-person shooter controller with physics, weapons, and advanced movement. The primary controller for gameplay.

**Features:**

- Full Q3/Warsow physics (gravity, jumping, sliding)
- Weapon system integration (viewmodels, firing, reload, ADS)
- Advanced movement: crouchslide, wall jump, ledge grab
- Viewport effects integration (walk bob, landing impact)
- Collision via CollisionManager

**Controls:**

- WASD - Movement
- Mouse - Look
- Space - Jump (wall jump when airborne)
- Ctrl - Crouch (slide when sprinting)
- Shift - Sprint
- Mouse1 - Fire
- Mouse2 - ADS (Aim Down Sights)
- R - Reload
- 1-9 - Weapon slots
- Q - Quick switch

**Key Methods:**

```typescript
controller.getPlayerPosition()       // Origin position (Q3-style)
controller.getPlayerFeetPosition()   // Feet position
controller.setPosition(pos)          // Teleport to origin
controller.getCurrentHeight()        // 56 or 36 (crouched)
controller.getCrouchState()          // {isCrouching, isSliding, height}
```

**Console:**

```
spectator 0           # Enable physics mode
spectator 1           # Noclip/fly mode
sv_gravity 1000       # Gravity strength
sv_jumpheight 320     # Jump velocity
```

### FreeflyController

FPS-style first-person camera with optional collision.

**Controls:**

- WASD - Movement
- Mouse - Look
- Space/Shift - Up/Down
- Scroll - Speed

**Console:**

```
camera controller freefly
freefly_speed 2.0
freefly_collision 1
```

### IsometricController

Top-down camera for strategy/RPG games.

**Features:**

- Fixed angle view
- Pan with WASD or edge scroll
- Zoom with scroll wheel

**Console:**

```
camera controller isometric
camera height 800
```

### SidescrollController

2.5D camera for platformers.

**Features:**

- Horizontal tracking
- Fixed depth position
- Vertical follow

**Console:**

```
camera controller sidescroll
```

### FollowController

Third-person camera that tracks a target.

**Features:**

- Smooth following
- Orbit controls
- Collision avoidance

**Console:**

```
camera controller follow
```

## Camera Modes

Two projection modes available:

```typescript
cameraSystem.setMode('perspective');   // 3D perspective
cameraSystem.setMode('orthographic');  // True orthographic
```

**Console:**

```
camera mode perspective
camera mode orthographic
```

## Creating Custom Controllers

Implement the `ICameraController` interface:

```typescript
import { ICameraController } from './engine/camera/ICameraController';

class CinematicController implements ICameraController {
  name = 'cinematic';
  
  attach(camera: Camera): void {
    // Setup controls
  }
  
  detach(): void {
    // Cleanup
  }
  
  update(deltaTime: number): void {
    // Per-frame logic
  }
}

// Register
cameraSystem.registerController(new CinematicController());
```

## Spawning at Map Locations

After loading a map, spawn camera at a player start:

```typescript
const spawns = entities.filter(e => 
  e.classname === 'info_player_deathmatch'
);

if (spawns.length > 0) {
  const spawn = spawns[0];
  const pos = parseOrigin(spawn.origin);
  camera.position = new Vector3(pos.x, pos.y + 50, pos.z);
}
```

## Console Commands

| Command | Description |
|---------|-------------|
| `camera controller <name>` | Switch controller |
| `camera mode <mode>` | Perspective/orthographic |
| `camera height <n>` | Set camera height |
| `camera target <x> <y> <z>` | Look at position |
| `freefly_speed <n>` | Movement speed |
| `freefly_collision <0/1>` | Toggle collision |

## Network Integration

In multiplayer, FPS/Freefly camera integrates with the networking stack:

- **Prediction:** FPSController applies predicted movement instantly for responsive camera
- **Reconciliation:** `visualOffset` absorbs server corrections via exponential decay (~50ms)
- **Remote players:** Interpolated via `SnapshotBuffer`, camera position is not affected
- **processSnapshots():** Called each frame to apply server state while preserving visual smoothness

See [Networking System](./networking.md) for details.

## Viewport Effects Integration

The `ViewportEffectsManager` processes camera effects each frame via the FPSController:

1. Controller gathers `PlayerState` (speed, grounded, jumping, direction)
2. Each effect produces a `ViewportDelta` (position offset, rotation offset, FOV change, `bobCycle`)
3. Deltas are accumulated and applied to the camera
4. `bobCycle` syncs weapon bob with walk bob for visual coherence

Effects: WalkBob, LandingImpact, SpeedFOV, StrafeLean, IdleBreathing, DamageFlash.

See [Viewport Effects](./viewport-effects.md) for details.

## Related

- [Movement System](./movement-system.md) - Physics integration
- [Viewport Effects](./viewport-effects.md) - Camera effects pipeline
- [Networking System](./networking.md) - Prediction and reconciliation
- [Tutorial: Camera Navigation](../tutorials/beginner/camera-navigation.md)
- [Tutorial: Custom Camera Controller](../tutorials/advanced/custom-camera.md)
