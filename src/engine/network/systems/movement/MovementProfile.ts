import type { Vec3 } from "../../components/TransformComponent";
import type { CollisionWorld } from "../collision/CollisionWorld";

/**
 * Movement input for the profile to process
 */
export interface MovementInput {
  /** Desired movement direction (normalized, world-relative) */
  direction: Vec3;

  /** View angles (pitch, yaw) */
  viewAngles: { pitch: number; yaw: number };

  /** Button states */
  buttons: number;

  /**
   * Input command sequence number (monotonic, 1 seq = one fixed-dt sim step).
   * When present, movement profiles derive their internal timelines from it
   * (`simTime = sequence * dt`) instead of accumulating deltaTime. This makes
   * reconciliation replays idempotent: re-simulating the same command recomputes
   * the same timestamps, so slide/walljump/ledge timers don't double-advance.
   */
  sequence?: number;

  /** Button check helper */
  isPressed(button: number): boolean;
}

/**
 * Result of movement simulation
 */
export interface MovementResult {
  /** New position after movement */
  position: Vec3;

  /** New velocity after movement */
  velocity: Vec3;

  /** Whether entity is on ground */
  grounded: boolean;

  /** Optional: new rotation */
  rotation?: Vec3;
}

/**
 * MovementProfile Interface
 *
 * Defines how entities move in the game world.
 * Different games implement this differently:
 *
 * - Q3Movement: Air acceleration, strafejumping, friction
 * - TopDownMovement: Direct 8-way movement, no gravity
 * - VehicleMovement: Acceleration, steering, drift
 * - PlatformerMovement: Jump, gravity, wall slide
 *
 * The generic MovementSystem uses this interface to process
 * movement for any game type.
 */
export interface MovementProfile {
  /**
   * Simulate one tick of movement
   *
   * @param position - Current position
   * @param velocity - Current velocity
   * @param input - Player input for this tick
   * @param deltaTime - Time since last tick (seconds)
   * @param collision - Collision world for traces
   * @returns New position, velocity, and grounded state
   */
  simulate(
    position: Vec3,
    velocity: Vec3,
    input: MovementInput | null,
    deltaTime: number,
    collision: CollisionWorld | null,
  ): MovementResult;

  /**
   * Get default configuration values
   */
  getDefaults(): {
    maxSpeed: number;
    acceleration: number;
    friction: number;
    gravity: number;
    jumpVelocity: number;
  };

  /**
   * Get profile name for debugging
   */
  getName(): string;
}
