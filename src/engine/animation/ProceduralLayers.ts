/**
 * Procedural Animation Layers
 *
 * Provides procedural animation adjustments layered on top of base animations:
 * - Upper body aim IK
 * - Strafe lean
 * - Crouchslide pose
 * - Wall jump pose
 */

import { Quaternion, Vector3 } from "@babylonjs/core";
import type { HumanoidBoneRole, HumanoidRig } from "./HumanoidRig";
import type { PlayerAnimationState } from "./PlayerAnimationState";

/**
 * Configuration for procedural layers
 */
export interface ProceduralLayerConfig {
  /** Enable upper body aim IK */
  aimIK: boolean;

  /** Enable strafe lean effect */
  strafeLean: boolean;

  /** Maximum strafe lean angle in radians */
  strafeLeanAmount: number;

  /** Enable procedural slide pose */
  proceduralSlide: boolean;

  /** Enable procedural wall jump pose */
  proceduralWallJump: boolean;

  /** How much pitch to distribute across spine (0-1) */
  aimPitchDistribution: number;
}

const DEFAULT_CONFIG: ProceduralLayerConfig = {
  aimIK: true,
  strafeLean: true,
  strafeLeanAmount: 0.15, // ~8.5 degrees
  proceduralSlide: true,
  proceduralWallJump: true,
  aimPitchDistribution: 0.5,
};

/**
 * Stored bone rotation for additive blending
 */
interface BoneOffset {
  rotation: Quaternion;
}

/**
 * ProceduralLayers - Apply procedural animation adjustments
 */
export class ProceduralLayers {
  private rig: HumanoidRig;
  private config: ProceduralLayerConfig;
  private boneOffsets: Map<HumanoidBoneRole, BoneOffset> = new Map();

  // Smoothing values
  private smoothedLean: number = 0;
  private smoothedPitch: number = 0;

  constructor(rig: HumanoidRig, config?: Partial<ProceduralLayerConfig>) {
    this.rig = rig;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update procedural layers based on player state
   */
  update(state: PlayerAnimationState, deltaTime: number): void {
    // Reset bone offsets
    this.clearOffsets();

    // Apply each layer
    if (this.config.aimIK) {
      this.applyAimIK(state, deltaTime);
    }

    if (this.config.strafeLean && state.grounded) {
      this.applyStrafeLean(state, deltaTime);
    }

    if (this.config.proceduralSlide && state.isSliding) {
      this.applySlidePose(state);
    }

    if (this.config.proceduralWallJump && state.isWallJumping) {
      this.applyWallJumpPose(state);
    }

    // Apply accumulated offsets to bones
    this.applyOffsets();
  }

  /**
   * Clear accumulated bone offsets
   */
  private clearOffsets(): void {
    this.boneOffsets.clear();
  }

  /**
   * Add rotation offset to a bone
   */
  private addBoneOffset(role: HumanoidBoneRole, rotation: Quaternion): void {
    const existing = this.boneOffsets.get(role);
    if (existing) {
      // Multiply rotations
      existing.rotation = existing.rotation.multiply(rotation);
    } else {
      this.boneOffsets.set(role, { rotation: rotation.clone() });
    }
  }

  /**
   * Apply accumulated offsets to actual bones
   */
  private applyOffsets(): void {
    for (const [role, offset] of this.boneOffsets) {
      const bone = this.rig.getBone(role);
      if (bone) {
        // Get current rotation and apply offset
        const currentRotation = bone.getRotationQuaternion();
        if (currentRotation) {
          const newRotation = currentRotation.multiply(offset.rotation);
          bone.setRotationQuaternion(newRotation);
        }
      }
    }
  }

  /**
   * Layer 1: Upper Body Aim IK
   * Rotates spine, neck, and head to follow aim direction
   */
  private applyAimIK(state: PlayerAnimationState, deltaTime: number): void {
    // Smooth the pitch for less jerky motion
    const smoothSpeed = 10;
    this.smoothedPitch += (state.aimPitch - this.smoothedPitch) * smoothSpeed * deltaTime;

    // Convert pitch to radians (-90 to 90 degrees)
    const pitchRad = (this.smoothedPitch * Math.PI) / 180;

    // Distribute pitch across spine chain
    const spinePitch = pitchRad * 0.25 * this.config.aimPitchDistribution;
    const neckPitch = pitchRad * 0.35 * this.config.aimPitchDistribution;
    const headPitch = pitchRad * 0.4 * this.config.aimPitchDistribution;

    // Apply rotations (pitch = rotation around X axis)
    this.addBoneOffset("spine2", Quaternion.RotationAxis(Vector3.Right(), spinePitch));
    this.addBoneOffset("neck", Quaternion.RotationAxis(Vector3.Right(), neckPitch));
    this.addBoneOffset("head", Quaternion.RotationAxis(Vector3.Right(), headPitch));
  }

  /**
   * Layer 2: Strafe Lean
   * Leans body opposite to strafe direction
   */
  private applyStrafeLean(state: PlayerAnimationState, deltaTime: number): void {
    // Calculate target lean from lateral velocity
    const lateralSpeed = state.localVelocity.x;
    const maxSpeed = 10; // Assume max strafe speed
    const normalizedLateral = Math.max(-1, Math.min(1, lateralSpeed / maxSpeed));

    // Target lean angle (opposite to movement direction)
    const targetLean = -normalizedLateral * this.config.strafeLeanAmount;

    // Smooth the lean
    const smoothSpeed = 8;
    this.smoothedLean += (targetLean - this.smoothedLean) * smoothSpeed * deltaTime;

    // Apply lean to spine (rotation around Z axis)
    this.addBoneOffset("spine", Quaternion.RotationAxis(Vector3.Forward(), this.smoothedLean));
    this.addBoneOffset("spine1", Quaternion.RotationAxis(Vector3.Forward(), this.smoothedLean * 0.5));
  }

  /**
   * Layer 3: Crouchslide Pose
   * Fully procedural slide animation
   */
  private applySlidePose(state: PlayerAnimationState): void {
    // Calculate intensity based on slide speed
    const intensity = Math.min(state.slideSpeed / 15, 1);

    // Torso: Lean back
    this.addBoneOffset("spine", Quaternion.RotationAxis(Vector3.Right(), -0.4 * intensity));
    this.addBoneOffset("spine1", Quaternion.RotationAxis(Vector3.Right(), -0.2 * intensity));
    this.addBoneOffset("spine2", Quaternion.RotationAxis(Vector3.Right(), -0.1 * intensity));

    // Lead leg (right): Extended forward
    this.addBoneOffset("rightUpLeg", Quaternion.RotationAxis(Vector3.Right(), -1.3 * intensity));
    this.addBoneOffset("rightLeg", Quaternion.RotationAxis(Vector3.Right(), 0.3 * intensity));

    // Back leg (left): Tucked
    this.addBoneOffset("leftUpLeg", Quaternion.RotationAxis(Vector3.Right(), 0.5 * intensity));
    this.addBoneOffset("leftLeg", Quaternion.RotationAxis(Vector3.Right(), -1.2 * intensity));

    // Arms: Out for balance
    this.addBoneOffset("leftArm", Quaternion.RotationAxis(Vector3.Forward(), 0.6 * intensity));
    this.addBoneOffset("rightArm", Quaternion.RotationAxis(Vector3.Forward(), -0.3 * intensity));
  }

  /**
   * Layer 4: Wall Jump Pose
   * Directional pose based on wall normal
   */
  private applyWallJumpPose(state: PlayerAnimationState): void {
    const phase = state.wallJumpPhase;

    if (phase < 0.2) {
      // Contact phase: Compress toward wall
      const compression = phase / 0.2;

      // Legs bent
      this.addBoneOffset("leftUpLeg", Quaternion.RotationAxis(Vector3.Right(), 0.4 * compression));
      this.addBoneOffset("leftLeg", Quaternion.RotationAxis(Vector3.Right(), -0.8 * compression));
      this.addBoneOffset("rightUpLeg", Quaternion.RotationAxis(Vector3.Right(), 0.4 * compression));
      this.addBoneOffset("rightLeg", Quaternion.RotationAxis(Vector3.Right(), -0.8 * compression));

      // Arms reach toward wall
      this.addBoneOffset("leftArm", Quaternion.RotationAxis(Vector3.Forward(), -0.5 * compression));
      this.addBoneOffset("rightArm", Quaternion.RotationAxis(Vector3.Forward(), 0.5 * compression));
    } else if (phase < 0.5) {
      // Push-off phase: Extend legs
      const pushStrength = (phase - 0.2) / 0.3;

      // Legs extend
      this.addBoneOffset("leftUpLeg", Quaternion.RotationAxis(Vector3.Right(), -0.8 * pushStrength));
      this.addBoneOffset("leftLeg", Quaternion.RotationAxis(Vector3.Right(), 0.2 * pushStrength));
      this.addBoneOffset("rightUpLeg", Quaternion.RotationAxis(Vector3.Right(), -0.8 * pushStrength));
      this.addBoneOffset("rightLeg", Quaternion.RotationAxis(Vector3.Right(), 0.2 * pushStrength));

      // Arms swing
      this.addBoneOffset("leftArm", Quaternion.RotationAxis(Vector3.Right(), -0.6 * pushStrength));
      this.addBoneOffset("rightArm", Quaternion.RotationAxis(Vector3.Right(), -0.6 * pushStrength));
    } else {
      // Flight phase: Tuck for momentum
      const tuckStrength = 1 - (phase - 0.5) / 0.5;

      // Slight tuck
      this.addBoneOffset("leftUpLeg", Quaternion.RotationAxis(Vector3.Right(), -0.3 * tuckStrength));
      this.addBoneOffset("rightUpLeg", Quaternion.RotationAxis(Vector3.Right(), -0.3 * tuckStrength));
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ProceduralLayerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ProceduralLayerConfig {
    return { ...this.config };
  }
}
