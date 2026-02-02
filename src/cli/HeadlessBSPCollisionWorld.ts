/**
 * HeadlessBSPCollisionWorld - Server-side BSP collision for headless mode
 * 
 * Uses SweepCollisionBackend (same as local client) for consistent collision.
 */

import type { Vec3 } from '../engine/network/components/TransformComponent';
import type { CollisionWorld, TraceResult, AABB, StepSlideMoveResult } from '../engine/network/systems/collision/CollisionWorld';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { SweepCollisionBackend } from '../engine/physics/SweepCollisionBackend';
import type { BspFile } from '../engine/loader/bsp/BspLoader';


/**
 * Convert network Vec3 to Babylon Vector3
 */
function toBabylon(v: Vec3): Vector3 {
    return new Vector3(v.x, v.y, v.z);
}

/**
 * Convert Babylon Vector3 to network Vec3
 */
function fromBabylon(v: Vector3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

/**
 * Headless BSP-based collision world for server-side physics
 * 
 * Uses SweepCollisionBackend for collision - same backend as local client.
 * 
 * IMPORTANT: Use the static create() factory method, not the constructor directly!
 */
export class HeadlessBSPCollisionWorld implements CollisionWorld {
    private backend: SweepCollisionBackend;
    private initialized: boolean = false;

    private static readonly PLAYER_RADIUS = 16;
    private static readonly PLAYER_HEIGHT = 56;

    /**
     * Private constructor - use create() factory instead
     */
    private constructor() {
        this.backend = new SweepCollisionBackend();
    }

    /**
     * Create a HeadlessBSPCollisionWorld with properly initialized collision.
     * This MUST be awaited before using the collision world.
     */
    static async create(bsp: BspFile): Promise<HeadlessBSPCollisionWorld> {
        const world = new HeadlessBSPCollisionWorld();

        // CRITICAL: Actually await the initialization!
        await world.backend.init(bsp);
        world.initialized = true;

        console.log('[HeadlessBSPCollisionWorld] Initialized with SweepCollisionBackend');

        // Debug: Test a trace to verify collision works
        const testStart = new Vector3(880, 200, 1508);
        const testEnd = new Vector3(880, 0, 1508);
        const testResult = world.backend.trace(testStart, testEnd, {
            radius: HeadlessBSPCollisionWorld.PLAYER_RADIUS,
            height: HeadlessBSPCollisionWorld.PLAYER_HEIGHT
        });
        console.log(`[HeadlessBSPCollisionWorld] Test trace: fraction=${testResult.fraction.toFixed(4)}, hit=${testResult.fraction < 1}`);

        return world;
    }

    /**
     * Check if collision is ready
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Trace a ray from start to end
     */
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

    /**
     * Q3-style step-slide move with full collision resolution.
     * 
     * IMPORTANT: velocity parameter is velocity in units/second, needs to be scaled by deltaTime
     */
    stepSlideMove(start: Vec3, velocity: Vec3, deltaTime: number, _bounds: AABB): StepSlideMoveResult {
        const startPos = toBabylon(start);
        // Backend expects MOVEMENT (units), not velocity (units/sec)
        // So we scale velocity by deltaTime to get movement
        const movement = toBabylon(velocity).scale(deltaTime);

        const traceOpts = {
            radius: HeadlessBSPCollisionWorld.PLAYER_RADIUS,
            height: HeadlessBSPCollisionWorld.PLAYER_HEIGHT
        };

        // Use backend's stepSlideMove (same as local)
        const result = this.backend.stepSlideMove(startPos.clone(), movement, traceOpts);

        // Check if grounded: did we land on something?
        // If we had downward velocity but didn't move down much, we hit ground
        const expectedYMove = movement.y;
        const actualYMove = result.endPos.y - startPos.y;

        // Grounded if:
        // 1. We expected to move down (expectedYMove < 0)
        // 2. But we moved less than expected (collision stopped us)
        // 3. OR we're standing still and there's ground right below us
        let grounded = false;

        if (expectedYMove < -0.1 && actualYMove > expectedYMove * 0.5) {
            // Downward movement was blocked → on ground
            grounded = true;
        } else if (Math.abs(movement.y) < 0.1) {
            // Nearly stationary - check if ground is close below
            const groundCheckEnd = result.endPos.add(new Vector3(0, -2, 0));
            const groundTrace = this.backend.trace(result.endPos.clone(), groundCheckEnd, traceOpts);
            grounded = groundTrace.fraction < 1.0;
        }

        // Backend returns clipped MOVEMENT delta
        // Convert back to velocity (units/sec) by dividing by deltaTime
        const clippedVelocity = deltaTime > 0
            ? fromBabylon(result.velocity.scale(1 / deltaTime))
            : { x: 0, y: 0, z: 0 };

        return {
            endPos: fromBabylon(result.endPos),
            velocity: clippedVelocity,
            grounded
        };
    }

    /**
     * Check contents at a point
     */
    pointContents(point: Vec3): number {
        const pointV = toBabylon(point);
        return this.backend.pointContents(pointV);
    }

    /**
     * Find entities in radius (not implemented yet)
     */
    findEntitiesInRadius(_center: Vec3, _radius: number): string[] {
        return [];
    }

    /**
     * Get world bounds
     */
    getWorldBounds(): AABB {
        return {
            min: { x: -8192, y: -8192, z: -8192 },
            max: { x: 8192, y: 8192, z: 8192 },
        };
    }
}

