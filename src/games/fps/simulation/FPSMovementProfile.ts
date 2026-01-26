/**
 * FPSMovementProfile - Advanced Quake 3 / Warsow style movement
 *
 * Full featured movement profile including:
 * - Ground movement with friction and acceleration
 * - Air acceleration (strafejumping/bunnyhop)
 * - Wall jump with charging
 * - Ledge grabbing
 * - Crouchslide
 *
 * This is a pure-math implementation for server-side simulation,
 * ported from AdvancedCharacterController.
 */

import type { Vec3 } from '../../../engine/network/components/TransformComponent';
import type { CollisionWorld, TraceResult } from '../../../engine/network/systems/collision/CollisionWorld';
import type { MovementProfile, MovementInput, MovementResult } from '../../../engine/network/systems/movement/MovementProfile';
import { InputButtons } from '../../../engine/network/components/InputComponent';

// ================== Vec3 Math Helpers ==================

function vec3Zero(): Vec3 {
  return { x: 0, y: 0, z: 0 };
}

function vec3Clone(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function vec3LengthXZ(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.z * v.z);
}

function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < 0.0001) return vec3Zero();
  return vec3Scale(v, 1 / len);
}

function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vec3DotXZ(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.z * b.z;
}

// ================== Configuration ==================

export interface FPSMovementConfig {
  // Core movement
  maxSpeed: number;
  runSpeed: number;
  groundAcceleration: number;
  airAcceleration: number;
  maxAirSpeed: number;
  friction: number;
  stopSpeed: number;
  gravity: number;
  jumpVelocity: number;
  crouchMultiplier: number;
  stepHeight: number;

  // Top speed limiter
  topSpeed: number;

  // Air control (Warsow style)
  airControl: number;
  airControlPower: number;

  // Wall jump
  wallJumpEnabled: boolean;
  wallJumpHeight: number;
  wallJumpBounce: number;
  wallJumpReach: number;
  wallJumpCooldown: number;
  wallJumpMinHeight: number;
  wallJumpChargeTime: number;
  wallJumpBoost: number;

  // Ledge grab
  ledgeGrabEnabled: boolean;
  ledgeReach: number;
  ledgeHeight: number;
  ledgeMinFall: number;
  ledgeTimeout: number;
  ledgePullTime: number;

  // Crouchslide
  slideEnabled: boolean;
  slideDuration: number;
  slideSpeedMultiplier: number;
  slideDecay: number;
  slideJumpBoost: number;
  slideMinSpeed: number;
  slideFriction: number;
  slideCooldown: number;
}

// ================== Extended Result with Advanced State ==================

export interface AdvancedMovementResult extends MovementResult {
  isSliding: boolean;
  isCrouching: boolean;
  wallJumpState: 'none' | 'available' | 'charging';
  ledgeGrabState: 'none' | 'grabbing' | 'pulling';
  actualHorizSpeed: number;
  crouchViewOffset: number;
}

// ================== Movement Profile Class ==================

export class FPSMovementProfile implements MovementProfile {
  private config: FPSMovementConfig;

  // Player bounds for collision traces (matches local AdvancedCharacterController)
  // Uses Q3-style asymmetric box: origin at waist, -24 to feet, +32 to head
  private static readonly PLAYER_RADIUS = 16;
  private static readonly PLAYER_HEIGHT = 56;
  private static readonly PLAYER_BOUNDS = {
    min: { x: -16, y: -24, z: -16 },  // Bottom/back/left from origin
    max: { x: 16, y: 32, z: 16 }       // Top/front/right from origin
  };

  // Persistent state (carried between frames)
  private isGrounded: boolean = false;
  private wasGroundedLastFrame: boolean = false;
  private jumpConsumed: boolean = false;

  // Crouch/Slide state
  private isCrouching: boolean = false;
  private isSliding: boolean = false;
  private slideStartTime: number = 0;
  private lastSlideEndTime: number = 0;
  private slideVelocity: Vec3 = vec3Zero();
  private crouchViewOffset: number = 0;

  // Wall jump state
  private wallJumpState: 'none' | 'available' | 'charging' = 'none';
  private wallJumpChargeTime: number = 0;
  private wallJumpNormal: Vec3 = vec3Zero();
  private lastWallJumpTime: number = 0;
  private wallJumpKeyReleased: boolean = true;

  // Ledge grab state
  private ledgeGrabState: 'none' | 'grabbing' | 'pulling' = 'none';
  private ledgeGrabTime: number = 0;
  private ledgeTargetPos: Vec3 = vec3Zero();
  private ledgeStartPos: Vec3 = vec3Zero();

  // Speed tracking
  private lastPosX: number = 0;
  private lastPosZ: number = 0;
  private actualHorizSpeed: number = 0;
  private smoothedY: number = 0;

  // Constants
  private static readonly CROUCH_HEIGHT_OFFSET = -24;
  private static readonly CROUCH_TRANSITION_SPEED = 0.2;

  constructor(config?: Partial<FPSMovementConfig>) {
    this.config = {
      // Core movement (defaults from MovementVars)
      maxSpeed: 280,
      runSpeed: 350,
      groundAcceleration: 10,
      airAcceleration: 1,
      maxAirSpeed: 30,
      friction: 6,
      stopSpeed: 100,
      gravity: 1000,
      jumpVelocity: 320,
      crouchMultiplier: 0.5,
      stepHeight: 18,
      topSpeed: 1000,
      airControl: 150,
      airControlPower: 50,

      // Wall jump
      wallJumpEnabled: true,
      wallJumpHeight: 280,
      wallJumpBounce: 0.8,
      wallJumpReach: 20,
      wallJumpCooldown: 1.0,
      wallJumpMinHeight: 32,
      wallJumpChargeTime: 0.2,
      wallJumpBoost: 1.2,

      // Ledge grab
      ledgeGrabEnabled: true,
      ledgeReach: 32,
      ledgeHeight: 64,
      ledgeMinFall: -50,
      ledgeTimeout: 2.0,
      ledgePullTime: 0.35,

      // Crouchslide
      slideEnabled: true,
      slideDuration: 800,
      slideSpeedMultiplier: 1.2,
      slideDecay: 0.5,
      slideJumpBoost: 1.3,
      slideMinSpeed: 375,
      slideFriction: 0.1,
      slideCooldown: 1500,

      ...config,
    };
  }

  getName(): string {
    return 'AdvancedFPSMovement';
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

  /**
   * Main simulation entry point
   */
  simulate(
    position: Vec3,
    velocity: Vec3,
    input: MovementInput | null,
    deltaTime: number,
    collision: CollisionWorld | null
  ): AdvancedMovementResult {
    const newPos = vec3Clone(position);
    const newVel = vec3Clone(velocity);
    const now = Date.now();

    // Store previous grounded state
    this.wasGroundedLastFrame = this.isGrounded;

    // === GROUND CHECK (also snaps position to ground if close) ===
    this.isGrounded = this.checkGrounded(newPos, newVel, collision);

    // Just landed check
    const justLanded = !this.wasGroundedLastFrame && this.isGrounded;

    // === GRAVITY ===
    if (!this.isGrounded) {
      newVel.y -= this.config.gravity * deltaTime;
    } else if (newVel.y < 0) {
      newVel.y = 0;
    }

    // === INPUT PROCESSING ===
    if (input) {
      // Determine wishspeed
      const isSprinting = input.isPressed(InputButtons.SPRINT);
      const isCrouching = input.isPressed(InputButtons.CROUCH);
      const isJumping = input.isPressed(InputButtons.JUMP);

      let wishspeed = isSprinting ? this.config.runSpeed : this.config.maxSpeed;

      // Crouch speed reduction (if not sliding)
      if (isCrouching && !this.isSliding) {
        const horizSpeed = vec3LengthXZ(newVel);
        const cooldownPassed = (now - this.lastSlideEndTime) >= this.config.slideCooldown;

        if (horizSpeed < this.config.slideMinSpeed || !cooldownPassed) {
          wishspeed *= this.config.crouchMultiplier;
        }
      }

      // === JUMP ===
      if (!isJumping) {
        this.jumpConsumed = false;
      }

      const autohop = true; // Could be config
      const willAutohop = autohop && justLanded && isJumping;
      const canJump = !this.jumpConsumed || (autohop && justLanded);

      if (isJumping && this.isGrounded && canJump) {
        newVel.y = this.config.jumpVelocity;
        this.jumpConsumed = true;
        this.isGrounded = false;

        // Exit slide on jump
        if (this.isSliding) {
          this.exitSlide(newVel, now);
        }
      }

      // === MOVEMENT DIRECTION ===
      const wishDir = input.direction;
      const wishLen = vec3LengthXZ(wishDir);
      const hasInput = wishLen > 0.001;

      const normalizedWish = hasInput
        ? { x: wishDir.x / wishLen, y: 0, z: wishDir.z / wishLen }
        : vec3Zero();

      if (this.isGrounded) {
        // === GROUND MOVEMENT ===
        const friction = this.isSliding ? this.config.slideFriction : this.config.friction;
        this.applyFriction(newVel, friction, deltaTime);

        if (hasInput) {
          this.groundAccelerate(newVel, normalizedWish, wishspeed, deltaTime);
        }
      } else {
        // === AIR MOVEMENT ===
        if (hasInput) {
          this.airAccelerate(newVel, normalizedWish, wishspeed, deltaTime);
        }

        // === WALL JUMP (in air) ===
        if (this.config.wallJumpEnabled && !this.isSliding) {
          this.updateWallJump(newPos, newVel, input, collision, deltaTime, now);
        }
      }

      // === CROUCHSLIDE ===
      if (this.config.slideEnabled) {
        this.updateSlide(newVel, input, deltaTime, now);
      }

      // === CROUCH STATE ===
      this.updateCrouch(input, deltaTime);
    }

    // === APPLY VELOCITY USING STEP-SLIDE MOVE ===
    // Uses same collision as local AdvancedCharacterController
    if (collision) {
      // Use Q3-style stepSlideMove for proper collision handling
      const result = collision.stepSlideMove(
        newPos,
        newVel,
        deltaTime,
        FPSMovementProfile.PLAYER_BOUNDS
      );

      // Apply results
      newPos.x = result.endPos.x;
      newPos.y = result.endPos.y;
      newPos.z = result.endPos.z;
      this.isGrounded = result.grounded;

      // Zero vertical velocity if grounded
      if (this.isGrounded && newVel.y < 0) {
        newVel.y = 0;
      }
    } else {
      // No collision world - simple move
      newPos.x += newVel.x * deltaTime;
      newPos.y += newVel.y * deltaTime;
      newPos.z += newVel.z * deltaTime;

      // Simple ground clamp at y=0
      if (newPos.y < 0) {
        newPos.y = 0;
        newVel.y = 0;
        this.isGrounded = true;
      }
    }

    // === UPDATE SPEED TRACKING ===
    if (deltaTime > 0) {
      const dx = newPos.x - this.lastPosX;
      const dz = newPos.z - this.lastPosZ;
      this.actualHorizSpeed = Math.sqrt(dx * dx + dz * dz) / deltaTime;
    }
    this.lastPosX = newPos.x;
    this.lastPosZ = newPos.z;

    // === SMOOTHED Y ===
    const heightDiff = Math.abs(newPos.y - this.smoothedY);
    if (heightDiff > this.config.stepHeight * 2) {
      this.smoothedY = newPos.y;
    } else {
      this.smoothedY += (newPos.y - this.smoothedY) * 0.15;
    }

    return {
      position: newPos,
      velocity: newVel,
      grounded: this.isGrounded,
      isSliding: this.isSliding,
      isCrouching: this.isCrouching,
      wallJumpState: this.wallJumpState,
      ledgeGrabState: this.ledgeGrabState,
      actualHorizSpeed: this.actualHorizSpeed,
      crouchViewOffset: this.crouchViewOffset,
    };
  }

  // ================== Ground Check ==================

  /**
   * Check if standing on ground and snap to ground surface if close.
   * This prevents falling through floors by detecting and correcting position.
   */
  private checkGrounded(pos: Vec3, vel: Vec3, collision: CollisionWorld | null): boolean {
    if (!collision) {
      if (pos.y <= 0.1) {
        pos.y = 0;
        return true;
      }
      return false;
    }

    // Trace down to find ground (use stepHeight distance to catch it early)
    const traceDistance = this.config.stepHeight; // 18 units
    const groundTrace = collision.trace(
      pos,
      { x: pos.x, y: pos.y - traceDistance, z: pos.z }
    );

    if (!groundTrace.hit) {
      return false;
    }

    // Calculate actual distance to ground
    const distanceToGround = traceDistance * groundTrace.fraction;

    // If very close (within 2 units) and moving down or stationary, snap to ground
    if (distanceToGround < 2 && vel.y <= 0) {
      // Snap position to be exactly on the ground
      pos.y -= distanceToGround;
      vel.y = 0;
      return true;
    }

    // If fraction is 0, we're INSIDE the ground - push up!
    if (groundTrace.fraction === 0) {
      // We're stuck in the ground, trace UP to find the surface
      const upTrace = collision.trace(
        pos,
        { x: pos.x, y: pos.y + traceDistance, z: pos.z }
      );

      if (upTrace.hit && upTrace.fraction > 0) {
        // Move up to where we hit the ceiling/surface
        pos.y += traceDistance * upTrace.fraction;
      } else {
        // No obstacle above, just push up
        pos.y += 5;
      }
      vel.y = Math.max(0, vel.y);
      return true;
    }

    // Close enough to consider grounded (within step height) but not snapping
    return distanceToGround < 2;
  }

  // ================== Friction ==================

  private applyFriction(vel: Vec3, friction: number, deltaTime: number): void {
    const speed = vec3LengthXZ(vel);

    if (speed < 1) {
      vel.x = 0;
      vel.z = 0;
      return;
    }

    const control = speed < this.config.stopSpeed ? this.config.stopSpeed : speed;
    const drop = control * friction * deltaTime;
    let newSpeed = speed - drop;

    if (newSpeed < 0) newSpeed = 0;

    const scale = newSpeed / speed;
    vel.x *= scale;
    vel.z *= scale;
  }

  // ================== Ground Acceleration ==================

  private groundAccelerate(vel: Vec3, wishDir: Vec3, wishSpeed: number, deltaTime: number): void {
    const currentSpeed = vec3DotXZ(vel, wishDir);
    const addSpeed = wishSpeed - currentSpeed;

    if (addSpeed <= 0) return;

    let accelSpeed = this.config.groundAcceleration * deltaTime * wishSpeed;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;

    vel.x += wishDir.x * accelSpeed;
    vel.z += wishDir.z * accelSpeed;
  }

  // ================== Air Acceleration ==================

  private airAccelerate(vel: Vec3, wishDir: Vec3, wishSpeed: number, deltaTime: number): void {
    // Cap air wishspeed
    const airWishSpeed = Math.min(wishSpeed, this.config.maxAirSpeed);

    const currentSpeed = vec3DotXZ(vel, wishDir);
    const addSpeed = airWishSpeed - currentSpeed;

    if (addSpeed <= 0) return;

    let accelSpeed = this.config.airAcceleration * deltaTime * wishSpeed;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;

    vel.x += wishDir.x * accelSpeed;
    vel.z += wishDir.z * accelSpeed;
  }

  // ================== Wall Jump ==================

  private updateWallJump(
    pos: Vec3,
    vel: Vec3,
    input: MovementInput,
    collision: CollisionWorld | null,
    deltaTime: number,
    now: number
  ): void {
    if (!collision) return;

    const isJumping = input.isPressed(InputButtons.JUMP);

    // Track key release
    if (!isJumping) {
      this.wallJumpKeyReleased = true;
    }

    // Check cooldown
    const cooldownPassed = (now - this.lastWallJumpTime) >= this.config.wallJumpCooldown * 1000;
    if (!cooldownPassed) {
      this.wallJumpState = 'none';
      return;
    }

    // Check minimum height above ground
    const groundCheck = collision.trace(pos, { x: pos.x, y: pos.y - this.config.wallJumpMinHeight, z: pos.z });
    if (groundCheck.hit && groundCheck.fraction < 1) {
      this.wallJumpState = 'none';
      return;
    }

    // Check for wall in front
    const reach = this.config.wallJumpReach;
    const forward = vec3Normalize(input.direction);

    // Trace in look direction
    const wallCheck = collision.trace(
      pos,
      vec3Add(pos, vec3Scale(forward, reach))
    );

    if (wallCheck.hit && wallCheck.normal) {
      // Found a wall
      this.wallJumpNormal = wallCheck.normal;
      this.wallJumpState = 'available';

      // Execute wall jump on fresh press
      if (isJumping && this.wallJumpKeyReleased) {
        this.wallJumpKeyReleased = false;
        this.executeWallJump(vel, wallCheck.normal, now);
      }
    } else {
      this.wallJumpState = 'none';
    }
  }

  private executeWallJump(vel: Vec3, normal: Vec3, now: number): void {
    // Push away from wall
    const horizSpeed = vec3LengthXZ(vel);
    const pushSpeed = horizSpeed * this.config.wallJumpBounce;

    vel.x = normal.x * pushSpeed;
    vel.z = normal.z * pushSpeed;
    vel.y = this.config.wallJumpHeight;

    this.lastWallJumpTime = now;
    this.wallJumpState = 'none';
  }

  // ================== Crouchslide ==================

  private updateSlide(vel: Vec3, input: MovementInput, deltaTime: number, now: number): void {
    const isCrouching = input.isPressed(InputButtons.CROUCH);
    const isJumping = input.isPressed(InputButtons.JUMP);
    const horizSpeed = vec3LengthXZ(vel);

    if (!this.isSliding) {
      // Check if we should enter slide
      const canSlide = this.isGrounded
        && isCrouching
        && horizSpeed >= this.config.slideMinSpeed
        && (now - this.lastSlideEndTime) >= this.config.slideCooldown;

      if (canSlide) {
        this.isSliding = true;
        this.slideStartTime = now;
        this.slideVelocity = vec3Clone(vel);

        // Boost on entry
        const boost = this.config.slideSpeedMultiplier;
        vel.x *= boost;
        vel.z *= boost;
      }
    } else {
      // Currently sliding
      const slideElapsed = now - this.slideStartTime;
      const slideDuration = this.config.slideDuration;

      // Exit conditions
      const slideExpired = slideElapsed >= slideDuration;
      const tooSlow = horizSpeed < 50;
      const releasedCrouch = !isCrouching;
      const jumpCancel = isJumping && slideElapsed > 100; // Grace period

      if (slideExpired || tooSlow || releasedCrouch || jumpCancel) {
        this.exitSlide(vel, now);

        // Jump boost on cancel
        if (jumpCancel) {
          vel.y = this.config.jumpVelocity;
          const boost = this.config.slideJumpBoost;
          vel.x *= boost;
          vel.z *= boost;
        }
      } else {
        // Apply slide decay
        const decay = this.config.slideDecay * deltaTime;
        const currentSpeed = vec3LengthXZ(vel);
        const newSpeed = Math.max(50, currentSpeed - decay);
        const scale = newSpeed / currentSpeed;
        vel.x *= scale;
        vel.z *= scale;
      }
    }
  }

  private exitSlide(vel: Vec3, now: number): void {
    this.isSliding = false;
    this.lastSlideEndTime = now;
  }

  // ================== Crouch ==================

  private updateCrouch(input: MovementInput, deltaTime: number): void {
    const wantsCrouch = input.isPressed(InputButtons.CROUCH) || this.isSliding;
    this.isCrouching = wantsCrouch;

    const targetOffset = this.isCrouching ? FPSMovementProfile.CROUCH_HEIGHT_OFFSET : 0;
    this.crouchViewOffset += (targetOffset - this.crouchViewOffset) * FPSMovementProfile.CROUCH_TRANSITION_SPEED;
  }

  // ================== Ledge Grab ==================

  /**
   * Update ledge grab state machine
   * Returns true if ledge grab is active (consuming movement)
   */
  private updateLedgeGrab(
    pos: Vec3,
    vel: Vec3,
    input: MovementInput,
    collision: CollisionWorld | null,
    deltaTime: number
  ): boolean {
    if (!this.config.ledgeGrabEnabled) return false;

    // === STATE: GRABBING (pause at ledge) ===
    if (this.ledgeGrabState === 'grabbing') {
      this.ledgeGrabTime += deltaTime;

      // Freeze position
      pos.x = this.ledgeStartPos.x;
      pos.y = this.ledgeStartPos.y;
      pos.z = this.ledgeStartPos.z;
      vel.x = 0;
      vel.y = 0;
      vel.z = 0;

      // Cancel on crouch/sprint
      if (input.isPressed(InputButtons.CROUCH) || input.isPressed(InputButtons.SPRINT)) {
        this.ledgeGrabState = 'none';
        vel.y = -100; // Drop
        return false;
      }

      // Auto-climb after brief pause
      const grabPauseTime = 0.12;
      if (this.ledgeGrabTime >= grabPauseTime) {
        this.ledgeGrabState = 'pulling';
        this.ledgeGrabTime = 0;
      }

      return true;
    }

    // === STATE: PULLING (climbing animation) ===
    if (this.ledgeGrabState === 'pulling') {
      this.ledgeGrabTime += deltaTime;
      const pullTime = this.config.ledgePullTime;
      const progress = Math.min(1.0, this.ledgeGrabTime / pullTime);

      // Ease in-out
      const t = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Interpolate position
      pos.x = this.ledgeStartPos.x + (this.ledgeTargetPos.x - this.ledgeStartPos.x) * t;
      pos.y = this.ledgeStartPos.y + (this.ledgeTargetPos.y - this.ledgeStartPos.y) * t;
      pos.z = this.ledgeStartPos.z + (this.ledgeTargetPos.z - this.ledgeStartPos.z) * t;
      vel.x = 0;
      vel.y = 0;
      vel.z = 0;

      if (progress >= 1.0) {
        // Done climbing
        this.ledgeGrabState = 'none';
        // Small forward momentum
        const forward = vec3Normalize(input.direction);
        vel.x = forward.x * 100;
        vel.z = forward.z * 100;
      }

      return true;
    }

    // === STATE: DETECTION ===
    // TODO: Implement ledge detection using collision traces
    // This requires:
    // 1. Trace at waist level (should hit wall)
    // 2. Trace at head level (should NOT hit wall)
    // 3. Trace down from above to find ledge surface
    // 4. Verify room to stand
    //
    // For now, ledge grab is disabled until BSP traces are properly integrated

    return false;
  }

  private startLedgeGrab(targetPos: Vec3, currentPos: Vec3): void {
    this.ledgeGrabState = 'grabbing';
    this.ledgeGrabTime = 0;
    this.ledgeStartPos = vec3Clone(currentPos);
    this.ledgeTargetPos = vec3Clone(targetPos);
  }

  // ================== Collision Movement ==================

  private moveWithCollision(pos: Vec3, vel: Vec3, move: Vec3, collision: CollisionWorld): void {
    const endPos = vec3Add(pos, move);
    const trace = collision.trace(pos, endPos);

    if (!trace.hit) {
      // No collision - apply full movement
      pos.x = endPos.x;
      pos.y = endPos.y;
      pos.z = endPos.z;
    } else if (trace.fraction > 0) {
      // Partial collision - move up to hit point
      pos.x += move.x * trace.fraction;
      pos.y += move.y * trace.fraction;
      pos.z += move.z * trace.fraction;

      // Clip velocity against surface
      if (trace.normal) {
        const dot = vec3Dot(vel, trace.normal);
        vel.x -= trace.normal.x * dot;
        vel.y -= trace.normal.y * dot;
        vel.z -= trace.normal.z * dot;
      }
    } else {
      // fraction=0 means we started inside solid!
      // Push player UP to escape (anti-stuck)
      if (trace.normal && trace.normal.y > 0.7) {
        // It's a floor - push up
        pos.y += 1; // Nudge up by 1 unit
        vel.y = Math.max(0, vel.y); // Don't go through floor
      } else if (trace.normal) {
        // Wall - push away from normal
        pos.x += trace.normal.x * 1;
        pos.z += trace.normal.z * 1;
        vel.x = 0;
        vel.z = 0;
      } else {
        // Unknown - just nudge up
        pos.y += 5;
        vel.y = 0;
      }
    }

    // Re-check grounded after collision
    const groundTrace = collision.trace(pos, { x: pos.x, y: pos.y - 2, z: pos.z });
    if (groundTrace.hit && groundTrace.fraction < 1) {
      this.isGrounded = true;
      // Snap to ground if close
      if (groundTrace.fraction < 0.1 && vel.y <= 0) {
        pos.y -= groundTrace.fraction * 2;
        vel.y = 0;
      }
    }
  }
}
