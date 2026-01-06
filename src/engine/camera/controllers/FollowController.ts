/**
 * FollowController - Camera controller that follows a target node
 * 
 * Engine-level camera controller for following players, NPCs, vehicles, etc.
 * Supports configurable offset, smoothing, and look-at behavior.
 */

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ICameraController, CameraControllerConfig } from "./ICameraController";

export interface FollowConfig extends CameraControllerConfig {
  /** Offset from target position */
  offset?: Vector3;
  /** Look ahead distance (for moving targets) */
  lookAhead?: number;
  /** Whether to rotate with target */
  rotateWithTarget?: boolean;
}

export class FollowController implements ICameraController {
  readonly type = "follow";
  
  private camera: ArcRotateCamera | null = null;
  private scene: Scene | null = null;
  
  // State
  private enabled: boolean = true;
  private followTarget: TransformNode | null = null;
  private lastTargetPosition: Vector3 = Vector3.Zero();
  private targetVelocity: Vector3 = Vector3.Zero();
  
  // Configuration
  private config: FollowConfig = {
    smoothing: 0.1,
    speed: 1.0,
    offset: new Vector3(0, 50, -100),
    lookAhead: 0,
    rotateWithTarget: false,
  };
  
  // Observers
  private renderObserver: Observer<Scene> | null = null;

  attach(camera: Camera, scene: Scene, _canvas: HTMLCanvasElement): void {
    if (!(camera instanceof ArcRotateCamera)) {
      console.error("[FollowController] Requires ArcRotateCamera");
      return;
    }
    
    this.camera = camera;
    this.scene = scene;
    
    this.setupRenderLoop();
    console.log("[FollowController] Attached");
  }

  detach(): void {
    this.removeRenderLoop();
    this.camera = null;
    this.scene = null;
    console.log("[FollowController] Detached");
  }

  update(_deltaTime: number): void {
    // Update is handled by render observer
  }

  setTarget(target: Vector3 | TransformNode): void {
    if (target instanceof TransformNode) {
      this.followTarget = target;
      this.lastTargetPosition = target.position.clone();
    } else if (this.camera) {
      // Just set camera target directly
      this.camera.setTarget(target);
    }
  }

  getTarget(): Vector3 {
    if (this.followTarget) {
      return this.followTarget.position.clone();
    }
    return this.camera?.target.clone() ?? Vector3.Zero();
  }

  setFollowTarget(node: TransformNode, offset?: Vector3): void {
    this.followTarget = node;
    this.lastTargetPosition = node.position.clone();
    if (offset) {
      this.config.offset = offset;
    }
  }

  /**
   * Clear the follow target
   */
  clearFollowTarget(): void {
    this.followTarget = null;
  }

  configure(config: Partial<FollowConfig>): void {
    this.config = { ...this.config, ...config };
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
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupRenderLoop(): void {
    if (!this.scene) return;

    this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.enabled || !this.camera) return;
      this.updateFollow();
    });
  }

  private removeRenderLoop(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
  }

  private updateFollow(): void {
    if (!this.followTarget || !this.camera) return;

    const targetPos = this.followTarget.position;
    const smoothing = this.config.smoothing ?? 0.1;
    
    // Calculate velocity for look-ahead
    this.targetVelocity = targetPos.subtract(this.lastTargetPosition);
    this.lastTargetPosition = targetPos.clone();
    
    // Calculate desired camera target with look-ahead
    let desiredTarget = targetPos.clone();
    if (this.config.lookAhead && this.config.lookAhead > 0) {
      desiredTarget.addInPlace(this.targetVelocity.scale(this.config.lookAhead));
    }
    
    // Apply offset
    const offset = this.config.offset ?? new Vector3(0, 50, -100);
    
    if (this.config.rotateWithTarget && this.followTarget.rotationQuaternion) {
      // Rotate offset by target's rotation
      const rotatedOffset = offset.clone();
      rotatedOffset.rotateByQuaternionToRef(
        this.followTarget.rotationQuaternion,
        rotatedOffset
      );
      desiredTarget.addInPlace(rotatedOffset);
    }
    
    // Smoothly interpolate camera target
    this.camera.target = Vector3.Lerp(
      this.camera.target,
      desiredTarget,
      smoothing
    );
  }
}
