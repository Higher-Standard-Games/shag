/**
 * Noise - Procedural noise generation utilities
 * 
 * Engine-level noise generators for terrain, textures, and procedural content.
 * Includes Perlin noise with octave/FBM support.
 */

import { SeededRandom } from './SeededRandom';

/**
 * Perlin Noise (2D implementation)
 * 
 * Classic gradient noise algorithm for smooth, natural-looking randomness.
 */
export class PerlinNoise {
  private permutation: number[];
  
  constructor(seed: number) {
    const rng = new SeededRandom(seed);
    this.permutation = [];
    for (let i = 0; i < 256; i++) {
      this.permutation[i] = i;
    }
    // Shuffle using seeded RNG
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
    }
    // Duplicate for overflow
    this.permutation = [...this.permutation, ...this.permutation];
  }
  
  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  
  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }
  
  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  
  /**
   * Get noise value at (x, y)
   * @returns Value in range [-1, 1]
   */
  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    
    x -= Math.floor(x);
    y -= Math.floor(y);
    
    const u = this.fade(x);
    const v = this.fade(y);
    
    const A = this.permutation[X] + Y;
    const B = this.permutation[X + 1] + Y;
    
    return this.lerp(
      this.lerp(
        this.grad(this.permutation[A], x, y),
        this.grad(this.permutation[B], x - 1, y),
        u
      ),
      this.lerp(
        this.grad(this.permutation[A + 1], x, y - 1),
        this.grad(this.permutation[B + 1], x - 1, y - 1),
        u
      ),
      v
    );
  }
  
  /**
   * Alias for noise() for compatibility
   */
  noise2D(x: number, y: number): number {
    return this.noise(x, y);
  }
  
  /**
   * Fractal Brownian Motion (FBM) - multiple octaves of noise combined
   * @returns Value in range [0, 1]
   */
  octaveNoise(x: number, y: number, octaves: number = 3, persistence: number = 0.5): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    
    // Normalize to [0, 1]
    return (total / maxValue + 1) / 2;
  }
  
  /**
   * Turbulence - absolute value of noise for more chaotic patterns
   * @returns Value in range [0, 1]
   */
  turbulence(x: number, y: number, octaves: number = 3, persistence: number = 0.5): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
      total += Math.abs(this.noise(x * frequency, y * frequency)) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    
    return total / maxValue;
  }
}

/**
 * Simple Value Noise (faster but less smooth than Perlin)
 */
export class ValueNoise {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  private hash(x: number, y: number): number {
    const n = x + y * 57 + this.seed;
    const s = Math.sin(n) * 43758.5453123;
    return s - Math.floor(s);
  }
  
  /**
   * Get noise value at (x, y)
   * @returns Value in range [0, 1]
   */
  noise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    
    // Smooth interpolation
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    
    // Get corner values
    const a = this.hash(ix, iy);
    const b = this.hash(ix + 1, iy);
    const c = this.hash(ix, iy + 1);
    const d = this.hash(ix + 1, iy + 1);
    
    // Bilinear interpolation
    return a * (1 - ux) * (1 - uy) +
           b * ux * (1 - uy) +
           c * (1 - ux) * uy +
           d * ux * uy;
  }
  
  /**
   * Multi-octave value noise
   * @returns Value in range [0, 1]
   */
  octaveNoise(x: number, y: number, octaves: number = 3, persistence: number = 0.5): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    
    return total / maxValue;
  }
}
