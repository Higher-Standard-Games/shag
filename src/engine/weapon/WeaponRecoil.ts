/**
 * WeaponRecoil — Weapon kick/recovery animation system.
 *
 * Extracted from WeaponViewManager's updateMuzzleFlash method.
 *
 * Manages:
 *   - Backward kick (recoilOffset) — pushes weapon away from camera
 *   - Upward pitch kick (recoilPitchOffset) — rotates weapon barrel up
 *   - A snap to the kick, then a straight return to rest
 *   - ADS multiplier (steadier aim when scoped)
 *
 * The kick follows the weapon's fire rate: it snaps in within a few frames and
 * is back at rest before the next shot, so an automatic weapon's view model
 * pulses with every round instead of drifting back and staying there.
 *
 * WeaponViewManager reads recoilOffset & recoilPitchOffset each frame
 * to compose the final weapon position/rotation.
 */

// ── Constants ───────────────────────────────────────────────────────

const RECOIL_KICK = 1.5; // Max backward distance per 1.0 recoilScale
const RECOIL_PITCH_KICK = 0.12; // Max upward pitch (radians, ~7°)
const RECOIL_ATTACK = 0.03; // Seconds to reach the kick (shorter for fast-firing weapons)
const RECOIL_RECOVER = 8.0; // Backward recovery speed for slow-firing weapons (units/s)
const RECOIL_PITCH_RECOVER = 0.6; // Pitch recovery speed for slow-firing weapons (radians/s)
const RECOIL_ADS_MULT = 0.2; // ADS reduces recoil to 20% unless the weapon says otherwise
/** Share of the refire interval the kick and return may take, so each shot starts from rest. */
const RECOIL_REFIRE_SHARE = 0.85;

// ── Class ───────────────────────────────────────────────────────────

export class WeaponRecoil {
  // Current offsets (read by WeaponViewManager)
  offset = 0; // Backward kick
  pitchOffset = 0; // Upward pitch kick

  // The kick in progress: from where it started to its peak, over `attack` seconds
  private attack = 0;
  private attackElapsed = 0;
  private startOffset = 0;
  private startPitch = 0;
  private target = 0;
  private pitchTarget = 0;
  // Return speeds for this shot
  private recoverSpeed = RECOIL_RECOVER;
  private pitchRecoverSpeed = RECOIL_PITCH_RECOVER;

  /**
   * Trigger a recoil kick.
   *
   * Aimed, the backward punch follows the weapon's `adsRecoilScale`, but the
   * barrel's rise keeps to 20%: a heavy gun may punch back hard down the sights,
   * and the sights stay where they point.
   *
   * @param recoilScale     Weapon-specific multiplier (default 1.0)
   * @param adsProgress     0 = hip, 1 = fully ADS
   * @param adsRecoilScale  Backward punch when fully aimed, as a fraction of hip (default 0.2)
   * @param refireSeconds   Time to the next shot; the kick is done and back at rest within it
   */
  fire(recoilScale: number, adsProgress: number, adsRecoilScale = RECOIL_ADS_MULT, refireSeconds?: number): void {
    const backMult = 1.0 - adsProgress * (1.0 - adsRecoilScale);
    const pitchMult = 1.0 - adsProgress * (1.0 - RECOIL_ADS_MULT);
    this.target = RECOIL_KICK * recoilScale * backMult;
    this.pitchTarget = RECOIL_PITCH_KICK * recoilScale * pitchMult;

    const window = refireSeconds !== undefined && refireSeconds > 0 ? refireSeconds * RECOIL_REFIRE_SHARE : Infinity;
    this.attack = Math.min(RECOIL_ATTACK, window * 0.3);
    this.attackElapsed = 0;
    this.startOffset = this.offset;
    this.startPitch = this.pitchOffset;
    if (this.attack <= 0) {
      this.offset = this.target;
      this.pitchOffset = this.pitchTarget;
    }

    // Return at the slow default, or faster when the next shot comes sooner.
    const returnTime = window - this.attack;
    this.recoverSpeed = Math.max(RECOIL_RECOVER, this.target / Math.max(0.01, returnTime));
    this.pitchRecoverSpeed = Math.max(RECOIL_PITCH_RECOVER, this.pitchTarget / Math.max(0.01, returnTime));
  }

  /**
   * Update the kick and the return each frame.
   */
  update(deltaTime: number): void {
    if (this.attackElapsed < this.attack) {
      this.attackElapsed = Math.min(this.attack, this.attackElapsed + deltaTime);
      const t = this.attackElapsed / this.attack;
      this.offset = this.startOffset + (this.target - this.startOffset) * t;
      this.pitchOffset = this.startPitch + (this.pitchTarget - this.startPitch) * t;
      return;
    }
    if (this.offset > 0) this.offset = Math.max(0, this.offset - this.recoverSpeed * deltaTime);
    if (this.pitchOffset > 0) this.pitchOffset = Math.max(0, this.pitchOffset - this.pitchRecoverSpeed * deltaTime);
  }

  /** Reset recoil (e.g. on weapon switch). */
  reset(): void {
    this.offset = 0;
    this.pitchOffset = 0;
    this.target = 0;
    this.pitchTarget = 0;
    this.attack = 0;
    this.attackElapsed = 0;
  }
}
