/**
 * SharedCollisionWorld - Single shared CollisionWorld implementation
 * 
 * Used by BOTH client and server to guarantee physics parity.
 * Takes a SweepCollisionBackend via dependency injection.
 * 
 * This eliminates the duplicate BSPCollisionWorld / HeadlessBSPCollisionWorld
 * implementations that previously had subtle differences causing
 * client-server physics divergence.
 */

import type { Vec3 } from '../../engine/network/components/TransformComponent';
import type { CollisionWorld, TraceResult, AABB, StepSlideMoveResult } from '../../engine/network/systems/collision/CollisionWorld';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { SweepCollisionBackend } from '../../engine/physics/SweepCollisionBackend';

// ═══════════════════════════════════════════════════════════════════
// COORDINATE CONVERSION
// ═══════════════════════════════════════════════════════════════════

function toBabylon(v: Vec3): Vector3 {
    return new Vector3(v.x, v.y, v.z);
}

function fromBabylon(v: Vector3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

// ═══════════════════════════════════════════════════════════════════
// SHARED COLLISION WORLD
// ═══════════════════════════════════════════════════════════════════

export class SharedCollisionWorld implements CollisionWorld {
    // Player dimensions matching Q3 asymmetric box
    private static readonly PLAYER_RADIUS = 16;
    private static readonly PLAYER_HEIGHT = 56;

    private backend: SweepCollisionBackend;

    constructor(backend: SweepCollisionBackend) {
        this.backend = backend;
    }

    // ───────────────────────────────────────────────────────────────
    // TRACE
    // ───────────────────────────────────────────────────────────────

    trace(start: Vec3, end: Vec3, bounds?: AABB): TraceResult {
        const startV = toBabylon(start);
        const endV = toBabylon(end);

        const options = bounds
            ? {
                radius: (bounds.max.x - bounds.min.x) / 2,
                height: bounds.max.y - bounds.min.y,
            }
            : { radius: 0, height: 0 };

        const result = this.backend.trace(startV, endV, options);

        return {
            hit: result.fraction < 1,
            fraction: result.fraction,
            hitPoint: result.endPos ? fromBabylon(result.endPos) : undefined,
            normal: result.normal ? fromBabylon(result.normal) : undefined,
            contents: result.contents ?? 0,
        };
    }

    // ───────────────────────────────────────────────────────────────
    // STEP-SLIDE MOVE
    // ───────────────────────────────────────────────────────────────

    /**
     * Q3-style step-slide move with full collision resolution.
     * 
     * ONE implementation for both client and server — guarantees
     * identical ground detection and velocity clipping.
     */
    stepSlideMove(start: Vec3, velocity: Vec3, deltaTime: number, _bounds: AABB): StepSlideMoveResult {
        const startPos = toBabylon(start);
        // Backend expects MOVEMENT (units), not velocity (units/sec)
        const movement = toBabylon(velocity).scale(deltaTime);

        const traceOpts = {
            radius: SharedCollisionWorld.PLAYER_RADIUS,
            height: SharedCollisionWorld.PLAYER_HEIGHT
        };

        const result = this.backend.stepSlideMove(startPos.clone(), movement, traceOpts);

        // ── GROUND DETECTION ──
        // Q3 PM_GroundTrace style: ALWAYS trace down, regardless of movement direction.
        // Previous conditional paths missed uphill movement (movement.y > 0.1),
        // causing grounded/airborne oscillation on ramps.
        let grounded = false;

        // Unconditional ground trace: always check for ground within 2u below.
        // Detection only — no position snap, no velocity clip.
        // NOTE: original code used fraction < 1.0 only (no normal check).
        // Adding normal.y >= 0.7 broke crouch slides near walls/uneven surfaces.
        const groundCheckEnd = result.endPos.add(new Vector3(0, -2, 0));
        const groundTrace = this.backend.trace(result.endPos.clone(), groundCheckEnd, traceOpts);
        if (groundTrace.fraction < 1.0) {
            grounded = true;
        }

        // ── VELOCITY CONVERSION ──
        // Backend returns clipped MOVEMENT delta, convert back to velocity (units/sec)
        const clippedVelocity = deltaTime > 0
            ? fromBabylon(result.velocity.scale(1 / deltaTime))
            : { x: 0, y: 0, z: 0 };

        return {
            endPos: fromBabylon(result.endPos),
            velocity: clippedVelocity,
            grounded
        };
    }

    // ───────────────────────────────────────────────────────────────
    // POINT CONTENTS
    // ───────────────────────────────────────────────────────────────

    pointContents(point: Vec3): number {
        const pointV = toBabylon(point);
        return this.backend.pointContents(pointV);
    }

    // ───────────────────────────────────────────────────────────────
    // ENTITY QUERY (not yet used)
    // ───────────────────────────────────────────────────────────────

    findEntitiesInRadius(_center: Vec3, _radius: number): string[] {
        return [];
    }

    // ───────────────────────────────────────────────────────────────
    // WORLD BOUNDS
    // ───────────────────────────────────────────────────────────────

    getWorldBounds(): AABB {
        return {
            min: { x: -8192, y: -8192, z: -8192 },
            max: { x: 8192, y: 8192, z: 8192 },
        };
    }
}
