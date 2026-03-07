/**
 * WeaponBob — Walk bob, sprint tilt, jump/land bob for first-person weapons.
 *
 * Extracted from WeaponViewManager to keep bob logic self-contained.
 * Manages:
 *   - Walk bob (sinusoidal X/Y sway synced to view-bob cycle)
 *   - Sprint tilt/roll/yaw (speed-based weapon lowering)
 *   - Jump/land bob (time-triggered animation on ground transitions)
 *
 * WeaponViewManager calls `update()` each frame and reads the resulting offsets
 * to compose the final weapon position together with ADS, recoil, charge, etc.
 */

import { MovementVars } from '../movement/MovementVars';

// ── Constants ───────────────────────────────────────────────────────

const BOB_LERP_SPEED = 8.0;           // Smooth bob transitions
const JUMP_LAND_LERP = 12.0;          // How fast to reach target
const JUMP_LAND_RECOVER = 4.0;        // How fast to recover to 0
const JUMP_LAND_COOLDOWN = 0.15;      // Minimum seconds between triggers

// Sprint speed thresholds (Quake units/s)
const BASE_SPEED = 320;
const SPRINT_SPEED = 420;             // 100% sprint tilt point
const MAX_EXTRA_SPEED = 800;          // 120% cap

// ── Public state read by WeaponViewManager ──────────────────────────

export interface BobState {
    /** Horizontal walk bob (left/right sway) */
    bobX: number;
    /** Vertical walk bob (up/down sway) */
    bobY: number;
    /** Sprint pitch tilt (degrees, negative = tilted up) */
    sprintTilt: number;
    /** Sprint roll (degrees, positive = rolled right) */
    sprintRoll: number;
    /** Sprint yaw — barrel toward chest (degrees) */
    sprintYaw: number;
    /** Jump/land vertical bob offset */
    jumpLandBob: number;
}

// ── Class ───────────────────────────────────────────────────────────

export class WeaponBob {
    // Walk bob (smoothed)
    private currentBobX = 0;
    private currentBobY = 0;

    // Sprint tilt (smoothed)
    private currentSprintTilt = 0;
    private currentSprintRoll = 0;
    private currentSprintYaw = 0;

    // Jump/land bob (triggered animation)
    private jumpLandTarget = 0;
    private jumpLandCurrent = 0;
    private jumpLandCooldown = 0;
    private wasGrounded = true;

    // ── API ──────────────────────────────────────────────────────────

    /**
     * Update bob state for the current frame.
     *
     * @param deltaTime   Frame delta (seconds)
     * @param isGrounded  Is the player on the ground?
     * @param hSpeed      Horizontal speed (Quake units/s)
     * @param velocityY   Vertical velocity (positive = upward)
     * @param landingVelocity  Vertical speed at time of last landing
     * @param bobCycle    Shared bob cycle from ViewportEffectsManager (radians)
     * @param isReloading Whether a reload is in progress (suppresses bob)
     * @param adsProgress ADS interpolation (0 = hip, 1 = full ADS)
     * @param handOffsetX Sign-carrying base X offset (positive = right hand)
     */
    update(
        deltaTime: number,
        isGrounded: boolean,
        hSpeed: number,
        velocityY: number,
        landingVelocity: number,
        bobCycle: number,
        isReloading: boolean,
        adsProgress: number,
        handOffsetX: number,
    ): void {
        const mv = MovementVars.getInstance();
        const bobEnabled = mv.get('cl_gunbob') > 0;

        const amplitude = mv.get('cl_gunbob_amplitude');
        const speedMult = mv.get('cl_gunbob_speed');
        const sprintTiltCvar = mv.get('cl_gunbob_sprint_tilt');
        const sprintInward = mv.get('cl_gunbob_sprint_inward');

        const cycle = bobCycle * speedMult;
        const speedFactor = Math.min(hSpeed / 320, 2.0);

        // ── Walk bob (grounded only) ────────────────────────────────
        let targetBobX = 0;
        let targetBobY = 0;
        let targetTilt = 0;
        let targetRoll = 0;
        let targetInward = 0;

        if (bobEnabled && isGrounded && hSpeed > 10) {
            targetBobY = Math.sin(cycle * 2) * amplitude * speedFactor;
            targetBobX = Math.sin(cycle) * amplitude * 0.5 * speedFactor;
        }

        // ── Sprint tilt (speed-based, NOT grounded check) ───────────
        // Two-phase scaling:
        //   Phase 1: 320-420 → 0%..100%
        //   Phase 2: 420+   → 100%..120% (capped)
        let sprintRatio: number;
        if (hSpeed <= SPRINT_SPEED) {
            sprintRatio = Math.max(0, (hSpeed - BASE_SPEED) / (SPRINT_SPEED - BASE_SPEED));
        } else {
            const extra = (hSpeed - SPRINT_SPEED) / (MAX_EXTRA_SPEED - SPRINT_SPEED);
            sprintRatio = 1.0 + Math.min(0.2, extra * 0.2);
        }

        if (bobEnabled && hSpeed > BASE_SPEED * 0.8) {
            targetTilt = -sprintTiltCvar * sprintRatio;
            targetRoll = sprintTiltCvar * 1.5 * sprintRatio;
            const handSign = handOffsetX > 0 ? -1 : 1;
            targetInward = handSign * sprintInward * sprintRatio;
        }

        // ── Dampen during reload ────────────────────────────────────
        if (isReloading) {
            targetBobX = 0;
            targetBobY = 0;
            targetTilt = 0;
            targetRoll = 0;
            targetInward = 0;
        }

        // ── Dampen when ADS (stable aim) ────────────────────────────
        const adsDamp = 1.0 - adsProgress * 0.85;
        targetBobX *= adsDamp;
        targetBobY *= adsDamp;
        targetTilt *= adsDamp;
        targetRoll *= adsDamp;
        targetInward *= adsDamp;

        // ── Smooth lerp to targets ──────────────────────────────────
        const lf = Math.min(1.0, deltaTime * BOB_LERP_SPEED);
        this.currentBobX += (targetBobX - this.currentBobX) * lf;
        this.currentBobY += (targetBobY - this.currentBobY) * lf;
        this.currentSprintTilt += (targetTilt - this.currentSprintTilt) * lf;
        this.currentSprintRoll += (targetRoll - this.currentSprintRoll) * lf;
        this.currentSprintYaw += (targetInward - this.currentSprintYaw) * lf;

        // ── Jump / land bob ─────────────────────────────────────────
        const jumpBobIntensity = mv.get('cl_gunbob_jump');
        const landBobIntensity = mv.get('cl_gunbob_land');

        if (this.jumpLandCooldown > 0) {
            this.jumpLandCooldown -= deltaTime;
        }

        // Detect jump (leaving ground)
        if (this.jumpLandCooldown <= 0 && this.wasGrounded && !isGrounded && velocityY > 50) {
            this.jumpLandTarget = -jumpBobIntensity;
            this.jumpLandCooldown = JUMP_LAND_COOLDOWN;
        }

        // Detect landing (hitting ground)
        if (this.jumpLandCooldown <= 0 && !this.wasGrounded && isGrounded) {
            const impact = Math.min(1.0, Math.abs(landingVelocity) / 500);
            this.jumpLandTarget = -landBobIntensity * (0.5 + impact * 0.5);
            this.jumpLandCooldown = JUMP_LAND_COOLDOWN;
        }

        // Smoothly reach target then recover
        const jlf = Math.min(1.0, deltaTime * JUMP_LAND_LERP);
        this.jumpLandCurrent += (this.jumpLandTarget - this.jumpLandCurrent) * jlf;

        const rf = Math.min(1.0, deltaTime * JUMP_LAND_RECOVER);
        this.jumpLandTarget *= (1.0 - rf);

        this.wasGrounded = isGrounded;
    }

    /** Current smoothed bob state (read after calling update). */
    get state(): BobState {
        return {
            bobX: this.currentBobX,
            bobY: this.currentBobY,
            sprintTilt: this.currentSprintTilt,
            sprintRoll: this.currentSprintRoll,
            sprintYaw: this.currentSprintYaw,
            jumpLandBob: this.jumpLandCurrent,
        };
    }

    /** Reset all bob state (e.g. on weapon switch). */
    reset(): void {
        this.currentBobX = 0;
        this.currentBobY = 0;
        this.currentSprintTilt = 0;
        this.currentSprintRoll = 0;
        this.currentSprintYaw = 0;
        this.jumpLandTarget = 0;
        this.jumpLandCurrent = 0;
        this.jumpLandCooldown = 0;
        this.wasGrounded = true;
    }
}
