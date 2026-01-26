import type { Vec3 } from '../../components/TransformComponent';
import type { CollisionWorld } from '../collision/CollisionWorld';
import type { MovementProfile, MovementInput, MovementResult } from './MovementProfile';
import { InputButtons } from '../../components/InputComponent';

/**
 * Configuration for SimpleMovement
 */
export interface SimpleMovementConfig {
  maxSpeed: number;
  acceleration: number;
  friction: number;
  gravity: number;
  jumpVelocity: number;
}

/**
 * SimpleMovement - Basic movement implementation
 *
 * A simple movement profile suitable for:
 * - Prototyping
 * - Simple games
 * - Base for more complex profiles
 *
 * Features:
 * - Ground movement with friction
 * - Basic gravity
 * - Jump
 * - No air acceleration (simple version)
 */
export class SimpleMovement implements MovementProfile {
  private config: SimpleMovementConfig;

  constructor(config?: Partial<SimpleMovementConfig>) {
    this.config = {
      maxSpeed: 280,
      acceleration: 10,
      friction: 6,
      gravity: 800,
      jumpVelocity: 270,
      ...config,
    };
  }

  getName(): string {
    return 'SimpleMovement';
  }

  getDefaults() {
    return { ...this.config };
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
    // Simple ground check: if Y velocity is ~0 and we're at a reasonable height
    // In production, use collision.trace() for proper ground detection
    if (collision) {
      const groundTrace = collision.trace(
        position,
        { x: position.x, y: position.y - 0.1, z: position.z }
      );
      grounded = groundTrace.hit && groundTrace.fraction < 1;
    } else {
      // Fallback: assume grounded if Y velocity is small and position is low
      grounded = Math.abs(newVel.y) < 1 && newPos.y <= 0.1;
    }

    // === GRAVITY ===
    if (!grounded) {
      newVel.y -= this.config.gravity * deltaTime;
    } else {
      // Snap to ground
      if (newVel.y < 0) {
        newVel.y = 0;
      }
    }

    // === INPUT PROCESSING ===
    if (input) {
      // Jump
      if (grounded && input.isPressed(InputButtons.JUMP)) {
        newVel.y = this.config.jumpVelocity;
        grounded = false;
      }

      // Horizontal movement
      const wishDir = input.direction;
      const wishSpeed = Math.sqrt(wishDir.x * wishDir.x + wishDir.z * wishDir.z);

      if (wishSpeed > 0.01) {
        // Normalize wish direction
        const normalizedWish: Vec3 = {
          x: wishDir.x / wishSpeed,
          y: 0,
          z: wishDir.z / wishSpeed,
        };

        if (grounded) {
          // Ground movement: apply friction then accelerate
          this.applyFriction(newVel, deltaTime);
          this.accelerate(newVel, normalizedWish, this.config.maxSpeed, deltaTime);
        } else {
          // Air movement: simple version - just accelerate slower
          this.accelerate(newVel, normalizedWish, this.config.maxSpeed * 0.1, deltaTime);
        }
      } else if (grounded) {
        // No input, apply friction
        this.applyFriction(newVel, deltaTime);
      }
    } else if (grounded) {
      // No input component, apply friction
      this.applyFriction(newVel, deltaTime);
    }

    // === APPLY VELOCITY ===
    const moveX = newVel.x * deltaTime;
    const moveY = newVel.y * deltaTime;
    const moveZ = newVel.z * deltaTime;

    // Collision detection
    if (collision) {
      const endPos: Vec3 = {
        x: newPos.x + moveX,
        y: newPos.y + moveY,
        z: newPos.z + moveZ,
      };

      const trace = collision.trace(newPos, endPos);

      if (trace.hit) {
        // Move to hit point with small offset
        newPos.x = newPos.x + moveX * trace.fraction;
        newPos.y = newPos.y + moveY * trace.fraction;
        newPos.z = newPos.z + moveZ * trace.fraction;

        // Clip velocity against hit normal
        if (trace.normal) {
          const dot =
            newVel.x * trace.normal.x +
            newVel.y * trace.normal.y +
            newVel.z * trace.normal.z;

          newVel.x -= trace.normal.x * dot;
          newVel.y -= trace.normal.y * dot;
          newVel.z -= trace.normal.z * dot;
        }
      } else {
        // No collision, move freely
        newPos.x = endPos.x;
        newPos.y = endPos.y;
        newPos.z = endPos.z;
      }
    } else {
      // No collision world, move freely
      newPos.x += moveX;
      newPos.y += moveY;
      newPos.z += moveZ;
    }

    // Simple ground clamp if no collision system
    if (!collision && newPos.y < 0) {
      newPos.y = 0;
      newVel.y = 0;
      grounded = true;
    }

    return { position: newPos, velocity: newVel, grounded };
  }

  /**
   * Apply ground friction to velocity
   */
  private applyFriction(velocity: Vec3, deltaTime: number): void {
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

    if (speed < 0.1) {
      velocity.x = 0;
      velocity.z = 0;
      return;
    }

    // Calculate friction drop
    const drop = speed * this.config.friction * deltaTime;
    let newSpeed = speed - drop;

    if (newSpeed < 0) {
      newSpeed = 0;
    }

    // Scale velocity
    const scale = newSpeed / speed;
    velocity.x *= scale;
    velocity.z *= scale;
  }

  /**
   * Accelerate in a direction
   */
  private accelerate(
    velocity: Vec3,
    wishDir: Vec3,
    maxSpeed: number,
    deltaTime: number
  ): void {
    // Current speed in wish direction
    const currentSpeed = velocity.x * wishDir.x + velocity.z * wishDir.z;

    // How much to add
    const addSpeed = maxSpeed - currentSpeed;

    if (addSpeed <= 0) {
      return;
    }

    // Acceleration
    let accelSpeed = this.config.acceleration * maxSpeed * deltaTime;

    if (accelSpeed > addSpeed) {
      accelSpeed = addSpeed;
    }

    velocity.x += wishDir.x * accelSpeed;
    velocity.z += wishDir.z * accelSpeed;
  }
}
