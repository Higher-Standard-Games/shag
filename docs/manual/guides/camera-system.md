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

`init` requires both the scene and canvas in browser code. Headless code passes its own controlled substitute. Select a controller explicitly with `setController` after registration; the `defaultController` config field is not read.

## Controllers

Built-in controller type names:

- `fps`;
- `freefly`;
- `isometric`;
- `sidescroll`;
- `follow`;
- `spectator`, driven by the FPS `spectator` command rather than by `camera mode`.

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

`camera mode` selects a controller. `iso` is accepted as a short form of `isometric`. With no argument it reports the active controller by its own type name and lists the names it takes.

`camera fov` does not write the camera: viewport effects rewrite that every frame from `cl_fov`, so the subcommand sets `cl_fov` instead, and reports the range rather than silently clamping a value outside it.

## Projection modes

`CameraSystem` separately supports:

- `perspective`;
- `orthographic`;
- `fake_ortho`.

Use `createCamera(mode)` or `applyCameraMode(mode)` in code; the console has no projection command.

## Freefly

```text
freefly_speed 300
freefly_collision
freefly_collision 0
freefly_collision mode bsp
```

Freefly uses the player's own FPS action bindings rather than fixed keys: move is WASD, rise is Jump (Space), sink is Crouch (C, Ctrl or middle mouse), and the speed multiplier is Sprint (Shift). Mouse look needs pointer lock. Rebinding those actions rebinds freefly with them.

Held controls reset when the page loses focus, the tab becomes hidden or mouse
capture is released. Returning and capturing again requires fresh presses;
saved bindings are preserved. Mouse releases outside the canvas and cancelled
touches are handled too.

If the browser denies mouse capture, a dismissible notice explains how to retry.
Fullscreen failures also show feedback, through Settings or Alt+Enter; the
Settings toggle continues to reflect the actual fullscreen state.

Fullscreen gameplay requests browser Keyboard Lock for movement keys when the
game canvas also owns pointer lock. The keys come from the active context's
actions marked `lockInFullscreen`, including binding overrides. FPS marks its
four horizontal movement actions, protecting combinations such as Ctrl+W while
retaining their movement input. Escape is never requested.

Keyboard capture releases on pointer unlock, fullscreen exit, menus without
movement actions, text-field focus, window blur, hidden tabs and input-system
disposal. Supported browsers require a secure context and may ask permission.
Use Alt+Enter or the game's Fullscreen setting; browser F11 fullscreen alone
does not enable this protection. Unsupported browsers retain normal input.
A denied request shows a dismissible notice and is not retried every frame.

## Custom controller

```ts
const controller: ICameraController = new MyController();
cameras.registerController(controller.type, controller);
cameras.setController(controller.type);
```

`ICameraController` requires `attach(camera, scene, canvas)`, `detach`, `update`, configuration accessors, enable state, and `dispose`. `setTarget`, `getTarget` and `setFollowTarget` are optional.

Always remove observers, input contexts, and DOM listeners in `detach`. Do not dispose the shared camera there.

## Position

```text
pos
pos copy
teleport 0 128 0
```

## First-person views

The local FPS camera and every view behind another player's eyes (live
spectating and demo playback) are built the same way, so a watched screen moves
the way the player's own did:

- `createFirstPersonEffects()` in `src/engine/viewport/FirstPersonEffects.ts`
  lists the movement effects a first-person view runs: walk bob, landing
  impact, strafe lean, speed FOV and idle breathing. The FPS controller
  registers these; a watched view runs its own `FirstPersonEffectStack`, so it
  never disturbs the local camera's state. A demo steps its stack on the demo
  clock, and a step of zero (a paused demo) holds the last frame.
- `src/engine/camera/FirstPersonMotion.ts` holds the eye's own motion: the dip
  into a slide (`slidePitch`), the lift through a ledge grab (`easeLedgePitch`)
  and the ease up a step (`smoothStepUp`).
- `applyFirstPersonPose()` in `src/engine/camera/FirstPersonPose.ts` writes an
  eye position, view angles and the effects into a camera through the same
  applicator the local camera uses.

A watched view needs the player's keys, slide and ledge-grab phases and crouch
eye height; snapshots carry them for each player (see
[Networking](./networking.md#snapshot-format)).

## FPS integration

The FPS controller participates in prediction, reconciliation, viewport effects, and weapon view presentation. Keep those game-specific dependencies in the FPS composition and shared hooks rather than adding direct game imports to generic camera code.

See [Camera navigation](../tutorials/beginner/camera-navigation.md) and [Custom camera](../tutorials/advanced/custom-camera.md).
