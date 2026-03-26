/**
 * SmoothCorrection — Prediction error correction tests
 *
 * Verifies exponential decay curve, epsilon zeroing, accumulation,
 * side-effect-free getCorrection(), and reset behavior.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { SmoothCorrection } from "../network/client/SmoothCorrection";

describe("SmoothCorrection", () => {
  let correction: SmoothCorrection;

  beforeEach(() => {
    correction = new SmoothCorrection();
  });

  describe("Initial state", () => {
    it("should have no correction initially", () => {
      expect(correction.hasCorrection()).toBe(false);
    });

    it("should return zero correction initially", () => {
      const c = correction.getCorrection();
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
      expect(c.z).toBe(0);
    });
  });

  describe("addCorrection", () => {
    it("should store correction and report hasCorrection", () => {
      correction.addCorrection(10, 0, 0);
      expect(correction.hasCorrection()).toBe(true);
    });

    it("should accumulate multiple corrections", () => {
      correction.addCorrection(5, 0, 0);
      correction.addCorrection(5, 0, 0);
      // Internal stored = 10. getCorrection returns 10% = 1.0
      const c = correction.getCorrection();
      expect(c.x).toBeCloseTo(1.0);
    });

    it("should handle all three axes", () => {
      correction.addCorrection(10, 20, 30);
      const c = correction.getCorrection();
      expect(c.x).toBeCloseTo(1.0);  // 10 * 0.1
      expect(c.y).toBeCloseTo(2.0);  // 20 * 0.1
      expect(c.z).toBeCloseTo(3.0);  // 30 * 0.1
    });
  });

  describe("getCorrection (side-effect-free)", () => {
    it("should return same value when called twice without decay", () => {
      correction.addCorrection(10, 20, 30);
      const c1 = correction.getCorrection();
      const c2 = correction.getCorrection();
      expect(c1.x).toBe(c2.x);
      expect(c1.y).toBe(c2.y);
      expect(c1.z).toBe(c2.z);
    });
  });

  describe("applyDecay", () => {
    it("should reduce stored correction by 10% per call", () => {
      correction.addCorrection(100, 0, 0);

      // Before decay: getCorrection = 100 * 0.1 = 10
      expect(correction.getCorrection().x).toBeCloseTo(10);

      correction.applyDecay();
      // After 1 decay: stored = 100 * 0.9 = 90. getCorrection = 90 * 0.1 = 9
      expect(correction.getCorrection().x).toBeCloseTo(9);

      correction.applyDecay();
      // After 2 decays: stored = 90 * 0.9 = 81. getCorrection = 81 * 0.1 = 8.1
      expect(correction.getCorrection().x).toBeCloseTo(8.1);
    });

    it("should converge toward zero after many decays", () => {
      correction.addCorrection(100, 100, 100);

      // Apply 200 decays — should be essentially zero
      // 100 * 0.9^200 ≈ 7e-8, well below epsilon 0.01
      for (let i = 0; i < 200; i++) {
        correction.applyDecay();
      }

      expect(correction.hasCorrection()).toBe(false);
      const c = correction.getCorrection();
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
      expect(c.z).toBe(0);
    });

    it("should zero out values below epsilon (0.01)", () => {
      correction.addCorrection(0.005, 0, 0);
      correction.applyDecay();
      // 0.005 * 0.9 = 0.0045, which is < 0.01, so it should be zeroed
      expect(correction.hasCorrection()).toBe(false);
    });
  });

  describe("Decay curve verification", () => {
    it("should retain ~35% after 10 decays", () => {
      correction.addCorrection(100, 0, 0);
      for (let i = 0; i < 10; i++) {
        correction.applyDecay();
      }
      // 100 * 0.9^10 ≈ 34.87
      const c = correction.getCorrection();
      expect(c.x).toBeCloseTo(100 * Math.pow(0.9, 10) * 0.1, 0);
    });

    it("should retain ~12% after 20 decays", () => {
      correction.addCorrection(100, 0, 0);
      for (let i = 0; i < 20; i++) {
        correction.applyDecay();
      }
      // 100 * 0.9^20 ≈ 12.16
      const c = correction.getCorrection();
      expect(c.x).toBeCloseTo(100 * Math.pow(0.9, 20) * 0.1, 0);
    });
  });

  describe("reset", () => {
    it("should clear all corrections", () => {
      correction.addCorrection(100, 200, 300);
      expect(correction.hasCorrection()).toBe(true);

      correction.reset();
      expect(correction.hasCorrection()).toBe(false);

      const c = correction.getCorrection();
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
      expect(c.z).toBe(0);
    });
  });

  describe("Negative corrections", () => {
    it("should handle negative values correctly", () => {
      correction.addCorrection(-50, -100, -150);
      const c = correction.getCorrection();
      expect(c.x).toBeCloseTo(-5);
      expect(c.y).toBeCloseTo(-10);
      expect(c.z).toBeCloseTo(-15);
    });
  });
});
