/**
 * cl_fov is quoted in the units players know — horizontal degrees at 16:9 —
 * while Babylon's camera wants vertical radians. Getting that conversion wrong
 * is invisible in code review and obvious the moment someone plays, so it is
 * pinned here rather than trusted.
 */

import { describe, expect, it } from "vitest";
import { currentBaseFov, horizontalFovToVerticalRadians, verticalRadiansToHorizontalFov } from "../camera/FovSettings";

const RAD = (deg: number) => (deg * Math.PI) / 180;

describe("field of view conversion", () => {
  it("round-trips every value a player can pick", () => {
    for (let deg = 80; deg <= 110; deg++) {
      expect(verticalRadiansToHorizontalFov(horizontalFovToVerticalRadians(deg))).toBeCloseTo(deg, 6);
    }
  });

  it("puts 90 horizontal at the vertical angle 16:9 implies", () => {
    // tan(45°) / (16/9) = 0.5625 → 2·atan(0.5625) ≈ 1.0247 rad ≈ 58.7° vertical.
    const vertical = horizontalFovToVerticalRadians(90);
    expect(vertical).toBeCloseTo(2 * Math.atan(Math.tan(RAD(45)) / (16 / 9)), 9);
    expect((vertical * 180) / Math.PI).toBeCloseTo(58.72, 1);
  });

  it("lands the default close to the FOV the camera already used", () => {
    // The old hardcoded base was 1.0 rad vertical, about 88.3° horizontal at
    // 16:9. Defaulting cl_fov to 90 must be a nudge, not a new look.
    expect(verticalRadiansToHorizontalFov(1.0)).toBeCloseTo(88.3, 1);
    expect(currentBaseFov()).toBeCloseTo(horizontalFovToVerticalRadians(90), 9);
    expect(Math.abs(currentBaseFov() - 1.0)).toBeLessThan(0.03);
  });

  it("widens monotonically, and never inverts", () => {
    let previous = 0;
    for (let deg = 80; deg <= 110; deg++) {
      const vertical = horizontalFovToVerticalRadians(deg);
      expect(vertical).toBeGreaterThan(previous);
      previous = vertical;
    }
    // A sane vertical angle at both ends — nothing degenerate or reflex.
    expect(horizontalFovToVerticalRadians(80)).toBeGreaterThan(RAD(40));
    expect(horizontalFovToVerticalRadians(110)).toBeLessThan(RAD(90));
  });
});
