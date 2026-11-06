import { describe, expect, it } from "vitest";
import { overlapLoopChannel } from "../audio/LoopOverlap";

describe("loop overlap", () => {
  it("joins faded edges without replaying a silent boundary", () => {
    const source = Float32Array.from([0, 0.25, 0.5, 1, 1, 1, 1, 0.5, 0.25, 0]);
    const loop = overlapLoopChannel(source, 4);
    expect(loop.length).toBe(6);
    expect(loop[0]).toBe(1);
    expect(loop.at(-1)).toBe(1);
    expect(Math.min(...loop)).toBeGreaterThan(0.4);
    expect([...source]).toEqual([0, 0.25, 0.5, 1, 1, 1, 1, 0.5, 0.25, 0]);
  });

  it("uses equal-power weights between the tail and head", () => {
    const source = Float32Array.from([0, 1, 0, 0, 0, 0, 0, 0]);
    const loop = overlapLoopChannel(source, 3);
    expect(loop[1]).toBeCloseTo(Math.SQRT1_2);
    expect(loop[2]).toBeCloseTo(source[2]);
  });

  it.each([0, 1, -1, NaN, Infinity])("preserves the source for an unusable overlap %s", (frames) => {
    const source = Float32Array.from([1, 2, 3, 4]);
    const loop = overlapLoopChannel(source, frames);
    expect(loop).toEqual(source);
    expect(loop).not.toBe(source);
  });

  it("bounds overlap to half the source and handles tiny buffers", () => {
    expect(overlapLoopChannel(new Float32Array(10), 100).length).toBe(5);
    expect(overlapLoopChannel(Float32Array.of(1), 100)).toEqual(Float32Array.of(1));
    expect(overlapLoopChannel(new Float32Array(), 100).length).toBe(0);
  });
});
