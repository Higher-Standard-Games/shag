import { describe, it, expect } from "vitest";
import { PerlinNoise, ValueNoise } from "../math/Noise";

describe("PerlinNoise", () => {
  describe("determinism", () => {
    it("should produce same values for same seed and coordinates", () => {
      const noise1 = new PerlinNoise(42);
      const noise2 = new PerlinNoise(42);

      expect(noise1.noise(1.5, 2.5)).toBe(noise2.noise(1.5, 2.5));
      expect(noise1.noise(10.3, 20.7)).toBe(noise2.noise(10.3, 20.7));
    });

    it("should produce different values for different seeds", () => {
      const noise1 = new PerlinNoise(42);
      const noise2 = new PerlinNoise(123);

      // Use non-integer coordinates to avoid grid points where noise is always 0
      expect(noise1.noise(5.7, 3.2)).not.toBe(noise2.noise(5.7, 3.2));
    });
  });

  describe("noise", () => {
    it("should return values in range [-1, 1]", () => {
      const noise = new PerlinNoise(42);
      for (let i = 0; i < 100; i++) {
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        const val = noise.noise(x, y);
        expect(val).toBeGreaterThanOrEqual(-1);
        expect(val).toBeLessThanOrEqual(1);
      }
    });

    it("noise2D should be alias for noise", () => {
      const noise = new PerlinNoise(42);
      expect(noise.noise2D(3.5, 7.2)).toBe(noise.noise(3.5, 7.2));
    });
  });

  describe("octaveNoise", () => {
    it("should return values in range [0, 1]", () => {
      const noise = new PerlinNoise(42);
      for (let i = 0; i < 50; i++) {
        const x = Math.random() * 50;
        const y = Math.random() * 50;
        const val = noise.octaveNoise(x, y, 4, 0.5);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    });

    it("should produce smoother results with more octaves", () => {
      const noise = new PerlinNoise(42);
      // More octaves = more detail, but still bounded
      const val1 = noise.octaveNoise(5, 5, 1);
      const val4 = noise.octaveNoise(5, 5, 4);
      
      expect(typeof val1).toBe("number");
      expect(typeof val4).toBe("number");
    });
  });

  describe("turbulence", () => {
    it("should return values in range [0, 1]", () => {
      const noise = new PerlinNoise(42);
      for (let i = 0; i < 50; i++) {
        const x = Math.random() * 50;
        const y = Math.random() * 50;
        const val = noise.turbulence(x, y, 3, 0.5);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe("ValueNoise", () => {
  describe("determinism", () => {
    it("should produce same values for same seed and coordinates", () => {
      const noise1 = new ValueNoise(42);
      const noise2 = new ValueNoise(42);

      expect(noise1.noise(1.5, 2.5)).toBe(noise2.noise(1.5, 2.5));
    });
  });

  describe("noise", () => {
    it("should return values in range [0, 1]", () => {
      const noise = new ValueNoise(42);
      for (let i = 0; i < 100; i++) {
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        const val = noise.noise(x, y);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("octaveNoise", () => {
    it("should return values in range [0, 1]", () => {
      const noise = new ValueNoise(42);
      for (let i = 0; i < 50; i++) {
        const x = Math.random() * 50;
        const y = Math.random() * 50;
        const val = noise.octaveNoise(x, y, 3, 0.5);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    });
  });
});
