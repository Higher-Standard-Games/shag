/**
 * Humanoid Rig - Bone mapping for Mixamo-compatible skeletons
 *
 * All models rigged through Mixamo use the same 65-bone skeleton structure.
 * This class provides a standardized interface for accessing bones by role.
 */

import type { Bone } from "@babylonjs/core/Bones/bone";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/**
 * Standard humanoid bone names following Mixamo convention
 */
export interface HumanoidBoneMap {
  // Core
  hips: string;
  spine: string;
  spine1: string;
  spine2: string;
  neck: string;
  head: string;
  headTop: string;

  // Left Arm
  leftShoulder: string;
  leftArm: string;
  leftForeArm: string;
  leftHand: string;

  // Right Arm
  rightShoulder: string;
  rightArm: string;
  rightForeArm: string;
  rightHand: string;

  // Left Leg
  leftUpLeg: string;
  leftLeg: string;
  leftFoot: string;
  leftToeBase: string;

  // Right Leg
  rightUpLeg: string;
  rightLeg: string;
  rightFoot: string;
  rightToeBase: string;
}

/**
 * Default Mixamo bone name mapping
 * These are the exact names Mixamo uses when auto-rigging
 */
export const MIXAMO_BONE_MAP: HumanoidBoneMap = {
  // Core
  hips: "mixamorigHips",
  spine: "mixamorigSpine",
  spine1: "mixamorigSpine1",
  spine2: "mixamorigSpine2",
  neck: "mixamorigNeck",
  head: "mixamorigHead",
  headTop: "mixamorigHeadTop_End",

  // Left Arm
  leftShoulder: "mixamorigLeftShoulder",
  leftArm: "mixamorigLeftArm",
  leftForeArm: "mixamorigLeftForeArm",
  leftHand: "mixamorigLeftHand",

  // Right Arm
  rightShoulder: "mixamorigRightShoulder",
  rightArm: "mixamorigRightArm",
  rightForeArm: "mixamorigRightForeArm",
  rightHand: "mixamorigRightHand",

  // Left Leg
  leftUpLeg: "mixamorigLeftUpLeg",
  leftLeg: "mixamorigLeftLeg",
  leftFoot: "mixamorigLeftFoot",
  leftToeBase: "mixamorigLeftToeBase",

  // Right Leg
  rightUpLeg: "mixamorigRightUpLeg",
  rightLeg: "mixamorigRightLeg",
  rightFoot: "mixamorigRightFoot",
  rightToeBase: "mixamorigRightToeBase",
};

/**
 * Alternative bone naming conventions that may be encountered
 */
export const ALTERNATIVE_BONE_MAPS: Record<string, Partial<HumanoidBoneMap>> = {
  // Some exporters strip the "mixamorig" prefix
  noPrefix: {
    hips: "Hips",
    spine: "Spine",
    spine1: "Spine1",
    spine2: "Spine2",
    neck: "Neck",
    head: "Head",
    leftShoulder: "LeftShoulder",
    leftArm: "LeftArm",
    leftForeArm: "LeftForeArm",
    leftHand: "LeftHand",
    rightShoulder: "RightShoulder",
    rightArm: "RightArm",
    rightForeArm: "RightForeArm",
    rightHand: "RightHand",
    leftUpLeg: "LeftUpLeg",
    leftLeg: "LeftLeg",
    leftFoot: "LeftFoot",
    leftToeBase: "LeftToeBase",
    rightUpLeg: "RightUpLeg",
    rightLeg: "RightLeg",
    rightFoot: "RightFoot",
    rightToeBase: "RightToeBase",
  },
};

/**
 * Humanoid role identifiers for bone access
 */
export type HumanoidBoneRole = keyof HumanoidBoneMap;

/**
 * HumanoidRig - Wrapper for accessing skeleton bones by role
 */
export class HumanoidRig {
  private skeleton: Skeleton;
  private boneMap: Map<HumanoidBoneRole, Bone> = new Map();
  private transformMap: Map<HumanoidBoneRole, TransformNode> = new Map();
  private namingConvention: string = "mixamo";

  constructor(skeleton: Skeleton, boneMapping?: HumanoidBoneMap) {
    this.skeleton = skeleton;
    this.detectAndMapBones(boneMapping);
  }

  /**
   * Detect bone naming convention and map bones
   */
  private detectAndMapBones(customMapping?: HumanoidBoneMap): void {
    const bones = this.skeleton.bones;

    // Try to detect naming convention
    const mapping = customMapping || this.detectNamingConvention(bones);

    // Map each role to its bone
    for (const [role, boneName] of Object.entries(mapping)) {
      const bone = bones.find((b) => b.name === boneName || b.name.toLowerCase() === boneName.toLowerCase());

      if (bone) {
        this.boneMap.set(role as HumanoidBoneRole, bone);

        // Also map the transform node if available
        const transform = bone.getTransformNode();
        if (transform) {
          this.transformMap.set(role as HumanoidBoneRole, transform);
        }
      }
    }

    console.log(
      `[HumanoidRig] Mapped ${this.boneMap.size}/${Object.keys(mapping).length} bones using ${this.namingConvention} convention`,
    );
  }

  /**
   * Auto-detect bone naming convention from skeleton
   */
  private detectNamingConvention(bones: Bone[]): HumanoidBoneMap {
    const boneNames = bones.map((b) => b.name);

    // Check for Mixamo naming
    if (boneNames.some((n) => n.startsWith("mixamorig"))) {
      this.namingConvention = "mixamo";
      return MIXAMO_BONE_MAP;
    }

    // Check for no-prefix naming
    if (boneNames.some((n) => n === "Hips" || n === "hips")) {
      this.namingConvention = "noPrefix";
      return { ...MIXAMO_BONE_MAP, ...ALTERNATIVE_BONE_MAPS.noPrefix } as HumanoidBoneMap;
    }

    // Default to Mixamo naming
    this.namingConvention = "mixamo";
    return MIXAMO_BONE_MAP;
  }

  /**
   * Get a bone by its humanoid role
   */
  getBone(role: HumanoidBoneRole): Bone | undefined {
    return this.boneMap.get(role);
  }

  /**
   * Get a transform node by its humanoid role
   */
  getTransform(role: HumanoidBoneRole): TransformNode | undefined {
    return this.transformMap.get(role);
  }

  /**
   * Check if a bone role is mapped
   */
  hasBone(role: HumanoidBoneRole): boolean {
    return this.boneMap.has(role);
  }

  /**
   * Get all mapped bone roles
   */
  getMappedRoles(): HumanoidBoneRole[] {
    return Array.from(this.boneMap.keys());
  }

  /**
   * Get the underlying skeleton
   */
  getSkeleton(): Skeleton {
    return this.skeleton;
  }

  /**
   * Get the detected naming convention
   */
  getNamingConvention(): string {
    return this.namingConvention;
  }

  /**
   * Validate that all required bones are present
   */
  validate(): { valid: boolean; missing: HumanoidBoneRole[] } {
    const requiredBones: HumanoidBoneRole[] = [
      "hips",
      "spine",
      "head",
      "leftArm",
      "rightArm",
      "leftUpLeg",
      "rightUpLeg",
    ];

    const missing = requiredBones.filter((role) => !this.hasBone(role));

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * Debug: Print all detected bones
   */
  debugPrint(): void {
    console.log("[HumanoidRig] Bone mapping:");
    for (const [role, bone] of this.boneMap) {
      console.log(`  ${role}: ${bone.name}`);
    }
  }
}
