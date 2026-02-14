import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MovementVars } from "./MovementVars";
import { getCollisionManager } from "../physics";
import {
    PLAYER_RADIUS,
    PLAYER_HEIGHT,

} from "../physics/PlayerPhysicsConstants";
import { CollisionManager } from "../physics/CollisionManager";

/**
 * Input state required for physics simulation
 */
export interface PlayerInput {
    wishdir: Vector3;   // Normalized direction vector
    up: boolean;        // Jump key
    crouch: boolean;    // Crouch key
    sprint: boolean;    // Sprint key
    aim: boolean;       // Aiming (ADS) - prevents sprint
    forward: boolean;   // W/S check for air accel modes
    strafe: boolean;    // A/D check for air accel modes
    viewForward: Vector3; // Forward vector of camera/view
}

/**
 * Output state from physics simulation
 */
export interface PhysicsState {
    position: Vector3;      // Current origin position
    velocity: Vector3;      // Current velocity
    isGrounded: boolean;    // Is on ground?
    isSliding: boolean;     // Is currently sliding?
    isCrouching: boolean;   // Is currently crouched?
    wallJumpState: 'none' | 'available' | 'charging';
    crouchViewOffset: number; // For smooth view transition
    smoothedY: number;      // For stair smoothing
    actualHorizSpeed: number; // Real speed (dist/time) for UI
    slideCameraPitch: number; // Camera pitch during slide (absolute, not offset)
    slideEntryPitch: number;  // Player's pitch when slide started (for axis lock)
    isSlideActive: boolean;   // True if slide is actively controlling camera
    ledgeGrabState: 'none' | 'grabbing' | 'pulling'; // Ledge grab state
    ledgeCameraPitch: number; // Camera pitch during ledge grab (absolute)
    isLedgeGrabActive: boolean; // True if ledge grab is actively controlling camera
}

/**
 * Warsow/Quake-style Character Controller
 * Handles collision, gravity, friction, and advanced movement tech (bunnyhop, sliding, walljump)
 */
export class AdvancedCharacterController {
    // Physics State
    public position: Vector3 = Vector3.Zero();
    public velocity: Vector3 = Vector3.Zero();
    public isGrounded: boolean = false;
    public wasGroundedLastFrame: boolean = false;
    public jumpConsumed: boolean = false;

    // Smoothing
    public smoothedY: number = 0;
    public lastPhysicsX: number = 0;
    public lastPhysicsZ: number = 0;
    public actualHorizSpeed: number = 0;

    // Crouch State
    public isCrouching: boolean = false;
    public crouchViewOffset: number = 0;
    private static readonly CROUCH_TRANSITION_SPEED = 0.2;
    private static readonly CROUCH_HEIGHT_OFFSET = -24;

    // Slide State
    public isSliding: boolean = false;
    private slideStartTime: number = 0;
    private lastSlideEndTime: number = 0;
    private slideVelocity: Vector3 = Vector3.Zero();
    private slideEntrySpeed: number = 0;
    private slideEntryPitch: number = 0;
    private slideJumpHoldTime: number = 0;
    public slideCameraPitch: number = 0;

    // Wall Jump State
    public wallJumpState: 'none' | 'available' | 'charging' = 'none';
    private wallJumpChargeTime: number = 0;
    private wallJumpNormal: Vector3 = Vector3.Zero();
    private wallJumpPosition: Vector3 = Vector3.Zero();
    private wallJumpPreVelocity: Vector3 = Vector3.Zero();
    private lastWallJumpTime: number = 0;
    private wallJumpKeyReleased: boolean = true; // Require fresh press for wall jump

    // Ledge Grab State
    public ledgeGrabState: 'none' | 'grabbing' | 'pulling' = 'none';
    private ledgeGrabTime: number = 0;
    private ledgeTargetPos: Vector3 = Vector3.Zero();
    private ledgeStartPos: Vector3 = Vector3.Zero();
    private ledgeWallNormal: Vector3 = Vector3.Zero();
    private ledgeCameraPitch: number = 0; // Current camera pitch for ledge grab animation
    private ledgeEntryPitch: number = 0; // Camera pitch when grab started

    // Constants (copied from FPSController to keep logic self-contained)
    private static readonly SLIDE_FADE_MS = 400;
    private static readonly SLIDE_PITCH_TILT = -0.22; // ~12 degrees (matches v0.8.21)
    private static readonly SLIDE_JUMP_GRACE_MS = 400; // Grace period before jump cancel allowed



    constructor(startPosition: Vector3) {
        this.position.copyFrom(startPosition);
        this.smoothedY = startPosition.y;
        this.lastPhysicsX = startPosition.x;
        this.lastPhysicsZ = startPosition.z;
    }

    public setPosition(pos: Vector3) {
        this.position.copyFrom(pos);
        // Reset smoothing to prevent interpolation artifacts
        this.smoothedY = pos.y;
        this.lastPhysicsX = pos.x;
        this.lastPhysicsZ = pos.z;
    }

    /**
     * Main update loop
     */
    public update(deltaTime: number, input: PlayerInput, mouseRotationX: number): PhysicsState {
        const mv = MovementVars.getInstance();
        const cm = getCollisionManager();


        // Check if we just landed
        const justLanded = !this.wasGroundedLastFrame && this.isGrounded;

        // Movement Parameters
        const gravity = mv.get('sv_gravity');
        const jumpHeight = mv.get('sv_jumpheight');
        const stepHeight = mv.get('sv_stepheight');
        const smoothFactor = mv.get('cl_smoothfactor');
        // RECONSTRUCTED LOGIC: Zero friction when sliding to allow momentum preservation
        const friction = this.isSliding ? 0 : mv.get('sv_friction');

        const accelerate = mv.get('sv_accelerate');
        const stopspeed = mv.get('sv_stopspeed');
        const airaccelerate = mv.get('sv_airaccelerate');
        const maxairspeed = mv.get('sv_maxairspeed');
        const autorun = mv.get('cl_autorun') > 0;

        // Determine user wishspeed
        const canRun = !input.aim && !input.crouch;
        const isRunning = canRun && (autorun ? !input.sprint : input.sprint);
        let wishspeed = isRunning ? mv.get('sv_runSpeed') : mv.get('sv_movementSpeed');

        // Crouch speed modifier
        if (input.crouch && !this.isSliding) {
            const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
            const slideMinSpeed = mv.get('sv_slideMinSpeed');
            const slideCooldown = mv.get('sv_slideCooldown');
            const cooldownPassed = (Date.now() - this.lastSlideEndTime) >= slideCooldown;

            // Only reduce speed if NOT about to enter slide
            if (horizSpeed < slideMinSpeed || !cooldownPassed) {
                wishspeed *= mv.get('cl_crouchmult');
            }
        }

        // === LEDGE GRAB ===
        // Must check this FIRST to prevent Wall Jump / Gravity from overriding it
        const ledgeGrabEnabled = mv.get('sv_ledgegrab') > 0;
        if (ledgeGrabEnabled) {
            if (this.updateLedgeGrab(deltaTime, mv, cm, input, mouseRotationX)) {
                return {
                    position: this.position,
                    velocity: this.velocity,
                    isGrounded: false,
                    isSliding: false,
                    isCrouching: false,
                    wallJumpState: 'none',
                    crouchViewOffset: this.crouchViewOffset,
                    smoothedY: this.smoothedY,
                    actualHorizSpeed: 0,
                    slideCameraPitch: mouseRotationX,
                    slideEntryPitch: mouseRotationX,
                    isSlideActive: false,
                    ledgeGrabState: this.ledgeGrabState,
                    ledgeCameraPitch: this.ledgeCameraPitch,
                    isLedgeGrabActive: this.ledgeGrabState !== 'none'
                };
            }
        }

        // === GRAVITY ===
        if (!this.isGrounded) {
            this.velocity.y -= gravity * deltaTime;
        }

        // === JUMP ===
        if (!input.up) {
            this.jumpConsumed = false;
        }

        // Autohop logic
        const autohop = mv.get('sv_autohop') > 0;
        const willAutohop = autohop && justLanded && input.up;
        const canJump = !this.jumpConsumed || (autohop && justLanded);

        // Wall Jump logic (consumes jump if successful)
        let wallJumpConsumed = false;
        const wallJumpEnabled = mv.get('sv_walljump') > 0;
        if (wallJumpEnabled) {
            this.updateWallJump(deltaTime, mv, cm, input);

            // If charging, freeze physics (skip gravity, friction, movement)
            if (this.wallJumpState === 'charging') {
                // Ensure velocity/position are locked (handled in updateWallJump)

                // Still update crouch state for visuals
                let wantsToCrouch = input.crouch; // No sliding while wall jumping
                this.isCrouching = wantsToCrouch;
                const targetCrouchOffset = this.isCrouching ? AdvancedCharacterController.CROUCH_HEIGHT_OFFSET : 0;
                this.crouchViewOffset += (targetCrouchOffset - this.crouchViewOffset) * AdvancedCharacterController.CROUCH_TRANSITION_SPEED;

                // Return stuck state
                return {
                    position: this.position,
                    velocity: this.velocity,
                    isGrounded: false,
                    isSliding: false,
                    isCrouching: this.isCrouching,
                    wallJumpState: this.wallJumpState,
                    crouchViewOffset: this.crouchViewOffset,
                    smoothedY: this.smoothedY,
                    actualHorizSpeed: 0,
                    slideCameraPitch: mouseRotationX,
                    slideEntryPitch: mouseRotationX,
                    isSlideActive: false,
                    ledgeGrabState: 'none',
                    ledgeCameraPitch: mouseRotationX,
                    isLedgeGrabActive: false
                };
            }
        }

        // Normal Jump
        if (input.up && this.isGrounded) {
            if (canJump && !wallJumpConsumed) {
                this.velocity.y = jumpHeight;
                this.isGrounded = false;
                this.jumpConsumed = true;
                // Also consume wall jump key to prevent wall jump when holding space from ground
                this.wallJumpKeyReleased = false;
            }
        }

        // === MOVEMENT ===
        // Build wish direction
        // We don't have camera here, so we assume functionality of input.wishdir 
        // is already rotated by camera yaw in the Controller before passing here.
        const wishdir = input.wishdir;
        const hasInput = wishdir.length() > 0.001;

        // Ground Movement
        if (this.isGrounded) {
            // Friction (skip on autohop)
            if (!willAutohop) {
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

                // Acceleration
                if (hasInput && !this.isSliding) {
                    const holdingStrafe = input.strafe;
                    const holdingForward = input.forward;
                    const groundWishspeed = (holdingStrafe && !holdingForward) ? mv.get('sv_movementSpeed') : wishspeed;

                    const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
                    const addspeed = groundWishspeed - currentspeed;
                    if (addspeed > 0) {
                        let accelspeed = accelerate * deltaTime * groundWishspeed;
                        if (accelspeed > addspeed) accelspeed = addspeed;
                        this.velocity.x += accelspeed * wishdir.x;
                        this.velocity.z += accelspeed * wishdir.z;
                    }
                }
            }
        } else {
            // Air Movement
            const holdingStrafe = input.strafe;
            const holdingForward = input.forward;
            const velocityDotWish = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
            const isAccelerating = velocityDotWish > 0;

            if (hasInput) {
                if (holdingForward && !holdingStrafe && isAccelerating) {
                    // Mode 1: Air Accelerate (W only)
                    this.airAccelerate(wishdir, wishspeed, deltaTime, mv);
                } else if (holdingStrafe && !holdingForward) {
                    // Mode 2: Strafe Bunny (A/D only)
                    this.strafeBunnyAccelerate(wishdir, wishspeed, maxairspeed, deltaTime, mv);
                } else {
                    // Mode 3: Normal Air Control
                    this.normalAirAccelerate(wishdir, wishspeed, airaccelerate, deltaTime, mv);
                }
            }
        }

        /* MOVED TO TOP */

        // === CROUCH SLIDE ===
        this.updateCrouchslide(deltaTime, mv, input, mouseRotationX);

        // === COLLISION / INTEGRATION ===
        const movement = this.velocity.scale(deltaTime);
        const prevY = this.position.y;

        if (movement.length() > 0) {
            if (cm.isInitialized()) {
                // Use BSP collision with stepSlideMove for stair stepping
                const backend = (cm as any).backends?.get('q3');
                if (backend && typeof backend.stepSlideMove === 'function') {
                    const traceOpts = { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT };
                    const result = backend.stepSlideMove(this.position.clone(), movement, traceOpts);
                    this.position.copyFrom(result.endPos);

                    // CRITICAL: Update velocity from collision-clipped result.
                    // stepSlideMove returns the clipped movement vector as 'velocity'.
                    // Convert it back to actual velocity by dividing by deltaTime.
                    // Without this, the player's velocity keeps pointing into walls
                    // they've hit, causing them to get permanently stuck.
                    if (result.hitCount > 0 && deltaTime > 0) {
                        this.velocity.copyFrom(result.velocity.scale(1.0 / deltaTime));
                    }
                } else {
                    // Fallback local or simple move
                    // TODO: implement slideMove logic locally if needed, for now just add
                    this.position.addInPlace(movement);
                }
            } else {
                this.position.addInPlace(movement);
            }
        }

        // === CEILING DETECTION ===
        const actualYMove = this.position.y - prevY;
        const expectedYMove = movement.y;
        if (this.velocity.y > 0 && expectedYMove > 0.1) {
            if (actualYMove < expectedYMove * 0.5) {
                this.velocity.y = 0; // Bonk
            }
        }

        // === GROUND DETECTION ===
        this.checkGrounded(cm);

        // === POST-INTEGRATION CALCULATIONS ===
        // Calculate actual speed
        if (deltaTime > 0) {
            const dx = this.position.x - this.lastPhysicsX;
            const dz = this.position.z - this.lastPhysicsZ;
            this.actualHorizSpeed = Math.sqrt(dx * dx + dz * dz) / deltaTime;
        }
        this.lastPhysicsX = this.position.x;
        this.lastPhysicsZ = this.position.z;

        // Smoothing
        const heightDiff = Math.abs(this.position.y - this.smoothedY);
        if (heightDiff > stepHeight * 2) {
            this.smoothedY = this.position.y;
        } else {
            this.smoothedY = this.smoothedY + (this.position.y - this.smoothedY) * smoothFactor;
        }

        // Crouch State
        let wantsToCrouch = input.crouch || this.isSliding;
        const wasCrouching = this.isCrouching;
        if (wasCrouching && !wantsToCrouch && this.isGrounded) {
            // Ceiling check logic would go here
            // Omitted for brevity in this first pass, can copy trace logic if strictness needed
        }
        this.isCrouching = wantsToCrouch;

        const targetCrouchOffset = this.isCrouching ? AdvancedCharacterController.CROUCH_HEIGHT_OFFSET : 0;
        this.crouchViewOffset += (targetCrouchOffset - this.crouchViewOffset) * AdvancedCharacterController.CROUCH_TRANSITION_SPEED;

        return {
            position: this.position,
            velocity: this.velocity,
            isGrounded: this.isGrounded,
            isSliding: this.isSliding,
            isCrouching: this.isCrouching,
            wallJumpState: this.wallJumpState,
            crouchViewOffset: this.crouchViewOffset,
            smoothedY: this.smoothedY,
            actualHorizSpeed: this.actualHorizSpeed,
            slideCameraPitch: this.isSliding ? this.slideCameraPitch : mouseRotationX,
            slideEntryPitch: this.slideEntryPitch,
            isSlideActive: this.isSliding,
            ledgeGrabState: this.ledgeGrabState,
            ledgeCameraPitch: this.ledgeCameraPitch,
            isLedgeGrabActive: false
        };
    }

    // === HELPER METHODS ===

    private airAccelerate(wishdir: Vector3, wishspeed: number, deltaTime: number, mv: MovementVars): void {
        const maxPlayerSpeed = mv.get('sv_movementSpeed');
        const topspeed = mv.get('sv_topspeed');
        const runSpeed = mv.get('sv_runSpeed');
        const radicalSpeed = 600;

        const airforwardaccel = 1.00001;
        const bunnyaccel = 0.1593;
        const turnaccel = 4.0;
        const backtosideratio = 0.8;

        const curvelX = this.velocity.x;
        const curvelZ = this.velocity.z;
        const curspeed = Math.sqrt(curvelX * curvelX + curvelZ * curvelZ);

        let accelFalloff = 1.0;
        if (curspeed > runSpeed) {
            if (curspeed < radicalSpeed) {
                const ratio = (curspeed - runSpeed) / (radicalSpeed - runSpeed);
                accelFalloff = 1 - ratio * 0.5;
            } else {
                const ratio = (curspeed - radicalSpeed) / (topspeed - radicalSpeed);
                accelFalloff = Math.max(0, 0.5 * (1 - ratio * ratio * ratio));
            }
        }

        let targetWishspeed: number;
        if (wishspeed > curspeed * 1.01) {
            const accelspeed = curspeed + airforwardaccel * maxPlayerSpeed * deltaTime * accelFalloff;
            targetWishspeed = Math.min(wishspeed, accelspeed);
        } else {
            const f = Math.max(0, (topspeed - curspeed) / (topspeed - maxPlayerSpeed));
            targetWishspeed = Math.max(curspeed, maxPlayerSpeed) + bunnyaccel * f * accelFalloff * maxPlayerSpeed * deltaTime;
        }

        const wishvelX = wishdir.x * targetWishspeed;
        const wishvelZ = wishdir.z * targetWishspeed;
        let accelDirX = wishvelX - curvelX;
        let accelDirZ = wishvelZ - curvelZ;

        const accelDirLen = Math.sqrt(accelDirX * accelDirX + accelDirZ * accelDirZ);
        if (accelDirLen < 0.001) return;

        accelDirX /= accelDirLen;
        accelDirZ /= accelDirLen;
        const addspeed = accelDirLen;

        let accelspeed = turnaccel * maxPlayerSpeed * deltaTime;
        if (accelspeed > addspeed) accelspeed = addspeed;

        if (backtosideratio < 1.0 && curspeed > 0.001) {
            const curDirX = curvelX / curspeed;
            const curDirZ = curvelZ / curspeed;
            const dot = accelDirX * curDirX + accelDirZ * curDirZ;
            if (dot < 0) {
                accelDirX -= (1.0 - backtosideratio) * dot * curDirX;
                accelDirZ -= (1.0 - backtosideratio) * dot * curDirZ;
            }
        }

        this.velocity.x += accelspeed * accelDirX;
        this.velocity.z += accelspeed * accelDirZ;
    }

    private strafeBunnyAccelerate(wishdir: Vector3, wishspeed: number, maxairspeed: number, deltaTime: number, mv: MovementVars): void {
        const baseStrafeBunnyAccel = 50;
        const strafeWishspeed = Math.min(wishspeed, maxairspeed);
        const curSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
        const runSpeed = mv.get('sv_runSpeed');
        const radicalSpeed = 600;
        const topspeed = mv.get('sv_topspeed');

        let accelFalloff = 1.0;
        if (curSpeed > runSpeed) {
            if (curSpeed < radicalSpeed) {
                const ratio = (curSpeed - runSpeed) / (radicalSpeed - runSpeed);
                accelFalloff = 1 - ratio * 0.5;
            } else {
                const ratio = (curSpeed - radicalSpeed) / (topspeed - radicalSpeed);
                accelFalloff = Math.max(0, 0.5 * (1 - ratio * ratio * ratio));
            }
        }

        const strafeBunnyAccel = baseStrafeBunnyAccel * accelFalloff;
        const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
        const addspeed = strafeWishspeed - currentspeed;

        if (addspeed > 0 && accelFalloff > 0.01) {
            let accelspeed = strafeBunnyAccel * deltaTime * strafeWishspeed;
            if (accelspeed > addspeed) accelspeed = addspeed;
            this.velocity.x += accelspeed * wishdir.x;
            this.velocity.z += accelspeed * wishdir.z;
        }
    }

    private normalAirAccelerate(wishdir: Vector3, wishspeed: number, airaccelerate: number, deltaTime: number, mv: MovementVars): void {
        const curSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
        const runSpeed = mv.get('sv_runSpeed');
        const radicalSpeed = 600;
        const topspeed = mv.get('sv_topspeed');

        let accelFalloff = 1.0;
        if (curSpeed > runSpeed) {
            if (curSpeed < radicalSpeed) {
                const ratio = (curSpeed - runSpeed) / (radicalSpeed - runSpeed);
                accelFalloff = 1 - ratio * 0.5;
            } else {
                const ratio = (curSpeed - radicalSpeed) / (topspeed - radicalSpeed);
                accelFalloff = Math.max(0, 0.5 * (1 - ratio * ratio * ratio));
            }
        }

        const currentspeed = this.velocity.x * wishdir.x + this.velocity.z * wishdir.z;
        const addspeed = wishspeed - currentspeed;

        if (addspeed > 0 && accelFalloff > 0.01) {
            let accelspeed = airaccelerate * deltaTime * wishspeed * accelFalloff;
            if (accelspeed > addspeed) accelspeed = addspeed;
            this.velocity.x += accelspeed * wishdir.x;
            this.velocity.z += accelspeed * wishdir.z;
        }
    }

    private checkGrounded(cm: CollisionManager): void {
        this.wasGroundedLastFrame = this.isGrounded;
        if (cm.isInitialized()) {
            const backend = (cm as any).backends?.get('q3');
            if (backend && typeof backend.trace === 'function') {
                const groundCheckStart = this.position.clone();
                const groundCheckEnd = groundCheckStart.add(new Vector3(0, -2, 0));
                const traceOpts = { radius: PLAYER_RADIUS, height: PLAYER_HEIGHT };
                const groundTrace = backend.trace(groundCheckStart, groundCheckEnd, traceOpts);

                if (groundTrace.fraction < 1.0) {
                    if (this.velocity.y <= 0) {
                        if (!this.isGrounded) {
                            this.isGrounded = true;
                        }
                        if (this.velocity.y < 0) this.velocity.y = 0;
                    }
                } else {
                    if (this.isGrounded) {
                        this.isGrounded = false;
                        if (this.velocity.y <= 0) this.velocity.y = -1;
                    }
                }
            }
        } else {
            // Fallback logic
        }
    }

    private updateWallJump(deltaTime: number, mv: MovementVars, cm: CollisionManager, input: PlayerInput) {
        // Constants
        const wallJumpReach = mv.get('sv_walljump_reach') || 64; // Default 64
        const wallJumpCooldown = mv.get('sv_walljump_cooldown') || 1.0;
        // Enforce a sensible minimum height default if CVar is missing/zero
        const cvarMinHeight = mv.get('sv_walljump_minheight');
        const wallJumpMinHeight = (cvarMinHeight && cvarMinHeight > 0) ? cvarMinHeight : 48; // Default 48 units (~1.5m)
        const chargeTimeCvar = mv.get('sv_walljump_chargetime');

        // Cooldown Check
        const currentTime = performance.now() / 1000;
        if (currentTime - this.lastWallJumpTime < wallJumpCooldown) {
            this.wallJumpState = 'none';
            return;
        }

        // Must be in air to wall jump
        if (this.isGrounded) {
            this.wallJumpState = 'none';
            // DON'T reset wallJumpKeyReleased here! Only reset when key is actually released.
            return;
        }

        // Track key release for fresh press requirement
        if (!input.up) {
            this.wallJumpKeyReleased = true;
        }

        // Handle Charging State
        if (this.wallJumpState === 'charging') {
            // Update timer
            this.wallJumpChargeTime += deltaTime;

            // Check input or timeout
            if (!input.up || (chargeTimeCvar > 0 && this.wallJumpChargeTime >= chargeTimeCvar)) {
                // Release -> Push
                this.executeWallJumpPush(this.wallJumpNormal, mv, false);
                return;
            }

            // Still charging/hanging
            // Lock position and velocity
            this.position.copyFrom(this.wallJumpPosition);
            this.velocity.set(0, 0, 0);
            return; // Stop processing (don't scan for new walls)
        }

        // Trace Setup
        if (!cm.isInitialized()) return;
        const backend = (cm as any).backends?.get('q3');
        if (!backend?.trace) return;

        // Ground check (sv_walljump_minheight)
        // Ensure strictly NO ground within minHeight distance below player
        // Use eye level (position + 24) to match old FPSController behavior
        const groundCheckStart = this.position.clone();
        groundCheckStart.y += 24; // Eye level - matches old camera.position check
        const groundCheckEnd = groundCheckStart.add(new Vector3(0, -wallJumpMinHeight, 0));
        const groundCheck = backend.trace(groundCheckStart, groundCheckEnd, { radius: 8, height: 16 });

        if (groundCheck.fraction < 1.0) {
            // Hit ground within min height - too close to ground
            this.wallJumpState = 'none';
            return;
        }

        // Direction vectors
        // viewForward is from camera, normalized. Flatten it for wall checking.
        const flatForward = new Vector3(input.viewForward.x, 0, input.viewForward.z).normalize();

        // Potential wall directions
        const directions = [
            flatForward, // Forward
            new Vector3(flatForward.x * 0.707 - flatForward.z * 0.707, 0, flatForward.x * 0.707 + flatForward.z * 0.707), // Forward-Right
            new Vector3(flatForward.x * 0.707 + flatForward.z * 0.707, 0, -flatForward.x * 0.707 + flatForward.z * 0.707), // Forward-Left
            new Vector3(-flatForward.z, 0, flatForward.x), // Right
            new Vector3(flatForward.z, 0, -flatForward.x), // Left
        ];

        let wallNormal: Vector3 | null = null;
        let wallHit = false;

        for (const dir of directions) {
            const traceStart = this.position.clone();
            const traceEnd = traceStart.add(dir.scale(wallJumpReach));
            const trace = backend.trace(traceStart, traceEnd, { radius: 12, height: 40 });

            if (trace.fraction < 1.0 && trace.normal) {
                // Check verticality
                if (Math.abs(trace.normal.y) < 0.5) { // It's a wall
                    wallNormal = new Vector3(trace.normal.x, 0, trace.normal.z).normalize();
                    wallHit = true;
                    break;
                }
            }
        }

        if (!wallHit || !wallNormal) {
            this.wallJumpState = 'none';
            return;
        }

        // Found wall!
        const velDot = this.velocity.x * wallNormal.x + this.velocity.z * wallNormal.z;
        if (velDot > -10) {
            this.wallJumpState = 'none';
            return;
        }

        // === EYE-LEVEL WALL CHECK ===
        // Verify wall extends up to eye level (not just a low fence/railing/stairs)
        // If there's no wall at eye level, player should step/jump OVER it, not wall jump
        const eyeHeight = 32;  // +32 from origin (eye level in Q3)
        const eyeCheckStart = this.position.add(new Vector3(0, eyeHeight - 10, 0));  // Near eye level
        const eyeCheckEnd = eyeCheckStart.add(wallNormal.scale(-wallJumpReach));  // Trace toward wall
        const eyeTrace = backend.trace(eyeCheckStart, eyeCheckEnd, { radius: 8, height: 16 });

        if (eyeTrace.fraction >= 1.0) {
            // No wall at eye level - this is a low obstacle (stairs, fence, railing)
            // Player should step over it, not wall jump
            this.wallJumpState = 'none';
            return;
        }

        // Prevent spamming / double jumping in same frame or auto-hop cycle
        // IMPORTANT: Require FRESH press - key must be released AFTER last wall jump
        // This prevents holding space to continuously wall jump
        if (!this.wallJumpKeyReleased) {
            // Key still held from last jump - wait for release
            this.wallJumpState = 'available'; // Show we're near a wall but can't jump yet
            return;
        }

        if (input.up && chargeTimeCvar <= 0) {
            // INSTANT BOUNCE
            this.wallJumpKeyReleased = false; // Consume the press
            this.jumpConsumed = true; // Also consume normal jump
            this.executeWallJumpPush(wallNormal, mv, true);
            return;
        } else if (input.up && chargeTimeCvar > 0) {
            // START CHARGING
            this.wallJumpKeyReleased = false; // Consume the press
            this.wallJumpState = 'charging';
            this.wallJumpChargeTime = 0;
            this.wallJumpNormal.copyFrom(wallNormal);
            this.wallJumpPosition.copyFrom(this.position);
            this.wallJumpPreVelocity.copyFrom(this.velocity);
            this.velocity.set(0, 0, 0);
        } else {
            this.wallJumpState = 'available';
        }
    }




    private executeWallJumpPush(normal: Vector3, mv: MovementVars, instant: boolean) {
        const wallJumpHeight = mv.get('sv_walljump_height');
        const wallJumpBounce = mv.get('sv_walljump_bounce');
        const wallJumpBoost = mv.get('sv_walljump_boost');

        // Restore velocity if we were charging
        const baseVelocity = instant ? this.velocity.clone() : this.wallJumpPreVelocity.clone();

        // Calculate reflection
        // R = V - 2(V.N)N
        const dot = baseVelocity.x * normal.x + baseVelocity.z * normal.z;
        const reflectedX = baseVelocity.x - 2 * dot * normal.x;
        const reflectedZ = baseVelocity.z - 2 * dot * normal.z;

        // Apply bounce factor
        this.velocity.x = reflectedX * wallJumpBounce;
        this.velocity.z = reflectedZ * wallJumpBounce;

        // Only apply extra outward push if we're not moving fast enough (or sticking)
        if (!instant) {
            const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
            if (speed < 100) {
                this.velocity.x += normal.x * 200 * wallJumpBoost;
                this.velocity.z += normal.z * 200 * wallJumpBoost;
            }
        }

        // Apply vertical jump (boost not needed if height is set explicitly)
        // Original logic used simple height set.
        this.velocity.y = wallJumpHeight * (instant ? 1.0 : wallJumpBoost);

        this.lastWallJumpTime = performance.now() / 1000;
        this.wallJumpState = 'none';

        // Mark jump as consumed so we don't double-jump immediately
        this.jumpConsumed = true;
    }


    private updateLedgeGrab(deltaTime: number, mv: MovementVars, cm: CollisionManager, input: PlayerInput, mouseRotationX: number): boolean {
        // Constants
        const reach = mv.get('sv_ledge_reach') || 40;
        const climbHeight = mv.get('sv_ledge_height') || 56; // How high above eye level we can grab
        const grabPauseTime = 0.12; // Brief pause at grab point before climbing
        const pullTime = mv.get('sv_ledge_pulltime') || 0.8; // Time to climb up (slower = smoother)
        const timeout = mv.get('sv_ledge_timeout') || 1.5;

        // === STATE MACHINE ===

        // 1. GRABBING (Brief pause at ledge edge)
        if (this.ledgeGrabState === 'grabbing') {
            this.ledgeGrabTime += deltaTime;

            // FREEZE position - don't let physics move us
            this.position.copyFrom(this.ledgeStartPos);
            this.velocity.set(0, 0, 0);
            this.isGrounded = false;

            // Camera pitch effect - tilt down to look at ledge
            // Smooth transition to looking down during grab
            const grabPitchTarget = this.ledgeEntryPitch + 0.35; // Look down ~20 degrees
            const grabPitchProgress = Math.min(1.0, this.ledgeGrabTime / grabPauseTime);
            this.ledgeCameraPitch = this.ledgeEntryPitch + (grabPitchTarget - this.ledgeEntryPitch) * grabPitchProgress;

            // Check for cancel (crouch or backwards)
            const dotWishWall = Vector3.Dot(input.wishdir, this.ledgeWallNormal);
            if (input.crouch || input.sprint || (dotWishWall > 0.5 && input.wishdir.length() > 0.1)) {
                // Release/Drop
                this.ledgeGrabState = 'none';
                this.velocity.y = -100; // Fall away
                console.log('[LedgeGrab] Dropped');
                return false;
            }

            // After brief pause, auto-climb (or on forward press)
            if (this.ledgeGrabTime >= grabPauseTime) {
                this.enterPullingState();
                console.log('[LedgeGrab] Starting climb after pause');
                return true;
            }

            return true; // Still pausing at grab point
        }

        // 2. PULLING (Climbing animation)
        if (this.ledgeGrabState === 'pulling') {
            this.ledgeGrabTime += deltaTime;
            const progress = Math.min(1.0, this.ledgeGrabTime / pullTime);

            // EaseInOutQuad for smooth animation (same as old implementation)
            const t = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            // Camera pitch animation - smoothly return from looking down to original pitch
            const grabPitch = this.ledgeEntryPitch + 0.35; // Where we were looking during grab
            this.ledgeCameraPitch = grabPitch + (this.ledgeEntryPitch - grabPitch) * t;

            // Smooth position interpolation from grab position to target
            this.position.x = this.ledgeStartPos.x + (this.ledgeTargetPos.x - this.ledgeStartPos.x) * t;
            this.position.y = this.ledgeStartPos.y + (this.ledgeTargetPos.y - this.ledgeStartPos.y) * t;
            this.position.z = this.ledgeStartPos.z + (this.ledgeTargetPos.z - this.ledgeStartPos.z) * t;

            this.velocity.set(0, 0, 0);
            this.isGrounded = false;

            if (progress >= 1.0) {
                // Done climbing
                this.ledgeGrabState = 'none';
                this.isGrounded = true;
                this.position.copyFrom(this.ledgeTargetPos);
                this.velocity.set(0, 0, 0);

                // Small forward momentum to continue running
                const forward = new Vector3(input.viewForward.x, 0, input.viewForward.z).normalize();
                this.velocity.x = forward.x * 100;
                this.velocity.z = forward.z * 100;

                console.log('[LedgeGrab] Climb complete!');
                return false;
            }
            return true; // Still climbing
        }

        // 3. DETECTION - Eye-level based
        // Don't detect while grounded (use stair stepping)
        if (this.isGrounded) return false;

        // Allow detection when rising slowly or falling
        // Block only during fast upward motion (initial jump burst)
        if (this.velocity.y > 200) return false;

        // Must be pressing forward OR moving forward with velocity
        const hasForwardIntent = input.forward ||
            (this.velocity.x * input.viewForward.x + this.velocity.z * input.viewForward.z) > 50;
        if (!hasForwardIntent) return false;

        if (!cm.isInitialized()) return false;
        const backend = (cm as any).backends?.get('q3');
        if (!backend?.trace) return false;

        // Eye position (camera/physics origin + 24 above feet)
        const eyePos = this.position.clone();
        eyePos.y += 24;

        // Forward direction (flattened)
        const forwardDir = new Vector3(input.viewForward.x, 0, input.viewForward.z).normalize();

        console.log(`[LedgeGrab] Detecting... eyeY=${eyePos.y.toFixed(1)}, velY=${this.velocity.y.toFixed(0)}`);

        // === TRACE 1: Check for wall at waist/chest level ===
        // If there's a wall at waist level, we might be at a ledge
        const waistPos = eyePos.clone();
        waistPos.y -= 16; // Waist is ~16 below eye
        const waistEnd = waistPos.add(forwardDir.scale(reach));
        const waistTrace = backend.trace(waistPos, waistEnd, { radius: 12, height: 16 });

        if (waistTrace.fraction >= 1.0) {
            console.log('[LedgeGrab] No wall at waist level');
            return false;
        }

        // === TRACE 2: Check if space is clear ABOVE eye level ===
        // If there's no wall above eye level, there's a ledge
        const headPos = eyePos.clone();
        headPos.y += 8; // Slightly above eye
        const headEnd = headPos.add(forwardDir.scale(reach));
        const headTrace = backend.trace(headPos, headEnd, { radius: 12, height: 16 });

        if (headTrace.fraction < 0.9) {
            console.log('[LedgeGrab] Wall above eye level - no ledge');
            return false;
        }

        // === TRACE 3: Find the ledge surface ===
        // Trace down from above to find where the ledge top is
        const aboveLedge = eyePos.add(forwardDir.scale(reach * 0.7));
        aboveLedge.y += climbHeight;

        const belowLedge = aboveLedge.clone();
        belowLedge.y -= (climbHeight + 48);

        const ledgeTrace = backend.trace(aboveLedge, belowLedge, { radius: 8, height: 8 });

        if (ledgeTrace.fraction >= 1.0) {
            console.log('[LedgeGrab] No ledge surface found');
            return false;
        }

        // Check if surface is flat enough (floor)
        if (!ledgeTrace.normal || ledgeTrace.normal.y < 0.7) {
            console.log(`[LedgeGrab] Ledge too sloped: normal.y=${ledgeTrace.normal?.y.toFixed(2)}`);
            return false;
        }

        const ledgeSurfaceY = ledgeTrace.endPos.y;
        console.log(`[LedgeGrab] Ledge found at Y=${ledgeSurfaceY.toFixed(1)}, eyeY=${eyePos.y.toFixed(1)}`);

        // === CHECK: Is eye level approximately at ledge height? ===
        // Eye should be below ledge surface but not too far below
        // "Half model" = roughly eyes at ledge level ± some tolerance
        const eyeToLedge = ledgeSurfaceY - eyePos.y;

        // If eye is already above ledge, skip (we're past it)
        if (eyeToLedge < -16) {
            console.log(`[LedgeGrab] Eye already above ledge (diff=${eyeToLedge.toFixed(1)})`);
            return false;
        }

        // If eye is too far below ledge, skip (can't reach)
        if (eyeToLedge > climbHeight) {
            console.log(`[LedgeGrab] Ledge too high (diff=${eyeToLedge.toFixed(1)}, max=${climbHeight})`);
            return false;
        }

        // === TRACE 4: Check there's room to stand on the ledge ===
        const targetPos = ledgeTrace.endPos.clone();
        targetPos.y += 24 + 4; // Stand on ledge (origin height + small buffer)

        const standTrace = backend.trace(targetPos, targetPos.add(new Vector3(0, 32, 0)), { radius: 12, height: 56 });
        if (standTrace.fraction < 0.8) {
            console.log('[LedgeGrab] No room to stand on ledge');
            return false;
        }

        // === SUCCESS: Start grabbing ===
        console.log(`[LedgeGrab] *** GRABBING LEDGE! *** eyeToLedge=${eyeToLedge.toFixed(1)}`);

        // Store wall normal for later
        if (waistTrace.normal) {
            this.ledgeWallNormal.copyFrom(waistTrace.normal);
        } else {
            this.ledgeWallNormal = forwardDir.scale(-1);
        }

        this.startGrabbing(targetPos, mouseRotationX);
        return true;
    }

    private startGrabbing(targetPos: Vector3, mouseRotationX: number) {
        this.ledgeGrabState = 'grabbing';
        this.ledgeGrabTime = 0;

        // Store current position as grab point (freeze here)
        this.ledgeStartPos.copyFrom(this.position);
        this.ledgeTargetPos.copyFrom(targetPos);

        // Capture current camera pitch for animation
        this.ledgeEntryPitch = mouseRotationX;
        this.ledgeCameraPitch = mouseRotationX;

        // Immediately zero velocity to stop all movement
        this.velocity.set(0, 0, 0);

        console.log(`[LedgeGrab] Grabbed at Y=${this.position.y.toFixed(1)}, target Y=${targetPos.y.toFixed(1)}, pitch=${mouseRotationX.toFixed(2)}`);
    }

    private enterPullingState() {
        this.ledgeGrabState = 'pulling';
        this.ledgeGrabTime = 0;
        // Keep current position as start of pull (we're already frozen at grab point)
        this.ledgeStartPos.copyFrom(this.position);
    }

    private updateCrouchslide(deltaTime: number, mv: MovementVars, input: PlayerInput, mouseRotationX: number) {
        const slideEnabled = mv.get('sv_slide') > 0;
        if (!slideEnabled) {
            if (this.isSliding) this.exitSlide();
            return;
        }

        const now = performance.now();
        const slideMinSpeed = mv.get('sv_slideMinSpeed') || 425;
        const slideDuration = mv.get('sv_slideDuration') || 800;
        const slideCooldown = mv.get('sv_slideCooldown') || 1500;
        const slideSpeedMult = mv.get('sv_slideSpeedMultiplier') || 1.2;

        // Calculate current horizontal speed
        const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);

        // === SLIDE ENTRY ===
        if (!this.isSliding && input.crouch && this.isGrounded) {
            const cooldownPassed = (now - this.lastSlideEndTime) >= slideCooldown;

            if (horizSpeed >= slideMinSpeed && cooldownPassed) {
                // Enter slide!
                this.isSliding = true;
                this.slideStartTime = now;

                // Lock velocity direction at entry
                this.slideVelocity = this.velocity.clone();
                this.slideVelocity.y = 0;
                this.slideVelocity.normalize();

                // Store entry speed for momentum preservation
                this.slideEntrySpeed = horizSpeed * slideSpeedMult;

                // Store entry pitch for axis lock
                this.slideEntryPitch = mouseRotationX;

                // Apply speed multiplier immediately
                this.velocity.x = this.slideVelocity.x * this.slideEntrySpeed;
                this.velocity.z = this.slideVelocity.z * this.slideEntrySpeed;

                console.log(`[Slide] Entered at speed ${this.slideEntrySpeed.toFixed(0)}`);
            }
        }

        // === SLIDING PHYSICS ===
        if (this.isSliding) {
            const slideElapsed = now - this.slideStartTime;

            // === CAMERA PITCH TILT (look up effect) with smooth 400ms in/out ===
            let tiltIntensity: number;
            const fadeIn = AdvancedCharacterController.SLIDE_FADE_MS;
            const fadeOut = AdvancedCharacterController.SLIDE_FADE_MS;
            const timeRemaining = slideDuration - slideElapsed;

            if (slideElapsed < fadeIn) {
                // Fade in: 0 → 1 over first 400ms (smoothstep for smooth ease)
                const t = slideElapsed / fadeIn;
                tiltIntensity = t * t * (3 - 2 * t); // smoothstep
            } else if (timeRemaining < fadeOut) {
                // Fade out: 1 → 0 over last 400ms (smoothstep)
                const t = Math.max(0, timeRemaining) / fadeOut;
                tiltIntensity = t * t * (3 - 2 * t); // smoothstep
            } else {
                // Full tilt in the middle
                tiltIntensity = 1;
            }

            // Calculate absolute camera pitch (entry pitch + tilt offset)
            const targetPitch = this.slideEntryPitch + (AdvancedCharacterController.SLIDE_PITCH_TILT * tiltIntensity);
            this.slideCameraPitch = targetPitch;

            // === SPEED DECAY ===
            // Preserve full speed for first 400ms, then start decaying
            let currentSlideSpeed: number;
            if (slideElapsed < AdvancedCharacterController.SLIDE_JUMP_GRACE_MS) {
                // Grace period - maintain entry speed
                currentSlideSpeed = this.slideEntrySpeed;
            } else {
                // After grace, apply decay
                const decayElapsed = slideElapsed - AdvancedCharacterController.SLIDE_JUMP_GRACE_MS;
                const decayDuration = slideDuration - AdvancedCharacterController.SLIDE_JUMP_GRACE_MS;
                const decayProgress = Math.min(1, decayElapsed / decayDuration);

                // Decay from entry speed down to crouch walk speed
                const crouchSpeed = mv.get('sv_movementSpeed') * mv.get('cl_crouchmult');
                currentSlideSpeed = this.slideEntrySpeed + (crouchSpeed - this.slideEntrySpeed) * decayProgress;
            }

            // Update velocity in slide direction (locked)
            this.velocity.x = this.slideVelocity.x * currentSlideSpeed;
            this.velocity.z = this.slideVelocity.z * currentSlideSpeed;

            // === SLIDE EXIT CONDITIONS ===

            // Timeout - slide ends and player crouches at crouch speed
            if (slideElapsed >= slideDuration) {
                console.log('[Slide] Exit: Timeout');
                this.exitSlide();
                return;
            }

            // Release crouch
            if (!input.crouch) {
                console.log('[Slide] Exit: Released crouch');
                this.exitSlide();
                return;
            }

            // Jump cancel - only available AFTER grace period
            if (input.up && slideElapsed >= AdvancedCharacterController.SLIDE_JUMP_GRACE_MS) {
                this.slideJumpHoldTime += deltaTime;

                // Hold threshold for boost (200ms)
                if (this.slideJumpHoldTime >= 0.2) {
                    const slideJumpBoost = mv.get('sv_slideJumpBoost') || 1.3;
                    console.log(`[Slide] Boost Jump! Speed ${(currentSlideSpeed * slideJumpBoost).toFixed(0)}`);
                    this.velocity.x = this.slideVelocity.x * currentSlideSpeed * slideJumpBoost;
                    this.velocity.z = this.slideVelocity.z * currentSlideSpeed * slideJumpBoost;
                    this.velocity.y = mv.get('sv_jumpheight');
                    this.isGrounded = false;
                    this.exitSlide();
                    return;
                }
            } else if (!input.up) {
                // Reset hold time if not holding jump
                if (this.slideJumpHoldTime > 0 && this.slideJumpHoldTime < 0.2 && slideElapsed >= AdvancedCharacterController.SLIDE_JUMP_GRACE_MS) {
                    // TAP JUMP - quick stand without boost
                    console.log('[Slide] Exit: Tap jump (stand)');
                    this.exitSlide();
                    return;
                }
                this.slideJumpHoldTime = 0;
            }

            // Left ground (fell off edge) - let slide naturally end
            // (Ground detection can flicker during slide physics)
        } else {
            // Not sliding - reset camera pitch
            this.slideCameraPitch = mouseRotationX;
        }
    }

    private exitSlide() {
        this.isSliding = false;
        this.lastSlideEndTime = performance.now();
        this.slideJumpHoldTime = 0;
        this.slideEntrySpeed = 0;
    }
}
