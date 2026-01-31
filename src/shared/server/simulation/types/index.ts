/**
 * Branded types for type-safe IDs and units
 */

// ═══════════════════════════════════════════════════════════════════
// BRANDED TYPE UTILITIES
// ═══════════════════════════════════════════════════════════════════

/** Brand symbol for type safety */
declare const brand: unique symbol;

/** Branded type utility */
type Brand<T, B> = T & { readonly [brand]: B };

// ═══════════════════════════════════════════════════════════════════
// ENTITY/PLAYER IDS
// ═══════════════════════════════════════════════════════════════════

/** Unique entity identifier */
export type EntityId = Brand<number, 'EntityId'>;

/** Unique player identifier */
export type PlayerId = Brand<number, 'PlayerId'>;

/** Monotonic tick counter */
export type TickNumber = Brand<number, 'TickNumber'>;

// Factory functions
export function entityId(n: number): EntityId {
    return n as EntityId;
}

export function playerId(n: number): PlayerId {
    return n as PlayerId;
}

export function tickNumber(n: number): TickNumber {
    return n as TickNumber;
}

// ═══════════════════════════════════════════════════════════════════
// VECTOR TYPES WITH UNITS
// ═══════════════════════════════════════════════════════════════════

/** 3D vector base */
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

/** Position in world units (Quake units) */
export type PositionWorld = Brand<Vec3, 'PositionWorld'>;

/** Velocity in units per second */
export type VelocityPerSec = Brand<Vec3, 'VelocityPerSec'>;

/** Angular velocity in radians per second */
export type AngularVelocityPerSec = Brand<Vec3, 'AngularVelocityPerSec'>;

/** Acceleration in units per second squared */
export type AccelerationPerSec2 = Brand<Vec3, 'AccelerationPerSec2'>;

// Factory functions
export function positionWorld(x: number, y: number, z: number): PositionWorld {
    return { x, y, z } as PositionWorld;
}

export function velocityPerSec(x: number, y: number, z: number): VelocityPerSec {
    return { x, y, z } as VelocityPerSec;
}

export function vec3Zero(): Vec3 {
    return { x: 0, y: 0, z: 0 };
}

// ═══════════════════════════════════════════════════════════════════
// TIME/DURATION TYPES
// ═══════════════════════════════════════════════════════════════════

/** Duration in milliseconds */
export type Milliseconds = Brand<number, 'Milliseconds'>;

/** Duration in seconds */
export type Seconds = Brand<number, 'Seconds'>;

export function milliseconds(n: number): Milliseconds {
    return n as Milliseconds;
}

export function seconds(n: number): Seconds {
    return n as Seconds;
}

export function msToSec(ms: Milliseconds): Seconds {
    return (ms / 1000) as Seconds;
}

export function secToMs(sec: Seconds): Milliseconds {
    return (sec * 1000) as Milliseconds;
}

// ═══════════════════════════════════════════════════════════════════
// ENTITY TYPES
// ═══════════════════════════════════════════════════════════════════

/** Entity type enum */
export enum EntityType {
    Player = 'player',
    Projectile = 'projectile',
    Item = 'item',
    Trigger = 'trigger',
    World = 'world',
}

// ═══════════════════════════════════════════════════════════════════
// DISPLACEMENT TYPE (movement per tick)
// ═══════════════════════════════════════════════════════════════════

/** Displacement in units per tick (already scaled by dt) */
export type DisplacementPerTick = Brand<Vec3, 'DisplacementPerTick'>;

export function displacementPerTick(x: number, y: number, z: number): DisplacementPerTick {
    return { x, y, z } as DisplacementPerTick;
}

// ═══════════════════════════════════════════════════════════════════
// UNIT CONVERSION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert velocity (per second) to displacement (per tick)
 * displacement = velocity * dt
 */
export function velocityToDisplacement(
    velocity: VelocityPerSec,
    dt: Seconds
): DisplacementPerTick {
    return {
        x: velocity.x * dt,
        y: velocity.y * dt,
        z: velocity.z * dt,
    } as DisplacementPerTick;
}

/**
 * Convert displacement (per tick) back to velocity (per second)
 * velocity = displacement / dt
 */
export function displacementToVelocity(
    displacement: DisplacementPerTick,
    dt: Seconds
): VelocityPerSec {
    const invDt = 1 / dt;
    return {
        x: displacement.x * invDt,
        y: displacement.y * invDt,
        z: displacement.z * invDt,
    } as VelocityPerSec;
}

/**
 * Apply velocity over time to get new position
 * position' = position + velocity * dt
 */
export function applyVelocity(
    position: PositionWorld,
    velocity: VelocityPerSec,
    dt: Seconds
): PositionWorld {
    return {
        x: position.x + velocity.x * dt,
        y: position.y + velocity.y * dt,
        z: position.z + velocity.z * dt,
    } as PositionWorld;
}

/**
 * Apply displacement to position
 * position' = position + displacement
 */
export function applyDisplacement(
    position: PositionWorld,
    displacement: DisplacementPerTick
): PositionWorld {
    return {
        x: position.x + displacement.x,
        y: position.y + displacement.y,
        z: position.z + displacement.z,
    } as PositionWorld;
}

/**
 * Apply acceleration to velocity
 * velocity' = velocity + acceleration * dt
 */
export function applyAcceleration(
    velocity: VelocityPerSec,
    acceleration: AccelerationPerSec2,
    dt: Seconds
): VelocityPerSec {
    return {
        x: velocity.x + acceleration.x * dt,
        y: velocity.y + acceleration.y * dt,
        z: velocity.z + acceleration.z * dt,
    } as VelocityPerSec;
}

// ═══════════════════════════════════════════════════════════════════
// PHYSICS CONSTANTS (branded)
// ═══════════════════════════════════════════════════════════════════

/** Gravity acceleration (800 units/sec²) - Q3/Warsow standard */
export const GRAVITY: AccelerationPerSec2 = { x: 0, y: -800, z: 0 } as AccelerationPerSec2;

/** Standard tick duration at 125Hz */
export const TICK_DT: Seconds = 0.008 as Seconds;

/** Zero velocity constant */
export const ZERO_VELOCITY: VelocityPerSec = { x: 0, y: 0, z: 0 } as VelocityPerSec;

