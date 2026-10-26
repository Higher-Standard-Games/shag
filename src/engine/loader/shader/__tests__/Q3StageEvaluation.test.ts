import { describe, expect, it, vi } from "vitest";
import type { TcMod, WaveFunc } from "../Q3ShaderTypes";
import { createTcState, evaluateWaveFunc, stepTcModsInto } from "../Q3StageEvaluation";

describe("renderer-independent stage evaluation", () => {
  it("preserves ordered overwrites, registration scale and negative scroll wrapping", () => {
    const ops: TcMod[] = [
      { type: "scale", sScale: 2, tScale: 3 },
      { type: "scroll", sSpeed: 100, tSpeed: -100 },
      { type: "transform", m00: 1, m01: 0, m10: 0, m11: 2, t0: 4, t1: 5 },
      { type: "scroll", sSpeed: -2, tSpeed: 3 },
    ];
    const state = createTcState(ops);
    expect(state.uScale).toBe(2);
    stepTcModsInto(state, ops, 2, 2);
    expect(state).toEqual({ uOffset: 0, vOffset: 11, rotation: 0, uScale: 1, vScale: 2 });
    const negative = createTcState([]);
    stepTcModsInto(negative, [{ type: "scroll", sSpeed: -600, tSpeed: 600 }], 2, 2);
    expect(negative.uOffset).toBe(-200);
    expect(negative.vOffset).toBe(200);
  });

  it("keeps turbulence timestep-dependent and consumes RNG only for noise", () => {
    const rng = vi.fn().mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    const noise: WaveFunc = { func: "noise", base: 1, amplitude: 2, phase: 0, frequency: 0 };
    const state = createTcState([]);
    stepTcModsInto(state, [{ type: "stretch", func: noise }], 1, 1, rng);
    expect(state.uScale).toBe(0);
    expect(evaluateWaveFunc(noise, 2, rng)).toBe(2);
    expect(rng).toHaveBeenCalledTimes(2);
    stepTcModsInto(state, [{ type: "turb", base: 99, amplitude: 2, phase: 0, frequency: 0 }], 0.1, 3, rng);
    expect(state.uOffset).toBe(0);
    expect(state.vOffset).toBeCloseTo(Math.cos(0.7) * 2);
    expect(rng).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["triangle", -0.25, 0],
    ["square", -0.25, 1],
    ["sawtooth", -0.25, 0.5],
    ["inversesawtooth", -0.25, -0.5],
    ["sin", 0.25, 1],
  ] as const)("keeps authored %s phase semantics", (func, time, expected) => {
    expect(evaluateWaveFunc({ func, base: 0, amplitude: 1, phase: 0, frequency: 1 }, time)).toBeCloseTo(expected);
  });
});
