/**
 * CameraInputHandler - Shared input handler logic for camera controllers.
 *
 * Encapsulates the common pointer lock, mouse look, and key prevention
 * boilerplate that both FPSController and FreeflyController duplicate.
 * Each controller uses this utility via composition, keeping their
 * own update() and gameplay-specific input handling independent.
 */

import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Cvar } from "../core/Cvar";
import type { CameraControllerConfig } from "./controllers/ICameraController";

export interface MouseLookState {
  rotationX: number; // Pitch (vertical)
  rotationY: number; // Yaw (horizontal)
}

export interface PointerLockCallbacks {
  /** Called when pointer lock is acquired */
  onLocked?: () => void;
  /** Called when pointer lock is released — controller should zero out keys */
  onUnlocked?: () => void;
}

export class CameraInputHandler {
  private canvas: HTMLCanvasElement | null = null;
  private camera: FreeCamera | null = null;
  private config: CameraControllerConfig = {};
  private _isPointerLocked: boolean = false;
  private controllerName: string = "Camera";

  // Pointer lock callbacks
  private callbacks: PointerLockCallbacks = {};

  // Optional per-controller mouse look customizer (e.g. FPS adds ADS sensitivity)
  private mouseLookModifier: ((sensitivity: number) => number) | null = null;

  // Optional per-controller camera rotation applier
  // FPS needs to store rotation separately (mouseRotationX/Y) for slide/ledge offsets
  // Freefly writes directly to camera.rotation
  private rotationApplier: ((rotX: number, rotY: number) => void) | null = null;

  // Tracked mouse rotation (used when controller stores separately from camera)
  private _mouseRotationX: number = 0;
  private _mouseRotationY: number = 0;

  // Bound event handlers for cleanup
  private _onCanvasClick: ((e: MouseEvent) => void) | null = null;
  private _onPointerLockChange: (() => void) | null = null;
  private _onMouseMove: ((e: MouseEvent) => void) | null = null;

  /** While true, mouse-look is ignored WITHOUT releasing pointer lock (unlike
   *  a full disable, which would exit pointer lock and pop the pause menu).
   *  Used by the post-game screen to freeze aim while the board is up. */
  private _lookFrozen: boolean = false;
  private captureEnabled = true;

  setLookFrozen(frozen: boolean): void {
    this._lookFrozen = frozen;
  }

  /** Suspend gameplay click-to-lock while another view owns the shared canvas. */
  setCaptureEnabled(enabled: boolean): void {
    this.captureEnabled = enabled;
  }
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private _onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private _onContextMenu: ((e: Event) => void) | null = null;

  get isPointerLocked(): boolean {
    return this._isPointerLocked;
  }

  get mouseRotationX(): number {
    return this._mouseRotationX;
  }
  get mouseRotationY(): number {
    return this._mouseRotationY;
  }

  set mouseRotationX(v: number) {
    this._mouseRotationX = v;
  }
  set mouseRotationY(v: number) {
    this._mouseRotationY = v;
  }

  /**
   * Set up all shared input handlers.
   *
   * @param canvas - The rendering canvas
   * @param camera - The active FreeCamera
   * @param config - Controller config (sensitivity, invertY, etc.)
   * @param controllerName - Name for log messages (e.g. "FPSController")
   * @param callbacks - Optional callbacks for pointer lock state changes
   * @param options - Optional customization hooks
   */
  setup(
    canvas: HTMLCanvasElement,
    camera: FreeCamera,
    config: CameraControllerConfig,
    controllerName: string,
    callbacks?: PointerLockCallbacks,
    options?: {
      /** Transform sensitivity (e.g. apply ADS multiplier) */
      mouseLookModifier?: (sensitivity: number) => number;
      /** Custom rotation applier (e.g. FPS stores separately, Freefly writes to camera) */
      rotationApplier?: (rotX: number, rotY: number) => void;
      /** Extra keys to preventDefault (FPS adds Ctrl + Tab + F4) */
      extraPreventDefaultKeys?: string[];
    },
  ): void {
    this.canvas = canvas;
    this.camera = camera;
    this.config = config;
    this.controllerName = controllerName;
    this.callbacks = callbacks || {};
    this.mouseLookModifier = options?.mouseLookModifier || null;
    this.rotationApplier = options?.rotationApplier || null;
    const extraKeys = options?.extraPreventDefaultKeys || [];

    // Click to capture mouse
    this._onCanvasClick = (e: MouseEvent) => {
      if (e.target !== this.canvas) return;
      // Post-game "open up": the cursor is deliberately free (chat + return
      // button) — don't re-capture on a stray world click while look is frozen.
      if (this._lookFrozen || !this.captureEnabled) return;
      if (!this._isPointerLocked && this.canvas) {
        this.canvas.requestPointerLock();
      }
    };

    // Pointer lock state change
    this._onPointerLockChange = () => {
      this._isPointerLocked = document.pointerLockElement === this.canvas;
      if (this._isPointerLocked) {
        console.log(`[${this.controllerName}] Mouse captured - WASD to move, ESC to release`);
        this.callbacks.onLocked?.();
      } else {
        console.log(`[${this.controllerName}] Mouse released - Click to capture`);
        this.callbacks.onUnlocked?.();
      }
    };

    // Mouse look (only when pointer is locked)
    this._onMouseMove = (e: MouseEvent) => {
      if (!this._isPointerLocked || !this.camera) return;
      if (this._lookFrozen) return; // post-game screen: aim is locked, pointer lock stays held

      const baseSensitivity = this.config.mouseSensitivity || 0.002;
      const sensitivityMultiplier = Cvar.getNumber("m_sensitivity") ?? 1.0;
      let sensitivity = baseSensitivity * sensitivityMultiplier;

      // Apply controller-specific modifier (e.g. ADS reduction)
      if (this.mouseLookModifier) {
        sensitivity = this.mouseLookModifier(sensitivity);
      }

      const invertYCvar = Cvar.getBool("m_invertY");
      const invertY = this.config.invertY || invertYCvar ? -1 : 1;

      // Update tracked rotation
      this._mouseRotationY += e.movementX * sensitivity;
      this._mouseRotationX += e.movementY * sensitivity * invertY;

      // Clamp vertical rotation
      this._mouseRotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this._mouseRotationX));

      // Apply rotation — custom applier or direct to camera
      if (this.rotationApplier) {
        this.rotationApplier(this._mouseRotationX, this._mouseRotationY);
      } else if (this.camera) {
        this.camera.rotation.x = this._mouseRotationX;
        this.camera.rotation.y = this._mouseRotationY;
      }
    };

    // Key prevention (Space + any extras)
    this._onKeyDown = (e: KeyboardEvent) => {
      if (!this._isPointerLocked) return;
      if (e.code === "Space") e.preventDefault();
      for (const key of extraKeys) {
        if (e.ctrlKey && key === "Ctrl") {
          e.preventDefault();
          continue;
        }
        if (e.code === key) e.preventDefault();
      }
    };

    this._onKeyUp = () => {
      // No-op: key state is driven by InputSystem in syncKeysFromInput()
    };

    // Prevent context menu on right click
    this._onContextMenu = (e: Event) => {
      if (this._isPointerLocked) e.preventDefault();
    };

    // Attach listeners
    canvas.addEventListener("click", this._onCanvasClick);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    canvas.addEventListener("contextmenu", this._onContextMenu);
  }

  /**
   * Remove all event listeners and release pointer lock.
   */
  teardown(): void {
    if (this._isPointerLocked) {
      document.exitPointerLock();
    }

    if (this.canvas) {
      if (this._onCanvasClick) this.canvas.removeEventListener("click", this._onCanvasClick);
      if (this._onContextMenu) this.canvas.removeEventListener("contextmenu", this._onContextMenu);
    }
    if (this._onPointerLockChange) document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    if (this._onMouseMove) document.removeEventListener("mousemove", this._onMouseMove);
    if (this._onKeyDown) document.removeEventListener("keydown", this._onKeyDown);
    if (this._onKeyUp) document.removeEventListener("keyup", this._onKeyUp);

    this._onCanvasClick = null;
    this._onPointerLockChange = null;
    this._onMouseMove = null;
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onContextMenu = null;
    this._isPointerLocked = false;
    this.canvas = null;
    this.camera = null;
  }
}
