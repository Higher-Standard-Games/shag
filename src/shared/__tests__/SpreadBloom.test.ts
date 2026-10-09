/**
 * Spread bloom and the look-angle round trip, shared by the server and the client.
 */

import { describe, expect, it } from "vitest";
import {
  bloomIdleSeconds,
  coolSpreadHeat,
  generateSpreadDirections,
  heatAfterShot,
  spreadCone,
  yawPitchFromDirection,
} from "../SpreadUtils";

const weapon = {
  spread: 2,
  adsSpread: 0.5,
  spreadBloom: { maxSpread: 6, adsMaxSpread: 1.5, shotsToMax: 4, recoverySeconds: 0.5 },
};

describe("spread bloom", () => {
  it("opens the cone from the base to the maximum with heat, hip and aimed", () => {
    expect(spreadCone(weapon, 0, false)).toBe(2);
    expect(spreadCone(weapon, 1, false)).toBe(6);
    expect(spreadCone(weapon, 0.5, false)).toBe(4);
    expect(spreadCone(weapon, 0, true)).toBe(0.5);
    expect(spreadCone(weapon, 1, true)).toBe(1.5);
    expect(spreadCone(weapon, 7, false)).toBe(6);
  });

  it("is the plain spread for a weapon without bloom", () => {
    expect(spreadCone({ spread: 8, adsSpread: 2 }, 1, false)).toBe(8);
    expect(spreadCone({ spread: 8, adsSpread: 2 }, 1, true)).toBe(2);
    expect(heatAfterShot({ spread: 8 }, 0)).toBe(0);
  });

  it("heats to full in shotsToMax shots and no further", () => {
    let heat = 0;
    for (let i = 0; i < 4; i++) heat = heatAfterShot(weapon, heat);
    expect(heat).toBe(1);
    expect(heatAfterShot(weapon, heat)).toBe(1);
  });

  it("counts held fire as never idle, so the heat builds; it drains once the shots stop", () => {
    const refire = 0.104;
    expect(bloomIdleSeconds(refire, refire)).toBe(0);
    expect(bloomIdleSeconds(refire * 1.2, refire)).toBe(0);
    expect(bloomIdleSeconds(1, refire)).toBeCloseTo(1 - refire * 1.25, 9);

    expect(coolSpreadHeat(weapon, 1, 0)).toBe(1);
    expect(coolSpreadHeat(weapon, 1, 0.25)).toBeCloseTo(0.5, 9);
    expect(coolSpreadHeat(weapon, 1, 2)).toBe(0);
  });
});

describe("look angles from a direction", () => {
  it("recover the angles generateSpreadDirections was given, so a client rebuilds the same pellets", () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [1.2, -0.4],
      [-2.7, 0.9],
    ]) {
      const p = -pitch;
      const dir = { x: Math.sin(yaw) * Math.cos(p), y: Math.sin(p), z: Math.cos(yaw) * Math.cos(p) };
      const back = yawPitchFromDirection(dir);
      expect(back.yaw).toBeCloseTo(yaw, 9);
      expect(back.pitch).toBeCloseTo(pitch, 9);
      const a = generateSpreadDirections(1234, 6, 8, yaw, pitch);
      const b = generateSpreadDirections(1234, 6, 8, back.yaw, back.pitch);
      for (let i = 0; i < a.length; i++) expect(b[i].x).toBeCloseTo(a[i].x, 9);
    }
  });
});
