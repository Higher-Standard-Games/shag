/**
 * PlayerState - Input state for viewport effects
 *
 * Contains all player movement data that effects need to compute their output.
 * This is a snapshot of the player's current state, passed to effects each frame.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';

export interface PlayerState {
    /** Current world position */
    position: Vector3;

    /** Current velocity vector */
    velocity: Vector3;

    /** Horizontal speed (magnitude of XZ velocity) */
    horizontalSpeed: number;

    /** Is the player touching ground this frame? */
    isGrounded: boolean;

    /** Was the player grounded last frame? (for landing detection) */
    wasGroundedLastFrame: boolean;

    /** Did the player just jump? (input detected + grounded) */
    isJumping: boolean;

    /** Strafe input: -1 (left), 0 (none), 1 (right) */
    strafeInput: number;

    /** Forward input: -1 (back), 0 (none), 1 (forward) */
    forwardInput: number;

    /** Vertical velocity at moment of landing (for impact strength) */
    landingVelocity?: number;
}

/**
 * Create a neutral/zero player state (useful for initialization)
 */
export function createNeutralPlayerState(): PlayerState {
    return {
        position: Vector3.Zero(),
        velocity: Vector3.Zero(),
        horizontalSpeed: 0,
        isGrounded: true,
        wasGroundedLastFrame: true,
        isJumping: false,
        strafeInput: 0,
        forwardInput: 0,
        landingVelocity: 0,
    };
}
