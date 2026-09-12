/**
 * Stowing the viewmodel for a both-hands movement state.
 *
 * The interesting behaviour is not the slide itself but its edges: the mesh
 * must not be disabled before the animation has played, and reversing halfway
 * has to continue from where the weapon actually is.
 */

import { describe, expect, it } from "vitest";
import { WeaponHolsterAnim } from "../weapon/WeaponHolsterAnim";

/** Advance in small steps, as the render loop does. */
function run(anim: WeaponHolsterAnim, seconds: number, step = 1 / 120): void {
  for (let t = 0; t < seconds; t += step) anim.update(step);
}

describe("WeaponHolsterAnim", () => {
  it("starts raised and out of the way", () => {
    const anim = new WeaponHolsterAnim();

    expect(anim.getOffsets()).toEqual({ yOffset: 0, roll: 0, xOffset: 0, zOffset: 0 });
    expect(anim.isFullyHolstered).toBe(false);
    expect(anim.isActive).toBe(false);
  });

  it("does not disable the mesh until the weapon has finished travelling", () => {
    const anim = new WeaponHolsterAnim();

    anim.setHolstered(true);
    // Requested, but nothing has moved yet: disabling here would skip the slide.
    expect(anim.isFullyHolstered).toBe(false);

    run(anim, 0.05);
    expect(anim.isFullyHolstered).toBe(false);
    expect(anim.getOffsets().yOffset).toBeLessThan(0);

    run(anim, 0.3);
    expect(anim.isFullyHolstered).toBe(true);
  });

  it("comes back up and settles exactly at rest", () => {
    const anim = new WeaponHolsterAnim();

    anim.setHolstered(true);
    run(anim, 0.4);
    anim.setHolstered(false);
    run(anim, 0.4);

    expect(anim.isFullyHolstered).toBe(false);
    expect(anim.isActive).toBe(false);
    expect(anim.getOffsets().yOffset).toBe(0);
    expect(anim.getOffsets().roll).toBe(0);
  });

  it("reverses from where the weapon is, not from the bottom", () => {
    const anim = new WeaponHolsterAnim();

    anim.setHolstered(true);
    run(anim, 0.06); // part way down
    const midDrop = anim.getOffsets().yOffset;
    expect(midDrop).toBeLessThan(0);

    // Letting go of the ladder here must raise from this height. A phase-based
    // animation would snap to the bottom first and read as a stutter.
    anim.setHolstered(false);
    anim.update(1 / 120);
    expect(anim.getOffsets().yOffset).toBeGreaterThan(midDrop);
  });

  it("stays stowed for as long as the state lasts", () => {
    const anim = new WeaponHolsterAnim();

    anim.setHolstered(true);
    run(anim, 10);

    // A climb is unbounded; the weapon must not drift back up on its own.
    expect(anim.isFullyHolstered).toBe(true);
    expect(anim.getOffsets().yOffset).toBeLessThan(-80);
  });

  it("reset drops any in-flight slide", () => {
    const anim = new WeaponHolsterAnim();

    anim.setHolstered(true);
    run(anim, 0.4);
    anim.reset();

    expect(anim.isActive).toBe(false);
    expect(anim.isFullyHolstered).toBe(false);
    expect(anim.getOffsets().yOffset).toBe(0);
  });
});
