/**
 * SideScrollController - 2D side-scrolling camera controller
 * 
 * Engine-level camera controller for platformers and side-scrolling games.
 * Supports following a target, smooth scrolling, and axis locking.
 */

import {
  ArcRotateCamera,
  Camera,
  KeyboardEventTypes,
  KeyboardInfo,
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
  
  // Movement state
  private moveLeft: boolean = false;
  private moveRight: boolean = false;
  private moveUp: boolean = false;
  private moveDown: boolean = false;
  
  // Configuration
  private config: CameraControllerConfig = {
    smoothing: 0.1,
    speed: 5,
    lockY: false,
    lockX: false,
  };
  
  // Observers
  private renderObserver: Observer<Scene> | null = null;
  private keyboardObserver: Observer<KeyboardInfo> | null = null;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    if (!(camera instanceof ArcRotateCamera)) {
      console.error("[SideScrollController] Requires ArcRotateCamera");
      return;
    }
    
    this.camera = camera;
    this.scene = scene;
    this._canvas = canvas;
    
    // Set up side-scrolling view (camera looks from side)
    // Store original values for debugging
    const origAlpha = this.camera.alpha;
    const origBeta = this.camera.beta;
    
    this.camera.alpha = 0;  // Looking from front/back along Z axis
    this.camera.beta = Math.PI / 2;   // Level with ground (horizontal)
    
    console.log(`[SideScrollController] Camera angles: alpha ${origAlpha.toFixed(2)} -> ${this.camera.alpha.toFixed(2)}, beta ${origBeta.toFixed(2)} -> ${this.camera.beta.toFixed(2)}`);
    
    // Initialize target
    this.targetPosition = camera.target.clone();
    
    this.setupInputHandlers();
    console.log("[SideScrollController] Attached - Arrow keys/WASD to move, side view");
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

    // Keyboard handler for movement
    this.keyboardObserver = this.scene.onKeyboardObservable.add((kbInfo) => {
      if (!this.enabled) return;
      
      const pressed = kbInfo.type === KeyboardEventTypes.KEYDOWN;
      
      switch (kbInfo.event.code) {
        case "KeyA":
        case "ArrowLeft":
          this.moveLeft = pressed;
          break;
        case "KeyD":
        case "ArrowRight":
          this.moveRight = pressed;
          break;
        case "KeyW":
        case "ArrowUp":
          this.moveUp = pressed;
          break;
        case "KeyS":
        case "ArrowDown":
          this.moveDown = pressed;
          break;
      }
    });

    // Render observer for smooth following and movement
    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.enabled || !this.camera) return;
      this.updateCameraPosition();
    });
  }

  private removeInputHandlers(): void {
    if (this.keyboardObserver && this.scene) {
      this.scene.onKeyboardObservable.remove(this.keyboardObserver);
      this.keyboardObserver = null;
    }
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.resetMovement();
  }
  
  private resetMovement(): void {
    this.moveLeft = false;
    this.moveRight = false;
    this.moveUp = false;
    this.moveDown = false;
  }

  private updateCameraPosition(): void {
    if (!this.camera) return;
    
    const speed = this.config.speed || 5;
    
    // With alpha=0, camera looks from +X towards -X
    // So Z is left/right in the view, Y is up/down
    if (this.moveLeft) this.targetPosition.z += speed;
    if (this.moveRight) this.targetPosition.z -= speed;
    if (this.moveUp) this.targetPosition.y += speed;
    if (this.moveDown) this.targetPosition.y -= speed;
    
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
