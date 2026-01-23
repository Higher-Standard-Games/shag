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

// Core classes
export { HumanoidRig, MIXAMO_BONE_MAP } from "./HumanoidRig";
export type { HumanoidBoneMap, HumanoidBoneRole } from "./HumanoidRig";

export { AnimationLoader, STANDARD_ANIMATIONS } from "./AnimationLoader";
export type { AnimationClipInfo } from "./AnimationLoader";

export { AnimationBlender } from "./AnimationBlender";
export type { BlendConfig } from "./AnimationBlender";

export { ProceduralLayers } from "./ProceduralLayers";
export type { ProceduralLayerConfig } from "./ProceduralLayers";

// Main controller
export {
    PlayerAnimationController,
    createPlayerAnimationController,
} from "./PlayerAnimationController";
export type { PlayerAnimationConfig } from "./PlayerAnimationController";

// State types
export {
    AnimationStateName,
    createDefaultAnimationState,
    selectAnimationState,
} from "./PlayerAnimationState";
export type { PlayerAnimationState } from "./PlayerAnimationState";

// State bridge for FPSController integration
export {
    extractAnimationState,
    FPSControllerAnimationAdapter,
} from "./AnimationStateBridge";
export type { AnimationStateProvider } from "./AnimationStateBridge";
