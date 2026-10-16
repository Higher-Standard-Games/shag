/**
 * SharedCollisionWorld - Single shared CollisionWorld implementation
 *
 * Used by BOTH client and server to guarantee physics parity.
 * Takes a structural SweepBackend via dependency injection — the engine's
 * Babylon-based SweepCollisionBackend is wrapped by SweepBackendAdapter
 * (engine/physics) at the construction site, so this file is pure structural
 * math with no engine or Babylon dependency (QA-3 / QA-WO8).
 *
 * This eliminates the duplicate BSPCollisionWorld / HeadlessBSPCollisionWorld
 * implementations that previously had subtle differences causing
 * client-server physics divergence.
 */

import type { Vec3 } from "../server/simulation/types";
import type { AABB, CollisionWorld, StepSlideMoveResult, SweepBackend, TraceResult } from "./CollisionWorld";

// ═══════════════════════════════════════════════════════════════════
// SHARED COLLISION WORLD
// ═══════════════════════════════════════════════════════════════════

export class SharedCollisionWorld implements CollisionWorld {
  // Player dimensions matching Q3 asymmetric box
  private static readonly PLAYER_RADIUS = 16;
  private static readonly PLAYER_HEIGHT = 64;

  private backend: SweepBackend;

  constructor(backend: SweepBackend) {
    this.backend = backend;
  }

  get lifts() {
    return this.backend.lifts;
  }

  // ───────────────────────────────────────────────────────────────
  // TRACE
  // ───────────────────────────────────────────────────────────────

  trace(start: Vec3, end: Vec3, bounds?: AABB, contentMask?: number): TraceResult {
    const options = bounds
      ? {
          radius: (bounds.max.x - bounds.min.x) / 2,
          height: bounds.max.y - bounds.min.y,
          contentMask,
        }
      : { radius: 0, height: 0, contentMask };

    const result = this.backend.trace(start, end, options);

    return {
      hit: result.fraction < 1,
      fraction: result.fraction,
      hitPoint: result.endPos,
      normal: result.normal,
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
  stepSlideMove(start: Vec3, velocity: Vec3, deltaTime: number, bounds: AABB): StepSlideMoveResult {
    // Backend expects MOVEMENT (units), not velocity (units/sec)
    const movement: Vec3 = {
      x: velocity.x * deltaTime,
      y: velocity.y * deltaTime,
      z: velocity.z * deltaTime,
    };

    // Derive collision dimensions from bounds.
    // For player-sized or larger objects, keep hardcoded PLAYER constants
    // (player bounds pass height=56 but PLAYER_HEIGHT=64 was the working value).
    // Only override for significantly smaller objects (items, weapons).
    const boundsRadius = (bounds.max.x - bounds.min.x) / 2;
    const boundsHeight = bounds.max.y - bounds.min.y;
    const isSmallObject = boundsRadius > 0 && boundsRadius < SharedCollisionWorld.PLAYER_RADIUS * 0.75;
    const traceOpts = {
      radius: isSmallObject ? boundsRadius : SharedCollisionWorld.PLAYER_RADIUS,
      height: isSmallObject ? boundsHeight : SharedCollisionWorld.PLAYER_HEIGHT,
    };

    const result = this.backend.stepSlideMove(start, movement, traceOpts);

    // ── GROUND DETECTION ──
    // Downward blocking and nearly level motion use the floor checks below.
    // Uphill motion can remain tangent to a ramp without hitting it this frame.
    // Nearby support alone is insufficient: jumps and slide bumps must be
    // moving along/into the support plane, rather than away from it.
    const expectedYMove = movement.y;
    const actualYMove = result.endPos.y - start.y;
    let grounded = false;

    if (expectedYMove < -0.1 && actualYMove > expectedYMove * 0.5) {
      // Path 1: downward movement was blocked by collision → on ground
      grounded = true;
    } else if (Math.abs(movement.y) < 0.1) {
      // Path 2: nearly stationary vertically → trace to detect floor
      const groundCheckEnd = { x: result.endPos.x, y: result.endPos.y - 2, z: result.endPos.z };
      const groundTrace = this.backend.trace(result.endPos, groundCheckEnd, traceOpts);
      grounded = groundTrace.fraction < 1.0;
    } else if (movement.y > 0.1) {
      const groundCheckEnd = { x: result.endPos.x, y: result.endPos.y - 2, z: result.endPos.z };
      const groundTrace = this.backend.trace(result.endPos, groundCheckEnd, traceOpts);
      const normal = groundTrace.normal;
      if (groundTrace.fraction < 1 && normal && normal.y >= 0.7) {
        const separation = result.velocity.x * normal.x + result.velocity.y * normal.y + result.velocity.z * normal.z;
        // Backend velocity is a displacement; allow only a small clipping error.
        grounded = separation <= 0.01;
      }
    }

    // ── VELOCITY CONVERSION ──
    // Backend returns clipped MOVEMENT delta, convert back to velocity (units/sec).
    // Multiply by the inverse (not divide) — bit-identical to the previous
    // Babylon `.scale(1 / deltaTime)`, which determinism checksums depend on.
    const invDt = deltaTime > 0 ? 1 / deltaTime : 0;
    const clippedVelocity: Vec3 =
      deltaTime > 0
        ? {
            x: result.velocity.x * invDt,
            y: result.velocity.y * invDt,
            z: result.velocity.z * invDt,
          }
        : { x: 0, y: 0, z: 0 };

    return {
      endPos: result.endPos,
      velocity: clippedVelocity,
      grounded,
    };
  }

  // ───────────────────────────────────────────────────────────────
  // POINT CONTENTS
  // ───────────────────────────────────────────────────────────────

  pointContents(point: Vec3): number {
    return this.backend.pointContents(point);
  }

  isInLadder(min: Vec3, max: Vec3): boolean {
    return this.backend.isInLadder?.(min, max) ?? false;
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
