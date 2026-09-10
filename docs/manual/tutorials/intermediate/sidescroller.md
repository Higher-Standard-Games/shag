# Using the sidescroll controller

`SideScrollController` is an engine camera option for 2.5D views. It does not turn the FPS simulation into a platformer by itself.

## Try it

```text
camera mode sidescroll
```

The controller requires an `ArcRotateCamera`; `CameraSystem` creates or restores one during the switch.

## Configure and follow

```ts
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CameraSystem } from '../../../../src/engine/camera/CameraSystem';
import { SideScrollController } from '../../../../src/engine/camera/controllers/SidescrollController';

const cameraSystem = CameraSystem.getInstance();
const controller = cameraSystem.getController('sidescroll') as SideScrollController;

controller.configure({
  smoothing: 0.1,
  speed: 5,
  lockX: false,
  lockY: false,
});
controller.setFollowTarget(playerNode, new Vector3(0, 80, 0));
```

Clear the follow target or dispose the controller during teardown.

## Gameplay plane

A real sidescroller mode must also constrain authoritative movement, spawning, attacks, and collision to the intended plane. Camera locking alone is presentation and cannot enforce server rules.

## Input caution

The controller reads action IDs through `InputSystem`. Confirm that the selected game composition registers compatible movement actions before relying on manual camera panning.

## Map loading

Use `MapLoader.getInstance().loadMap(name, scene)` for an indexed BSP. Do not construct a `MapLoader`; it is a singleton with a private constructor.
