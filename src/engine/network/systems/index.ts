/**
 * Generic Network Systems
 *
 * These systems are game-agnostic and can be used by any game type.
 * They rely on interfaces (MovementProfile, CollisionWorld) that
 * games implement for their specific needs.
 */

// Collision
export {
  type AABB,
  type CollisionWorld,
  Contents,
  NullCollisionWorld,
  type TraceResult,
} from "./collision/CollisionWorld";
// Core systems (client-side prediction)
export { MovementSystem } from "./MovementSystem";
// Movement profiles
export type { MovementInput, MovementProfile, MovementResult } from "./movement/MovementProfile";
export { SimpleMovement, type SimpleMovementConfig } from "./movement/SimpleMovement";
