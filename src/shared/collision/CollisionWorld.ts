import type { Vec3 } from "../server/simulation/types";

/**
 * Result of a collision trace
 */
export interface TraceResult {
  /** Whether the trace hit something */
  hit: boolean;

  /** Fraction of the trace completed before hit (0-1) */
  fraction: number;

  /** Hit position (if hit) */
  hitPoint?: Vec3;

  /** Surface normal at hit point (if hit) */
  normal?: Vec3;

  /** Entity ID that was hit (if hit entity) */
  entityId?: string;

  /** Surface contents/material (game-specific) */
  contents?: number;
}

/**
 * Axis-Aligned Bounding Box for collision
 */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

/**
 * Result of a step-slide move operation
 */
export interface StepSlideMoveResult {
  /** Final position after collision resolution */
  endPos: Vec3;
  /** Final velocity after wall sliding */
  velocity: Vec3;
  /** Whether player is on ground after move */
  grounded: boolean;
}

/**
 * CollisionWorld Interface
 *
 * Abstraction for collision detection in the game world.
 * Different games implement this differently:
 *
 * - BSPCollisionWorld: Quake-style BSP tree collision
 * - TilemapCollisionWorld: 2D/isometric tilemap collision
 * - TrackCollisionWorld: Racing game track collision
 * - PhysicsCollisionWorld: Full physics engine (Rapier, etc.)
 *
 * The generic systems use this interface for all collision
 * queries, making them game-agnostic.
 */
export interface CollisionWorld {
  /**
   * Trace a ray/box from start to end
   *
   * @param start - Starting position
   * @param end - Ending position
   * @param bounds - Optional AABB for box trace (point trace if omitted)
   * @returns Trace result with hit info
   */
  trace(start: Vec3, end: Vec3, bounds?: AABB, contentMask?: number): TraceResult;

  /**
   * Q3-style step-slide move with full collision resolution.
   * This is the proper way to move a player in BSP worlds.
   *
   * @param start - Starting position
   * @param velocity - Current velocity
   * @param deltaTime - Time step for this frame
   * @param bounds - Player bounding box
   * @returns Final position and velocity after collision
   */
  stepSlideMove(start: Vec3, velocity: Vec3, deltaTime: number, bounds: AABB): StepSlideMoveResult;

  /**
   * Check if a point is inside solid geometry
   *
   * @param point - Point to check
   * @returns Contents flags at that point
   */
  pointContents(point: Vec3): number;

  /**
   * Find all entities within a radius
   *
   * @param center - Center of search
   * @param radius - Search radius
   * @returns Array of entity IDs within radius
   */
  findEntitiesInRadius(center: Vec3, radius: number): string[];

  /**
   * Get the world bounds
   *
   * @returns AABB of the entire world
   */
  getWorldBounds(): AABB;
}

/**
 * Structural sweep backend contract (QA-WO8): what SharedCollisionWorld needs
 * from a collision backend, in plain {x,y,z} terms. The engine's Babylon-based
 * SweepCollisionBackend is adapted to this shape by an engine-side adapter
 * (engine/physics/SweepBackendAdapter) — shared code never sees Babylon.
 */
export interface SweepBackendTraceOptions {
  radius: number;
  height: number;
  /**
   * Q3 content flags this trace collides with. Omitted means the backend's
   * player default, SOLID | PLAYERCLIP.
   *
   * Q3 VALUES, not the {@link Contents} enum below — this crosses to the engine
   * backend, which reads BSP shader flags straight from the map.
   */
  contentMask?: number;
}

/**
 * What a shot collides with: solid world only.
 *
 * Q3's `CONTENTS_SOLID`. Deliberately excludes `CONTENTS_PLAYERCLIP` (0x10000),
 * the invisible brush mappers put across railings, window openings and decorative
 * gaps to keep players from walking or getting stuck in them. Those are supposed
 * to stop bodies and let shots through. Firing a rocket at an obviously open
 * hole and watching it burst in mid-air is the symptom of getting this wrong.
 *
 * Same numeric value as `Contents.SOLID` below, but this is the Q3 flag the
 * engine backend matches against, which is a different vocabulary that happens
 * to agree on this one bit.
 */
export const SHOT_CONTENT_MASK = 0x1;

export interface SweepBackend {
  trace(
    start: Vec3,
    end: Vec3,
    options: SweepBackendTraceOptions,
  ): { fraction: number; endPos?: Vec3; normal?: Vec3; contents?: number };
  /** `movement` is a displacement in units (not units/sec). */
  stepSlideMove(
    start: Vec3,
    movement: Vec3,
    options: SweepBackendTraceOptions,
  ): { endPos: Vec3; velocity: Vec3; hitCount: number };
  pointContents(point: Vec3): number;
}

/**
 * Contents flags (BSP-style, game can define more)
 */
export const Contents = {
  EMPTY: 0,
  SOLID: 1 << 0,
  WATER: 1 << 1,
  LAVA: 1 << 2,
  SLIME: 1 << 3,
  PLAYERCLIP: 1 << 4,
  MONSTERCLIP: 1 << 5,
  TRIGGER: 1 << 6,
} as const;

/**
 * Null/empty collision world for testing
 * Always returns no collision
 */
export class NullCollisionWorld implements CollisionWorld {
  trace(_start: Vec3, _end: Vec3, _bounds?: AABB): TraceResult {
    return { hit: false, fraction: 1 };
  }

  stepSlideMove(start: Vec3, velocity: Vec3, deltaTime: number, bounds: AABB): StepSlideMoveResult {
    // Simple floor collision at Y=0 for testing
    // Calculate new position
    const newX = start.x + velocity.x * deltaTime;
    let newY = start.y + velocity.y * deltaTime;
    const newZ = start.z + velocity.z * deltaTime;

    // Apply velocity
    const newVelX = velocity.x;
    let newVelY = velocity.y;
    const newVelZ = velocity.z;

    // Floor height (adjust for player bounds - AABB min.y is negative)
    const floorHeight = -bounds.min.y;

    // Check floor collision
    let grounded = false;
    if (newY <= floorHeight) {
      newY = floorHeight;
      if (newVelY < 0) {
        newVelY = 0; // Stop downward velocity
      }
      grounded = true;
    }

    return {
      endPos: { x: newX, y: newY, z: newZ },
      velocity: { x: newVelX, y: newVelY, z: newVelZ },
      grounded,
    };
  }

  pointContents(_point: Vec3): number {
    return Contents.EMPTY;
  }

  findEntitiesInRadius(_center: Vec3, _radius: number): string[] {
    return [];
  }

  getWorldBounds(): AABB {
    return {
      min: { x: -10000, y: -10000, z: -10000 },
      max: { x: 10000, y: 10000, z: 10000 },
    };
  }
}
