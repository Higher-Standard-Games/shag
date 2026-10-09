import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { describe, expect, it } from "vitest";
import { countLitPixels, expectedPrecipitationBackend } from "../rendering/WeatherQA";

function engineWith(webGPU: boolean, caps: { supportTransformFeedbacks?: boolean; supportComputeShaders?: boolean }) {
  return { isWebGPU: webGPU, getCaps: () => caps } as unknown as AbstractEngine;
}

describe("WeatherQA", () => {
  it("expects GPU precipitation from compute on WebGPU and transform feedback on WebGL2", () => {
    expect(expectedPrecipitationBackend(engineWith(true, { supportComputeShaders: true }))).toBe("gpu");
    expect(expectedPrecipitationBackend(engineWith(true, { supportTransformFeedbacks: true }))).toBe("cpu");
    expect(expectedPrecipitationBackend(engineWith(false, { supportTransformFeedbacks: true }))).toBe("gpu");
    expect(expectedPrecipitationBackend(engineWith(false, { supportComputeShaders: true }))).toBe("cpu");
  });

  it("counts pixels lit above the clear colour in either channel order", () => {
    const bytes = new Uint8Array([0, 0, 0, 255, 16, 16, 16, 255, 0, 0, 17, 255, 200, 0, 0, 0]);
    expect(countLitPixels(bytes)).toBe(2);
    expect(() => countLitPixels(new Uint8Array(3))).toThrow();
  });
});
