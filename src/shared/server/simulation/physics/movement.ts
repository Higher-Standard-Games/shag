/**
 * Q3/Warsow style movement functions
 * 
 * Pure functions for movement calculations.
 * These are shared between client (prediction) and server (authority).
 */

import type { Vec3 } from '../types';
import {
    GRAVITY,
    FALLING_GRAVITY_MULTIPLIER,
    GROUND_ACCELERATION,
    AIR_ACCELERATION,
    GROUND_FRICTION,
    STOP_SPEED,
    MAX_GROUND_SPEED,
    JUMP_VELOCITY,
} from './constants';

// ═══════════════════════════════════════════════════════════════════
// VECTOR UTILITIES
// ═══════════════════════════════════════════════════════════════════

/** Calculate horizontal length (XZ plane) */
export function vec3HorizontalLength(v: Vec3): number {
    return Math.sqrt(v.x * v.x + v.z * v.z);
}

/** Normalize a vector */
export function vec3Normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len === 0) return { x: 0, y: 0, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Dot product */
export function vec3Dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Scale vector */
export function vec3Scale(v: Vec3, s: number): Vec3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/** Add vectors */
export function vec3Add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

// ═══════════════════════════════════════════════════════════════════
// MOVEMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Apply friction to velocity (ground movement)
 * 
 * Q3 friction: reduces speed each tick based on friction coefficient
 */
export function applyFriction(
    velocity: Vec3,
    dt: number,
    friction: number = GROUND_FRICTION
): Vec3 {
    const speed = vec3HorizontalLength(velocity);
    if (speed < 0.1) {
        return { x: 0, y: velocity.y, z: 0 };
    }

    // Q3 friction formula
    const drop = Math.max(speed, STOP_SPEED) * friction * dt;
    const newSpeed = Math.max(0, speed - drop);
    const scale = newSpeed / speed;

    return {
        x: velocity.x * scale,
        y: velocity.y,
        z: velocity.z * scale,
    };
}

/**
 * Apply acceleration in wish direction
 * 
 * Q3 acceleration: accelerates toward wish direction
 */
export function accelerate(
    velocity: Vec3,
    wishDir: Vec3,
    wishSpeed: number,
    accel: number,
    dt: number
): Vec3 {
    // Current speed in wish direction
    const currentSpeed = vec3Dot(velocity, wishDir);

    // How much to add
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) {
        return velocity;
    }

    // Clamp acceleration
    let accelSpeed = accel * dt * wishSpeed;
    if (accelSpeed > addSpeed) {
        accelSpeed = addSpeed;
    }

    return {
        x: velocity.x + accelSpeed * wishDir.x,
        y: velocity.y,
        z: velocity.z + accelSpeed * wishDir.z,
    };
}

/**
 * Ground movement: friction + acceleration
 */
export function moveGround(
    velocity: Vec3,
    wishDir: Vec3,
    wishSpeed: number,
    dt: number
): Vec3 {
    // Apply friction first
    let vel = applyFriction(velocity, dt, GROUND_FRICTION);

    // Then accelerate
    vel = accelerate(vel, wishDir, wishSpeed, GROUND_ACCELERATION, dt);

    // Clamp to max speed
    const speed = vec3HorizontalLength(vel);
    if (speed > MAX_GROUND_SPEED) {
        const scale = MAX_GROUND_SPEED / speed;
        vel.x *= scale;
        vel.z *= scale;
    }

    return vel;
}

/**
 * Air movement: no friction, air acceleration
 */
export function moveAir(
    velocity: Vec3,
    wishDir: Vec3,
    wishSpeed: number,
    dt: number
): Vec3 {
    // Air has no friction, just acceleration
    return accelerate(velocity, wishDir, wishSpeed, AIR_ACCELERATION, dt);
}

/**
 * Apply gravity (asymmetric: stronger when falling for snappier feel)
 */
export function applyGravity(velocity: Vec3, dt: number): Vec3 {
    // When falling (vy < 0), apply stronger gravity for less floaty descents
    const gravityScale = velocity.y < 0 ? FALLING_GRAVITY_MULTIPLIER : 1.0;
    return {
        x: velocity.x,
        y: velocity.y - GRAVITY * gravityScale * dt,
        z: velocity.z,
    };
}

/**
 * Apply jump
 */
export function applyJump(velocity: Vec3): Vec3 {
    return {
        x: velocity.x,
        y: JUMP_VELOCITY,
        z: velocity.z,
    };
}

/**
 * Calculate wish direction from input and view angles
 */
export function calculateWishDir(
    forward: number,
    right: number,
    yaw: number
): Vec3 {
    if (forward === 0 && right === 0) {
        return { x: 0, y: 0, z: 0 };
    }

    // Convert yaw to radians
    const rad = (yaw * Math.PI) / 180;
    const sinYaw = Math.sin(rad);
    const cosYaw = Math.cos(rad);

    // Calculate wish direction
    const wishX = forward * sinYaw + right * cosYaw;
    const wishZ = forward * cosYaw - right * sinYaw;

    return vec3Normalize({ x: wishX, y: 0, z: wishZ });
}
