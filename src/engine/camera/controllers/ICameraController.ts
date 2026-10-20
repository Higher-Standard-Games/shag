/**
 * ICameraController - Interface for all camera controllers
 *
 * Engine-level abstraction that allows different camera behaviors
 * (isometric, FPS, side-scroll, follow) to be swapped at runtime.
 */

import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

export interface CameraControllerConfig {
  /** Smoothing factor for camera movement (0-1, higher = faster) */
  smoothing?: number;
  /** Movement speed multiplier */
  speed?: number;
  /** Whether to enable edge scrolling (for RTS-style) */
  edgeScrollEnabled?: boolean;
  /** Edge scroll threshold in pixels */
  edgeScrollThreshold?: number;
  /** Minimum zoom/distance */
  minDistance?: number;
  /** Maximum zoom/distance */
  maxDistance?: number;
  /** Lock vertical axis (for side-scrollers) */
  lockY?: boolean;
  /** Lock horizontal axis */
  lockX?: boolean;
  /** Mouse sensitivity (for FPS) */
  mouseSensitivity?: number;
  /** Invert Y axis */
  invertY?: boolean;
  /** Field of view in radians (for FPS/perspective cameras) */
  fov?: number;
}

export interface ICameraController {
  /** Unique identifier for this controller type */
  readonly type: string;

  /**
   * Attach this controller to a camera and scene
   * Sets up input handlers and observers
   */
  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void;

  /**
   * Detach this controller, removing all handlers
   * Does NOT dispose the camera
   */
  detach(): void;

  /**
   * Called every frame to update camera position/rotation
   * @param deltaTime - Time since last frame in seconds
   */
  update(deltaTime: number): void;

  /**
   * Set the camera's target position (for orbit/isometric cameras)
   * @param target - World position or node to target
   */
  setTarget?(target: Vector3 | TransformNode): void;

  /**
   * Get the current target position
   */
  getTarget?(): Vector3;

  /**
   * Set a node for the camera to follow (for follow cameras)
   * @param node - The transform node to follow
   * @param offset - Optional offset from the node
   */
  setFollowTarget?(node: TransformNode, offset?: Vector3): void;

  /** Move the viewer (player origin for first-person controllers) to `position`. */
  setPosition?(position: Vector3): void;

  /** The player's position, for controllers that drive a body rather than a free camera. */
  getPlayerPosition?(): Vector3;

  /** Shake the view; an `intensity` of 1 is a very close explosion. */
  shakeCamera?(intensity: number): void;

  /** Hold the view still (end screens) while leaving the controller attached. */
  setLookFrozen?(frozen: boolean): void;

  /** Stop movement prediction and firing while leaving the controller attached. */
  setGameplayFrozen?(frozen: boolean): void;

  /** Switch from local play to server-authoritative networked play. */
  enableNetworkMode?(): void;

  /**
   * Apply configuration options
   */
  configure(config: Partial<CameraControllerConfig>): void;

  /**
   * Get current configuration
   */
  getConfig(): CameraControllerConfig;

  /**
   * Enable or disable this controller
   */
  setEnabled(enabled: boolean): void;

  /**
   * Check if controller is enabled
   */
  isEnabled(): boolean;

  /**
   * Clean up all resources
   */
  dispose(): void;
}
