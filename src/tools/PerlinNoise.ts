/**
 * Seeded Random Number Generator
 */
export class SeededRandom {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  // Simple LCG random
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
  
  // Random integer in range [min, max]
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  
  // Random float in range [min, max]
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  
  // Random boolean with probability
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
}

/**
 * Perlin Noise (simplified 2D implementation)
 */
export class PerlinNoise {
  private permutation: number[];
  
  constructor(seed: number) {
    // Generate permutation table from seed
    const rng = new SeededRandom(seed);
    this.permutation = [];
    for (let i = 0; i < 256; i++) {
      this.permutation[i] = i;
    }
    // Shuffle
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
   * Get noise value at (x, y) - returns value in range [-1, 1]
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
   * Get octave noise (multiple frequencies combined)
   * Returns value in range [0, 1]
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
}
