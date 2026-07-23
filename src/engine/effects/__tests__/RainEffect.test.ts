import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { describe, expect, it } from "vitest";
import { supportsGpuPrecipitation } from "../RainEffect";

function engineWith(options: { webGPU: boolean; transformFeedback: boolean }): AbstractEngine {
  return {
    isWebGPU: options.webGPU,
    getCaps: () => ({ supportTransformFeedbacks: options.transformFeedback }),
  } as unknown as AbstractEngine;
}

describe("supportsGpuPrecipitation", () => {
  it("uses transform-feedback particles on WebGL2", () => {
    expect(supportsGpuPrecipitation(engineWith({ webGPU: false, transformFeedback: true }))).toBe(true);
  });

  it("keeps a compatibility path when transform feedback is unavailable", () => {
    expect(supportsGpuPrecipitation(engineWith({ webGPU: false, transformFeedback: false }))).toBe(false);
  });

  it("does not enter the WebGL2 particle implementation on WebGPU", () => {
    expect(supportsGpuPrecipitation(engineWith({ webGPU: true, transformFeedback: true }))).toBe(false);
  });
});
