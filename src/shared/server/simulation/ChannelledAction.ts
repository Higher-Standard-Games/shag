/**
 * ProgressMeter — shared "hold to act" progress that decays when unattended.
 *
 * Arming and defusing a bomb are the users
 * (docs/research/Search_And_Destroy.md §5.3), but nothing here knows what a
 * bomb is: a meter is a target, a duration, and progress that rises while
 * somebody qualifying is present and falls back when nobody is.
 *
 * ## Why shared-and-decaying rather than per-player-and-reset
 *
 * The first version of this file modelled a channel per PLAYER, discarding all
 * progress on interruption. Warsow's own bomb gametype
 * (`progs/gametypes/bomb/bomb.as`) does neither: one counter lives on the bomb,
 * every qualifying player advances the same counter, and when the area empties
 * it winds back down at the same rate rather than snapping to zero.
 *
 * That is a better game, not just a different implementation:
 *
 *  - A defuse interrupted at 90% bleeds down instead of vanishing, so trading a
 *    kill and stepping back in is a real play rather than a wasted round.
 *  - Progress belongs to the TEAM, so a defender who dies mid-defuse hands the
 *    work to whoever arrives next.
 *  - The decay is legible: the HUD can show the bar falling, which tells a
 *    defender exactly how long they have to get back.
 *
 * Ticks, not seconds: the server runs at a fixed rate and re-simulates for
 * demos, so accumulating float seconds would drift.
 */

export type ProgressOutcome =
  /** No progress and nobody working. */
  | "idle"
  /** Progress rose this tick. */
  | "advancing"
  /** Progress fell this tick because nobody was working. */
  | "decaying"
  /** Reached the duration this tick. Fires exactly once, then resets. */
  | "completed";

export interface ProgressState {
  /** Ticks accumulated, 0..durationTicks. */
  elapsedTicks: number;
  durationTicks: number;
  /** Whether the last tick advanced or decayed — for HUD direction. */
  advancing: boolean;
}

/**
 * One shared progress meter.
 *
 * `advance(working, tick)` is the whole API: pass whether anybody qualifying is
 * present this tick and the meter does the rest. There is no start or cancel to
 * forget, which matters because the interruption conditions for a real objective
 * are numerous — left the radius, died, round ended, bomb taken — and every one
 * of them is just "nobody is working" from here.
 */
export class ProgressMeter {
  private elapsed = 0;
  private lastAdvancing = false;
  private duration: number;

  constructor(durationTicks: number) {
    this.duration = Math.max(1, durationTicks);
  }

  /** Progress fraction 0..1. */
  get progress(): number {
    const p = this.elapsed / this.duration;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  /** True while progress is non-zero — i.e. the bar should be visible. */
  get active(): boolean {
    return this.elapsed > 0;
  }

  /** True if the last tick advanced rather than decayed. */
  get advancing(): boolean {
    return this.lastAdvancing;
  }

  get state(): ProgressState {
    return { elapsedTicks: this.elapsed, durationTicks: this.duration, advancing: this.lastAdvancing };
  }

  /** Change the required duration without discarding work already done. */
  setDuration(durationTicks: number): void {
    this.duration = Math.max(1, durationTicks);
  }

  /** Wind fully back — round end, bomb state change, target destroyed. */
  reset(): void {
    this.elapsed = 0;
    this.lastAdvancing = false;
  }

  /**
   * Advance one tick.
   *
   * @param working true if at least one qualifying actor is present. Numbers do
   *   not stack: five attackers arm no faster than one, which keeps a site from
   *   being taken by weight of bodies alone.
   */
  advance(working: boolean): ProgressOutcome {
    this.lastAdvancing = working;

    if (working) {
      this.elapsed++;
      if (this.elapsed >= this.duration) {
        this.elapsed = 0;
        this.lastAdvancing = false;
        return "completed";
      }
      return "advancing";
    }

    if (this.elapsed <= 0) {
      this.elapsed = 0;
      return "idle";
    }
    this.elapsed--;
    return "decaying";
  }
}
