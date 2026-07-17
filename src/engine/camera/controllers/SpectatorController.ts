/**
 * SpectatorController — First-person chase-cam that follows a target player entity.
 *
 * Implements ICameraController. Reads target entity's position and rotation
 * from the latest GameState snapshot via a target provider callback.
 * No prediction, no input processing — purely follows server state.
 *
 * Usage:
 *   const ctrl = new SpectatorController();
 *   ctrl.setTargetProvider((id) => getLatestStateForEntity(id));
 *   CameraSystem.getInstance().registerController('spectator', ctrl);
 *   CameraSystem.getInstance().setController('spectator');
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { DEFAULT_VIEWHEIGHT } from "../../physics/PlayerPhysicsConstants";
import { getGameFrameHook } from "../GameFrameHook";
import type { CameraControllerConfig, ICameraController } from "./ICameraController";

// ─── Types ───────────────────────────────────────────────────────

/** Data returned by the target provider */
export interface SpectatorTargetData {
  /** World position of the target entity (Q3 origin — waist level) */
  x: number;
  y: number;
  z: number;
  /** Yaw rotation in radians */
  yaw: number;
  /** Pitch rotation in radians */
  pitch: number;
  /** Eye height above the entity origin. Defaults to the live FPS standing height. */
  eyeHeight?: number;
  /** Camera-local reconstructed presentation offsets (used by demo POV). */
  bobRight?: number;
  bobUp?: number;
  pitchOffsetDegrees?: number;
  rollDegrees?: number;
  /** The provider already returns an interpolated presentation sample. */
  snapToTarget?: boolean;
}

/**
 * Provider callback that returns the current state of a target entity.
 * Returns null if the entity doesn't exist or has no valid data.
 */
export type SpectatorTargetProvider = (entityId: string) => SpectatorTargetData | null;

// ─── Constants ───────────────────────────────────────────────────

/** Default smoothing factor (0 = no smoothing, 1 = instant snap) */
const DEFAULT_SMOOTHING = 0.25;

/** Snap threshold — if distance exceeds this, snap immediately (teleport / first frame) */
const SNAP_DISTANCE_THRESHOLD = 500;

// ─── Controller ──────────────────────────────────────────────────

export class SpectatorController implements ICameraController {
  readonly type = "spectator";

  private camera: FreeCamera | null = null;
  private scene: Scene | null = null;
  private enabled: boolean = true;
  private renderObserver: any = null; // Babylon Observer handle

  // Target tracking
  private targetEntityId: string | null = null;
  private targetProvider: SpectatorTargetProvider | null = null;

  // Smoothed state
  private smoothedPosition: Vector3 = Vector3.Zero();
  private smoothedYaw: number = 0;
  private smoothedPitch: number = 0;
  private hasInitialPosition: boolean = false;

  // Configuration
  private config: CameraControllerConfig = {
    smoothing: DEFAULT_SMOOTHING,
  };

  // ── ICameraController lifecycle ────────────────────────────────

  attach(camera: Camera, _scene: Scene, _canvas: HTMLCanvasElement): void {
    if (camera instanceof FreeCamera) {
      this.camera = camera;
    } else {
      // Create a FreeCamera if one doesn't exist
      this.camera = new FreeCamera("spectatorCamera", camera.position.clone(), _scene);
    }

    this.scene = _scene;

    // Clear inputs — we control the camera entirely
    this.camera.inputs.clear();

    // Set as active camera
    _scene.activeCamera = this.camera;

    // Reset rotation quaternion (Euler angles only)
    this.camera.rotationQuaternion = null;

    // Reset smoothing state
    this.hasInitialPosition = false;

    // Register render loop — CameraSystem doesn't call update() for us
    // Guard: onBeforeRenderObservable may not exist in test mocks
    if (_scene.onBeforeRenderObservable) {
      this.renderObserver = _scene.onBeforeRenderObservable.add(() => {
        const dt = _scene.getEngine().getDeltaTime() / 1000; // ms → seconds
        this.update(dt);
      });
    }

    console.log("[SpectatorController] Attached");
  }

  detach(): void {
    // Remove render loop observer
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.camera = null;
    this.scene = null;
    this.hasInitialPosition = false;
    console.log("[SpectatorController] Detached");
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.camera) return;

    // Tick the network and render remote players (same as FreeflyController).
    // Via the injected game frame hook — no direct game import (QA-WO7).
    try {
      const game = getGameFrameHook();
      if (game?.isGameRunning()) {
        game.processSnapshots();
        game.renderRemotePlayers();
      }
    } catch (_e) {
      // Ignore if not initialized yet
    }

    if (!this.targetEntityId || !this.targetProvider) {
      return;
    }

    // Read target entity state from provider
    const target = this.targetProvider(this.targetEntityId);
    if (!target) {
      // Target entity is gone — don't move camera
      return;
    }

    // Calculate eye position (Q3 origin + eye height)
    const eyeX = target.x;
    const eyeY = target.y + (target.eyeHeight ?? DEFAULT_VIEWHEIGHT);
    const eyeZ = target.z;

    if (!this.hasInitialPosition || target.snapToTarget) {
      // First frame — snap to target immediately
      this.smoothedPosition.set(eyeX, eyeY, eyeZ);
      this.smoothedYaw = target.yaw;
      this.smoothedPitch = target.pitch;
      this.hasInitialPosition = true;
    } else {
      // Calculate distance to determine snap vs smoothing
      const dx = eyeX - this.smoothedPosition.x;
      const dy = eyeY - this.smoothedPosition.y;
      const dz = eyeZ - this.smoothedPosition.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance > SNAP_DISTANCE_THRESHOLD) {
        // Teleport — snap immediately
        this.smoothedPosition.set(eyeX, eyeY, eyeZ);
        this.smoothedYaw = target.yaw;
        this.smoothedPitch = target.pitch;
      } else {
        // Exponential interpolation for smooth following
        const smoothing = this.config.smoothing ?? DEFAULT_SMOOTHING;
        // Frame-rate independent smoothing: factor = 1 - (1 - s)^(dt * 60)
        const factor = 1 - (1 - smoothing) ** (deltaTime * 60);

        this.smoothedPosition.x += dx * factor;
        this.smoothedPosition.y += dy * factor;
        this.smoothedPosition.z += dz * factor;

        // Smooth yaw (handle wrap-around)
        let yawDiff = target.yaw - this.smoothedYaw;
        if (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        if (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
        this.smoothedYaw += yawDiff * factor;

        // Smooth pitch (no wrap-around needed)
        this.smoothedPitch += (target.pitch - this.smoothedPitch) * factor;
      }
    }

    // Apply to camera
    const bobRight = target.bobRight ?? 0;
    const bobUp = target.bobUp ?? 0;
    // Match FPSApplicator's camera-local right axis without mutating the
    // smoothed authoritative base position.
    const bobX = Math.cos(this.smoothedYaw) * bobRight;
    const bobZ = -Math.sin(this.smoothedYaw) * bobRight;
    this.camera.position.set(
      this.smoothedPosition.x + bobX,
      this.smoothedPosition.y + bobUp,
      this.smoothedPosition.z + bobZ,
    );
    this.camera.rotation.set(
      this.smoothedPitch + ((target.pitchOffsetDegrees ?? 0) * Math.PI) / 180,
      this.smoothedYaw,
      ((target.rollDegrees ?? 0) * Math.PI) / 180,
    );
  }

  configure(config: Partial<CameraControllerConfig>): void {
    Object.assign(this.config, config);
    // Clamp smoothing to [0, 1] — values > 1.0 produce NaN via Math.pow(negative, fractional)
    if (this.config.smoothing !== undefined) {
      this.config.smoothing = Math.max(0, Math.min(this.config.smoothing, 1));
    }
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
    this.targetEntityId = null;
    this.targetProvider = null;
    this.smoothedPosition = Vector3.Zero();
    this.smoothedYaw = 0;
    this.smoothedPitch = 0;
  }

  // ── Spectator-specific API ─────────────────────────────────────

  /**
   * Set the target provider callback.
   * The provider resolves an entity ID to its current position/rotation.
   */
  setTargetProvider(provider: SpectatorTargetProvider): void {
    this.targetProvider = provider;
  }

  /** Release a provider closure owned by a stopped playback/live session. */
  clearTargetProvider(): void {
    this.targetProvider = null;
    this.hasInitialPosition = false;
  }

  /**
   * Set the target entity to follow.
   * Named setSpectateTarget to avoid conflict with ICameraController.setTarget(Vector3).
   */
  setSpectateTarget(entityId: string): void {
    this.targetEntityId = entityId;
    // Reset smoothing so first frame snaps to new target
    this.hasInitialPosition = false;
  }

  /**
   * Clear the target — camera stops following.
   */
  clearSpectateTarget(): void {
    this.targetEntityId = null;
    this.hasInitialPosition = false;
  }

  /**
   * Get the ID of the currently followed entity.
   */
  getTargetEntityId(): string | null {
    return this.targetEntityId;
  }

  /**
   * Get the FreeCamera created by this controller.
   * Returns null until attach() has been called.
   * Used by DemoService to hand the spectator camera to WeaponViewManager.
   */
  getCamera(): FreeCamera | null {
    return this.camera;
  }

  /**
   * Get the smoothed position (for external use, e.g. audio positioning).
   */
  getSmoothedPosition(): { x: number; y: number; z: number } {
    return {
      x: this.smoothedPosition.x,
      y: this.smoothedPosition.y,
      z: this.smoothedPosition.z,
    };
  }
}
