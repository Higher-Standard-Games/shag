import { describe, expect, it } from "vitest";
import { overlapLoopChannel, prependLoopIntro } from "../audio/LoopOverlap";

describe("loop overlap", () => {
  it("preserves the attack then blends toward the loop tail without including the attack in the repeat", () => {
    const attack = Float32Array.of(0.8, 0.7, 0.6, 0.5, 0.4);
    const loop = Float32Array.of(0.1, 0.2, 0.3, 0.4);
    const joined = prependLoopIntro(attack, loop, 2, 3);
    expect([...joined.slice(0, 2)]).toEqual([...attack.slice(0, 2)]);
    expect(joined[2]).toBeCloseTo(0.6);
    expect(joined[4]).toBeCloseTo(0.4);
    expect([...joined.slice(5)]).toEqual([...loop]);
    expect([...attack]).toEqual([...Float32Array.of(0.8, 0.7, 0.6, 0.5, 0.4)]);
  });

  it("bounds the intro and fade to the available audio", () => {
    expect(prependLoopIntro(Float32Array.of(1, 2), Float32Array.of(3, 4), 100, 100)).toEqual(
      Float32Array.of(1, 2, 3, 4),
    );
  });
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
