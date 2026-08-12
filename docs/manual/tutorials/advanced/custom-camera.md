# Creating a camera controller

A custom controller implements `ICameraController` and is registered with `CameraSystem`.

## Contract

```ts
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type {
  CameraControllerConfig,
  ICameraController,
} from '../../../../src/engine/camera/controllers/ICameraController';

export class OrbitDebugController implements ICameraController {
  readonly type = 'orbit-debug';

  private scene: Scene | null = null;
  private observer: Observer<Scene> | null = null;
  private enabled = true;
  private config: CameraControllerConfig = { speed: 1 };
  private angle = 0;

  attach(camera: Camera, scene: Scene, _canvas: HTMLCanvasElement): void {
    this.scene = scene;
    this.observer = scene.onBeforeRenderObservable.add(() => {
      if (!this.enabled) return;
      this.angle += (this.config.speed ?? 1) * scene.getEngine().getDeltaTime() / 1000;
      camera.position.x = Math.cos(this.angle) * 200;
      camera.position.z = Math.sin(this.angle) * 200;
    });
  }

  detach(): void {
    if (this.scene && this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
    }
    this.observer = null;
    this.scene = null;
  }

  update(_deltaTime: number): void {}

  configure(config: Partial<CameraControllerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CameraControllerConfig {
    return { ...this.config };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.detach();
  }
}
```

Controllers may implement optional target/follow methods as needed.

## Register and select

```ts
const cameras = CameraSystem.getInstance();
cameras.registerController('orbit-debug', new OrbitDebugController());
cameras.setController('orbit-debug');
```

`registerController` disposes an existing controller registered under the same name. `setController` returns `false` if the type is missing or the system has not been initialized with a scene, canvas, and camera.

## Lifecycle rules

- remove every Babylon observer and DOM listener in `detach`;
- make `detach` and `dispose` safe to call more than once;
- do not dispose the shared camera from `detach`;
- use `InputSystem` actions rather than adding duplicate key listeners;
- keep game-specific selection or combat behavior outside the controller.

To expose it in the console, add its name to a game-specific command or extend `CameraCommand`; the current built-in enum only lists built-in controllers.
