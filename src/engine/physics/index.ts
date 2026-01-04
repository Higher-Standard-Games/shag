/**
 * Physics module - BSP collision and player movement
 */

export { BspCollision, type TraceResult } from './BspCollision';
export {
  ContentFlags,
  SurfaceFlags,
  CollisionMasks,
  isPlayerSolid,
  isSolid,
  isLiquid,
} from './ContentFlags';
