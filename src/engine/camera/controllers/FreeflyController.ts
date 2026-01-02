/**
 * FreeflyController - Debug camera controller for free flight
 * 
 * Simple flying camera for debugging maps/BSP:
 * - Left mouse button: fly forward
 * - Right mouse button: fly backward
 * - Mouse movement: freelook (always active)
 * - No gravity, no collision, flies through everything
 */

import {
  Camera,
  FreeCamera,
  Observer,
  Scene,
  Vector3,
} from "babylonjs";
import { ICameraController, CameraControllerConfig } from "./ICameraController";

export class FreeflyController implements ICameraController {
  readonly type = "freefly";
  
  private camera: FreeCamera | null = null;
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  
  // State
  private enabled: boolean = true;
  private isLeftDown: boolean = false;
  private isRightDown: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  
  // Configuration
  private config: CameraControllerConfig = {
    speed: 100, // Fast for map exploration
    mouseSensitivity: 0.003,
    invertY: false,
    fov: 1.0, // Wider FOV for debugging
  };
  
  // Observers
  private renderObserver: Observer<Scene> | null = null;
  
  // Event handlers (bound for removal)
  private onMouseDown: ((e: MouseEvent) => void) | null = null;
  private onMouseUp: ((e: MouseEvent) => void) | null = null;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onContextMenu: ((e: MouseEvent) => void) | null = null;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    this.scene = scene;
    this.canvas = canvas;
    
    // Get starting position from existing camera
    let startPos = camera.position.clone();
    
    // If it's an ArcRotateCamera, start at its position looking at target
    if ("target" in camera && (camera as any).target instanceof Vector3) {
      startPos = camera.position.clone();
    }
    
    if (!(camera instanceof FreeCamera)) {
      console.log("[FreeflyController] Creating FreeCamera at:", startPos.toString());
      this.camera = new FreeCamera("freeflyCamera", startPos, scene);
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
    
    // Disable collisions for free flight
    this.camera.checkCollisions = false;
    
    // Clear default inputs - we handle everything
    this.camera.inputs.clear();
    
    // Set up mouse handlers
    this.setupMouseHandlers();
    
    // Set up render observer for movement
    let frameCount = 0;
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      const deltaTime = scene.getEngine().getDeltaTime() / 1000;
      frameCount++;
      if (frameCount % 60 === 1) {
        console.log('[FreeflyController] Observer tick, camera:', this.camera ? 'yes' : 'no', 'enabled:', this.enabled, 'L:', this.isLeftDown, 'R:', this.isRightDown);
      }
      this.update(deltaTime);
    });
    
    console.log('[FreeflyController] Render observer attached to scene:', scene.uid, 'camera:', this.camera?.name);
    
    console.log("[FreeflyController] Attached - LMB forward, RMB backward, mouse freelook");
  }

  private setupMouseHandlers(): void {
    if (!this.canvas) return;
    
    this.onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isLeftDown = true;
        console.log('[FreeflyController] LMB down - forward');
      }
      if (e.button === 2) {
        this.isRightDown = true;
        console.log('[FreeflyController] RMB down - backward');
      }
    };
    
    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.isLeftDown = false;
      if (e.button === 2) this.isRightDown = false;
    };
    
    this.onMouseMove = (e: MouseEvent) => {
      if (!this.enabled || !this.camera) return;
      
      const sensitivity = this.config.mouseSensitivity || 0.003;
      const invertY = this.config.invertY ? -1 : 1;
      
      const deltaX = e.movementX || (e.clientX - this.lastMouseX);
      const deltaY = e.movementY || (e.clientY - this.lastMouseY);
      
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      
      // Always apply freelook (no button required)
      this.camera.rotation.y += deltaX * sensitivity;
      this.camera.rotation.x += deltaY * sensitivity * invertY;
      
      // Clamp vertical rotation
      this.camera.rotation.x = Math.max(
        -Math.PI / 2 + 0.1,
        Math.min(Math.PI / 2 - 0.1, this.camera.rotation.x)
      );
    };
    
    // Prevent context menu on right click
    this.onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    
    // Use document instead of canvas to ensure events aren't blocked by UI
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("contextmenu", this.onContextMenu);
    
    // Also track mouse up on window (in case mouse leaves canvas)
    window.addEventListener("mouseup", this.onMouseUp);
  }

  private removeMouseHandlers(): void {
    if (!this.canvas) return;
    
    if (this.onMouseDown) {
      document.removeEventListener("mousedown", this.onMouseDown);
    }
    if (this.onMouseUp) {
      document.removeEventListener("mouseup", this.onMouseUp);
      window.removeEventListener("mouseup", this.onMouseUp);
    }
    if (this.onMouseMove) {
      document.removeEventListener("mousemove", this.onMouseMove);
    }
    if (this.onContextMenu) {
      document.removeEventListener("contextmenu", this.onContextMenu);
    }
  }

  detach(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    
    this.removeMouseHandlers();
    
    this.camera = null;
    this.scene = null;
    this.canvas = null;
    this.isLeftDown = false;
    this.isRightDown = false;
    
    console.log("[FreeflyController] Detached");
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.camera) return;
    
    const speed = (this.config.speed || 100) * deltaTime;
    
    // Get camera forward direction
    const forward = this.camera.getDirection(Vector3.Forward());
    
    // Left mouse = forward, Right mouse = backward
    if (this.isLeftDown) {
      const movement = forward.scale(speed);
      this.camera.position.addInPlace(movement);
      console.log('[FreeflyController] Moving forward:', movement.toString(), 'pos:', this.camera.position.toString());
    }
    if (this.isRightDown) {
      const movement = forward.scale(-speed);
      this.camera.position.addInPlace(movement);
      console.log('[FreeflyController] Moving backward:', movement.toString(), 'pos:', this.camera.position.toString());
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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.isLeftDown = false;
      this.isRightDown = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.detach();
  }
}
