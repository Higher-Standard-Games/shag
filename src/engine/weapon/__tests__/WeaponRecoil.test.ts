/**
 * View model recoil: a snap back on each shot and a return to rest before the
 * next, so an automatic weapon pulses with its fire rate. It used to ease in
 * over about a quarter of a second, longer than the machinegun's 0.1 s between
 * shots, so the gun crept back and stayed there, covering the sights.
 */

import { describe, expect, it } from "vitest";
import { WeaponRecoil } from "../WeaponRecoil";

const FRAME = 1 / 144;

function run(recoil: WeaponRecoil, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += FRAME) recoil.update(FRAME);
}

describe("weapon recoil", () => {
  it("reaches its full kick within a few frames", () => {
    const recoil = new WeaponRecoil();
    recoil.fire(1, 0, undefined, 0.104);
    let peak = 0;
    for (let t = 0; t < 0.03; t += FRAME) {
      recoil.update(FRAME);
      peak = Math.max(peak, recoil.offset);
    }
    expect(peak).toBeCloseTo(1.5, 5);
  });

  it("is back at rest before the next shot of a fast-firing weapon", () => {
    const recoil = new WeaponRecoil();
    recoil.fire(1.6, 0, undefined, 0.104);
    run(recoil, 0.1);
    expect(recoil.offset).toBe(0);
    expect(recoil.pitchOffset).toBe(0);
  });

  it("does not creep back under sustained fire", () => {
    const recoil = new WeaponRecoil();
    let peak = 0;
    for (let shot = 0; shot < 30; shot++) {
      recoil.fire(1.6, 0, undefined, 0.104);
      for (let t = 0; t < 0.104; t += FRAME) {
        recoil.update(FRAME);
        peak = Math.max(peak, recoil.offset);
      }
    }
    expect(peak).toBeLessThanOrEqual(1.5 * 1.6 + 1e-9);
    expect(recoil.offset).toBe(0);
  });

  it("keeps a slow weapon's long return", () => {
    const recoil = new WeaponRecoil();
    recoil.fire(4, 0, undefined, 1.0);
    run(recoil, 0.3);
    expect(recoil.offset).toBeGreaterThan(0);
  });

  it("aimed, punches back by the weapon's ADS factor but keeps the barrel's rise at a fifth", () => {
    const hip = new WeaponRecoil();
    hip.fire(1.6, 0, 0.5, 0.104);
    run(hip, 0.03);
    const aimed = new WeaponRecoil();
    aimed.fire(1.6, 1, 0.5, 0.104);
    run(aimed, 0.03);
    expect(aimed.offset / hip.offset).toBeCloseTo(0.5, 5);
    expect(aimed.pitchOffset / hip.pitchOffset).toBeCloseTo(0.2, 5);
  });
});
