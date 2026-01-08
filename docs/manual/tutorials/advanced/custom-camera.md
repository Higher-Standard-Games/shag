# Building a Custom Camera Controller

**Time:** 45 minutes  
**Level:** Advanced

Create your own camera controller for unique gameplay.

## Prerequisites

- [Guide: Camera System](../../guides/camera-system.md)
- Understanding of Babylon.js cameras

## The ICameraController Interface

All camera controllers implement this interface:

```typescript
interface ICameraController {
  name: string;
  
  attach(camera: Camera): void;
  detach(): void;
  update(deltaTime: number): void;
}
```

## Example: Cinematic Camera

A camera that follows a spline path:

```typescript
// src/engine/camera/controllers/CinematicController.ts
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ICameraController } from '../ICameraController';

export class CinematicController implements ICameraController {
  name = 'cinematic';
  
  private camera: Camera | null = null;
  private path: Vector3[] = [];
  private lookAt: Vector3[] = [];
  private progress = 0;
  private speed = 0.1;
  private isPlaying = false;
  
  setPath(positions: Vector3[], targets: Vector3[]) {
    this.path = positions;
    this.lookAt = targets;
    this.progress = 0;
  }
  
  play() {
    this.isPlaying = true;
    this.progress = 0;
  }
  
  stop() {
    this.isPlaying = false;
  }
  
  attach(camera: Camera): void {
    this.camera = camera;
  }
  
  detach(): void {
    this.camera = null;
    this.isPlaying = false;
  }
  
  update(deltaTime: number): void {
    if (!this.camera || !this.isPlaying || this.path.length < 2) return;
    
    // Advance along path
    this.progress += deltaTime * this.speed;
    
    if (this.progress >= 1) {
      this.progress = 1;
      this.isPlaying = false;
    }
    
    // Interpolate position
    const pos = this.interpolatePath(this.path, this.progress);
    this.camera.position.copyFrom(pos);
    
    // Interpolate look target
    if (this.lookAt.length >= 2) {
      const target = this.interpolatePath(this.lookAt, this.progress);
      (this.camera as any).setTarget?.(target);
    }
  }
  
  private interpolatePath(points: Vector3[], t: number): Vector3 {
    const segments = points.length - 1;
    const segment = Math.min(Math.floor(t * segments), segments - 1);
    const localT = (t * segments) - segment;
    
    return Vector3.Lerp(points[segment], points[segment + 1], localT);
  }
}
```

## Registering the Controller

```typescript
import { CameraSystem } from '../../engine/camera/CameraSystem';
import { CinematicController } from './CinematicController';

const cameraSystem = CameraSystem.getInstance();
const cinematicController = new CinematicController();

cameraSystem.registerController(cinematicController);

// Setup path
cinematicController.setPath(
  [
    new Vector3(0, 100, -500),
    new Vector3(200, 150, -300),
    new Vector3(400, 100, 0),
  ],
  [
    new Vector3(0, 50, 0),
    new Vector3(100, 50, 0),
    new Vector3(200, 50, 0),
  ]
);

// Switch to cinematic
cameraSystem.setController('cinematic');
cinematicController.play();
```

## Example: Orbit Camera

Camera that orbits a target:

```typescript
export class OrbitController implements ICameraController {
  name = 'orbit';
  
  private camera: Camera | null = null;
  private target = Vector3.Zero();
  private radius = 200;
  private angle = 0;
  private height = 100;
  private autoRotate = true;
  private rotateSpeed = 0.5;
  
  setTarget(target: Vector3, radius: number = 200) {
    this.target = target;
    this.radius = radius;
  }
  
  attach(camera: Camera): void {
    this.camera = camera;
  }
  
  detach(): void {
    this.camera = null;
  }
  
  update(deltaTime: number): void {
    if (!this.camera) return;
    
    if (this.autoRotate) {
      this.angle += deltaTime * this.rotateSpeed;
    }
    
    // Calculate orbit position
    const x = this.target.x + Math.cos(this.angle) * this.radius;
    const z = this.target.z + Math.sin(this.angle) * this.radius;
    const y = this.target.y + this.height;
    
    this.camera.position.set(x, y, z);
    (this.camera as any).setTarget?.(this.target);
  }
}
```

## Adding Console Commands

```typescript
import { ConsoleCommandRegistry } from '../../engine/debug/ConsoleCommandRegistry';

const registry = ConsoleCommandRegistry.getInstance();

registry.registerCommand({
  name: 'cinematic',
  description: 'Control cinematic camera',
  execute: (args) => {
    const sub = args[0];
    
    switch (sub) {
      case 'play':
        cinematicController.play();
        return 'Playing cinematic';
      case 'stop':
        cinematicController.stop();
        return 'Stopped cinematic';
      case 'speed':
        const speed = parseFloat(args[1]);
        if (!isNaN(speed)) {
          cinematicController.speed = speed;
          return `Speed set to ${speed}`;
        }
        return 'Usage: cinematic speed <value>';
      default:
        return 'Subcommands: play, stop, speed';
    }
  }
});
```

## Tips

1. **Store references carefully** - Clean up in `detach()`
2. **Use deltaTime** - Frame-rate independent movement
3. **Smooth transitions** - Use lerp for smooth camera motion
4. **Add input handling** - Consider keyboard/mouse in `update()`
5. **Test edge cases** - What happens at path end?

## Next Steps

- [Custom Shader Materials](./custom-shaders.md)
- [Guide: Camera System](../../guides/camera-system.md)
