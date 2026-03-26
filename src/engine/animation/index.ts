/**
 * Animation Module - Player character animation system
 *
 * Provides:
 * - Humanoid rig abstraction for Mixamo-compatible skeletons
 * - Animation loading and retargeting
 * - Animation blending and state machine
 * - Procedural animation layers (aim IK, lean, slide, wall jump)
 *
 * @module engine/animation
 */

export type { BlendConfig } from "./AnimationBlender";
export { AnimationBlender } from "./AnimationBlender";
export type { AnimationClipInfo } from "./AnimationLoader";
export { AnimationLoader, STANDARD_ANIMATIONS } from "./AnimationLoader";
export type { AnimationStateProvider } from "./AnimationStateBridge";
// State bridge for FPSController integration
export {
  extractAnimationState,
  FPSControllerAnimationAdapter,
} from "./AnimationStateBridge";
export type { HumanoidBoneMap, HumanoidBoneRole } from "./HumanoidRig";
// Core classes
export { HumanoidRig, MIXAMO_BONE_MAP } from "./HumanoidRig";
export type { PlayerAnimationConfig } from "./PlayerAnimationController";
// Main controller
export {
  createPlayerAnimationController,
  PlayerAnimationController,
} from "./PlayerAnimationController";
export type { PlayerAnimationState } from "./PlayerAnimationState";
// State types
export {
  AnimationStateName,
  createDefaultAnimationState,
  selectAnimationState,
} from "./PlayerAnimationState";
export type { ProceduralLayerConfig } from "./ProceduralLayers";
export { ProceduralLayers } from "./ProceduralLayers";
