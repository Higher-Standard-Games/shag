/**
 * Deterministic PRNG for the server simulation.
 *
 * The sim must be reproducible for demo re-simulation (anti-cheat WO-AC4 /
 * ANTICHEAT_FEATURES.md R3): replaying a recorded match's inputs through the
 * authoritative sim has to produce the exact same outputs. `Math.random()` breaks
 * that. Seed a small PRNG from **stable sim state** (tick, entity id, a salt) so
 * each draw is a pure function of the game state — reproducible across the
 * record→replay boundary and independent of call order.
 */

/** Combine ints into a uint32 seed (FNV-1a style). Deterministic, well-mixed. */
export function seedFrom(a: number, b: number, c = 0): number {
  let h = 2166136261 >>> 0;
  for (const v of [a | 0, b | 0, c | 0]) {
    h = (h ^ (v >>> 0)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a fast, well-distributed seeded PRNG. Returns a `() => [0,1)` fn. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: a seeded PRNG from (tick, entityId, salt). */
export function rngFrom(tick: number, entityId: number, salt = 0): () => number {
  return mulberry32(seedFrom(tick, entityId, salt));
}
