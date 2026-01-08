/**
 * FPSController - First-person camera controller
 * 
 * Engine-level camera controller for FPS-style games.
 * Uses InputSystem for all input handling - no raw input code here.
 */

import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ICameraController, CameraControllerConfig } from "./ICameraController";
import { Cvar } from "../../core/Cvar";
import { InputSystem } from "../../input";
import { getCollisionManager } from "../../physics";

export class FPSController implements ICameraController {
  readonly type = "fps";
  
  private camera: FreeCamera | null = null;
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  
  // State
  private enabled: boolean = true;
  
  // Configuration
  private config: CameraControllerConfig = {
    speed: 10,
    mouseSensitivity: 0.002,
    invertY: false,
    fov: 0.8,
  };
  
  // Rotation speed for keyboard turning
  private rotationSpeed: number = 2.0;
  
  // Observers
  private renderObserver: Observer<Scene> | null = null;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    this.scene = scene;
    this.canvas = canvas;
    
    // Get a reasonable starting position from the existing camera
    let startPos = camera.position.clone();
    
    // If it's an ArcRotateCamera, calculate position at ground level looking at target
    if ("target" in camera && (camera as any).target instanceof Vector3) {
      const lookTarget = (camera as any).target.clone();
      startPos = lookTarget.clone();
      startPos.y = 5; // Player height
    }
    
    if (!(camera instanceof FreeCamera)) {
      console.log("[FPSController] Creating FreeCamera at position:", startPos.toString());
      this.camera = new FreeCamera("fpsCamera", startPos, scene);
      this.camera.rotation.x = 0;
      this.camera.rotation.y = 0;
      scene.activeCamera = this.camera;
    } else {
      this.camera = camera;
    }
    
    // Apply FOV
    if (this.config.fov && this.camera) {
      this.camera.fov = this.config.fov;
    }
    
    // Clear default inputs - we use InputSystem instead
    this.camera.inputs.clear();
    
    // Set up render observer for movement update
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      const deltaTime = scene.getEngine().getDeltaTime() / 1000;
      this.update(deltaTime);
    });
    
    console.log("[FPSController] Attached - Uses InputSystem for input");
  }

  detach(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.camera = null;
    this.scene = null;
    this.canvas = null;
    console.log("[FPSController] Detached");
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.camera) return;
    
    const input = InputSystem.getInstance();
    const speed = (this.config.speed || 10) * deltaTime;
    const movement = Vector3.Zero();
    
    // Get camera direction vectors
    const forward = this.camera.getDirection(Vector3.Forward());
    const right = this.camera.getDirection(Vector3.Right());
    
    // Query InputSystem for movement actions
    if (input.isActive("move_forward")) movement.addInPlace(forward.scale(speed));
    if (input.isActive("move_back")) movement.addInPlace(forward.scale(-speed));
    if (input.isActive("move_right")) movement.addInPlace(right.scale(speed));
    if (input.isActive("move_left")) movement.addInPlace(right.scale(-speed));
    if (input.isActive("move_up")) movement.y += speed;
    if (input.isActive("move_down")) movement.y -= speed;
    
    // Query InputSystem for rotation
    if (input.isActive("rotate_left")) {
      this.camera.rotation.y -= this.rotationSpeed * deltaTime;
    }
    if (input.isActive("rotate_right")) {
      this.camera.rotation.y += this.rotationSpeed * deltaTime;
    }
    
    // Mouse look via InputSystem raw state (for now - gestures later)
    const mouseDelta = input.getMouseDelta();
    if (input.isActive("camera_pan")) {
      const baseSensitivity = this.config.mouseSensitivity || 0.002;
      const sensitivityMultiplier = Cvar.getNumber('cam_sensitivity') || 1.0;
      const sensitivity = baseSensitivity * sensitivityMultiplier;
      const invertYCvar = Cvar.getBool('cam_invertY');
      const invertY = (this.config.invertY || invertYCvar) ? -1 : 1;
      
      this.camera.rotation.y += mouseDelta.x * sensitivity;
      this.camera.rotation.x += mouseDelta.y * sensitivity * invertY;
      
      // Clamp vertical rotation
      this.camera.rotation.x = Math.max(
        -Math.PI / 2 + 0.1,
        Math.min(Math.PI / 2 - 0.1, this.camera.rotation.x)
      );
    }
    
    // Apply movement with collision detection
    if (movement.length() > 0) {
      const cm = getCollisionManager();
      if (cm.isInitialized()) {
        const start = this.camera.position.clone();
        const end = start.add(movement);
        
        // Trace movement
        const result = cm.trace(start as never, end as never);
        
        if (result.fraction < 1.0) {
          // Hit something - move to collision point with small offset
          const safeMove = movement.scale(result.fraction * 0.95);
          this.camera.position.addInPlace(safeMove);
        } else {
          // No collision - apply full movement
          this.camera.position.addInPlace(movement);
        }
      } else {
        // No collision system - apply movement directly
        this.camera.position.addInPlace(movement);
      }
    }
    
    // Handle cancel action (exit pointer lock, etc.)
    if (input.wasPressed("cancel")) {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    }
  }

  configure(config: Partial<CameraControllerConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.fov && this.camera) {
      this.camera.fov = config.fov;
    }
  }

  getConfig(): CameraControllerConfig {
    return { ...this.config };
  }

  /** Get canvas element (for pointer lock support) */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
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
