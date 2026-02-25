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
        // Q3-style: grounded only if standing on a surface with normal.y >= 0.75
        // 0.75 ≈ 41° — makes 45° slopes (cos45 ≈ 0.707) non-walkable/surfable
        // matching Warsow feel. Ramps up to ~41° remain walkable.
        const MIN_WALK_NORMAL = 0.75;
        const expectedYMove = movement.y;
        const actualYMove = result.endPos.y - startPos.y;
        let grounded = false;

        if (expectedYMove < -0.1 && actualYMove > expectedYMove * 0.5) {
            // Path 1: downward movement was blocked — verify it's a floor, not a wall
            const groundCheckEnd = result.endPos.add(new Vector3(0, -2, 0));
            const groundTrace = this.backend.trace(result.endPos.clone(), groundCheckEnd, traceOpts);
            grounded = groundTrace.fraction < 1.0
                && groundTrace.normal !== undefined
                && groundTrace.normal.y >= MIN_WALK_NORMAL;
        } else if (Math.abs(movement.y) < 0.1) {
            // Path 2: nearly stationary vertically → trace to detect floor
            const groundCheckEnd = result.endPos.add(new Vector3(0, -2, 0));
            const groundTrace = this.backend.trace(result.endPos.clone(), groundCheckEnd, traceOpts);
            grounded = groundTrace.fraction < 1.0
                && groundTrace.normal !== undefined
                && groundTrace.normal.y >= MIN_WALK_NORMAL;
        }

        // ── VELOCITY CONVERSION ──
        // Backend returns clipped MOVEMENT delta, convert back to velocity (units/sec)
        const clippedVelocity = deltaTime > 0
            ? fromBabylon(result.velocity.scale(1 / deltaTime))
            : { x: 0, y: 0, z: 0 };

        // ── RAMP DETECTION ──
        // If slideMove redirected velocity significantly upward (hit a ramp/slope),
        // override grounded to false. Without this, at ramp/floor junctions the
        // ground trace finds the flat floor below → falsely grounded → friction
        // kills all speed. Q3 uses vel[2] > 180 to prevent grounding when going up.
        //
        // Check: did the slide move ADD significant upward velocity that wasn't
        // in the original input? If so, velocity was redirected by a non-walkable
        // surface (ramp), and the player should be airborne for friction purposes.
        if (grounded && deltaTime > 0) {
            const inputVelY = velocity.y;
            const outputVelY = clippedVelocity.y;
            const addedUpwardVel = outputVelY - inputVelY;
            // Threshold: > 30 units/sec of added upward velocity means ramp contact
            // (A player running at 300 u/s into a 45° ramp gets ~150 u/s upward)
            if (addedUpwardVel > 30) {
                grounded = false;
            }
        }

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
