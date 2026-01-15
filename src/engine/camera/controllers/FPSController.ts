/**
 * FPSController - First-person camera controller with gravity and physics
 * 
 * Based on FPSController but with:
 * - Gravity (player falls when not on ground)
 * - Ground detection via BSP collision
 * - Jump with Space (when grounded)
 * - Horizontal movement only (no fly up/down)
 * 
 * Controls:
 * - Click canvas to capture mouse (pointer lock)
 * - ESC to release mouse
 * - WASD to move horizontally
 * - Space to jump (when grounded)
 * - Mouse movement: freelook
 */

import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ICameraController, CameraControllerConfig } from "./ICameraController";
import { getCollisionManager } from "../../physics";
import { Cvar } from "../../core/Cvar";
import { ContentFlags, SurfaceFlags } from "../../physics/ContentFlags";
import { MovementVars } from "../../movement/MovementVars";

export class FPSController implements ICameraController {
  readonly type = "fps";

  // Static default speed that persists between controller changes
  private static defaultSpeed: number = 200;

  // Collision always enabled for FPS (can't walk through walls)
  private static collisionEnabled: boolean = true;

  // Collision mode: 'bsp' uses BSP brush tracing (same as FreeflyController), 'native' uses Babylon's mesh collision
  private static collisionMode: 'bsp' | 'native' = 'bsp';

  // Q3-style physics state
  private velocity: Vector3 = Vector3.Zero();  // Persistent velocity
  private isGrounded: boolean = false;
  // @ts-ignore - kept for future slope movement
  private groundNormal: Vector3 | null = null;

  // @ts-ignore - kept for future use
  private origin: Vector3 = Vector3.Zero();

  // Physics Y position (before smoothing) - MUST be kept separate from camera.position.y
  private physicsY: number = 0;
  // Smoothed Y for viewport only (never feeds back to physics)
  private smoothedY: number = 0;
  private smoothingInitialized: boolean = false;
  // Jump state for auto-bunny hop
  private jumpConsumed: boolean = false;
  private wasGroundedLastFrame: boolean = false;

  private camera: FreeCamera | null = null;
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;

  // State
  private enabled: boolean = true;
  private isPointerLocked: boolean = false;

  // Movement keys state
  private keys = {
    forward: false,  // W
    backward: false, // S
    left: false,     // A
    right: false,    // D
    up: false,       // Space (jump)
    sprint: false,   // Shift (run)
  };

  // Configuration
  private config: CameraControllerConfig = {
    speed: FPSController.defaultSpeed,
    mouseSensitivity: 0.002,
    invertY: false,
    fov: 1.0, // Wider FOV for debugging
  };

  /**
   * Get the current default speed
   */
  static getDefaultSpeed(): number {
    return FPSController.defaultSpeed;
  }

  /**
   * Set the default speed (persists between controller changes)
   */
  static setDefaultSpeed(speed: number): void {
    FPSController.defaultSpeed = speed;
  }

  /**
   * Get collision enabled state
   */
  static isCollisionEnabled(): boolean {
    return FPSController.collisionEnabled;
  }

  /**
   * Set collision enabled state
   */
  static setCollisionEnabled(enabled: boolean): void {
    FPSController.collisionEnabled = enabled;
    console.log(`[FPSController] Collision ${enabled ? 'enabled' : 'disabled'} (mode: ${FPSController.collisionMode})`);
  }

  /**
   * Get collision mode
   */
  static getCollisionMode(): 'bsp' | 'native' {
    return FPSController.collisionMode;
  }

  /**
   * Set collision mode
   */
  static setCollisionMode(mode: 'bsp' | 'native'): void {
    FPSController.collisionMode = mode;
    console.log(`[FPSController] Collision mode set to: ${mode}`);
  }

  // Observers
  private renderObserver: Observer<Scene> | null = null;

  // Event handlers (bound for removal)
  private onCanvasClick: ((e: MouseEvent) => void) | null = null;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private onPointerLockChange: (() => void) | null = null;

  attach(camera: Camera, scene: Scene, canvas: HTMLCanvasElement): void {
    this.scene = scene;
    this.canvas = canvas;

    // Get starting position from existing camera
    let startPos = camera.position.clone();

    // If it's an ArcRotateCamera, start at its position looking at target
    if ("target" in camera && (camera as any).target instanceof Vector3) {
      startPos = camera.position.clone();
    }

    if (!(camera instanceof FreeCamera)) {
      this.camera = new FreeCamera("freeflyCamera", startPos, scene);
      this.camera.rotation.x = 0;
      this.camera.rotation.y = 0;
      scene.activeCamera = this.camera;
    } else {
      this.camera = camera;
    }

    // Apply FOV
    if (this.config.fov && this.camera) {
      this.camera.fov = this.config.fov;
    }

    // Disable collisions for free flight
    this.camera.checkCollisions = false;

    // Clear default inputs - we handle everything
    this.camera.inputs.clear();

    // Set up input handlers
    this.setupInputHandlers();

    // Set up render observer for movement
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      const deltaTime = scene.getEngine().getDeltaTime() / 1000;
      this.update(deltaTime);
    });

    console.log("[FPSController] Attached - Click to capture mouse, WASD to move, ESC to release");
  }

  private setupInputHandlers(): void {
    if (!this.canvas) return;

    // Click to capture mouse - use document click and check target
    this.onCanvasClick = (e: MouseEvent) => {
      // Only respond to clicks on the canvas itself
      if (e.target !== this.canvas) return;

      console.log('[FPSController] Canvas clicked, requesting pointer lock');
      if (!this.isPointerLocked && this.canvas) {
        this.canvas.requestPointerLock();
      }
    };

    // Handle pointer lock change
    this.onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
      if (this.isPointerLocked) {
        console.log('[FPSController] Mouse captured - WASD to move, ESC to release');
      } else {
        console.log('[FPSController] Mouse released - Click to capture');
        // Reset movement keys when releasing
        this.keys.forward = false;
        this.keys.backward = false;
        this.keys.left = false;
        this.keys.right = false;
        this.keys.up = false;
        this.keys.sprint = false;
      }
    };

    // Mouse look (only when pointer is locked)
    this.onMouseMove = (e: MouseEvent) => {
      if (!this.enabled || !this.camera || !this.isPointerLocked) return;

      const baseSensitivity = this.config.mouseSensitivity || 0.002;
      const sensitivityMultiplier = Cvar.getNumber('m_sensitivity') || 1.0;
      const sensitivity = baseSensitivity * sensitivityMultiplier;
      const invertYCvar = Cvar.getBool('m_invertY');
      const invertY = (this.config.invertY || invertYCvar) ? -1 : 1;

      // Apply freelook
      this.camera.rotation.y += e.movementX * sensitivity;
      this.camera.rotation.x += e.movementY * sensitivity * invertY;

      // Clamp vertical rotation
      this.camera.rotation.x = Math.max(
        -Math.PI / 2 + 0.1,
        Math.min(Math.PI / 2 - 0.1, this.camera.rotation.x)
      );
    };

    // Keyboard input
    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.isPointerLocked) return;

      switch (e.code) {
        case 'KeyW': this.keys.forward = true; break;
        case 'KeyS': this.keys.backward = true; break;
        case 'KeyA': this.keys.left = true; break;
        case 'KeyD': this.keys.right = true; break;
        case 'Space': this.keys.up = true; e.preventDefault(); break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = true; break;
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': this.keys.forward = false; break;
        case 'KeyS': this.keys.backward = false; break;
        case 'KeyA': this.keys.left = false; break;
        case 'KeyD': this.keys.right = false; break;
        case 'Space': this.keys.up = false; break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = false; break;
      }
    };

    // Add event listeners - use document for click to ensure we catch it
    document.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  private removeInputHandlers(): void {
    // Exit pointer lock if active
    if (this.isPointerLocked) {
      document.exitPointerLock();
    }

    if (this.onCanvasClick) {
      document.removeEventListener('click', this.onCanvasClick);
    }
    if (this.onPointerLockChange) {
      document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    }
    if (this.onMouseMove) {
      document.removeEventListener('mousemove', this.onMouseMove);
    }
    if (this.onKeyDown) {
      document.removeEventListener('keydown', this.onKeyDown);
    }
    if (this.onKeyUp) {
      document.removeEventListener('keyup', this.onKeyUp);
    }
  }

  detach(): void {
    if (this.renderObserver && this.scene) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }

    this.removeInputHandlers();

    this.camera = null;
    this.scene = null;
    this.canvas = null;
    this.isPointerLocked = false;

    console.log("[FPSController] Detached");
  }

  update(deltaTime: number): void {
    if (!this.enabled || !this.camera || !this.isPointerLocked) return;

    const mv = MovementVars.getInstance();
    const gravity = mv.get('sv_gravity');
    const jumpHeight = mv.get('sv_jumpheight');
    const stepHeight = mv.get('sv_stepheight');
    const smoothFactor = mv.get('cl_smoothfactor');
    const friction = mv.get('sv_friction');
    const accelerate = mv.get('sv_accelerate');
    const stopspeed = mv.get('sv_stopspeed');
    const airaccelerate = mv.get('sv_airaccelerate');
    const maxairspeed = mv.get('sv_maxairspeed');
    const autorun = mv.get('cl_autorun') > 0;
    // cl_autorun inverts run/walk: run by default, walk when holding shift
    const isRunning = autorun ? !this.keys.sprint : this.keys.sprint;
    const wishspeed = isRunning ? mv.get('sv_runSpeed') : mv.get('sv_movementSpeed');

    const cm = getCollisionManager();

    // Initialize smoothing on first frame (same pattern as FreeflyController)
    if (!this.smoothingInitialized) {
      this.physicsY = this.camera.position.y;
      this.smoothedY = this.camera.position.y;
      this.smoothingInitialized = true;
      console.log(`[FPS] Initialized at: (${this.camera.position.x.toFixed(1)}, ${this.camera.position.y.toFixed(1)}, ${this.camera.position.z.toFixed(1)})`);
    }

    // CRITICAL: Restore physics Y before collision (not smoothed)
    this.camera.position.y = this.physicsY;

    // === CALCULATE WISHDIR (desired movement direction) ===
    const forward = this.camera.getDirection(Vector3.Forward());
    const right = this.camera.getDirection(Vector3.Right());
    const flatForward = new Vector3(forward.x, 0, forward.z);
    const flatRight = new Vector3(right.x, 0, right.z);
    if (flatForward.length() > 0.001) flatForward.normalize();
    if (flatRight.length() > 0.001) flatRight.normalize();

    // Build wishdir from input
    let wishdir = Vector3.Zero();
    if (this.keys.forward) wishdir.addInPlace(flatForward);
    if (this.keys.backward) wishdir.subtractInPlace(flatForward);
    if (this.keys.left) wishdir.subtractInPlace(flatRight);
    if (this.keys.right) wishdir.addInPlace(flatRight);

    const hasInput = wishdir.length() > 0.001;
    if (hasInput) wishdir.normalize();

    // === Q3-STYLE PHYSICS ===
    
    // Detect autohop frame: just landed + holding jump + autohop enabled
    const autohop = mv.get('sv_autohop') > 0;
    const justLanded = !this.wasGroundedLastFrame && this.isGrounded;
    const willAutohop = autohop && justLanded && this.keys.up;
    
    if (this.isGrounded) {
      // === GROUND MOVEMENT ===

      // WARSOW: Skip friction on autohop frame to preserve bunny hop speed!
      if (!willAutohop) {
        // Apply friction (PM_Friction) - only when NOT auto-hopping
        const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
        if (speed > 1) {
          const control = speed < stopspeed ? stopspeed : speed;
          const drop = control * friction * deltaTime;
          let newSpeed = speed - drop;
          if (newSpeed < 0) newSpeed = 0;
          const scale = newSpeed / speed;
          this.velocity.x *= scale;
          this.velocity.z *= scale;
        } else {
          this.velocity.x = 0;
          this.velocity.z = 0;
        }

        // Apply acceleration toward wishdir (PM_Accelerate)
        if (hasInput) {
          const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
          const addspeed = wishspeed - currentspeed;
          if (addspeed > 0) {
            let accelspeed = accelerate * deltaTime * wishspeed;
            if (accelspeed > addspeed) accelspeed = addspeed;
            this.velocity.x += accelspeed * wishdir.x;
            this.velocity.z += accelspeed * wishdir.z;
          }
        }
      }
    } else {
      // === AIR MOVEMENT (Warsow-style from gs_pmove.c) ===
      // Warsow constants from source:
      // pm_airaccelerate = 1, pm_strafebunnyaccel = 70, pm_wishspeed = 30, pm_aircontrol = 150
      
      const aircontrol = mv.get('sv_aircontrol');  // Warsow: 150
      const currentHorizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      
      const holdingStrafe = this.keys.left || this.keys.right;
      const holdingForward = this.keys.forward && !this.keys.backward;
      const holdingBackward = this.keys.backward && !this.keys.forward;
      const fmove = holdingForward || holdingBackward;
      const smove = holdingStrafe;
      
      // Warsow strafe bunny constants
      const strafebunnyaccel = 70;  // pm_strafebunnyaccel - HIGH value for speed gain!
      const pm_wishspeed = 30;      // cap for strafe bunny wishspeed
      
      // === STRAFE BUNNY: +strafe (with or without forward) ===
      // This is the CLASSIC strafe jumping - high accel (70) with capped wishspeed (30)
      // Speed gain happens because you're accelerating perpendicular to velocity
      if (smove) {
        // Cap wishspeed for strafe bunny
        const strafeWishspeed = Math.min(wishspeed, pm_wishspeed);
        
        // PM_Accelerate with high strafebunnyaccel
        const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
        const addspeed = strafeWishspeed - currentspeed;
        
        if (addspeed > 0) {
          let accelspeed = strafebunnyaccel * deltaTime * strafeWishspeed;
          if (accelspeed > addspeed) accelspeed = addspeed;
          this.velocity.x += accelspeed * wishdir.x;
          this.velocity.z += accelspeed * wishdir.z;
        }
        
        // Debug log for strafe bunny
        if (!FPSController._lastStrafeLog || Date.now() - FPSController._lastStrafeLog > 500) {
          FPSController._lastStrafeLog = Date.now();
          const newSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
          console.log(`[StrafeBunny] addspeed=${addspeed.toFixed(1)}, speed=${newSpeed.toFixed(0)}`);
        }
        
        // NO air control when strafing! (PM_Aircontrol returns early if smove != 0)
      }
      // === AIR CONTROL: +forward ONLY (no strafe) ===
      // PM_Aircontrol - rotate velocity toward look direction while preserving speed
      // This is subtle direction control, NOT speed gain
      else if (fmove && currentHorizSpeed > 1) {
        // Standard air acceleration first
        const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
        const addspeed = Math.min(wishspeed, maxairspeed) - currentspeed;
        if (addspeed > 0) {
          let accelspeed = airaccelerate * deltaTime * Math.min(wishspeed, maxairspeed);
          if (accelspeed > addspeed) accelspeed = addspeed;
          this.velocity.x += accelspeed * wishdir.x;
          this.velocity.z += accelspeed * wishdir.z;
        }
        
        // PM_Aircontrol from Warsow - rotate velocity toward wishdir
        // k = 32.0f * pm_aircontrol * dot * dot * pml.frametime
        if (aircontrol > 0) {
          const speed = currentHorizSpeed;
          const velDirX = this.velocity.x / speed;
          const velDirZ = this.velocity.z / speed;
          
          const dot = velDirX * wishdir.x + velDirZ * wishdir.z;
          
          if (dot > 0) {
            // Warsow formula: k = 32 * aircontrol * dot^2 * frametime
            const k = 32.0 * aircontrol * dot * dot * deltaTime;
            
            // velocity = velocity * speed + wishdir * k, then normalize and restore speed
            const newVelX = velDirX * speed + wishdir.x * k;
            const newVelZ = velDirZ * speed + wishdir.z * k;
            const newLen = Math.sqrt(newVelX * newVelX + newVelZ * newVelZ);
            
            if (newLen > 0.001) {
              // Normalize and restore original speed
              this.velocity.x = (newVelX / newLen) * speed;
              this.velocity.z = (newVelZ / newLen) * speed;
            }
          }
        }
      }
      // === STANDARD AIR ACCEL: no directional input or just backward ===
      else if (hasInput) {
        const airWishspeed = Math.min(wishspeed, maxairspeed);
        const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
        const addspeed = airWishspeed - currentspeed;
        
        if (addspeed > 0) {
          let accelspeed = airaccelerate * deltaTime * airWishspeed;
          if (accelspeed > addspeed) accelspeed = addspeed;
          this.velocity.x += accelspeed * wishdir.x;
          this.velocity.z += accelspeed * wishdir.z;
        }
      }
    }

    // === GRAVITY ===
    if (!this.isGrounded) {
      this.velocity.y -= gravity * deltaTime;
    }

    // === JUMP ===
    // Reset jumpConsumed when key is released
    if (!this.keys.up) {
      this.jumpConsumed = false;
    }
    
    if (this.keys.up && this.isGrounded) {
      // Two modes:
      // 1. Normal jump: Require key release between jumps (jumpConsumed check)
      // 2. Auto-bunny hop: Jump automatically on landing frame when holding space
      // (autohop and justLanded already calculated above for friction skip)
      const canJump = !this.jumpConsumed || (autohop && justLanded);
      
      if (canJump) {
        this.velocity.y = jumpHeight;
        this.isGrounded = false;
        this.jumpConsumed = true;
      }
    }

    // === BUILD MOVEMENT VECTOR FROM VELOCITY ===
    const movement = this.velocity.scale(deltaTime);

    // Store Y before movement for ground detection
    const prevY = this.camera.position.y;

    // === APPLY MOVEMENT WITH COLLISION ===
    if (movement.length() > 0) {
      if (FPSController.collisionEnabled) {
        if (FPSController.collisionMode === 'native') {
          this.nativeCollisionMove(movement);
        } else if (cm.isInitialized()) {
          // Use BSP collision with stepSlideMove for stair stepping
          const backend = (cm as any).backends?.get('q3');
          if (backend && typeof backend.stepSlideMove === 'function') {
            const start = this.camera.position.clone();
            const traceOpts = { radius: 16, height: 56 };
            const result = backend.stepSlideMove(start, movement, traceOpts);
            this.camera.position.copyFrom(result.endPos);
          } else {
            // Fallback to local slideMove
            this.slideMove(movement, cm as ReturnType<typeof getCollisionManager>);
          }
        } else {
          this.camera.position.addInPlace(movement);
        }
      } else {
        this.camera.position.addInPlace(movement);
      }
    }

    // === GROUND DETECTION ===
    // Q3-style: Actively check for ground beneath player each frame
    // CRITICAL: Only "land" if we're moving downward (fixes jetpack bug)
    this.wasGroundedLastFrame = this.isGrounded;
    
    if (cm.isInitialized()) {
      const backend = (cm as any).backends?.get('q3');
      if (backend && typeof backend.trace === 'function') {
        const groundCheckStart = this.camera.position.clone();
        const groundCheckEnd = groundCheckStart.add(new Vector3(0, -2, 0)); // Check 2 units down
        const traceOpts = { radius: 16, height: 56 };
        const groundTrace = backend.trace(groundCheckStart, groundCheckEnd, traceOpts);

        if (groundTrace.fraction < 1.0) {
          // Hit ground - but ONLY land if we're moving down or stationary
          // This prevents "landing" immediately after jumping (jetpack fix)
          if (this.velocity.y <= 0) {
            if (!this.isGrounded) {
              // Just landed this frame
              this.isGrounded = true;
            }
            // Zero vertical velocity when on ground
            if (this.velocity.y < 0) {
              this.velocity.y = 0;
            }
          }
          // If velocity.y > 0, we're going UP - don't land yet
        } else {
          // No ground beneath - start falling
          if (this.isGrounded) {
            this.isGrounded = false;
            // Small initial downward velocity to start falling
            if (this.velocity.y <= 0) {
              this.velocity.y = -1;
            }
          }
        }
      }
    } else {
      // Fallback: movement-based detection
      const actualYMove = this.camera.position.y - prevY;
      const expectedYMove = movement.y;
      // Only land if moving downward
      if (expectedYMove < -0.1 && actualYMove > expectedYMove * 0.5 && this.velocity.y <= 0) {
        this.isGrounded = true;
        if (this.velocity.y < 0) {
          this.velocity.y = 0;
        }
      }
    }

    // Debug log
    if (!FPSController._lastGroundLog || Date.now() - FPSController._lastGroundLog > 1000) {
      FPSController._lastGroundLog = Date.now();
      console.log(`[FPS] pos.y=${this.camera.position.y.toFixed(1)}, vel.y=${this.velocity.y.toFixed(1)}, grounded=${this.isGrounded}`);
    }

    // === SPEED DISPLAY (cl_showspeed) ===
    const showSpeed = mv.get('cl_showspeed') > 0;
    const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    this.updateSpeedDisplay(showSpeed, horizSpeed);

    // === SAVE PHYSICS Y AFTER COLLISION ===
    this.physicsY = this.camera.position.y;

    // === VIEWPORT SMOOTHING (same pattern as FreeflyController) ===
    const heightDiff = Math.abs(this.physicsY - this.smoothedY);
    if (heightDiff > stepHeight * 2) {
      // Large change (teleport, big fall) - snap immediately
      this.smoothedY = this.physicsY;
    } else {
      // Smooth interpolation for stairs
      this.smoothedY = this.smoothedY + (this.physicsY - this.smoothedY) * smoothFactor;
    }

    // === APPLY EYE OFFSET ===
    // Physics runs at feet level, but camera view is at eye level
    const eyeOffset = mv.get('sv_eyeoffset'); // Default 48 units

    // Apply smoothed Y + eye offset for rendering
    this.camera.position.y = this.smoothedY + eyeOffset;
  }

  // Speed display element
  private static speedDisplayEl: HTMLDivElement | null = null;

  /**
   * Update on-screen speed display
   */
  private updateSpeedDisplay(show: boolean, speed: number): void {
    if (show) {
      if (!FPSController.speedDisplayEl) {
        // Create speed display element
        const el = document.createElement('div');
        el.id = 'fps-speed-display';
        el.style.cssText = `
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          font-family: monospace;
          font-size: 24px;
          font-weight: bold;
          color: #0f0;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
          z-index: 9999;
          pointer-events: none;
        `;
        document.body.appendChild(el);
        FPSController.speedDisplayEl = el;
      }
      FPSController.speedDisplayEl.textContent = `${Math.round(speed)} u/s`;
      FPSController.speedDisplayEl.style.display = 'block';
    } else if (FPSController.speedDisplayEl) {
      FPSController.speedDisplayEl.style.display = 'none';
    }
  }

  /**
   * Q3-style clip velocity - project velocity onto plane
   */
  // @ts-ignore - kept for future slope movement
  private clipVelocity(vel: Vector3, normal: Vector3, overbounce: number): Vector3 {
    let backoff = Vector3.Dot(vel, normal);

    if (backoff < 0) {
      backoff *= overbounce;
    } else {
      backoff /= overbounce;
    }

    return vel.subtract(normal.scale(backoff));
  }

  /**
   * Q3-style slide move with BSP collision (same as FreeflyController)
   */
  private slideMove(originalMovement: Vector3, cm: ReturnType<typeof getCollisionManager>): void {
    if (!this.camera || !this.scene) return;

    const start = this.camera.position.clone();
    const end = start.add(originalMovement);
    const traceOpts = { radius: 16, height: 56 };

    // Trace through BSP
    const trace = cm.trace(start as never, end as never, traceOpts);

    // If we started in solid, don't move (stuck detection)
    if (trace.startSolid) {
      // Try to nudge out of solid
      const nudgeSteps = [1.0, 2.0, 4.0];
      const testDirs = [
        new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
        new Vector3(0, 1, 0), new Vector3(0, -1, 0),
        new Vector3(0, 0, 1), new Vector3(0, 0, -1),
      ];
      for (const nudge of nudgeSteps) {
        for (const dir of testDirs) {
          const testPos = start.add(dir.scale(nudge));
          const testTrace = cm.trace(testPos as never, testPos.add(new Vector3(0, -0.1, 0)) as never, traceOpts);
          if (!testTrace.startSolid) {
            this.camera.position = testPos;
            return;
          }
        }
      }
      return;
    }

    if (trace.fraction >= 1.0) {
      // No collision - apply full movement
      this.camera.position = end;
    } else if (trace.fraction > 0) {
      // Partial collision - move to contact point with small offset
      const contactPoint = Vector3.Lerp(start, end, trace.fraction);

      // Push back slightly from the wall
      if (trace.normal) {
        const n = trace.normal;
        contactPoint.x += n.x * 0.5;
        contactPoint.y += n.y * 0.5;
        contactPoint.z += n.z * 0.5;
      }

      this.camera.position = contactPoint;

      // Slide along the wall (Q3-style)
      if (trace.normal) {
        let velocity = originalMovement.clone();
        let timeLeft = 1.0 - trace.fraction;
        const maxTries = 4;
        for (let i = 0; i < maxTries && timeLeft > 0.01 && velocity.length() > 0.01; i++) {
          const n = trace.normal;
          const remaining = velocity.scale(timeLeft);
          const dot = remaining.x * n.x + remaining.y * n.y + remaining.z * n.z;
          const slideMove = new Vector3(
            remaining.x - n.x * dot,
            remaining.y - n.y * dot,
            remaining.z - n.z * dot
          );

          if (slideMove.length() < 0.01) break;

          const slideStart = this.camera.position.clone();
          const slideEnd = slideStart.add(slideMove);
          const slideTrace = cm.trace(slideStart as never, slideEnd as never, traceOpts);

          if (slideTrace.fraction > 0) {
            const slidePos = Vector3.Lerp(slideStart, slideEnd, Math.min(slideTrace.fraction * 0.9, 1.0));
            if (slideTrace.fraction < 1.0 && slideTrace.normal) {
              const sn = slideTrace.normal;
              slidePos.x += sn.x * 0.5;
              slidePos.y += sn.y * 0.5;
              slidePos.z += sn.z * 0.5;
            }
            this.camera.position = slidePos;
            timeLeft *= (1.0 - slideTrace.fraction);
            velocity = slideMove.normalize().scale(velocity.length());
          } else {
            break;
          }
        }
      }
    }
  }

  // @ts-ignore - kept for future debug use
  private static _loggedState = false;
  // @ts-ignore - kept for future debug use
  private static _warnedNotInit = false;
  // @ts-ignore - kept for future debug use
  private static _lastDebugTime = 0;
  // @ts-ignore - kept for future debug use
  private static _nativeCollisionSetup = false;
  private static _lastGroundLog = 0;
  private static _lastStrafeLog = 0;

  /**
   * Apply movement using Babylon's native mesh collision system
   * 
   * ARCHITECTURE: Native Collision Mode with BSP Data Augmentation
   * ============================================================
   * 
   * Primary Collision: Babylon.js camera._collideWithWorld
   * - Checks against rendered BSP geometry (walls, floors, ceilings)
   * - Checks against generated clip brush meshes (fullclip, playerclip, caulk)
   * - Excludes detail brushes (filtered in shouldSkipCollision)
   * 
   * Secondary Collision: BSP Clamp Pass (optional safety net)
   * - Runs after Babylon collision
   * - Trace A: checks fullclip/playerclip via BSP brush data
   * - Trace B: checks caulk/structural via BSP brush data
   * - Adjusts position if BSP collision detected
   * 
   * BSP Data Augmentation:
   * - ADD collision: Clip brush meshes generated in MapLoader.buildClipBrushMeshes
   * - REMOVE collision: Detail brushes excluded via shouldSkipCollision
   * 
   * Result: Solid, reliable collision that respects BSP semantics
   */
  private nativeCollisionMove(movement: Vector3): void {
    if (!this.camera || !this.scene) return;

    // Set up native collision on first use
    if (!FPSController._nativeCollisionSetup) {
      FPSController._nativeCollisionSetup = true;

      // Enable scene collision
      this.scene.collisionsEnabled = true;

      // Set up camera ellipsoid for player-sized collision
      // Babylon ellipsoid is half-extents: (width/2, height/2, depth/2)
      // For Q3-style player: radius=16, height=56 → ellipsoid (16, 28, 16)
      this.camera.ellipsoid = new Vector3(16, 28, 16);
      this.camera.ellipsoidOffset = new Vector3(0, 28, 0); // Offset so camera is at eye level
      this.camera.checkCollisions = true;

      // Enable collision on world geometry meshes, excluding non-solid elements
      const meshes = this.scene.meshes;
      let collisionMeshCount = 0;
      let skippedCount = 0;
      for (const mesh of meshes) {
        // Enable collision on BSP world mesh and children
        if (mesh.name.includes('bsp_') || mesh.name.includes('world') ||
          mesh.parent?.name.includes('bsp_') || mesh.parent?.name.includes('world')) {

          // Skip non-solid meshes (light halos, flares, billboards, effects)
          const shouldSkip = this.shouldSkipCollision(mesh);
          if (shouldSkip) {
            mesh.checkCollisions = false;
            skippedCount++;
            continue;
          }

          mesh.checkCollisions = true;
          collisionMeshCount++;
        }
      }
      console.log(`[FPSController] Skipped ${skippedCount} non-solid meshes (halos, flares, etc.)`)

      console.log(`[FPSController] Native collision setup: ${collisionMeshCount} meshes with collision enabled`);
      console.log(`[FPSController] Camera ellipsoid: (${this.camera.ellipsoid.x}, ${this.camera.ellipsoid.y}, ${this.camera.ellipsoid.z})`);
    }

    // IMPORTANT: camera.position.addInPlace() bypasses collision!
    // We must use Babylon's internal collision system

    // Debug: check what methods are available
    const cam = this.camera as any;
    if (!FPSController._debuggedMethods) {
      FPSController._debuggedMethods = true;
      console.log(`[FPSController] Camera type: ${this.camera.getClassName()}`);
      console.log(`[FPSController] Has _collideWithWorld: ${typeof cam._collideWithWorld}`);
      console.log(`[FPSController] Has _checkInputs: ${typeof cam._checkInputs}`);
      console.log(`[FPSController] checkCollisions: ${this.camera.checkCollisions}`);
      console.log(`[FPSController] scene.collisionsEnabled: ${this.scene.collisionsEnabled}`);

      // List meshes with collision enabled
      const collisionMeshes = this.scene.meshes.filter(m => m.checkCollisions);
      console.log(`[FPSController] Meshes with checkCollisions=true: ${collisionMeshes.length}`);
      if (collisionMeshes.length > 0) {
        console.log(`[FPSController] Sample collision mesh: "${collisionMeshes[0].name}"`);
      }
    }

    // Try using _collideWithWorld if available
    if (cam._collideWithWorld && this.camera.checkCollisions) {
      const posBefore = this.camera.position.clone();

      // Debug: Check for collision meshes near camera
      const now = Date.now();
      if (now - FPSController._lastDebugTime > 1000 && this.camera.position) {
        FPSController._lastDebugTime = now;
        const camPos = this.camera.position;
        const nearbyMeshes = this.scene.meshes.filter(m => {
          if (!m.checkCollisions) return false;
          const dist = Vector3.Distance(m.position, camPos);
          return dist < 100;
        });
        console.log(`[FPSController] Camera at (${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)})`);
        console.log(`[FPSController] Nearby collision meshes (< 100 units): ${nearbyMeshes.length}`);
        if (nearbyMeshes.length > 0 && nearbyMeshes.length < 10) {
          nearbyMeshes.forEach(m => {
            const dist = Vector3.Distance(m.position, camPos);
            console.log(`  - "${m.name}" at dist=${dist.toFixed(1)} metadata=${JSON.stringify(m.metadata)}`);
          });
        }
      }

      cam._collideWithWorld(movement);
      const posAfterBabylon = this.camera.position.clone();
      const ellipsoidOffset = (this.camera as any).ellipsoidOffset ? (this.camera as any).ellipsoidOffset : Vector3.Zero();

      // Use the new Q3 collision backend for BSP collision
      const cm = getCollisionManager();
      const wasBackend = cm.getBackendType();
      if (wasBackend !== 'q3') {
        cm.setBackend('q3');
      }

      // Debug logging
      const debugBsp = now - FPSController._lastDebugTime < 100;
      if (debugBsp) {
        console.log(`[Q3 Collision] pos: (${posBefore.x.toFixed(1)}, ${posBefore.y.toFixed(1)}, ${posBefore.z.toFixed(1)})`);
        console.log(`[Q3 Collision] movement: (${movement.x.toFixed(3)}, ${movement.y.toFixed(3)}, ${movement.z.toFixed(3)})`);
      }

      // Use Q3-style slideMove for smooth wall sliding
      const backend = (cm as any).backends?.get('q3');
      const traceOpts = {
        radius: 16,
        height: 56,
        contentMask: 0x1 | 0x10000, // SOLID | PLAYERCLIP
      };

      if (backend && typeof backend.stepSlideMove === 'function') {
        // Use stepSlideMove for smooth collision + stair stepping
        const slideResult = backend.stepSlideMove(posBefore, movement, traceOpts);
        this.camera.position.copyFrom(slideResult.endPos);

        if (slideResult.hitCount > 0 && debugBsp) {
          console.log(`[Freefly][StepSlideMove] ${slideResult.hitCount} collision(s), stepped=${slideResult.stepped}`);
        }
      } else if (backend && typeof backend.slideMove === 'function') {
        // Fallback to slideMove without stepping
        const slideResult = backend.slideMove(posBefore, movement, traceOpts);
        this.camera.position.copyFrom(slideResult.endPos);
      } else {
        // Fallback to simple trace
        const clipTrace = cm.trace(posBefore as never, posAfterBabylon as never, traceOpts);
        if (clipTrace.fraction < 1.0) {
          this.camera.position.copyFrom(clipTrace.endPos);
        }
      }

      if (wasBackend && wasBackend !== 'q3') {
        cm.setBackend(wasBackend);
      }

      // Check if we're stuck in solid (startSolid case)
      const stuckCheck = cm.trace(this.camera.position as never, this.camera.position as never, traceOpts);
      if (stuckCheck.startSolid) {
        const nowStuck = Date.now();
        if (nowStuck - FPSController._lastClipHitLogTime > 250) {
          FPSController._lastClipHitLogTime = nowStuck;
          const hitBrushIndex = (stuckCheck as any).hitBrushIndex;
          const hitTextureName = (stuckCheck as any).hitTextureName;
          FPSController._lastClipHitBrushIndex = typeof hitBrushIndex === 'number' ? hitBrushIndex : null;
          FPSController._lastClipHitTextureName = typeof hitTextureName === 'string' ? hitTextureName : null;
          console.log(`[Freefly][Stuck] startSolid=true brush=${hitBrushIndex} tex=${hitTextureName}`);
        }

        const base = posAfterBabylon.clone();
        const nudgeSteps = [0.5, 1.0, 2.0, 4.0, 8.0];
        const testDirs = [
          new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
          new Vector3(0, 1, 0), new Vector3(0, -1, 0),
          new Vector3(0, 0, 1), new Vector3(0, 0, -1),
          new Vector3(1, 1, 0), new Vector3(-1, -1, 0),
          new Vector3(1, 0, 1), new Vector3(-1, 0, -1),
          new Vector3(0, 1, 1), new Vector3(0, -1, -1)
        ];

        for (const nudge of nudgeSteps) {
          for (const dir of testDirs) {
            const testPos = base.add(dir.scale(nudge));
            const testStart = testPos.add(ellipsoidOffset);
            const testTraceA = cm.trace(testStart as never, testStart as never, {
              radius: 16,
              height: 56,
              clipTexturesOnly: true,
              contentMask: 0x1 | 0x10000,
            });
            const testTraceB = cm.trace(testStart as never, testStart as never, {
              radius: 16,
              height: 56,
              nodrawSolidsOnly: true,
              contentMask: 0x1,
            });
            if (!testTraceA.startSolid && !testTraceB.startSolid) {
              this.camera.position.copyFrom(testPos);
              return;
            }
          }
        }

        this.camera.position.copyFrom(posBefore);
      }

      // Debug: log if collision occurred (position changed differently than expected)
      const actualMove = this.camera.position.subtract(posBefore);
      const moveDiff = actualMove.subtract(movement).length();
      if (moveDiff > 0.01) {
        console.log(`[FPSController] Collision detected! Expected move: ${movement.length().toFixed(2)}, Actual: ${actualMove.length().toFixed(2)}`);
      }
    } else {
      // Fallback: no collision available, just move
      console.log(`[FPSController] WARNING: _collideWithWorld not available, falling back to direct move`);
      this.camera.position.addInPlace(movement);
    }
  }

  private static _debuggedMethods = false;
  private static _lastClipHitLogTime = 0;
  private static _lastClipHitBrushIndex: number | null = null;
  private static _lastClipHitTextureName: string | null = null;

  static getLastClipHitBrushIndex(): number | null {
    return FPSController._lastClipHitBrushIndex;
  }

  static getLastClipHitTextureName(): string | null {
    return FPSController._lastClipHitTextureName;
  }

  /**
   * Check if a mesh should be excluded from collision detection
   * Excludes: billboards, light halos, flares, transparent/additive effects
   */
  private shouldSkipCollision(mesh: any): boolean {
    const name = mesh.name?.toLowerCase() || '';
    const textureName = mesh.metadata?.textureName?.toLowerCase() || '';

    const contentFlags = typeof mesh.metadata?.contentFlags === 'number' ? mesh.metadata.contentFlags : 0;
    const surfaceFlags = typeof mesh.metadata?.surfaceFlags === 'number' ? mesh.metadata.surfaceFlags : 0;

    if ((contentFlags & ContentFlags.DETAIL) !== 0) {
      return true;
    }
    if ((surfaceFlags & SurfaceFlags.NONSOLID) !== 0) {
      return true;
    }
    if ((surfaceFlags & SurfaceFlags.HINT) !== 0) {
      return true;
    }

    // Skip by mesh name patterns
    if (name.includes('flare') || name.includes('halo') || name.includes('glow') ||
      name.includes('billboard') || name.includes('sprite') || name.includes('particle') ||
      name.includes('effect') || name.includes('light_')) {
      return true;
    }

    // Skip by texture name patterns (common Q3/Warsow light textures)
    if (textureName.includes('flare') || textureName.includes('halo') ||
      textureName.includes('glow') || textureName.includes('flareshader') ||
      textureName.includes('lights/') || textureName.includes('sfx/')) {
      return true;
    }

    // Skip meshes with additive blending (light effects)
    const material = mesh.material;
    if (material) {
      // Check for additive alpha mode (used for light effects)
      if (material.alphaMode === 1 || material.alphaMode === 2) { // ADD or MULTIPLY
        return true;
      }
      // Check for high transparency
      if (material.alpha !== undefined && material.alpha < 0.5) {
        return true;
      }
    }

    // Skip billboard faces (faceType 4 in BSP)
    if (mesh.metadata?.faceType === 4) {
      return true;
    }

    return false;
  }

  configure(config: Partial<CameraControllerConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.fov && this.camera) {
      this.camera.fov = config.fov;
    }
  }

  getConfig(): CameraControllerConfig {
    return { ...this.config };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.forward = false;
      this.keys.backward = false;
      this.keys.left = false;
      this.keys.right = false;
      this.keys.up = false;
      this.keys.sprint = false;
      if (this.isPointerLocked) {
        document.exitPointerLock();
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.detach();
  }
}

// Register freefly camera cvars at module load (after class definition)
Cvar.register('cam_freefly_speed', FPSController.getDefaultSpeed(), {
  type: 'float',
  min: 10,
  max: 10000,
  description: 'Freefly camera movement speed',
  onChange: (value) => {
    FPSController.setDefaultSpeed(value as number);
  },
});
