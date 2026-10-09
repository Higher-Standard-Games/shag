import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { GetClass } from "@babylonjs/core/Misc/typeStore";
import { describe, expect, it } from "vitest";
import { supportsGpuPrecipitation } from "../RainEffect";

function engineWith(options: { webGPU: boolean; transformFeedback: boolean; compute?: boolean }): AbstractEngine {
  return {
    isWebGPU: options.webGPU,
    getCaps: () => ({
      supportTransformFeedbacks: options.transformFeedback,
      supportComputeShaders: options.compute ?? false,
    }),
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

  it("needs the compute particle platform registered before using compute on WebGPU", async () => {
    const webgpu = engineWith({ webGPU: true, transformFeedback: false, compute: true });
    expect(GetClass("BABYLON.ComputeShaderParticleSystem")).toBeUndefined();
    expect(supportsGpuPrecipitation(webgpu)).toBe(false);
    await import("@babylonjs/core/Particles/computeShaderParticleSystem");
    expect(supportsGpuPrecipitation(webgpu)).toBe(true);
    expect(supportsGpuPrecipitation(engineWith({ webGPU: true, transformFeedback: false, compute: false }))).toBe(
      false,
    );
  });
});
