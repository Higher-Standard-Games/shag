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
    slideCameraPitch: number; // Camera tilt from sliding
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
    private static readonly CROUCH_HEIGHT_OFFSET = -24; // (DEFAULT_VIEWHEIGHT 50 - CROUCH_VIEWHEIGHT 26) * -1? No, 26-50 = -24.

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

    // Constants (copied from FPSController to keep logic self-contained)
    private static readonly SLIDE_FADE_MS = 400;
    private static readonly SLIDE_PITCH_TILT = -0.05; // Negative for looking UP
    private static readonly SLIDE_JUMP_GRACE_MS = 500;



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
        const friction = mv.get('sv_friction');
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
                    slideCameraPitch: mouseRotationX
                };
            }
        }

        // Normal Jump
        if (input.up && this.isGrounded) {
            if (canJump && !wallJumpConsumed) {
                this.velocity.y = jumpHeight;
                this.isGrounded = false;
                this.jumpConsumed = true;
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
                if (hasInput) {
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

        // === LEDGE GRAB ===
        const ledgeEnabled = mv.get('sv_ledgegrab') > 0;
        if (ledgeEnabled) {
            this.updateLedgeGrab(deltaTime, mv, cm, input);
        }

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
            slideCameraPitch: this.isSliding ? this.slideCameraPitch : mouseRotationX
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
            return;
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
        const groundCheckStart = this.position.clone();
        const groundCheckEnd = groundCheckStart.add(new Vector3(0, -(wallJumpMinHeight + 1), 0)); // +1 margin
        const groundCheck = backend.trace(groundCheckStart, groundCheckEnd, { radius: 8, height: 16 });

        if (groundCheck.fraction < 1.0) {
            // Hit ground within min height
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

        if (input.up && chargeTimeCvar <= 0) {
            // INSTANT BOUNCE
            this.executeWallJumpPush(wallNormal, mv, true);
            return;
        } else if (input.up && chargeTimeCvar > 0) {
            // START CHARGING
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
    }


    private updateLedgeGrab(_deltaTime: number, _mv: MovementVars, _cm: CollisionManager, _input: PlayerInput) {
        // Placeholder
    }

    private updateCrouchslide(deltaTime: number, mv: MovementVars, input: PlayerInput, mouseRotationX: number) {
        const slideEnabled = mv.get('sv_slide') > 0;
        if (!slideEnabled) {
            if (this.isSliding) this.exitSlide();
            return;
        }

        const now = Date.now();
        const horizSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);

        // Slide Entry
        if (!this.isSliding && input.crouch && this.isGrounded) {
            const slideMinSpeed = mv.get('sv_slideMinSpeed');
            const slideCooldown = mv.get('sv_slideCooldown');
            const slideSpeedMult = mv.get('sv_slideSpeedMultiplier');

            const cooldownPassed = (now - this.lastSlideEndTime) >= slideCooldown;
            if (horizSpeed >= slideMinSpeed && cooldownPassed) {
                this.isSliding = true;
                this.slideStartTime = now;

                this.slideVelocity = this.velocity.clone();
                this.slideVelocity.y = 0;
                this.slideVelocity.normalize();

                this.slideEntrySpeed = horizSpeed * slideSpeedMult;
                this.slideEntryPitch = mouseRotationX;

                this.velocity.x = this.slideVelocity.x * this.slideEntrySpeed;
                this.velocity.z = this.slideVelocity.z * this.slideEntrySpeed;
            }
        }

        // Slide Physics
        if (this.isSliding) {
            const slideDuration = mv.get('sv_slideDuration');
            const slideElapsed = now - this.slideStartTime;

            // Tilt Logic
            let tiltIntensity: number;
            const fadeIn = AdvancedCharacterController.SLIDE_FADE_MS;
            const fadeOut = AdvancedCharacterController.SLIDE_FADE_MS;
            const timeRemaining = slideDuration - slideElapsed;

            if (slideElapsed < fadeIn) {
                const t = slideElapsed / fadeIn;
                tiltIntensity = t * t * (3 - 2 * t);
            } else if (timeRemaining < fadeOut) {
                const t = timeRemaining / fadeOut;
                tiltIntensity = t * t * (3 - 2 * t);
            } else {
                tiltIntensity = 1;
            }

            const targetPitch = this.slideEntryPitch + (AdvancedCharacterController.SLIDE_PITCH_TILT * tiltIntensity);
            this.slideCameraPitch = targetPitch;

            // Friction / Decay
            let currentSlideSpeed: number;
            if (slideElapsed < AdvancedCharacterController.SLIDE_JUMP_GRACE_MS) {
                currentSlideSpeed = this.slideEntrySpeed;
            } else {
                const decayElapsed = slideElapsed - AdvancedCharacterController.SLIDE_JUMP_GRACE_MS;
                const decayDuration = slideDuration - AdvancedCharacterController.SLIDE_JUMP_GRACE_MS;
                const decayProgress = Math.min(1, decayElapsed / decayDuration);

                const crouchSpeed = mv.get('sv_movementSpeed') * mv.get('cl_crouchmult');
                currentSlideSpeed = this.slideEntrySpeed + (crouchSpeed - this.slideEntrySpeed) * decayProgress;
            }

            this.velocity.x = this.slideVelocity.x * currentSlideSpeed;
            this.velocity.z = this.slideVelocity.z * currentSlideSpeed;

            // Exit Conditions
            if (slideElapsed >= slideDuration || !input.crouch) {
                this.exitSlide();
                return;
            }

            // Jump Boost
            if (input.up && slideElapsed >= AdvancedCharacterController.SLIDE_JUMP_GRACE_MS) {
                this.slideJumpHoldTime += deltaTime;
                if (this.slideJumpHoldTime >= 0.2) {
                    const slideJumpBoost = mv.get('sv_slideJumpBoost');
                    this.velocity.x *= slideJumpBoost;
                    this.velocity.z *= slideJumpBoost;
                    this.velocity.y = mv.get('sv_jumpheight');
                    this.isGrounded = false;
                    this.exitSlide();
                    return;
                }
            } else if (!input.up) {
                this.slideJumpHoldTime = 0;
            }
        }
    }

    private exitSlide() {
        this.isSliding = false;
        this.lastSlideEndTime = Date.now();
        // Restore view? Controller handles setting rotation back to mouseRotationX implicitly when isSliding is false
    }
}
