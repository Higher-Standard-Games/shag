/**
 * The view kick of our own shots: up on each shot, settling back, and capped so
 * a held trigger shakes the view rather than walking it up the wall.
 */

import { describe, expect, it } from "vitest";
import { ViewKick } from "../controllers/ViewKick";

const DEG = Math.PI / 180;

describe("view kick", () => {
  it("kicks the view up (negative pitch) and sideways by the given degrees", () => {
    const kick = new ViewKick();
    kick.kick(0.4, -0.1, 0.14);
    expect(kick.pitch).toBeCloseTo(-0.4 * DEG, 9);
    expect(kick.yaw).toBeCloseTo(-0.1 * DEG, 9);
  });

  it("is all but gone after its recovery time, and exactly zero soon after", () => {
    const kick = new ViewKick();
    kick.kick(0.4, 0.1, 0.14);
    for (let t = 0; t < 0.14; t += 1 / 144) kick.settle(1 / 144);
    expect(Math.abs(kick.pitch)).toBeLessThan(0.4 * DEG * 0.03);
    for (let t = 0; t < 0.3; t += 1 / 144) kick.settle(1 / 144);
    expect(kick.pitch).toBe(0);
    expect(kick.yaw).toBe(0);
  });

  it("stacks under fast fire but never past its cap", () => {
    const kick = new ViewKick();
    for (let shot = 0; shot < 50; shot++) kick.kick(0.4, 0, 0.14);
    expect(kick.pitch).toBeCloseTo(-1.0 * DEG, 9);
  });
});
