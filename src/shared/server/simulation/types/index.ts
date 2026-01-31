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
