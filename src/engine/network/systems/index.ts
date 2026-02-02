/**
 * Generic Network Systems
 *
 * These systems are game-agnostic and can be used by any game type.
 * They rely on interfaces (MovementProfile, CollisionWorld) that
 * games implement for their specific needs.
 */

// Core systems (client-side prediction)
export { MovementSystem } from './MovementSystem';

// Movement profiles
export { type MovementProfile, type MovementInput, type MovementResult } from './movement/MovementProfile';
export { SimpleMovement, type SimpleMovementConfig } from './movement/SimpleMovement';

// Collision
export {
  type CollisionWorld,
  type TraceResult,
  type AABB,
  Contents,
  NullCollisionWorld,
} from './collision/CollisionWorld';
