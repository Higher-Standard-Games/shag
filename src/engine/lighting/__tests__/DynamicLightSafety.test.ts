import { describe, expect, it } from "vitest";
import {
  applySafeMaxSimultaneousLights,
  getSafeMaxSimultaneousLights,
  SAFE_MAX_SIMULTANEOUS_LIGHTS,
  SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS,
  WEBGPU_SAFE_MAX_SIMULTANEOUS_LIGHTS,
  WEBGPU_SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS,
} from "../DynamicLightSafety";

// biome-ignore lint/suspicious/noExplicitAny: minimal material stub for the light-budget helper
function fakeMaterial(className: string, maxSimultaneousLights?: number, isWebGPU = false): any {
  return {
    maxSimultaneousLights,
    allowShaderHotSwapping: true,
    getClassName: () => className,
    getScene: () => ({ getEngine: () => ({ isWebGPU }) }),
  };
}

describe("DynamicLightSafety (clustered-light budgets)", () => {
  it("raises standard-style materials to the standard budget (admits the clusters)", () => {
    const mat = fakeMaterial("StandardMaterial", 2);
    applySafeMaxSimultaneousLights(mat);
    expect(mat.maxSimultaneousLights).toBe(SAFE_MAX_SIMULTANEOUS_LIGHTS);
    expect(mat.allowShaderHotSwapping).toBe(true);
  });

  it("raises PBR materials to the PBR budget", () => {
    const mat = fakeMaterial("PBRMaterial", 1);
    applySafeMaxSimultaneousLights(mat);
    expect(mat.maxSimultaneousLights).toBe(SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS);
    expect(getSafeMaxSimultaneousLights(mat)).toBe(SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS);
  });

  it("sets the budget when the material has no cap yet", () => {
    const mat = fakeMaterial("StandardMaterial", undefined);
    applySafeMaxSimultaneousLights(mat);
    expect(mat.maxSimultaneousLights).toBe(SAFE_MAX_SIMULTANEOUS_LIGHTS);
  });

  it("does not lower a material already above the budget", () => {
    const mat = fakeMaterial("StandardMaterial", 12);
    applySafeMaxSimultaneousLights(mat);
    expect(mat.maxSimultaneousLights).toBe(12);
  });

  it("budgets cover base lights (ambient + sun) plus the static/dynamic clusters", () => {
    // ambient + sun + static-map cluster + dynamic cluster = 4 minimum.
    expect(SAFE_MAX_SIMULTANEOUS_LIGHTS).toBeGreaterThanOrEqual(4);
    expect(SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS).toBeGreaterThanOrEqual(4);
  });

  it("clamps WebGPU standard materials to the adapter-safe forward-light budget", () => {
    const mat = fakeMaterial("StandardMaterial", 6, true);
    applySafeMaxSimultaneousLights(mat);
    expect(mat.maxSimultaneousLights).toBe(WEBGPU_SAFE_MAX_SIMULTANEOUS_LIGHTS);
    expect(mat.allowShaderHotSwapping).toBe(false);
  });

  it("clamps WebGPU PBR materials below the skinned-material UBO ceiling", () => {
    const mat = fakeMaterial("PBRMaterial", 4, true);
    applySafeMaxSimultaneousLights(mat);
    expect(mat.maxSimultaneousLights).toBe(WEBGPU_SAFE_PBR_MAX_SIMULTANEOUS_LIGHTS);
    expect(mat.allowShaderHotSwapping).toBe(false);
  });
});
