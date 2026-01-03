/**
 * CameraSystem - Central camera management for the engine
 * 
 * Manages camera controllers, modes, and presets.
 * Allows runtime switching between different camera behaviors.
 */

import {
  ArcRotateCamera,
  Camera,
  FreeCamera,
  Scene,
  Vector3,
} from "babylonjs";
import { ICameraController } from "./controllers/ICameraController";
import { CameraPreset, CameraMode, CAMERA_PRESETS, getCameraPreset } from "./CameraPresets";
import { EventBus } from "../core/EventBus";

export interface CameraSystemConfig {
  /** Default camera mode */
  defaultMode?: CameraMode;
  /** Default camera height */
  defaultHeight?: number;
  /** Default controller type */
  defaultController?: string;
}

export class CameraSystem {
  private static instance: CameraSystem;
  
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private camera: Camera | null = null;
  
  private activeController: ICameraController | null = null;
  private controllers: Map<string, ICameraController> = new Map();
  
  private currentMode: CameraMode = "perspective";
  private currentHeight: number = 800;
  private currentPreset: string | null = null;
  
  // Store original camera for restoration when switching controllers
  private originalCamera: Camera | null = null;
  
  // Camera bounds (optional)
  private minBounds: Vector3 | null = null;
  private maxBounds: Vector3 | null = null;

  private constructor() {}

  static getInstance(): CameraSystem {
    if (!CameraSystem.instance) {
      CameraSystem.instance = new CameraSystem();
    }
    return CameraSystem.instance;
  }

  /** Get current preset name */
  getCurrentPreset(): string | null {
    return this.currentPreset;
  }

  /**
   * Initialize the camera system with a scene and canvas
   */
  init(scene: Scene, canvas: HTMLCanvasElement, config?: CameraSystemConfig): void {
    this.scene = scene;
    this.canvas = canvas;
    
    if (config) {
      if (config.defaultMode) this.currentMode = config.defaultMode;
      if (config.defaultHeight) this.currentHeight = config.defaultHeight;
    }
  }

  /**
   * Set the camera reference (for cameras created externally)
   */
  setCamera(camera: Camera): void {
    this.camera = camera;
    this.originalCamera = camera; // Store as original for restoration
  }

  /**
   * Register a camera controller
   */
  registerController(type: string, controller: ICameraController): void {
    this.controllers.set(type, controller);
  }

  /**
   * Get a registered controller by type
   */
  getController(type: string): ICameraController | undefined {
    return this.controllers.get(type);
  }

  /**
   * Get the currently active controller
   */
  getActiveController(): ICameraController | null {
    return this.activeController;
  }

  /**
   * Set the active controller directly (for controllers attached externally)
   */
  setActiveController(controller: ICameraController): void {
    this.activeController = controller;
  }

  /**
   * Get the current camera
   */
  getCamera(): Camera | null {
    return this.camera;
  }

  /**
   * Get camera as ArcRotateCamera (if applicable)
   */
  getArcRotateCamera(): ArcRotateCamera | null {
    if (this.camera instanceof ArcRotateCamera) {
      return this.camera;
    }
    return null;
  }

  /**
   * Get camera as FreeCamera (if applicable)
   */
  getFreeCamera(): FreeCamera | null {
    if (this.camera instanceof FreeCamera) {
      return this.camera;
    }
    return null;
  }

  /**
   * Set the active camera controller
   */
  setController(type: string): boolean {
    const controller = this.controllers.get(type);
    if (!controller) {
      console.error(`[CameraSystem] Controller not found: ${type}`);
      return false;
    }

    if (!this.scene || !this.canvas || !this.camera) {
      console.error("[CameraSystem] Not initialized");
      return false;
    }

    // Detach current controller
    if (this.activeController) {
      this.activeController.detach();
    }

    // For controllers that need ArcRotateCamera, restore original if it exists
    let cameraToUse = this.camera;
    const needsArcRotate = ["isometric", "sidescroll", "follow"].includes(type);
    if (needsArcRotate && this.originalCamera && this.originalCamera !== this.scene.activeCamera) {
      // Dispose the temporary camera created by FPS controller
      if (this.scene.activeCamera && this.scene.activeCamera !== this.originalCamera) {
        this.scene.activeCamera.dispose();
      }
      this.scene.activeCamera = this.originalCamera;
      cameraToUse = this.originalCamera;
      this.camera = this.originalCamera;
      console.log("[CameraSystem] Restored original ArcRotateCamera");
    }

    // Attach new controller
    controller.attach(cameraToUse, this.scene, this.canvas);
    this.activeController = controller;
    
    console.log(`[CameraSystem] Switched to controller: ${type}`);
    EventBus.emit("camera:controller_changed", { type });
    
    return true;
  }

  /**
   * Create and set up a camera based on mode
   */
  createCamera(mode: CameraMode, target: Vector3 = Vector3.Zero()): Camera {
    if (!this.scene) {
      throw new Error("[CameraSystem] Scene not initialized");
    }

    // Dispose existing camera
    if (this.camera) {
      this.camera.dispose();
    }

    this.currentMode = mode;

    switch (mode) {
      case "perspective":
      case "fake_ortho":
        this.camera = new ArcRotateCamera(
          "camera",
          -Math.PI / 4,
          Math.PI / 4,
          this.currentHeight,
          target,
          this.scene
        );
        break;
        
      case "orthographic":
        this.camera = new ArcRotateCamera(
          "camera",
          -Math.PI / 4,
          Math.PI / 4,
          this.currentHeight * 2,
          target,
          this.scene
        );
        (this.camera as ArcRotateCamera).mode = Camera.ORTHOGRAPHIC_CAMERA;
        break;
    }

    // Clear default inputs - controllers will handle input
    this.camera.inputs.clear();
    
    // Apply mode-specific settings
    this.applyCameraMode(mode);

    return this.camera;
  }

  /**
   * Apply camera mode settings
   */
  applyCameraMode(mode: CameraMode): void {
    if (!this.camera) return;

    const arcCamera = this.camera as ArcRotateCamera;
    
    switch (mode) {
      case "perspective":
        arcCamera.mode = Camera.PERSPECTIVE_CAMERA;
        arcCamera.fov = 0.8;
        arcCamera.radius = this.currentHeight;
        arcCamera.minZ = 1;
        arcCamera.maxZ = 10000;
        break;

      case "orthographic":
        arcCamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
        arcCamera.radius = Math.max(500, this.currentHeight * 2);
        arcCamera.minZ = -10000;
        arcCamera.maxZ = 10000;
        this.updateOrthoSize(this.currentHeight);
        break;

      case "fake_ortho":
        arcCamera.mode = Camera.PERSPECTIVE_CAMERA;
        const baseFov = 0.3;
        const fovScale = Math.min(0.6, baseFov + (this.currentHeight - 100) / 1000);
        arcCamera.fov = fovScale;
        arcCamera.radius = this.currentHeight * 2;
        arcCamera.minZ = 0.1;
        arcCamera.maxZ = Math.max(5000, this.currentHeight * 4);
        break;
    }

    this.currentMode = mode;
    console.log(`[CameraSystem] Applied mode: ${mode}, height: ${this.currentHeight}`);
  }

  /**
   * Update orthographic camera size
   */
  private updateOrthoSize(size: number): void {
    if (!this.camera || !this.canvas) return;
    
    const arcCamera = this.camera as ArcRotateCamera;
    const ratio = this.canvas.width / this.canvas.height;
    
    arcCamera.orthoTop = size;
    arcCamera.orthoBottom = -size;
    arcCamera.orthoLeft = -size * ratio;
    arcCamera.orthoRight = size * ratio;
  }

  /**
   * Apply a camera preset
   */
  applyPreset(presetName: string): boolean {
    const preset = getCameraPreset(presetName);
    if (!preset) {
      console.error(`[CameraSystem] Preset not found: ${presetName}`);
      return false;
    }

    return this.applyPresetConfig(preset);
  }

  /**
   * Apply a preset configuration directly
   */
  applyPresetConfig(preset: CameraPreset): boolean {
    if (!this.scene || !this.canvas) {
      console.error("[CameraSystem] Not initialized");
      return false;
    }

    // Update height before creating camera
    this.currentHeight = preset.height;

    // Create appropriate camera
    const target = this.camera instanceof ArcRotateCamera 
      ? (this.camera as ArcRotateCamera).target.clone()
      : Vector3.Zero();
    
    this.createCamera(preset.cameraMode, target);

    // Apply angles
    const arcCamera = this.camera as ArcRotateCamera;
    if (arcCamera) {
      arcCamera.alpha = preset.alpha;
      arcCamera.beta = preset.beta;
      
      if (preset.fov !== undefined) {
        arcCamera.fov = preset.fov;
      }
      if (preset.orthoSize !== undefined && preset.cameraMode === "orthographic") {
        this.updateOrthoSize(preset.orthoSize);
      }
    }

    // Switch to appropriate controller
    if (this.controllers.has(preset.controllerType)) {
      this.setController(preset.controllerType);
      
      // Apply controller config
      if (preset.controllerConfig && this.activeController) {
        this.activeController.configure(preset.controllerConfig);
      }
    }

    this.currentPreset = preset.name;
    console.log(`[CameraSystem] Applied preset: ${preset.name}`);
    EventBus.emit("camera:preset_changed", { preset: preset.name });

    return true;
  }

  /**
   * Set camera height/distance
   */
  setHeight(height: number): void {
    this.currentHeight = height;
    this.applyCameraMode(this.currentMode);
  }

  /**
   * Get current camera height
   */
  getHeight(): number {
    return this.currentHeight;
  }

  /**
   * Get current camera mode
   */
  getMode(): CameraMode {
    return this.currentMode;
  }

  /**
   * Set camera target position
   */
  setTarget(target: Vector3): void {
    if (this.camera instanceof ArcRotateCamera) {
      this.camera.setTarget(target);
    }
    
    // Also notify controller
    if (this.activeController?.setTarget) {
      this.activeController.setTarget(target);
    }
  }

  /**
   * Get camera target position
   */
  getTarget(): Vector3 {
    if (this.camera instanceof ArcRotateCamera) {
      return this.camera.target.clone();
    }
    if (this.camera instanceof FreeCamera) {
      return this.camera.position.clone();
    }
    return Vector3.Zero();
  }

  /**
   * Set camera bounds for movement limiting
   */
  setBounds(min: Vector3, max: Vector3): void {
    this.minBounds = min;
    this.maxBounds = max;
  }

  /**
   * Clear camera bounds
   */
  clearBounds(): void {
    this.minBounds = null;
    this.maxBounds = null;
  }

  /**
   * Get camera bounds
   */
  getBounds(): { min: Vector3 | null; max: Vector3 | null } {
    return { min: this.minBounds, max: this.maxBounds };
  }

  /**
   * Clamp a position to camera bounds
   */
  clampToBounds(position: Vector3): Vector3 {
    if (!this.minBounds || !this.maxBounds) {
      return position;
    }

    return new Vector3(
      Math.max(this.minBounds.x, Math.min(this.maxBounds.x, position.x)),
      Math.max(this.minBounds.y, Math.min(this.maxBounds.y, position.y)),
      Math.max(this.minBounds.z, Math.min(this.maxBounds.z, position.z))
    );
  }

  /**
   * Get all available preset names
   */
  getPresetNames(): string[] {
    return Object.keys(CAMERA_PRESETS);
  }

  /**
   * Get all registered controller types
   */
  getControllerTypes(): string[] {
    return Array.from(this.controllers.keys());
  }

  /**
   * Handle window resize
   */
  onResize(): void {
    if (this.currentMode === "orthographic") {
      this.updateOrthoSize(this.currentHeight);
    }
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    // Detach active controller
    if (this.activeController) {
      this.activeController.detach();
      this.activeController = null;
    }

    // Dispose all controllers
    for (const controller of this.controllers.values()) {
      controller.dispose();
    }
    this.controllers.clear();

    // Dispose camera
    if (this.camera) {
      this.camera.dispose();
      this.camera = null;
    }

    this.scene = null;
    this.canvas = null;
  }
}
