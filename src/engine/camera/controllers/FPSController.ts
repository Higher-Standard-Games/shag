/**
 * FPSController - First-person camera controller
 * 
 * Engine-level camera controller for FPS-style games.
 * Supports WASD movement, mouse look, and jumping.
 */

import {
  Camera,
  FreeCamera,
  KeyboardEventTypes,
  KeyboardInfo,
  Observer,
  PointerEventTypes,
  PointerInfo,
  Scene,
  Vector3,
} from "babylonjs";
import { ICameraController, CameraControllerConfig } from "./ICameraController";

export class FPSController implements ICameraController {
  readonly type = "fps";
  
  private camera: FreeCamera | null = null;
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  
  // State
  private enabled: boolean = true;
  private isPointerLocked: boolean = false;
  
  // Movement state
  private moveForward: boolean = false;
  private moveBackward: boolean = false;
  private moveLeft: boolean = false;
  private moveRight: boolean = false;
  private moveUp: boolean = false;
  private moveDown: boolean = false;
  
  // Configuration
  private config: CameraControllerConfig = {
    speed: 10,
    mouseSensitivity: 0.002,
    invertY: false,
  };
  
  // Observers
  private pointerObserver: Observer<PointerInfo> | null = null;
  private keyboardObserver: Observer<KeyboardInfo> | null = null;
  private renderObserver: Observer<Scene> | null = null;
  private pointerLockChangeHandler: (() => void) | null = null;
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    this.scene = scene;
    this.canvas = canvas;
    
    // Get a reasonable starting position from the existing camera
    let startPos = camera.position.clone();
    let lookTarget = Vector3.Zero();
    
    // If it's an ArcRotateCamera, calculate position at ground level looking at target
    if ("target" in camera && (camera as any).target instanceof Vector3) {
      lookTarget = (camera as any).target.clone();
      // Start at ground level near the target
      startPos = lookTarget.clone();
      startPos.y = 5; // Player height
    }
    
    if (!(camera instanceof FreeCamera)) {
      console.log("[FPSController] Creating FreeCamera at position:", startPos.toString());
      // Create a FreeCamera - don't dispose the old one, CameraSystem manages that
      this.camera = new FreeCamera("fpsCamera", startPos, scene);
      // Set rotation to look forward horizontally (not at ground)
      this.camera.rotation.x = 0; // Look straight ahead, not down
      this.camera.rotation.y = 0; // Face default direction
      scene.activeCamera = this.camera;
    } else {
      this.camera = camera;
    }
    
    // Clear default inputs
    this.camera.inputs.clear();
    
    this.setupInputHandlers();
    console.log("[FPSController] Attached - WASD to move, click to enable mouse look, ESC to exit");
  }

  detach(): void {
    this.removeInputHandlers();
    this.exitPointerLock();
    this.camera = null;
    this.scene = null;
    this.canvas = null;
    console.log("[FPSController] Detached");
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.camera) return;
    
    const speed = (this.config.speed || 10) * deltaTime;
    const movement = Vector3.Zero();
    
    // Get camera direction vectors
    const forward = this.camera.getDirection(Vector3.Forward());
    const right = this.camera.getDirection(Vector3.Right());
    
    // Calculate movement
    if (this.moveForward) movement.addInPlace(forward.scale(speed));
    if (this.moveBackward) movement.addInPlace(forward.scale(-speed));
    if (this.moveRight) movement.addInPlace(right.scale(speed));
    if (this.moveLeft) movement.addInPlace(right.scale(-speed));
    if (this.moveUp) movement.y += speed;
    if (this.moveDown) movement.y -= speed;
    
    // Apply movement
    this.camera.position.addInPlace(movement);
  }

  configure(config: Partial<CameraControllerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CameraControllerConfig {
    return { ...this.config };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.resetMovement();
      this.exitPointerLock();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Request pointer lock for mouse look
   */
  requestPointerLock(): void {
    if (this.canvas) {
      this.canvas.requestPointerLock();
    }
  }

  /**
   * Exit pointer lock
   */
  exitPointerLock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.isPointerLocked = false;
  }

  dispose(): void {
    this.detach();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupInputHandlers(): void {
    if (!this.scene || !this.canvas) return;

    // Pointer lock change handler
    this.pointerLockChangeHandler = () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
    };
    document.addEventListener("pointerlockchange", this.pointerLockChangeHandler);

    // Mouse move handler for look
    this.mouseMoveHandler = (e: MouseEvent) => {
      if (!this.isPointerLocked || !this.camera || !this.enabled) return;
      
      const sensitivity = this.config.mouseSensitivity || 0.002;
      const invertY = this.config.invertY ? -1 : 1;
      
      // Apply rotation
      this.camera.rotation.y += e.movementX * sensitivity;
      this.camera.rotation.x += e.movementY * sensitivity * invertY;
      
      // Clamp vertical rotation
      this.camera.rotation.x = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.camera.rotation.x));
    };
    document.addEventListener("mousemove", this.mouseMoveHandler);

    // Click to request pointer lock
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (!this.enabled) return;
      
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        if (!this.isPointerLocked) {
          this.requestPointerLock();
        }
      }
    });

    // Keyboard handler for movement
    this.keyboardObserver = this.scene.onKeyboardObservable.add((kbInfo) => {
      if (!this.enabled) return;
      
      const pressed = kbInfo.type === KeyboardEventTypes.KEYDOWN;
      
      switch (kbInfo.event.code) {
        case "KeyW":
        case "ArrowUp":
          this.moveForward = pressed;
          break;
        case "KeyS":
        case "ArrowDown":
          this.moveBackward = pressed;
          break;
        case "KeyA":
        case "ArrowLeft":
          this.moveLeft = pressed;
          break;
        case "KeyD":
        case "ArrowRight":
          this.moveRight = pressed;
          break;
        case "Space":
          this.moveUp = pressed;
          break;
        case "ShiftLeft":
        case "ControlLeft":
          this.moveDown = pressed;
          break;
        case "Escape":
          if (pressed) this.exitPointerLock();
          break;
      }
    });

    // Render observer for movement update
    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      const deltaTime = this.scene!.getEngine().getDeltaTime() / 1000;
      this.update(deltaTime);
    });
  }

  private removeInputHandlers(): void {
    if (this.pointerObserver && this.scene) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    
    if (this.keyboardObserver && this.scene) {
      this.scene.onKeyboardObservable.remove(this.keyboardObserver);
      this.keyboardObserver = null;
    }
    
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    
    if (this.pointerLockChangeHandler) {
      document.removeEventListener("pointerlockchange", this.pointerLockChangeHandler);
      this.pointerLockChangeHandler = null;
    }
    
    if (this.mouseMoveHandler) {
      document.removeEventListener("mousemove", this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
  }

  private resetMovement(): void {
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.moveUp = false;
    this.moveDown = false;
  }
}
