/**
 * ProgressMeter — shared hold-to-act progress that decays when unattended.
 *
 * The decay is the point. An earlier version of this module reset progress to
 * zero on interruption; Warsow's bomb gametype winds it back down instead, so a
 * defuse broken at 90% is worth returning to. These tests pin that behaviour
 * rather than the one that felt obvious.
 */

import { describe, expect, it } from "vitest";
import { ProgressMeter } from "../ChannelledAction";

/** Advance `ticks` times with a fixed working flag; returns the last outcome. */
function run(meter: ProgressMeter, working: boolean, ticks: number) {
  let out = meter.advance(working);
  for (let i = 1; i < ticks; i++) out = meter.advance(working);
  return out;
}

describe("filling", () => {
  it("advances while somebody is working and completes on the last tick", () => {
    const m = new ProgressMeter(5);
    expect(m.advance(true)).toBe("advancing");
    expect(m.advance(true)).toBe("advancing");
    expect(m.advance(true)).toBe("advancing");
    expect(m.advance(true)).toBe("advancing");
    expect(m.advance(true)).toBe("completed");
  });

  it("resets after completing, so it fires exactly once", () => {
    const m = new ProgressMeter(3);
    run(m, true, 3);
    expect(m.progress).toBe(0);
    expect(m.advance(true)).toBe("advancing");
  });

  it("is idle when nothing is happening and nothing has been done", () => {
    expect(new ProgressMeter(5).advance(false)).toBe("idle");
  });

  it("reports progress as a 0..1 fraction", () => {
    const m = new ProgressMeter(4);
    m.advance(true);
    expect(m.progress).toBeCloseTo(0.25, 5);
    m.advance(true);
    expect(m.progress).toBeCloseTo(0.5, 5);
  });
});

describe("decay", () => {
  it("winds back down instead of resetting when the area empties", () => {
    // The behavioural difference that matters: a broken defuse is worth
    // returning to, and the falling bar tells the defender how long they have.
    const m = new ProgressMeter(10);
    run(m, true, 8);
    expect(m.progress).toBeCloseTo(0.8, 5);

    expect(m.advance(false)).toBe("decaying");
    expect(m.progress).toBeCloseTo(0.7, 5);
    expect(m.progress).toBeGreaterThan(0);
  });

  it("resumes from where the decay left it", () => {
    const m = new ProgressMeter(10);
    run(m, true, 6);
    run(m, false, 2); // bleeds to 0.4
    expect(m.progress).toBeCloseTo(0.4, 5);
    m.advance(true);
    expect(m.progress).toBeCloseTo(0.5, 5);
  });

  it("bottoms out at zero and stays idle", () => {
    const m = new ProgressMeter(4);
    run(m, true, 2);
    expect(run(m, false, 2)).toBe("decaying");
    expect(m.progress).toBe(0);
    expect(m.advance(false)).toBe("idle");
  });

  it("exposes direction so the HUD can show the bar falling", () => {
    const m = new ProgressMeter(5);
    m.advance(true);
    expect(m.advancing).toBe(true);
    m.advance(false);
    expect(m.advancing).toBe(false);
  });

  it("is active whenever progress is non-zero", () => {
    const m = new ProgressMeter(5);
    expect(m.active).toBe(false);
    m.advance(true);
    expect(m.active).toBe(true);
  });
});

describe("configuration", () => {
  it("can change duration mid-fill without discarding work", () => {
    const m = new ProgressMeter(4);
    run(m, true, 2);
    m.setDuration(10);
    expect(m.progress).toBeCloseTo(0.2, 5);
  });

  it("never accepts a duration below one tick", () => {
    const m = new ProgressMeter(0);
    expect(m.advance(true)).toBe("completed");
  });

  it("resets fully on demand, for round ends", () => {
    const m = new ProgressMeter(10);
    run(m, true, 5);
    m.reset();
    expect(m.progress).toBe(0);
    expect(m.advancing).toBe(false);
  });
});
