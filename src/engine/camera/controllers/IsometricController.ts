/**
 * IsometricController - RTS/Isometric camera controller
 * 
 * Engine-level camera controller for isometric and RTS-style games.
 * Supports pan/drag, edge scrolling, and smooth movement.
 * 
 * This is the ENGINE version - game-specific click handling should be
 * done separately in game code, not in this controller.
 */

import {
  ArcRotateCamera,
  Camera,
  Matrix,
  Observer,
  PointerEventTypes,
  PointerInfo,
  Scene,
  Vector3,
} from "babylonjs";
import { ICameraController, CameraControllerConfig } from "./ICameraController";
import { CameraSystem } from "../CameraSystem";

export class IsometricController implements ICameraController {
  readonly type = "isometric";
  
  private camera: ArcRotateCamera | null = null;
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  
  // State
  private enabled: boolean = true;
  private isDragging: boolean = false;
  private startGroundPosition: Vector3 | null = null;
  private isMouseInCanvas: boolean = true;
  private pointerDownPos: { x: number; y: number } | null = null;
  
  // Smoothing
  private targetPosition: Vector3 = Vector3.Zero();
  
  // Configuration
  private config: CameraControllerConfig = {
    smoothing: 0.15,
    speed: 1.0,
    edgeScrollEnabled: false,
    edgeScrollThreshold: 20,
  };
  
  // Observers
  private pointerObserver: Observer<PointerInfo> | null = null;
  private renderObserver: Observer<Scene> | null = null;
  private mouseLeaveHandler: (() => void) | null = null;
  private mouseEnterHandler: (() => void) | null = null;
  
  // Callbacks for game-specific handling
  private onClickCallback: ((screenX: number, screenY: number, wasDrag: boolean) => void) | null = null;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    if (!(camera instanceof ArcRotateCamera)) {
      console.error("[IsometricController] Requires ArcRotateCamera");
      return;
    }
    
    this.camera = camera;
    this.scene = scene;
    this.canvas = canvas;
    
    // Initialize target position from camera
    this.targetPosition = camera.target.clone();
    
    this.setupInputHandlers();
    console.log("[IsometricController] Attached");
  }

  detach(): void {
    this.removeInputHandlers();
    this.camera = null;
    this.scene = null;
    this.canvas = null;
    console.log("[IsometricController] Detached");
  }

  update(_deltaTime: number): void {
    // Update is handled by render observer for smoother results
  }

  setTarget(target: Vector3): void {
    this.targetPosition = target.clone();
    if (this.camera) {
      this.camera.target.copyFrom(target);
    }
  }

  getTarget(): Vector3 {
    return this.targetPosition.clone();
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
      this.isDragging = false;
      this.startGroundPosition = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Sync target position with camera's current target
   * Call this after externally changing camera target
   */
  syncTargetPosition(): void {
    if (this.camera) {
      this.targetPosition = this.camera.target.clone();
    }
  }

  /**
   * Set callback for click events (for game-specific handling)
   */
  setClickCallback(callback: (screenX: number, screenY: number, wasDrag: boolean) => void): void {
    this.onClickCallback = callback;
  }

  dispose(): void {
    this.detach();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupInputHandlers(): void {
    if (!this.scene || !this.canvas) return;

    // Mouse leave/enter handlers
    this.mouseLeaveHandler = () => {
      this.isDragging = false;
      this.startGroundPosition = null;
      this.isMouseInCanvas = false;
      this.pointerDownPos = null;
    };
    
    this.mouseEnterHandler = () => {
      this.isMouseInCanvas = true;
    };

    this.canvas.addEventListener("mouseleave", this.mouseLeaveHandler);
    this.canvas.addEventListener("mouseenter", this.mouseEnterHandler);

    // Pointer observer for drag handling
    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (!this.enabled) return;
      
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN:
          this.handlePointerDown(pointerInfo);
          break;
        case PointerEventTypes.POINTERUP:
          this.handlePointerUp(pointerInfo);
          break;
        case PointerEventTypes.POINTERMOVE:
          this.handlePointerMove();
          break;
      }
    });

    // Render observer for smoothing and edge scroll
    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.enabled) return;
      this.handleEdgeScroll();
      this.applySmoothing();
    });
  }

  private removeInputHandlers(): void {
    if (this.pointerObserver && this.scene) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    
    if (this.canvas) {
      if (this.mouseLeaveHandler) {
        this.canvas.removeEventListener("mouseleave", this.mouseLeaveHandler);
      }
      if (this.mouseEnterHandler) {
        this.canvas.removeEventListener("mouseenter", this.mouseEnterHandler);
      }
    }
  }

  private handlePointerDown(pointerInfo: PointerInfo): void {
    if (pointerInfo.event.button !== 0) return; // Left click only
    
    this.isDragging = true;
    this.pointerDownPos = { 
      x: this.scene!.pointerX, 
      y: this.scene!.pointerY 
    };
    
    // Raycast to ground
    this.startGroundPosition = this.getGroundPosition();
    
    // Sync target to current to avoid jump
    if (this.camera) {
      this.targetPosition.copyFrom(this.camera.target);
    }
  }

  private handlePointerUp(_pointerInfo: PointerInfo): void {
    if (this.isDragging && this.pointerDownPos) {
      // Check if this was a click (minimal movement) or drag
      const dx = this.scene!.pointerX - this.pointerDownPos.x;
      const dy = this.scene!.pointerY - this.pointerDownPos.y;
      const distSq = dx * dx + dy * dy;
      const wasDrag = distSq >= 25; // 5 pixel threshold
      
      // Notify game code about the click
      if (this.onClickCallback) {
        this.onClickCallback(this.scene!.pointerX, this.scene!.pointerY, wasDrag);
      }
    }
    
    this.isDragging = false;
    this.startGroundPosition = null;
    this.pointerDownPos = null;
  }

  private handlePointerMove(): void {
    if (!this.isDragging || !this.startGroundPosition) return;
    
    const currentGroundPos = this.getGroundPosition();
    if (!currentGroundPos) return;
    
    const delta = this.startGroundPosition.subtract(currentGroundPos);
    
    // Safety checks
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || !Number.isFinite(delta.z)) return;
    if (delta.lengthSquared() > 10000) return; // Prevent massive jumps
    
    // Apply to target
    this.targetPosition.addInPlace(delta);
    
    // Apply bounds if set
    const bounds = CameraSystem.getInstance().getBounds();
    if (bounds.min && bounds.max) {
      this.targetPosition = CameraSystem.getInstance().clampToBounds(this.targetPosition);
    }
    
    // Snap camera immediately while dragging
    if (this.camera) {
      this.camera.target.copyFrom(this.targetPosition);
    }
    
    // Recalculate start position
    this.startGroundPosition = this.getGroundPosition();
  }

  private getGroundPosition(): Vector3 | null {
    if (!this.scene || !this.camera) return null;
    
    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      Matrix.Identity(),
      this.camera
    );
    
    // Intersect with Y=0 plane
    if (Math.abs(ray.direction.y) < 0.0001) return null;
    
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    
    return ray.origin.add(ray.direction.scale(t));
  }

  private handleEdgeScroll(): void {
    if (!this.config.edgeScrollEnabled || this.isDragging || !this.isMouseInCanvas) return;
    if (!this.scene || !this.camera || !this.canvas) return;
    
    const x = this.scene.pointerX;
    const y = this.scene.pointerY;
    const threshold = this.config.edgeScrollThreshold || 20;
    const speed = (this.config.speed || 1.0) * 1.0;
    
    if (x < 0 || y < 0 || x > this.canvas.width || y > this.canvas.height) return;
    
    let moveX = 0;
    let moveY = 0;
    
    if (x < threshold) {
      moveX = -speed;
    } else if (x > this.canvas.width - threshold) {
      moveX = speed;
    }
    
    if (y < threshold) {
      moveY = -speed;
    } else if (y > this.canvas.height - threshold) {
      moveY = speed;
    }
    
    if (moveX !== 0 || moveY !== 0) {
      const forward = this.camera.getDirection(Vector3.Forward());
      forward.y = 0;
      forward.normalize();
      
      const right = this.camera.getDirection(Vector3.Right());
      right.y = 0;
      right.normalize();
      
      const moveVector = right.scale(moveX).add(forward.scale(-moveY));
      this.targetPosition.addInPlace(moveVector);
    }
  }

  private applySmoothing(): void {
    if (this.isDragging || !this.camera) return;
    
    const smoothing = this.config.smoothing || 0.15;
    
    if (!this.camera.target.equals(this.targetPosition)) {
      this.camera.target = Vector3.Lerp(
        this.camera.target,
        this.targetPosition,
        smoothing
      );
      
      // Snap when close enough
      if (Vector3.DistanceSquared(this.camera.target, this.targetPosition) < 0.001) {
        this.camera.target.copyFrom(this.targetPosition);
      }
    }
  }
}
