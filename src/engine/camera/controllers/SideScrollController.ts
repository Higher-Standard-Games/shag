/**
 * SideScrollController - 2D side-scrolling camera controller
 * 
 * Engine-level camera controller for platformers and side-scrolling games.
 * Supports following a target, smooth scrolling, and axis locking.
 */

import {
  ArcRotateCamera,
  Camera,
  Observer,
  Scene,
  TransformNode,
  Vector3,
} from "babylonjs";
import { ICameraController, CameraControllerConfig } from "./ICameraController";

export class SideScrollController implements ICameraController {
  readonly type = "sidescroll";
  
  private camera: ArcRotateCamera | null = null;
  private scene: Scene | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  
  // State
  private enabled: boolean = true;
  private followTarget: TransformNode | null = null;
  private followOffset: Vector3 = new Vector3(0, 0, 0);
  private targetPosition: Vector3 = Vector3.Zero();
  
  // Configuration
  private config: CameraControllerConfig = {
    smoothing: 0.1,
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
    this._canvas = canvas;
    
    // Set up side-scrolling view (camera looks from side)
    this.camera.alpha = Math.PI / 2;  // 90 degrees - looking from side
    this.camera.beta = Math.PI / 2;   // Level with ground
    
    // Initialize target
    this.targetPosition = camera.target.clone();
    
    this.setupInputHandlers();
    console.log("[SideScrollController] Attached");
  }

  detach(): void {
    this.removeInputHandlers();
    this.camera = null;
    this.scene = null;
    this._canvas = null; // eslint-disable-line @typescript-eslint/no-unused-vars
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

  /**
   * Set a node for the camera to follow
   */
  setFollowTarget(node: TransformNode, offset?: Vector3): void {
    this.followTarget = node;
    if (offset) {
      this.followOffset = offset.clone();
    }
  }

  /**
   * Clear the follow target
   */
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

  private setupInputHandlers(): void {
    if (!this.scene) return;

    // Render observer for smooth following
    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.enabled || !this.camera) return;
      this.updateCameraPosition();
    });
  }

  private removeInputHandlers(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
  }

  private updateCameraPosition(): void {
    if (!this.camera) return;
    
    // Update target position if following something
    if (this.followTarget) {
      const targetPos = this.followTarget.position.add(this.followOffset);
      
      // Apply axis locking
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
      this.camera.target = Vector3.Lerp(
        this.camera.target,
        this.targetPosition,
        smoothing
      );
      
      // Snap when close
      if (Vector3.DistanceSquared(this.camera.target, this.targetPosition) < 0.01) {
        this.camera.target.copyFrom(this.targetPosition);
      }
    }
  }
}
