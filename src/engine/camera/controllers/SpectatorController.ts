/**
 * SpectatorController — the camera behind a watched player's eyes.
 *
 * Implements ICameraController for demo playback and live chase spectating.
 * The target provider hands it one finished first-person pose a frame — the
 * interpolated sample the player is drawn with, plus their view effects — and
 * it writes that through the shared first-person path. No prediction, no
 * input, and no smoothing of its own: the sample is already smooth, and more
 * smoothing would put the view behind the world around it.
 *
 * Usage:
 *   const ctrl = new SpectatorController();
 *   ctrl.setTargetProvider((id) => poseFor(id));
 *   CameraSystem.getInstance().registerController('spectator', ctrl);
 *   CameraSystem.getInstance().setController('spectator');
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Scene } from "@babylonjs/core/scene";
import { devLog } from "../../core/DevLog";
import { applyFirstPersonPose, type FirstPersonPose, finitePose } from "../FirstPersonPose";
import { currentBaseFov } from "../FovSettings";
import { getGameFrameHook } from "../GameFrameHook";
import type { CameraControllerConfig, ICameraController } from "./ICameraController";
import { reusableFreeCamera } from "./ReusableFreeCamera";

// ─── Types ───────────────────────────────────────────────────────

/**
 * Provider callback that returns the watched player's view this frame.
 * Returns null if the entity doesn't exist or has no valid data.
 */
export type SpectatorTargetProvider = (entityId: string) => FirstPersonPose | null;

// ─── Controller ──────────────────────────────────────────────────

export class SpectatorController implements ICameraController {
  readonly type = "spectator";

  private camera: FreeCamera | null = null;
  /** The camera made here when attached to a non-FreeCamera, kept for the next attach. */
  private ownCamera: FreeCamera | null = null;
  private scene: Scene | null = null;
  private enabled: boolean = true;
  private renderObserver: any = null; // Babylon Observer handle

  // Target tracking
  private targetEntityId: string | null = null;
  private targetProvider: SpectatorTargetProvider | null = null;

  // Configuration
  private config: CameraControllerConfig = {};

  // ── ICameraController lifecycle ────────────────────────────────

  attach(camera: Camera, _scene: Scene, _canvas: HTMLCanvasElement): void {
    if (camera instanceof FreeCamera) {
      this.camera = camera;
    } else {
      // Create a FreeCamera if one doesn't exist, once: every attach made a
      // new one and none was disposed, one per cut in a cinematic demo.
      this.ownCamera = reusableFreeCamera(this.ownCamera, "spectatorCamera", camera.position, _scene);
      this.camera = this.ownCamera;
    }

    this.scene = _scene;

    // Clear inputs — we control the camera entirely
    this.camera.inputs.clear();

    // Set as active camera
    _scene.activeCamera = this.camera;

    // Reset rotation quaternion (Euler angles only)
    this.camera.rotationQuaternion = null;
    // Roll comes through the up vector, which Babylon otherwise recomputes
    // only on frames where the roll changes: a roll that settles at zero keeps
    // that frame's pitch in the up vector, and turning tilts the view sideways.
    this.camera.updateUpVectorFromRotation = true;

    // Register render loop — CameraSystem doesn't call update() for us
    // Guard: onBeforeRenderObservable may not exist in test mocks
    if (_scene.onBeforeRenderObservable) {
      this.renderObserver = _scene.onBeforeRenderObservable.add(() => {
        const dt = _scene.getEngine().getDeltaTime() / 1000; // ms → seconds
        this.update(dt);
      });
    }

    devLog("[SpectatorController] Attached");
  }

  detach(): void {
    // Remove render loop observer
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.camera = null;
    this.scene = null;
    devLog("[SpectatorController] Detached");
  }

  update(_deltaTime: number): void {
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

    if (!this.targetEntityId || !this.targetProvider) return;

    // No pose (the target is gone, or between snapshots): the camera holds.
    const pose = finitePose(this.targetProvider(this.targetEntityId));
    if (!pose) return;
    applyFirstPersonPose(this.camera, pose, this.config.fov ?? currentBaseFov());
  }

  configure(config: Partial<CameraControllerConfig>): void {
    Object.assign(this.config, config);
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
  }

  /**
   * Set the target entity to follow.
   * Named setSpectateTarget to avoid conflict with ICameraController.setTarget(Vector3).
   */
  setSpectateTarget(entityId: string): void {
    this.targetEntityId = entityId;
  }

  /**
   * Clear the target — camera stops following.
   */
  clearSpectateTarget(): void {
    this.targetEntityId = null;
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
}
