# Using the isometric controller

SHAG includes an engine-level `IsometricController`. It supplies camera movement and pointer gestures; game selection and orders remain game-specific.

## Try it

```text
camera mode isometric
```

The console command asks `CameraSystem` to select the registered `isometric` controller. The system creates an `ArcRotateCamera` when necessary.

## Configure it in code

```ts
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CameraSystem } from '../../../../src/engine/camera/CameraSystem';
import { IsometricController } from '../../../../src/engine/camera/controllers/IsometricController';

const cameraSystem = CameraSystem.getInstance();
const controller = cameraSystem.getController('isometric') as IsometricController;

controller.configure({
  smoothing: 0.15,
  speed: 1,
  edgeScrollEnabled: false,
  edgeScrollThreshold: 20,
});
controller.setTarget(new Vector3(0, 0, 0));
```

Only run this after the camera system and built-in controllers have been initialized. Prefer `getController` over registering a second controller with the same name.

## Add game interaction

`IsometricController.setClickCallback` reports screen coordinates and whether the gesture became a drag. Perform Babylon picking and selection in the game layer. Remove or replace the callback when the game mode is disposed.

## Projection

Controller type and projection mode are separate. Set the projection in code with `CameraSystem.applyCameraMode('orthographic')`; the console `camera mode` command selects a controller only.

## Map loading

Use the existing singleton:

```ts
const result = await MapLoader.getInstance().loadMap('washoi_dm2', scene);
```

Do not construct `new MapLoader(scene)`; its constructor is private and the class coordinates shared PK3, shader, render-variable, and cleanup state.
