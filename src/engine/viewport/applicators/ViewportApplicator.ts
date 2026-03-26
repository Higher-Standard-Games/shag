/**
 * ViewportApplicator - Base interface for camera-specific delta application
 *
 * Different camera types interpret ViewportDelta differently:
 * - FPS: Direct camera offset/rotation
 * - Isometric: Target point offset, zoom
 * - ThirdPerson: Orbit offset, distance
 *
 * This abstraction allows effects to be camera-agnostic.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { ViewportDelta } from "../ViewportDelta";

export interface ViewportApplicator {
  /** Camera type this applicator handles */
  readonly cameraType: string;

  /**
   * Apply a viewport delta to the camera
   * @param delta Combined delta from all effects
   * @param camera The camera to modify
   * @param baseFOV Base FOV before effects (for FOV multiplier)
   */
  apply(delta: ViewportDelta, camera: Camera, baseFOV: number): void;

  /**
   * Reset camera to neutral state (remove all effect modifications)
   * @param camera The camera to reset
   * @param baseFOV Original base FOV
   */
  reset(camera: Camera, baseFOV: number): void;
}
