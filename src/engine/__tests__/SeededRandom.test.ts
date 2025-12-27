import { describe, it, expect } from "vitest";
import { SeededRandom } from "../math/SeededRandom";

describe("SeededRandom", () => {
  describe("determinism", () => {
    it("should produce same sequence for same seed", () => {
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(12345);

      for (let i = 0; i < 10; i++) {
        expect(rng1.next()).toBe(rng2.next());
      }
    });

    it("should produce different sequences for different seeds", () => {
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(54321);

      const seq1 = [rng1.next(), rng1.next(), rng1.next()];
      const seq2 = [rng2.next(), rng2.next(), rng2.next()];

      expect(seq1).not.toEqual(seq2);
    });
  });

  describe("next", () => {
    it("should return values in range [0, 1)", () => {
      const rng = new SeededRandom(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.next();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });
  });

  describe("int", () => {
    it("should return integers in specified range (inclusive)", () => {
      const rng = new SeededRandom(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.int(5, 10);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(10);
        expect(Number.isInteger(val)).toBe(true);
      }
    });

    it("should return min when min equals max", () => {
      const rng = new SeededRandom(42);
      expect(rng.int(7, 7)).toBe(7);
    });
  });

  describe("float", () => {
    it("should return floats in specified range", () => {
      const rng = new SeededRandom(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.float(2.5, 7.5);
        expect(val).toBeGreaterThanOrEqual(2.5);
        expect(val).toBeLessThanOrEqual(7.5);
      }
    });
  });

  describe("bool", () => {
    it("should return boolean values", () => {
      const rng = new SeededRandom(42);
      for (let i = 0; i < 10; i++) {
        const val = rng.bool();
        expect(typeof val).toBe("boolean");
      }
    });

    it("should respect probability parameter", () => {
      const rng = new SeededRandom(42);
      let trueCount = 0;
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        if (rng.bool(0.8)) trueCount++;
      }

      // With 80% probability, expect roughly 800 trues (allow some variance)
      expect(trueCount).toBeGreaterThan(700);
      expect(trueCount).toBeLessThan(900);
    });
  });

  describe("pick", () => {
    it("should pick element from array", () => {
      const rng = new SeededRandom(42);
      const arr = ["a", "b", "c", "d", "e"];

      for (let i = 0; i < 20; i++) {
        const picked = rng.pick(arr);
        expect(arr).toContain(picked);
      }
    });

    it("should return undefined for empty array", () => {
      const rng = new SeededRandom(42);
      expect(rng.pick([])).toBeUndefined();
    });
  });

  describe("shuffle", () => {
    it("should shuffle array in place", () => {
      const rng = new SeededRandom(42);
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const arr = [...original];

      rng.shuffle(arr);

      // Should contain same elements
      expect(arr.sort((a, b) => a - b)).toEqual(original);
    });

    it("should produce deterministic shuffle for same seed", () => {
      const arr1 = [1, 2, 3, 4, 5];
      const arr2 = [1, 2, 3, 4, 5];

      new SeededRandom(12345).shuffle(arr1);
      new SeededRandom(12345).shuffle(arr2);

      expect(arr1).toEqual(arr2);
    });
  });

  describe("getSeed and setSeed", () => {
    it("should get current seed", () => {
      const rng = new SeededRandom(42);
      rng.next(); // Advance state
      const seed = rng.getSeed();
      expect(typeof seed).toBe("number");
    });

    it("should reset with setSeed", () => {
      const rng = new SeededRandom(42);
      rng.next();
      rng.next();

      rng.setSeed(42);
      const rng2 = new SeededRandom(42);

      expect(rng.next()).toBe(rng2.next());
    });
  });
});
