/**
 * Animation State Bridge
 * 
 * Extracts animation state from FPSController to drive the PlayerAnimationController.
 * This bridges the gap between the physics/movement systems and the animation system.
 */

import { Vector3 } from "@babylonjs/core";
import { PlayerAnimationState, createDefaultAnimationState } from "./PlayerAnimationState";

/**
 * Interface for controllers that can provide animation state
 */
export interface AnimationStateProvider {
    // Position and velocity
    getPlayerPosition(): Vector3;
    getVelocity?(): Vector3;

    // Ground state
    isPlayerGrounded?(): boolean;

    // Crouch and slide
    getCrouchState?(): { isCrouching: boolean; isSliding: boolean; height: number };
    getSlideSpeed?(): number;
    getSlideDirection?(): Vector3;

    // Wall jump
    getWallJumpState?(): { state: string; normal: Vector3; phase: number };

    // Ledge grab
    getLedgeGrabState?(): string;

    // Camera rotation
    getRotation?(): { x: number; y: number };

    // Combat
    isFiring?(): boolean;
    getIsReloading?(): boolean;
    getReloadProgress?(): number;
}

/**
 * Extract PlayerAnimationState from an FPSController or similar provider
 */
export function extractAnimationState(
    provider: AnimationStateProvider,
    cameraRotation?: { x: number; y: number }
): PlayerAnimationState {
    const state = createDefaultAnimationState();

    // Get velocity if available
    if (provider.getVelocity) {
        state.velocity = provider.getVelocity().clone();
        state.speed = Math.sqrt(state.velocity.x ** 2 + state.velocity.z ** 2);

        // Calculate local velocity (relative to facing direction)
        if (cameraRotation) {
            const yaw = cameraRotation.y;
            const cos = Math.cos(yaw);
            const sin = Math.sin(yaw);

            // Rotate world velocity into local space
            state.localVelocity = new Vector3(
                state.velocity.x * cos + state.velocity.z * sin,
                state.velocity.y,
                -state.velocity.x * sin + state.velocity.z * cos
            );
        } else {
            state.localVelocity = state.velocity.clone();
        }
    }

    // Ground state
    if (provider.isPlayerGrounded) {
        state.grounded = provider.isPlayerGrounded();
    }

    // Crouch and slide
    if (provider.getCrouchState) {
        const crouch = provider.getCrouchState();
        state.isCrouching = crouch.isCrouching;
        state.isSliding = crouch.isSliding;
    }

    if (state.isSliding) {
        if (provider.getSlideSpeed) {
            state.slideSpeed = provider.getSlideSpeed();
        }
        if (provider.getSlideDirection) {
            state.slideDirection = provider.getSlideDirection();
        }
    }

    // Wall jump
    if (provider.getWallJumpState) {
        const wallJump = provider.getWallJumpState();
        state.isWallJumping = wallJump.state !== "none";
        state.wallNormal = wallJump.normal;
        state.wallJumpPhase = wallJump.phase;
    }

    // Ledge grab
    if (provider.getLedgeGrabState) {
        state.isLedgeGrabbing = provider.getLedgeGrabState() !== "none";
    }

    // Aim direction
    if (cameraRotation) {
        state.aimPitch = cameraRotation.x * (180 / Math.PI);
        state.aimYaw = cameraRotation.y * (180 / Math.PI);
    } else if (provider.getRotation) {
        const rot = provider.getRotation();
        state.aimPitch = rot.x * (180 / Math.PI);
        state.aimYaw = rot.y * (180 / Math.PI);
    }

    // Combat state
    if (provider.isFiring) {
        state.isFiring = provider.isFiring();
    }
    if (provider.getIsReloading) {
        state.isReloading = provider.getIsReloading();
    }
    if (provider.getReloadProgress) {
        state.reloadProgress = provider.getReloadProgress();
    }

    return state;
}

/**
 * FPSControllerAnimationAdapter
 * 
 * Wraps an FPSController to implement AnimationStateProvider
 */
export class FPSControllerAnimationAdapter implements AnimationStateProvider {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private controller: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(controller: any) {
        this.controller = controller;
    }

    getPlayerPosition(): Vector3 {
        return this.controller.getPlayerPosition();
    }

    getVelocity(): Vector3 {
        if (this.controller.getVelocity) {
            return this.controller.getVelocity();
        }
        return Vector3.Zero();
    }

    isPlayerGrounded(): boolean {
        if (this.controller.isPlayerGrounded) {
            return this.controller.isPlayerGrounded();
        }
        return true;
    }

    getCrouchState(): { isCrouching: boolean; isSliding: boolean; height: number } {
        if (this.controller.getCrouchState) {
            return this.controller.getCrouchState();
        }
        return { isCrouching: false, isSliding: false, height: 56 };
    }

    getSlideSpeed(): number {
        if (this.controller.getSlideSpeed) {
            return this.controller.getSlideSpeed();
        }
        return 0;
    }

    getSlideDirection(): Vector3 {
        if (this.controller.getSlideDirection) {
            return this.controller.getSlideDirection();
        }
        return Vector3.Forward();
    }

    getWallJumpState(): { state: string; normal: Vector3; phase: number } {
        if (this.controller.getWallJumpState) {
            return this.controller.getWallJumpState();
        }
        return { state: "none", normal: Vector3.Zero(), phase: 0 };
    }

    getLedgeGrabState(): string {
        if (this.controller.getLedgeGrabState) {
            return this.controller.getLedgeGrabState();
        }
        return "none";
    }

    getRotation(): { x: number; y: number } {
        if (this.controller.getRotation) {
            return this.controller.getRotation();
        }
        return { x: 0, y: 0 };
    }

    isFiring(): boolean {
        if (this.controller.isFiring) {
            return this.controller.isFiring();
        }
        return false;
    }

    getIsReloading(): boolean {
        if (this.controller.getIsReloading) {
            return this.controller.getIsReloading();
        }
        return false;
    }

    getReloadProgress(): number {
        if (this.controller.getReloadProgress) {
            return this.controller.getReloadProgress();
        }
        return 0;
    }
}
