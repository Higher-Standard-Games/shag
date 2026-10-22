/**
 * WeaponHolsterAnim — slide the viewmodel out of view and back, for movement
 * states that occupy both hands (climbing a ladder).
 *
 * Shares the visual language of {@link WeaponSwitchAnim} — drop and roll, eased
 * — but not its state machine. A switch is a fixed down/load/up round trip; a
 * holster has to stay down for as long as the player is climbing, which is
 * unbounded, and can be reversed halfway through.
 *
 * So this is a single progress value driven toward a target rather than a phase
 * timeline: letting go of a ladder mid-lower raises the weapon from wherever it
 * actually is, instead of snapping to the bottom first. Offsets are additive
 * with the rest of the viewmodel stack.
 */

export interface HolsterAnimOffsets {
  yOffset: number;
  roll: number;
  xOffset: number;
  zOffset: number;
}

/** At rest: one shared, frozen answer instead of a new object every frame. */
const NO_HOLSTER_OFFSETS: Readonly<HolsterAnimOffsets> = Object.freeze({ yOffset: 0, roll: 0, xOffset: 0, zOffset: 0 });

export class WeaponHolsterAnim {
  private static readonly DOWN_DURATION_S = 0.18;
  private static readonly UP_DURATION_S = 0.2;
  /** Deeper than a weapon switch: this has to stay clear of the frame, not just read as a swap. */
  private static readonly Y_DROP = -90;
  private static readonly ROLL = Math.PI / 5;

  /** 0 = fully raised, 1 = fully stowed. */
  private progress = 0;
  private target = 0;

  /** Ask for the weapon to be stowed or brought back up. */
  setHolstered(holstered: boolean): void {
    this.target = holstered ? 1 : 0;
  }

  /** Advance toward the target. `deltaTime` is in seconds. */
  update(deltaTime: number): void {
    if (this.progress === this.target) return;

    const duration = this.target > this.progress ? WeaponHolsterAnim.DOWN_DURATION_S : WeaponHolsterAnim.UP_DURATION_S;
    const step = duration > 0 ? deltaTime / duration : 1;

    this.progress =
      this.target > this.progress
        ? Math.min(this.target, this.progress + step)
        : Math.max(this.target, this.progress - step);
  }

  getOffsets(): Readonly<HolsterAnimOffsets> {
    if (this.progress === 0) return NO_HOLSTER_OFFSETS;

    const eased = 1 - (1 - this.progress) ** 3; // ease-out-cubic, as the switch uses
    return {
      yOffset: eased * WeaponHolsterAnim.Y_DROP,
      roll: eased * WeaponHolsterAnim.ROLL,
      xOffset: 0,
      zOffset: 0,
    };
  }

  /**
   * Fully stowed and settled, so the mesh can stop being drawn.
   *
   * Kept distinct from "holster requested": disabling the mesh the moment the
   * player touches a ladder would skip the very animation this class exists to
   * play.
   */
  get isFullyHolstered(): boolean {
    return this.progress >= 1;
  }

  /** True whenever the weapon is not fully raised — stowed or moving. */
  get isActive(): boolean {
    return this.progress > 0 || this.target > 0;
  }

  reset(): void {
    this.progress = 0;
    this.target = 0;
  }
}
