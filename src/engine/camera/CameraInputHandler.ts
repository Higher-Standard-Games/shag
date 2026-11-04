/**
 * CameraInputHandler - Shared input handler logic for camera controllers.
 *
 * Encapsulates the common capture (pointer lock, or touch play on a touch
 * screen; see PlayCapture), look, and key prevention boilerplate that both
 * FPSController and FreeflyController duplicate.
 * Each controller uses this utility via composition, keeping their
 * own update() and gameplay-specific input handling independent.
 */

import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Cvar } from "../core/Cvar";
import { devLog } from "../core/DevLog";
import { InputDevice } from "../input/InputDevice";
import { inPlay, PLAY_CHANGE, setTouchPlay } from "../input/PlayCapture";
import { requestRawPointerLock } from "../input/RawPointerLock";
import { clearBrowserControlFailure, showBrowserControlFailure } from "../ui/BrowserControlFeedback";
import type { CameraControllerConfig } from "./controllers/ICameraController";

export interface MouseLookState {
  rotationX: number; // Pitch (vertical)
  rotationY: number; // Yaw (horizontal)
}

/** Reshapes a look turn (radians) given the view's yaw and pitch before it. */
export type LookShape = (yaw: number, pitch: number, viewYaw: number, viewPitch: number) => [number, number];

export interface PointerLockCallbacks {
  /** Called when play starts: pointer lock, or touch play */
  onLocked?: () => void;
  /** Called when play ends — controller should zero out keys */
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
  private _onPointerLockError: (() => void) | null = null;
  private _inPlay = false;
  private _onPlayChange: (() => void) | null = null;
  private _onCanvasTouch: ((e: PointerEvent) => void) | null = null;
  private captureGeneration = 0;
  private capturePending = false;
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

  /** In play: the pointer is locked, or touch play holds the input. */
  get inPlay(): boolean {
    return this._inPlay;
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
      // Touch controls forced on a mouse (in_touch 1): the click starts touch play
      if (InputDevice.getInstance().current === "touch") {
        setTouchPlay(true);
        return;
      }
      if (!this._isPointerLocked && this.canvas && !this.capturePending) {
        this.capturePending = true;
        const generation = ++this.captureGeneration;
        requestRawPointerLock(this.canvas).catch(() => {
          if (generation === this.captureGeneration) this._onPointerLockError?.();
        });
      }
    };

    // A tap starts touch play. Touches on the canvas cancel their default, so
    // the browser sends no click for them: the touch's own pointer event is it.
    this._onCanvasTouch = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || e.target !== this.canvas) return;
      if (this._lookFrozen || !this.captureEnabled) return;
      setTouchPlay(true);
    };

    // Pointer lock state change
    this._onPointerLockChange = () => {
      this.capturePending = false;
      this._isPointerLocked = document.pointerLockElement === this.canvas;
      if (this._isPointerLocked) clearBrowserControlFailure("pointer");
    };

    // Play starts and ends with pointer lock or touch play alike
    this._inPlay = inPlay();
    this._onPlayChange = () => {
      const playing = inPlay();
      if (playing === this._inPlay) return;
      this._inPlay = playing;
      if (playing) {
        devLog(`[${this.controllerName}] In play`);
        this.callbacks.onLocked?.();
      } else {
        devLog(`[${this.controllerName}] Out of play - click or tap to resume`);
        this.callbacks.onUnlocked?.();
      }
    };

    this._onPointerLockError = () => {
      if (!this.capturePending) return;
      this.capturePending = false;
      if (!this.captureEnabled || this._lookFrozen || !this.canvas) return;
      showBrowserControlFailure("Your browser did not capture the mouse. Click the game to try again.", "pointer");
    };

    // Mouse look (only when pointer is locked)
    this._onMouseMove = (e: MouseEvent) => {
      if (!this._isPointerLocked) return;
      const baseSensitivity = this.config.mouseSensitivity || 0.002;
      const sensitivityMultiplier = Cvar.getNumber("m_sensitivity") ?? 1.0;
      this.applyLookDelta(e.movementX, e.movementY, baseSensitivity * sensitivityMultiplier);
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
    canvas.addEventListener("pointerdown", this._onCanvasTouch);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    document.addEventListener(PLAY_CHANGE, this._onPlayChange);
    document.addEventListener("pointerlockerror", this._onPointerLockError);
    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    canvas.addEventListener("contextmenu", this._onContextMenu);
  }

  /**
   * Turn the view by `dx`, `dy` (pointer units) at `sensitivity` radians per
   * unit, through the controller's modifier (ADS), invert, and the pitch clamp.
   * Mouse look calls it; touch look calls it with its own sensitivity, and
   * `shape` (touch aim assist) gets the final turn in radians, with the view's
   * yaw and pitch before it, and returns the turn to apply.
   */
  applyLookDelta(dx: number, dy: number, sensitivity: number, shape?: LookShape): void {
    if (!this.camera || this._lookFrozen) return; // post-game screen: aim is locked
    if (this.mouseLookModifier) sensitivity = this.mouseLookModifier(sensitivity);
    const invertY = this.config.invertY || Cvar.getBool("m_invertY") ? -1 : 1;

    let yaw = dx * sensitivity;
    let pitch = dy * sensitivity * invertY;
    if (shape) [yaw, pitch] = shape(yaw, pitch, this._mouseRotationY, this._mouseRotationX);
    this._mouseRotationY += yaw;
    this._mouseRotationX += pitch;
    this._mouseRotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this._mouseRotationX));

    // Custom applier, or straight to the camera
    if (this.rotationApplier) {
      this.rotationApplier(this._mouseRotationX, this._mouseRotationY);
    } else {
      this.camera.rotation.x = this._mouseRotationX;
      this.camera.rotation.y = this._mouseRotationY;
    }
  }

  /**
   * Remove all event listeners and end play.
   */
  teardown(): void {
    this.captureGeneration++;
    this.capturePending = false;
    if (this._isPointerLocked) {
      document.exitPointerLock();
    }
    setTouchPlay(false);
    if (this._onPlayChange) document.removeEventListener(PLAY_CHANGE, this._onPlayChange);
    this._onPlayChange = null;

    if (this.canvas) {
      if (this._onCanvasClick) this.canvas.removeEventListener("click", this._onCanvasClick);
      if (this._onCanvasTouch) this.canvas.removeEventListener("pointerdown", this._onCanvasTouch);
      if (this._onContextMenu) this.canvas.removeEventListener("contextmenu", this._onContextMenu);
    }
    if (this._onPointerLockChange) document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    if (this._onPointerLockError) document.removeEventListener("pointerlockerror", this._onPointerLockError);
    if (this._onMouseMove) document.removeEventListener("mousemove", this._onMouseMove);
    if (this._onKeyDown) document.removeEventListener("keydown", this._onKeyDown);
    if (this._onKeyUp) document.removeEventListener("keyup", this._onKeyUp);

    this._onCanvasClick = null;
    this._onCanvasTouch = null;
    this._onPointerLockChange = null;
    this._onPointerLockError = null;
    this._onMouseMove = null;
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onContextMenu = null;
    this._isPointerLocked = false;
    this._inPlay = false;
    this.canvas = null;
    this.camera = null;
  }
}
