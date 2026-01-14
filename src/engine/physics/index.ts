/**
 * Physics module - BSP collision and player movement
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
export { ClipBrushBackend } from './ClipBrushBackend';
export { BabylonPhysicsBackend } from './BabylonPhysicsBackend';
export { CollisionManager, getCollisionManager } from './CollisionManager';
