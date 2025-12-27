/**
 * SeededRandom - Deterministic random number generator
 * 
 * Engine-level utility for reproducible random sequences.
 * Uses Linear Congruential Generator (LCG) algorithm.
 */

export class SeededRandom {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  /**
   * Get next random number in range [0, 1)
   */
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
  
  /**
   * Random integer in range [min, max] (inclusive)
   */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  
  /**
   * Random float in range [min, max]
   */
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
  
  /**
   * Random boolean with given probability of true
   */
  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }
  
  /**
   * Pick random element from array
   */
  pick<T>(array: T[]): T | undefined {
    if (array.length === 0) return undefined;
    return array[this.int(0, array.length - 1)];
  }
  
  /**
   * Shuffle array in place (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  
  /**
   * Get current seed (useful for saving state)
   */
  getSeed(): number {
    return this.seed;
  }
  
  /**
   * Reset to a new seed
   */
  setSeed(seed: number): void {
    this.seed = seed;
  }
}
