import type { Vec3 } from '../../../engine/network/components/TransformComponent';
import type { CollisionWorld } from '../../../engine/network/systems/collision/CollisionWorld';
import type { MovementProfile, MovementInput, MovementResult } from '../../../engine/network/systems/movement/MovementProfile';
import { InputButtons } from '../../../engine/network/components/InputComponent';

/**
 * Configuration for Q3-style FPS movement
 */
export interface FPSMovementConfig {
  /** Maximum ground speed */
  maxSpeed: number;
  /** Ground acceleration */
  groundAcceleration: number;
  /** Air acceleration (for strafejumping) */
  airAcceleration: number;
  /** Ground friction */
  friction: number;
  /** Gravity (units/s^2) */
  gravity: number;
  /** Jump velocity */
  jumpVelocity: number;
  /** Sprint speed multiplier */
  sprintMultiplier: number;
  /** Crouch speed multiplier */
  crouchMultiplier: number;
}

/**
 * FPSMovementProfile - Quake 3 / Warsow style movement
 *
 * Features:
 * - Ground movement with friction
 * - Air acceleration (strafejumping)
 * - Jump, crouch, sprint
 *
 * This is a simplified version - full implementation will be in Milestone 6.
 * For now, it provides enough to test the network architecture.
 */
export class FPSMovementProfile implements MovementProfile {
  private config: FPSMovementConfig;

  constructor(config?: Partial<FPSMovementConfig>) {
    this.config = {
      maxSpeed: 320,
      groundAcceleration: 10,
      airAcceleration: 1,
      friction: 6,
      gravity: 800,
      jumpVelocity: 270,
      sprintMultiplier: 1.5,
      crouchMultiplier: 0.5,
      ...config,
    };
  }

  getName(): string {
    return 'FPSMovement';
  }

  getDefaults() {
    return {
      maxSpeed: this.config.maxSpeed,
      acceleration: this.config.groundAcceleration,
      friction: this.config.friction,
      gravity: this.config.gravity,
      jumpVelocity: this.config.jumpVelocity,
    };
  }

  simulate(
    position: Vec3,
    velocity: Vec3,
    input: MovementInput | null,
    deltaTime: number,
    collision: CollisionWorld | null
  ): MovementResult {
    // Clone to avoid mutating input
    const newPos: Vec3 = { ...position };
    const newVel: Vec3 = { ...velocity };
    let grounded = false;

    // === GROUND CHECK ===
    if (collision) {
      const groundTrace = collision.trace(
        position,
        { x: position.x, y: position.y - 0.1, z: position.z }
      );
      grounded = groundTrace.hit && groundTrace.fraction < 1;
    } else {
      // Simple fallback
      grounded = newPos.y <= 0.1 && newVel.y <= 0;
    }

    // === GRAVITY ===
    if (!grounded) {
      newVel.y -= this.config.gravity * deltaTime;
    } else if (newVel.y < 0) {
      newVel.y = 0;
    }

    // === INPUT PROCESSING ===
    if (input) {
      // Calculate wish direction and speed
      let wishSpeed = this.config.maxSpeed;

      // Sprint modifier
      if (grounded && input.isPressed(InputButtons.SPRINT)) {
        wishSpeed *= this.config.sprintMultiplier;
      }

      // Crouch modifier
      if (input.isPressed(InputButtons.CROUCH)) {
        wishSpeed *= this.config.crouchMultiplier;
      }

      // Jump
      if (grounded && input.isPressed(InputButtons.JUMP)) {
        newVel.y = this.config.jumpVelocity;
        grounded = false;
      }

      // Movement direction
      const wishDir = input.direction;
      const wishLen = Math.sqrt(wishDir.x * wishDir.x + wishDir.z * wishDir.z);

      if (wishLen > 0.01) {
        const normalizedWish: Vec3 = {
          x: wishDir.x / wishLen,
          y: 0,
          z: wishDir.z / wishLen,
        };

        if (grounded) {
          this.groundMove(newVel, normalizedWish, wishSpeed, deltaTime);
        } else {
          this.airMove(newVel, normalizedWish, wishSpeed, deltaTime);
        }
      } else if (grounded) {
        this.applyFriction(newVel, deltaTime);
      }
    } else if (grounded) {
      this.applyFriction(newVel, deltaTime);
    }

    // === APPLY VELOCITY ===
    const move: Vec3 = {
      x: newVel.x * deltaTime,
      y: newVel.y * deltaTime,
      z: newVel.z * deltaTime,
    };

    if (collision) {
      this.slideMove(newPos, newVel, move, collision);
    } else {
      newPos.x += move.x;
      newPos.y += move.y;
      newPos.z += move.z;

      // Simple ground clamp
      if (newPos.y < 0) {
        newPos.y = 0;
        newVel.y = 0;
        grounded = true;
      }
    }

    return { position: newPos, velocity: newVel, grounded };
  }

  /**
   * Ground movement with friction and acceleration
   */
  private groundMove(
    velocity: Vec3,
    wishDir: Vec3,
    wishSpeed: number,
    deltaTime: number
  ): void {
    // Apply friction first
    this.applyFriction(velocity, deltaTime);

    // Then accelerate
    this.accelerate(velocity, wishDir, wishSpeed, this.config.groundAcceleration, deltaTime);
  }

  /**
   * Air movement (Q3-style air acceleration for strafejumping)
   */
  private airMove(
    velocity: Vec3,
    wishDir: Vec3,
    wishSpeed: number,
    deltaTime: number
  ): void {
    // Air acceleration is much lower
    // Cap air speed to prevent excessive acceleration
    const airWishSpeed = Math.min(wishSpeed, 30);

    this.accelerate(velocity, wishDir, airWishSpeed, this.config.airAcceleration, deltaTime);
  }

  /**
   * Apply ground friction
   */
  private applyFriction(velocity: Vec3, deltaTime: number): void {
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

    if (speed < 1) {
      velocity.x = 0;
      velocity.z = 0;
      return;
    }

    const drop = speed * this.config.friction * deltaTime;
    let newSpeed = speed - drop;

    if (newSpeed < 0) newSpeed = 0;

    const scale = newSpeed / speed;
    velocity.x *= scale;
    velocity.z *= scale;
  }

  /**
   * Accelerate in a direction (Q3-style)
   */
  private accelerate(
    velocity: Vec3,
    wishDir: Vec3,
    wishSpeed: number,
    accel: number,
    deltaTime: number
  ): void {
    const currentSpeed = velocity.x * wishDir.x + velocity.z * wishDir.z;
    const addSpeed = wishSpeed - currentSpeed;

    if (addSpeed <= 0) return;

    let accelSpeed = accel * wishSpeed * deltaTime;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;

    velocity.x += wishDir.x * accelSpeed;
    velocity.z += wishDir.z * accelSpeed;
  }

  /**
   * Slide movement along surfaces
   */
  private slideMove(
    position: Vec3,
    velocity: Vec3,
    move: Vec3,
    collision: CollisionWorld
  ): void {
    const endPos: Vec3 = {
      x: position.x + move.x,
      y: position.y + move.y,
      z: position.z + move.z,
    };

    const trace = collision.trace(position, endPos);

    if (!trace.hit) {
      // No collision, move freely
      position.x = endPos.x;
      position.y = endPos.y;
      position.z = endPos.z;
      return;
    }

    // Move up to the hit point
    position.x += move.x * trace.fraction;
    position.y += move.y * trace.fraction;
    position.z += move.z * trace.fraction;

    // Clip velocity against surface normal
    if (trace.normal) {
      const dot =
        velocity.x * trace.normal.x +
        velocity.y * trace.normal.y +
        velocity.z * trace.normal.z;

      velocity.x -= trace.normal.x * dot;
      velocity.y -= trace.normal.y * dot;
      velocity.z -= trace.normal.z * dot;
    }

    // TODO: Try to continue moving along the surface (proper slide)
  }
}
