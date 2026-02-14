/**
 * PhysicsComponent - Velocity and movement state
 */

import type { Vec3 } from '../types';

export interface PhysicsComponent {
    /** Linear velocity in units/sec */
    velocity: Vec3;

    /** Angular velocity in degrees/sec */
    angularVelocity: Vec3;

    /** Whether entity is on ground */
    grounded: boolean;

    /** Whether entity is jumping (for jump key handling) */
    jumping: boolean;

    // === Advanced movement state (from FPSMovementProfile.simulate()) ===

    /** Whether entity is crouchsliding */
    isSliding: boolean;

    /** Whether entity is crouching */
    isCrouching: boolean;

    /** Camera offset for crouch/stand transition */
    crouchViewOffset: number;

    /** Wall jump state */
    wallJumpState: 'none' | 'available' | 'charging';

    /** Ledge grab state */
    ledgeGrabState: 'none' | 'grabbing' | 'pulling';

    /** Actual horizontal speed (for HUD, effects) */
    actualHorizSpeed: number;
}

/** Create default physics */
export function createPhysics(): PhysicsComponent {
    return {
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        grounded: false,
        jumping: false,
        isSliding: false,
        isCrouching: false,
        crouchViewOffset: 0,
        wallJumpState: 'none',
        ledgeGrabState: 'none',
        actualHorizSpeed: 0,
    };
}

/** Clone physics (for COW) */
export function clonePhysics(p: PhysicsComponent): PhysicsComponent {
    return {
        velocity: { ...p.velocity },
        angularVelocity: { ...p.angularVelocity },
        grounded: p.grounded,
        jumping: p.jumping,
        isSliding: p.isSliding,
        isCrouching: p.isCrouching,
        crouchViewOffset: p.crouchViewOffset,
        wallJumpState: p.wallJumpState,
        ledgeGrabState: p.ledgeGrabState,
        actualHorizSpeed: p.actualHorizSpeed,
    };
}
