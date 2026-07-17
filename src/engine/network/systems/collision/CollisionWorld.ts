/**
 * Moved to shared/collision/CollisionWorld (QA-3 / QA-WO8): the collision
 * interfaces (TraceResult, AABB, StepSlideMoveResult, CollisionWorld, Contents)
 * are the deterministic core's contract — SharedCollisionWorld implements them
 * in shared without importing upward. This shim keeps existing engine-path
 * importers working; new code should import from shared/collision directly.
 */
export * from "../../../../shared/collision/CollisionWorld";
