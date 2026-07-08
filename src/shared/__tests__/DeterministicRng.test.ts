import { describe, expect, it } from "vitest";
import { mulberry32, rngFrom, seedFrom } from "../DeterministicRng";

describe("DeterministicRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const r = mulberry32(999);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seedFrom is a deterministic function of its inputs", () => {
    expect(seedFrom(10, 20, 1)).toBe(seedFrom(10, 20, 1));
    expect(seedFrom(10, 20, 1)).not.toBe(seedFrom(10, 20, 2));
    expect(seedFrom(10, 20, 1)).not.toBe(seedFrom(20, 10, 1)); // order matters
  });

  it("rngFrom(tick,entity,salt) reproduces across calls — the re-sim invariant", () => {
    const run1 = rngFrom(42, 7, 3);
    const run2 = rngFrom(42, 7, 3);
    expect([run1(), run1(), run1()]).toEqual([run2(), run2(), run2()]);
    // different salt (e.g. drop slot) diverges
    const other = rngFrom(42, 7, 4);
    expect(other()).not.toBe(rngFrom(42, 7, 3)());
  });
});
