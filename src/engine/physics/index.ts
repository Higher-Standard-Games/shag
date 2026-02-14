/**
 * Physics module - BSP collision and player movement
 *
 * Active collision backends:
 * - SweepCollisionBackend (q3): Primary Q3-style swept AABB collision
 * - BabylonPhysicsBackend: Babylon.js mesh raycasting for simpler games
 * - BspCollision: Low-level BSP trace (used by CLI debug tools)
 */

export { BspCollision } from './BspCollision';
export { ContentFlags, SurfaceFlags } from './ContentFlags';
export { PhysicsSystem } from './PhysicsSystem';

// Collision Backend System
export type {
  CollisionBackend,
  CollisionBackendType,
  TraceResult,
  TraceOptions,
  CollisionStats,
} from './CollisionBackend';
export { Contents, createDefaultTraceResult } from './CollisionBackend';
export { BabylonPhysicsBackend } from './BabylonPhysicsBackend';
export { CollisionManager, getCollisionManager } from './CollisionManager';
