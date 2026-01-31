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
}

/** Create default physics */
export function createPhysics(): PhysicsComponent {
    return {
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        grounded: false,
        jumping: false,
    };
}

/** Clone physics (for COW) */
export function clonePhysics(p: PhysicsComponent): PhysicsComponent {
    return {
        velocity: { ...p.velocity },
        angularVelocity: { ...p.angularVelocity },
        grounded: p.grounded,
        jumping: p.jumping,
    };
}
