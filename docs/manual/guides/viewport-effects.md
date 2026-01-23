# Viewport Effects System

The SHAG Engine viewport effects system provides modular camera and view effects like walk bob, landing impact, speed FOV, and strafe lean.

## Architecture

```
ViewportEffectsManager (Singleton)
    ├── effects: Map<string, ViewportEffect>
    ├── update(dt, playerState) → ViewportDelta
    └── trigger(event, data)
    
ViewportDelta
    ├── positionOffset: Vector3
    ├── rotationOffset: {pitch, yaw, roll}
    ├── fovMultiplier: number
    └── shakeIntensity: number
```

## Quick Start

```typescript
import { ViewportEffectsManager } from '@/engine/viewport';
import { WalkBobEffect } from '@/engine/viewport/effects';

const manager = ViewportEffectsManager.getInstance();
manager.init();

// Register built-in effects
manager.registerEffect(new WalkBobEffect());

// Each frame
const delta = manager.update(deltaTime, playerState);
applicator.apply(delta, camera, baseFOV);
```

## Built-in Effects

| Effect | Description | CVar |
|--------|-------------|------|
| `WalkBobEffect` | View bob while moving | `cl_bobbing` |
| `LandingImpactEffect` | Camera punch on landing | - |
| `SpeedFOVEffect` | FOV increase at high speed | - |
| `StrafeLeanEffect` | Camera roll on strafe | - |
| `IdleBreathingEffect` | Subtle idle movement | - |

## Player State

```typescript
interface PlayerState {
  position: Vector3;
  velocity: Vector3;
  speed: number;         // Horizontal speed
  isGrounded: boolean;
  isMoving: boolean;
  isSprinting: boolean;
  isCrouching: boolean;
  isSliding: boolean;
  isAiming: boolean;     // ADS
  lookDirection: Vector3;
}
```

## ViewportDelta

The output of each effect, combined additively:

```typescript
interface ViewportDelta {
  // Position offset (local space)
  positionOffset: { x: number; y: number; z: number };
  
  // Rotation offset (degrees)
  rotationOffset: { pitch: number; yaw: number; roll: number };
  
  // FOV multiplier (1.0 = no change)
  fovMultiplier: number;
  
  // Shake (0 = none, 1 = max)
  shakeIntensity: number;
}
```

## Creating Custom Effects

```typescript
import type { ViewportEffect } from '@/engine/viewport/ViewportEffect';

class MyEffect implements ViewportEffect {
  name = 'my-effect';
  enabled = true;
  
  update(dt: number, state: PlayerState): ViewportDelta {
    return {
      positionOffset: { x: 0, y: 0, z: 0 },
      rotationOffset: { pitch: 0, yaw: 0, roll: 0 },
      fovMultiplier: 1.0,
      shakeIntensity: 0,
    };
  }
  
  reset(): void { }
  
  // Optional: respond to events
  trigger?(event: string, data: unknown): void {
    if (event === 'viewport:shake') {
      // Handle shake event
    }
  }
  
  dispose?(): void { }
}
```

## EventBus Integration

Effects can respond to events:

```typescript
EventBus.emit('viewport:shake', { intensity: 0.5, duration: 0.3 });
EventBus.emit('viewport:landing', { impactVelocity: 500 });
```

Supported events:
- `viewport:shake` - Screen shake
- `viewport:punch` - View punch (recoil)
- `viewport:zoom` - FOV change
- `viewport:roll` - Camera roll
- `viewport:landing` - Landing impact

## Console Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `cl_vieweffects` | 1 | Master toggle for all effects |
| `cl_bobbing` | 0 | Enable walk bob |
| `cl_ads_time` | 0.08 | ADS transition time |
| `cl_ads_fov_reduction` | 15 | ADS FOV reduction (%) |

## Easing Functions

`@/engine/viewport/Easing.ts` provides:

- `linear(t)`
- `easeInQuad(t)`, `easeOutQuad(t)`, `easeInOutQuad(t)`
- `easeInCubic(t)`, `easeOutCubic(t)`, `easeInOutCubic(t)`
- `easeInElastic(t)`, `easeOutElastic(t)`
- `smoothstep(t)`, `smootherstep(t)`

## See Also

- [Camera System](./camera-system.md) - Camera controllers
- [Movement System](./movement-system.md) - Player movement
