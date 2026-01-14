/**
 * CharacterController - FPS character movement with BSP collision
 * 
 * Uses BSP collision for world collision detection
 * Simulates gravity, jumping, and velocity internally
 * Can be attached to FreeflyController for non-spectator mode
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { getCollisionManager } from '../physics';
import { MovementVars } from './MovementVars';

// ==================== Types ====================

export interface CharacterState {
  position: Vector3;
  velocity: Vector3;
  isGrounded: boolean;
  isJumping: boolean;
  isCrouching: boolean;
}

export interface CharacterConfig {
  radius: number;      // Collision radius (default: 16)
  height: number;      // Standing height (default: 56)
  crouchHeight: number; // Crouching height (default: 32)
  eyeOffset: number;   // Eye position from feet (default: 48)
}

// ==================== CharacterController Class ====================

export class CharacterController {
  private state: CharacterState;
  private config: CharacterConfig;
  
  // Ground detection
  private groundNormal: Vector3 = Vector3.Up();
  
  // Jump state
  private jumpStartTime: number = 0;
  private canJump: boolean = true;

  constructor(startPosition: Vector3, config?: Partial<CharacterConfig>) {
    this.config = {
      radius: config?.radius ?? 16,
      height: config?.height ?? 56,
      crouchHeight: config?.crouchHeight ?? 32,
      eyeOffset: config?.eyeOffset ?? 48,
    };

    this.state = {
      position: startPosition.clone(),
      velocity: Vector3.Zero(),
      isGrounded: false,
      isJumping: false,
      isCrouching: false,
    };
  }

  // ==================== State Accessors ====================

  getPosition(): Vector3 {
    return this.state.position.clone();
  }

  getEyePosition(): Vector3 {
    const eyeHeight = this.state.isCrouching 
      ? this.config.crouchHeight - 8 
      : this.config.eyeOffset;
    return this.state.position.add(new Vector3(0, eyeHeight, 0));
  }

  getVelocity(): Vector3 {
    return this.state.velocity.clone();
  }

  isGrounded(): boolean {
    return this.state.isGrounded;
  }

  isJumping(): boolean {
    return this.state.isJumping;
  }

  setPosition(pos: Vector3): void {
    this.state.position.copyFrom(pos);
  }

  // ==================== Movement ====================

  /**
   * Apply movement input (WASD)
   * @param forward Forward/backward input (-1 to 1)
   * @param strafe Left/right input (-1 to 1)
   * @param forwardDir Camera forward direction (normalized)
   * @param rightDir Camera right direction (normalized)
   */
  applyMovementInput(
    forward: number,
    strafe: number,
    forwardDir: Vector3,
    rightDir: Vector3
  ): void {
    const mv = MovementVars.getInstance();
    const speed = mv.get('cl_speed');
    const airControl = mv.get('sv_aircontrol');
    
    // Project directions to horizontal plane
    const flatForward = new Vector3(forwardDir.x, 0, forwardDir.z);
    const flatRight = new Vector3(rightDir.x, 0, rightDir.z);
    
    // Normalize only if length > 0
    if (flatForward.length() > 0.001) flatForward.normalize();
    if (flatRight.length() > 0.001) flatRight.normalize();
    
    // Calculate wish velocity directly (not accumulating)
    const wishVel = flatForward.scale(forward * speed).add(flatRight.scale(strafe * speed));
    
    // Apply air control reduction when airborne
    const controlFactor = this.state.isGrounded ? 1.0 : airControl;
    
    // Set horizontal velocity directly (no accumulation)
    this.state.velocity.x = wishVel.x * controlFactor;
    this.state.velocity.z = wishVel.z * controlFactor;
  }

  /**
   * Attempt to jump
   */
  jump(): boolean {
    if (!this.state.isGrounded || !this.canJump) {
      return false;
    }

    const mv = MovementVars.getInstance();
    const jumpHeight = mv.get('sv_jumpheight');
    
    this.state.velocity.y = jumpHeight;
    this.state.isJumping = true;
    this.state.isGrounded = false;
    this.canJump = false;
    this.jumpStartTime = Date.now();
    
    return true;
  }

  /**
   * Toggle crouch
   */
  setCrouching(crouching: boolean): void {
    this.state.isCrouching = crouching;
  }

  // ==================== Physics Update ====================

  /**
   * Update physics for one frame
   * @param deltaTime Time since last frame in seconds
   */
  update(deltaTime: number): void {
    const mv = MovementVars.getInstance();
    const gravity = mv.get('sv_gravity');
    const friction = mv.get('sv_friction');
    
    // Apply gravity if not grounded
    if (!this.state.isGrounded) {
      this.state.velocity.y -= gravity * deltaTime;
    }
    
    // Apply ground friction when grounded
    if (this.state.isGrounded) {
      const speed = Math.sqrt(
        this.state.velocity.x ** 2 + 
        this.state.velocity.z ** 2
      );
      
      if (speed > 0) {
        const drop = speed * friction * deltaTime;
        const newSpeed = Math.max(0, speed - drop);
        const scale = newSpeed / speed;
        this.state.velocity.x *= scale;
        this.state.velocity.z *= scale;
      }
    }
    
    // Calculate movement this frame
    const movement = this.state.velocity.scale(deltaTime);
    
    // Apply BSP collision and move
    this.moveWithCollision(movement);
    
    // Check ground status
    this.checkGround();
    
    // Reset jump ability when grounded
    if (this.state.isGrounded) {
      this.state.isJumping = false;
      if (!this.canJump && Date.now() - this.jumpStartTime > 100) {
        this.canJump = true;
      }
    }
  }

  // ==================== Collision ====================

  /**
   * Move with BSP collision detection
   */
  private moveWithCollision(movement: Vector3): void {
    const cm = getCollisionManager();
    if (!cm.isInitialized()) {
      // No collision - just move
      this.state.position.addInPlace(movement);
      return;
    }

    const height = this.state.isCrouching 
      ? this.config.crouchHeight 
      : this.config.height;

    const traceOpts = {
      radius: this.config.radius,
      height: height,
      contentMask: 0x1 | 0x10000, // SOLID | PLAYERCLIP
    };

    // Try to get Q3 backend for slideMove
    const backend = (cm as any).backends?.get('q3');
    
    if (backend && typeof backend.stepSlideMove === 'function') {
      // Use Q3-style step slide move for smooth stair climbing
      const result = backend.stepSlideMove(this.state.position, movement, traceOpts);
      this.state.position.copyFrom(result.endPos);
      
      // If we hit something while moving up/down, zero that velocity
      if (result.hitCount > 0) {
        // Check if we hit a ceiling (moving up)
        if (movement.y > 0 && result.endPos.y < this.state.position.y + movement.y) {
          this.state.velocity.y = 0;
        }
        // Check if we hit the ground (moving down)
        if (movement.y < 0 && result.endPos.y > this.state.position.y + movement.y) {
          this.state.velocity.y = 0;
        }
      }
    } else if (backend && typeof backend.slideMove === 'function') {
      // Fallback to basic slide move
      const result = backend.slideMove(this.state.position, movement, traceOpts);
      this.state.position.copyFrom(result.endPos);
    } else {
      // Fallback to simple trace
      const endPos = this.state.position.add(movement);
      const trace = cm.trace(
        this.state.position as any,
        endPos as any,
        traceOpts
      );
      this.state.position.copyFrom(trace.endPos);
    }
  }

  /**
   * Check if standing on ground
   */
  private checkGround(): void {
    const cm = getCollisionManager();
    if (!cm.isInitialized()) {
      this.state.isGrounded = false;
      return;
    }

    const height = this.state.isCrouching 
      ? this.config.crouchHeight 
      : this.config.height;

    // Trace down from current position
    const start = this.state.position.clone();
    const end = start.subtract(new Vector3(0, 2, 0)); // Check 2 units down

    const trace = cm.trace(start as any, end as any, {
      radius: this.config.radius,
      height: height,
      contentMask: 0x1 | 0x10000,
    });

    // We're grounded if we hit something within 2 units
    this.state.isGrounded = trace.fraction < 1.0;
    
    if (this.state.isGrounded && trace.normal) {
      this.groundNormal.copyFrom(trace.normal);
      
      // Zero vertical velocity when landing
      if (this.state.velocity.y < 0) {
        this.state.velocity.y = 0;
      }
    }
  }

  // ==================== Debug ====================

  getInfo(): string {
    const pos = this.state.position;
    const vel = this.state.velocity;
    const speed = Math.sqrt(vel.x ** 2 + vel.z ** 2);
    
    return [
      `Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`,
      `Velocity: (${vel.x.toFixed(1)}, ${vel.y.toFixed(1)}, ${vel.z.toFixed(1)})`,
      `Speed: ${speed.toFixed(1)} u/s`,
      `Grounded: ${this.state.isGrounded}`,
      `Jumping: ${this.state.isJumping}`,
      `Crouching: ${this.state.isCrouching}`,
    ].join('\n');
  }
}
