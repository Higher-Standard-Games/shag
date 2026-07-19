import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import { isVoltaicTruthAligned } from "../HitscanEffects";

function yaw(degrees: number): Vector3 {
  const radians = (degrees * Math.PI) / 180;
  return new Vector3(Math.sin(radians), 0, Math.cos(radians));
}

describe("Voltaic local truth reconciliation", () => {
  it("accepts the canonical server wander envelope", () => {
    expect(isVoltaicTruthAligned(Vector3.Forward(), yaw(4))).toBe(true);
  });

  it("rejects a stale endpoint after a rapid aim change", () => {
    expect(isVoltaicTruthAligned(Vector3.Forward(), yaw(20))).toBe(false);
    expect(isVoltaicTruthAligned(Vector3.Forward(), Vector3.Backward())).toBe(false);
  });

  it("rejects invalid zero directions", () => {
    expect(isVoltaicTruthAligned(Vector3.Zero(), Vector3.Forward())).toBe(false);
  });
});
