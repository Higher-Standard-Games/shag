# Isometric Strategy Setup

**Time:** 30 minutes  
**Level:** Intermediate

Set up an isometric camera. SHAG ships an `IsometricController` that any game can use; the bundled FPS game doesn't, but other SHAG game submodules — an isometric building game is in development — do. This tutorial focuses on getting the camera and input loop right so you can build on top.

## What We'll Build

- Isometric camera view
- Pan controls (WASD/edge scroll)
- Zoom controls
- Click-to-select (foundation)

## Prerequisites

- [Camera Navigation](../beginner/camera-navigation.md)
- Basic TypeScript knowledge

## Step 1: Switch to Isometric Camera

```typescript
import { CameraSystem } from '../../engine/camera/CameraSystem';

const cameraSystem = CameraSystem.getInstance();
cameraSystem.init(scene);

// Switch to isometric controller
cameraSystem.setController('isometric');

// Set initial height
cameraSystem.setHeight(800);
```

Or via console:

```
camera controller isometric
camera height 800
```

## Step 2: Configure Camera Angle

The isometric controller uses an ArcRotateCamera. Configure the angle:

```typescript
const camera = cameraSystem.getCamera() as ArcRotateCamera;

// Classic isometric angle (roughly 35.264°)
camera.beta = Math.PI / 4; // 45° from vertical

// Or true isometric
camera.beta = Math.atan(Math.sqrt(2)); // ~54.74°

// Lock rotation
camera.lowerBetaLimit = camera.beta;
camera.upperBetaLimit = camera.beta;
```

## Step 3: Pan Controls

The isometric controller includes pan controls:

- **WASD** - Pan camera
- **Arrow keys** - Pan camera  
- **Edge scroll** - Move mouse to screen edge

## Step 4: Zoom Controls

```typescript
// Configure zoom limits
camera.lowerRadiusLimit = 200;  // Closest zoom
camera.upperRadiusLimit = 2000; // Furthest zoom

// Scroll wheel zoom is built-in
```

## Step 5: Click Detection

Add raycasting for object selection:

```typescript
scene.onPointerDown = (evt, pickResult) => {
  if (pickResult.hit && pickResult.pickedMesh) {
    console.log('Clicked:', pickResult.pickedMesh.name);
    selectObject(pickResult.pickedMesh);
  }
};

function selectObject(mesh: Mesh) {
  // Clear previous selection
  clearSelection();
  
  // Highlight selected
  mesh.renderOutline = true;
  mesh.outlineColor = new Color3(0, 1, 0);
  mesh.outlineWidth = 0.1;
}
```

## Step 6: Minimap (Optional)

Create a second camera for minimap view:

```typescript
const minimapCamera = new ArcRotateCamera(
  'minimap',
  0,
  0, // Top-down
  2000,
  Vector3.Zero(),
  scene
);

// Render to texture
const minimapRT = new RenderTargetTexture(
  'minimapRT',
  256,
  scene
);
minimapRT.activeCamera = minimapCamera;
scene.customRenderTargets.push(minimapRT);
```

## Step 7: Grid Overlay (Optional)

```typescript
function createGrid(size: number, divisions: number) {
  const grid = MeshBuilder.CreateGround(
    'grid',
    { width: size, height: size, subdivisions: divisions },
    scene
  );
  
  const gridMaterial = new GridMaterial('gridMat', scene);
  gridMaterial.majorUnitFrequency = 10;
  gridMaterial.minorUnitVisibility = 0.3;
  gridMaterial.gridRatio = size / divisions;
  gridMaterial.opacity = 0.5;
  
  grid.material = gridMaterial;
  grid.position.y = 0.1; // Slightly above ground
  
  return grid;
}
```

## Complete Example

```typescript
async function setupIsometricGame(scene: Scene) {
  // Load map
  const mapLoader = new MapLoader(scene);
  await mapLoader.load('wdm2');
  
  // Setup camera
  const cameraSystem = CameraSystem.getInstance();
  cameraSystem.init(scene);
  cameraSystem.setController('isometric');
  cameraSystem.setHeight(600);
  
  // Configure camera
  const camera = cameraSystem.getCamera() as ArcRotateCamera;
  camera.beta = Math.PI / 4;
  camera.lowerRadiusLimit = 200;
  camera.upperRadiusLimit = 1500;
  
  // Add click handler
  scene.onPointerDown = (evt, pick) => {
    if (pick.hit) {
      console.log('Selected:', pick.pickedPoint);
    }
  };
}
```

## Tips

- Use `camera mode orthographic` for true isometric projection
- Disable freefly collision if you want to fly through walls during prototyping
- Game-specific concerns (fog of war, resource trees, unit selection) live in your game submodule, not the engine — see [Configuration](../../guides/configuration.md) for how to add a new game submodule under `src/games/`.

## Next Steps

- [Sidescroller Setup](./sidescroller.md)
- [Guide: Camera System](../../guides/camera-system.md)
