/**
 * Physics module - BSP collision and player movement
 *
 * Active collision backends:
 * - SweepCollisionBackend (q3): Primary Q3-style swept AABB collision
 * - BabylonPhysicsBackend: Babylon.js mesh raycasting for simpler games
 */

export { BabylonPhysicsBackend } from "./BabylonPhysicsBackend";
// Collision Backend System
export type {
  CollisionBackend,
  CollisionBackendType,
  CollisionStats,
  TraceOptions,
  TraceResult,
} from "./CollisionBackend";
export { Contents, createDefaultTraceResult } from "./CollisionBackend";
export { CollisionManager, getCollisionManager } from "./CollisionManager";
export { ContentFlags, SurfaceFlags } from "./ContentFlags";
export { PhysicsSystem } from "./PhysicsSystem";
