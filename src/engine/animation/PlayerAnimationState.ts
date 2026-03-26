/**
 * Player Animation State - State interface for animation controller
 *
 * Derived from CharacterController and movement systems.
 */

import { Vector3 } from "@babylonjs/core";

/**
 * Animation state passed from CharacterController to PlayerAnimationController
 */
export interface PlayerAnimationState {
  // === Basic Movement ===

  /** World-space velocity */
  velocity: Vector3;

  /** Player-local velocity (relative to facing direction) */
  localVelocity: Vector3;

  /** Horizontal speed magnitude */
  speed: number;

  /** True if player is on ground */
  grounded: boolean;

  /** True if player is crouching */
  isCrouching: boolean;

  // === Advanced Movement ===

  /** True if crouchslide is active */
  isSliding: boolean;

  /** Direction of slide in world space */
  slideDirection: Vector3;

  /** Current slide speed */
  slideSpeed: number;

  /** True if wall jump is in progress */
  isWallJumping: boolean;

  /** Wall surface normal (for wall jump direction) */
  wallNormal: Vector3;

  /** Wall jump progress (0-1) */
  wallJumpPhase: number;

  /** True if ledge grab is active */
  isLedgeGrabbing: boolean;

  // === Aiming ===

  /** Pitch angle in degrees (-90 to 90, negative = looking up) */
  aimPitch: number;

  /** Yaw angle in degrees */
  aimYaw: number;

  // === Combat ===

  /** True if player is firing weapon */
  isFiring: boolean;

  /** True if player is reloading */
  isReloading: boolean;

  /** Reload progress (0-1) */
  reloadProgress: number;
}

/**
 * Create default animation state
 */
export function createDefaultAnimationState(): PlayerAnimationState {
  return {
    velocity: Vector3.Zero(),
    localVelocity: Vector3.Zero(),
    speed: 0,
    grounded: true,
    isCrouching: false,

    isSliding: false,
    slideDirection: Vector3.Zero(),
    slideSpeed: 0,

    isWallJumping: false,
    wallNormal: Vector3.Zero(),
    wallJumpPhase: 0,

    isLedgeGrabbing: false,

    aimPitch: 0,
    aimYaw: 0,

    isFiring: false,
    isReloading: false,
    reloadProgress: 0,
  };
}

/**
 * Animation state names for state machine
 */
export enum AnimationStateName {
  Idle = "idle",
  RunForward = "run_forward",
  RunBackward = "run_backward",
  StrafeLeft = "strafe_left",
  StrafeRight = "strafe_right",
  JumpStart = "jump_start",
  JumpAir = "jump_air",
  JumpLand = "jump_land",
  CrouchIdle = "crouch_idle",
  CrouchWalk = "crouch_walk",
  Slide = "slide",
  WallJump = "walljump",
  LedgeGrab = "ledge_grab",
}

/**
 * Select appropriate animation state based on player state
 */
export function selectAnimationState(state: PlayerAnimationState): AnimationStateName {
  // Priority order for state resolution

  // 1. Special movement states
  if (state.isSliding) {
    return AnimationStateName.Slide;
  }

  if (state.isWallJumping) {
    return AnimationStateName.WallJump;
  }

  if (state.isLedgeGrabbing) {
    return AnimationStateName.LedgeGrab;
  }

  // 2. Airborne
  if (!state.grounded) {
    return AnimationStateName.JumpAir;
  }

  // 3. Crouching
  if (state.isCrouching) {
    return state.speed > 0.5 ? AnimationStateName.CrouchWalk : AnimationStateName.CrouchIdle;
  }

  // 4. Locomotion
  if (state.speed > 0.5) {
    return selectLocomotionState(state);
  }

  // 5. Idle
  return AnimationStateName.Idle;
}

/**
 * Select locomotion animation based on movement direction
 */
function selectLocomotionState(state: PlayerAnimationState): AnimationStateName {
  const { localVelocity } = state;

  // Calculate angle from forward direction
  const angle = Math.atan2(localVelocity.x, localVelocity.z);

  // 8-directional locomotion selection
  // Forward: -45° to 45°
  if (angle > -0.785 && angle < 0.785) {
    return AnimationStateName.RunForward;
  }

  // Backward: > 135° or < -135°
  if (angle > 2.356 || angle < -2.356) {
    return AnimationStateName.RunBackward;
  }

  // Right: 45° to 135°
  if (angle >= 0.785 && angle <= 2.356) {
    return AnimationStateName.StrafeRight;
  }

  // Left: -45° to -135°
  return AnimationStateName.StrafeLeft;
}
