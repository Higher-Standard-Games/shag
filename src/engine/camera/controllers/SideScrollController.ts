/**
 * SideScrollController - 2D side-scrolling camera controller
 *
 * Engine-level camera controller for platformers and side-scrolling games.
 * Uses InputSystem for movement input.
 */

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import { InputSystem } from "../../input";
import type { CameraControllerConfig, ICameraController } from "./ICameraController";

export class SideScrollController implements ICameraController {
  readonly type = "sidescroll";

  private camera: ArcRotateCamera | null = null;
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;

  // State
  private enabled: boolean = true;
  private followTarget: TransformNode | null = null;
  private followOffset: Vector3 = new Vector3(0, 0, 0);
  private targetPosition: Vector3 = Vector3.Zero();

  // Configuration
  private config: CameraControllerConfig = {
    smoothing: 0.1,
    speed: 5,
    lockY: false,
    lockX: false,
  };

  // Observers
  private renderObserver: Observer<Scene> | null = null;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    if (!(camera instanceof ArcRotateCamera)) {
      console.error("[SideScrollController] Requires ArcRotateCamera");
      return;
    }

    this.camera = camera;
    this.scene = scene;
    this.canvas = canvas;

    // Set up side-scrolling view
    this.camera.alpha = 0;
    this.camera.beta = Math.PI / 2;

    // Initialize target
    this.targetPosition = camera.target.clone();

    // Single render observer handles all input via InputSystem
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      if (!this.enabled || !this.camera) return;
      this.updateCameraPosition();
    });

    console.log("[SideScrollController] Attached - Uses InputSystem");
  }

  detach(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.camera = null;
    this.scene = null;
    this.canvas = null;
    this.followTarget = null;
    console.log("[SideScrollController] Detached");
  }

  update(_deltaTime: number): void {
    // Update is handled by render observer
  }

  setTarget(target: Vector3): void {
    this.targetPosition = target.clone();
  }

  getTarget(): Vector3 {
    return this.targetPosition.clone();
  }

  setFollowTarget(node: TransformNode, offset?: Vector3): void {
    this.followTarget = node;
    if (offset) {
      this.followOffset = offset.clone();
    }
  }

  clearFollowTarget(): void {
    this.followTarget = null;
  }

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

  // ============================================================================
  // Private Methods
  // ============================================================================

  private updateCameraPosition(): void {
    if (!this.camera) return;

    const input = InputSystem.getInstance();
    const speed = this.config.speed || 5;

    // Calculate movement delta using InputSystem
    let deltaZ = 0;
    let deltaY = 0;

    // With alpha=0, camera looks from +X towards -X
    // A/left = negative Z, D/right = positive Z
    if (input.isActive("move_left")) deltaZ -= speed;
    if (input.isActive("move_right")) deltaZ += speed;
    if (input.isActive("move_forward")) deltaY += speed; // W = up in sidescroll
    if (input.isActive("move_back")) deltaY -= speed; // S = down in sidescroll

    // Move both target AND camera position together for true sidescroll panning
    if (deltaZ !== 0 || deltaY !== 0) {
      this.targetPosition.z += deltaZ;
      this.targetPosition.y += deltaY;

      this.camera.position.z += deltaZ;
      this.camera.position.y += deltaY;
    }

    // Update target position if following something
    if (this.followTarget) {
      const targetPos = this.followTarget.position.add(this.followOffset);

      if (this.config.lockX) {
        this.targetPosition.x = this.camera.target.x;
        this.targetPosition.y = targetPos.y;
        this.targetPosition.z = targetPos.z;
      } else if (this.config.lockY) {
        this.targetPosition.x = targetPos.x;
        this.targetPosition.y = this.camera.target.y;
        this.targetPosition.z = targetPos.z;
      } else {
        this.targetPosition.copyFrom(targetPos);
      }
    }

    // Apply smoothing
    const smoothing = this.config.smoothing || 0.1;

    if (!this.camera.target.equals(this.targetPosition)) {
      this.camera.target = Vector3.Lerp(this.camera.target, this.targetPosition, smoothing);

      if (Vector3.DistanceSquared(this.camera.target, this.targetPosition) < 0.01) {
        this.camera.target.copyFrom(this.targetPosition);
      }
    }
  }

  /** Get canvas element */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }
}
