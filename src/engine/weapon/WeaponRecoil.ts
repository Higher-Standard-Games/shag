/**
 * WeaponRecoil — Weapon kick/recovery animation system.
 *
 * Extracted from WeaponViewManager's updateMuzzleFlash method.
 *
 * Manages:
 *   - Backward kick (recoilOffset) — pushes weapon away from camera
 *   - Upward pitch kick (recoilPitchOffset) — rotates weapon barrel up
 *   - Smooth ramp toward target on fire, then gradual recovery
 *   - ADS multiplier (steadier aim when scoped)
 *
 * WeaponViewManager reads recoilOffset & recoilPitchOffset each frame
 * to compose the final weapon position/rotation.
 */

// ── Constants ───────────────────────────────────────────────────────

const RECOIL_KICK = 1.5;         // Max backward distance per 1.0 recoilScale
const RECOIL_PITCH_KICK = 0.12;  // Max upward pitch (radians, ~7°)
const RECOIL_RAMP_SPEED = 15.0;  // How fast kick ramps up (higher = snappier)
const RECOIL_RECOVER = 8.0;      // Backward recovery speed
const RECOIL_PITCH_RECOVER = 0.6;// Pitch recovery speed
const RECOIL_ADS_MULT = 0.2;     // ADS reduces recoil to 20%

// ── Class ───────────────────────────────────────────────────────────

export class WeaponRecoil {
    // Current offsets (read by WeaponViewManager)
    offset = 0;        // Backward kick
    pitchOffset = 0;   // Upward pitch kick

    // Targets (set on fire, clear when reached)
    private target = 0;
    private pitchTarget = 0;

    /**
     * Trigger a recoil kick.
     *
     * @param recoilScale  Weapon-specific multiplier (default 1.0)
     * @param adsProgress  0 = hip, 1 = fully ADS (reduces recoil)
     */
    fire(recoilScale: number, adsProgress: number): void {
        const adsMult = 1.0 - adsProgress * (1.0 - RECOIL_ADS_MULT);
        this.target = RECOIL_KICK * recoilScale * adsMult;
        this.pitchTarget = RECOIL_PITCH_KICK * recoilScale * adsMult;
    }

    /**
     * Update recoil ramp + recovery each frame.
     */
    update(deltaTime: number): void {
        if (this.target > 0) {
            // Ramp toward target (smooth kick buildup)
            const rampLerp = Math.min(1.0, deltaTime * RECOIL_RAMP_SPEED);
            this.offset += (this.target - this.offset) * rampLerp;
            this.pitchOffset += (this.pitchTarget - this.pitchOffset) * rampLerp;

            // Once close to target, clear target and begin recovery
            if (Math.abs(this.target - this.offset) < 0.01) {
                this.target = 0;
                this.pitchTarget = 0;
            }
        } else {
            // Recover backward kick
            if (this.offset > 0) {
                this.offset -= RECOIL_RECOVER * deltaTime;
                if (this.offset < 0) this.offset = 0;
            }
            // Recover pitch (slower for weighty feel)
            if (this.pitchOffset > 0) {
                this.pitchOffset -= RECOIL_PITCH_RECOVER * deltaTime;
                if (this.pitchOffset < 0) this.pitchOffset = 0;
            }
        }
    }

    /** Reset recoil (e.g. on weapon switch). */
    reset(): void {
        this.offset = 0;
        this.pitchOffset = 0;
        this.target = 0;
        this.pitchTarget = 0;
    }
}
