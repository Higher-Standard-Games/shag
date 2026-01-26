import type { Vec3 } from '../../components/TransformComponent';

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
  trace(start: Vec3, end: Vec3, bounds?: AABB): TraceResult;

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
