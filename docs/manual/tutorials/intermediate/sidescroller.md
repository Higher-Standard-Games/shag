# Sidescroller Setup

**Time:** 30 minutes  
**Level:** Intermediate

Set up a 2.5D sidescroller camera for platformers.

## What We'll Build

- Fixed-depth camera
- Horizontal character tracking
- Jump-friendly vertical follow
- Parallax-ready setup

## Prerequisites

- [Camera Navigation](../beginner/camera-navigation.md)
- Basic TypeScript knowledge

## Step 1: Switch to Sidescroll Camera

```typescript
import { CameraSystem } from '../../engine/camera/CameraSystem';

const cameraSystem = CameraSystem.getInstance();
cameraSystem.init(scene);

// Switch to sidescroll controller
cameraSystem.setController('sidescroll');
```

Or via console:

```
camera controller sidescroll
```

## Step 2: Configure Camera Position

The sidescroll camera maintains a fixed Z-depth:

```typescript
const camera = cameraSystem.getCamera();

// Set camera distance from action plane
camera.position.z = -500; // Negative Z = looking toward +Z

// Set vertical offset
camera.position.y = 100;
```

## Step 3: Character Tracking

Create a simple follow system:

```typescript
class SidescrollFollower {
  private camera: Camera;
  private target: Mesh | null = null;
  private offsetY = 50;
  private smoothing = 0.1;
  
  constructor(camera: Camera) {
    this.camera = camera;
  }
  
  setTarget(mesh: Mesh) {
    this.target = mesh;
  }
  
  update() {
    if (!this.target) return;
    
    // Smooth horizontal follow
    const targetX = this.target.position.x;
    this.camera.position.x += (targetX - this.camera.position.x) * this.smoothing;
    
    // Vertical follow with offset
    const targetY = this.target.position.y + this.offsetY;
    this.camera.position.y += (targetY - this.camera.position.y) * this.smoothing;
  }
}
```

## Step 4: Camera Bounds

Limit camera to level boundaries:

```typescript
class BoundedCamera {
  minX = -1000;
  maxX = 1000;
  minY = 0;
  maxY = 500;
  
  clamp(camera: Camera) {
    camera.position.x = Math.max(this.minX, Math.min(this.maxX, camera.position.x));
    camera.position.y = Math.max(this.minY, Math.min(this.maxY, camera.position.y));
  }
}
```

## Step 5: Look-Ahead

Add look-ahead based on movement direction:

```typescript
class LookAheadCamera {
  private lookAhead = 100;
  private direction = 1; // 1 = right, -1 = left
  
  setDirection(dir: number) {
    this.direction = Math.sign(dir) || this.direction;
  }
  
  getOffset(): number {
    return this.lookAhead * this.direction;
  }
  
  update(camera: Camera, targetX: number) {
    const goalX = targetX + this.getOffset();
    camera.position.x += (goalX - camera.position.x) * 0.05;
  }
}
```

## Step 6: Vertical Zones

Only follow vertically in certain zones:

```typescript
class VerticalZoneCamera {
  private deadZoneTop = 100;
  private deadZoneBottom = 100;
  
  update(camera: Camera, targetY: number) {
    const screenY = targetY - camera.position.y;
    
    if (screenY > this.deadZoneTop) {
      camera.position.y = targetY - this.deadZoneTop;
    } else if (screenY < -this.deadZoneBottom) {
      camera.position.y = targetY + this.deadZoneBottom;
    }
  }
}
```

## Complete Example

```typescript
async function setupSidescroller(scene: Scene) {
  // Load map
  const mapLoader = new MapLoader(scene);
  await mapLoader.load('wdm7');
  
  // Setup camera
  const cameraSystem = CameraSystem.getInstance();
  cameraSystem.init(scene);
  cameraSystem.setController('sidescroll');
  
  const camera = cameraSystem.getCamera();
  camera.position.set(0, 100, -500);
  
  // Create player placeholder
  const player = MeshBuilder.CreateBox('player', { size: 32 }, scene);
  player.position.set(0, 50, 0);
  
  // Setup follower
  const follower = new SidescrollFollower(camera);
  follower.setTarget(player);
  
  // Update loop
  scene.onBeforeRenderObservable.add(() => {
    follower.update();
  });
  
  // Basic keyboard input for testing
  const keys: Record<string, boolean> = {};
  window.addEventListener('keydown', e => keys[e.key] = true);
  window.addEventListener('keyup', e => keys[e.key] = false);
  
  scene.onBeforeRenderObservable.add(() => {
    if (keys['ArrowLeft']) player.position.x -= 5;
    if (keys['ArrowRight']) player.position.x += 5;
    if (keys['ArrowUp']) player.position.y += 5;
  });
}
```

## Tips for 2.5D

- Keep player on Z = 0 plane
- Use BSP geometry as background/foreground layers
- Consider orthographic projection for pixel-perfect rendering
- Add parallax by moving background layers at different speeds

## Next Steps

- [FPS Game Skeleton](./fps-skeleton.md)
- [Custom Camera Controller](../advanced/custom-camera.md)
