# Camera system

`CameraSystem` owns the active Babylon camera and swaps reusable camera controllers.

## Initialize

```ts
const cameras = CameraSystem.getInstance();
cameras.init(scene, canvas, {
  defaultMode: 'perspective',
});
cameras.setCamera(camera);
```

`init` requires both the scene and canvas in browser code. Headless code passes its own controlled substitute. Select the controller explicitly after registration; the current implementation does not act on `defaultController`.

## Controllers

Built-in controller type names:

- `fps`;
- `freefly`;
- `isometric`;
- `sidescroll`;
- `follow`.

```ts
const changed = cameras.setController('freefly');
const active = cameras.getActiveController();
const registered = cameras.getController('isometric');
```

`setController` detaches the previous controller. For isometric, sidescroll, and follow, it creates or restores an `ArcRotateCamera` when necessary.

Console selection uses:

```text
camera mode freefly
camera mode isometric
camera fov 100
camera info
```

The console subcommand is named `mode`, but its current implementation selects a controller.

## Projection modes

`CameraSystem` separately supports:

- `perspective`;
- `orthographic`;
- `fake_ortho`.

Use `createCamera(mode)` or `applyCameraMode(mode)` in code. The console does not expose the older `camera mode orthographic` projection syntax.

## Freefly

```text
freefly_speed 300
freefly_collision
freefly_collision 0
freefly_collision mode bsp
```

Freefly uses FPS actions: WASD, Space up, C/Ctrl down, Shift speed multiplier, and mouse look under pointer lock.

## Custom controller

```ts
const controller: ICameraController = new MyController();
cameras.registerController(controller.type, controller);
cameras.setController(controller.type);
```

`ICameraController` requires `attach(camera, scene, canvas)`, `detach`, `update`, configuration accessors, enable state, and `dispose`. Optional target/follow methods are available.

Always remove observers, input contexts, and DOM listeners in `detach`. Do not dispose the shared camera there.

## Position

```text
pos
pos copy
teleport 0 128 0
```

The old `camera target` command is not a teleport API.

## FPS integration

The FPS controller participates in prediction, reconciliation, viewport effects, and weapon view presentation. Keep those game-specific dependencies in the FPS composition and shared hooks rather than adding direct game imports to generic camera code.

See [Camera navigation](../tutorials/beginner/camera-navigation.md) and [Custom camera](../tutorials/advanced/custom-camera.md).
