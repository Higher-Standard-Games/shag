import { describe, expect, it } from "vitest";
import { applySafeMaxSimultaneousLights, getSafeMaxSimultaneousLights } from "../DynamicLightSafety";

function fakeMaterial(className: string, maxSimultaneousLights?: number): any {
  return {
    maxSimultaneousLights,
    getClassName: () => className,
  };
}

describe("DynamicLightSafety", () => {
  it("caps standard-style materials at two lights", () => {
    const mat = fakeMaterial("StandardMaterial", 4);
    applySafeMaxSimultaneousLights(mat);
    expect(mat.maxSimultaneousLights).toBe(2);
  });

  it("caps PBR materials at one light", () => {
    const mat = fakeMaterial("PBRMaterial", 4);
    applySafeMaxSimultaneousLights(mat);
    expect(mat.maxSimultaneousLights).toBe(1);
    expect(getSafeMaxSimultaneousLights(mat)).toBe(1);
  });

  it("does not raise an already safer material", () => {
    const mat = fakeMaterial("StandardMaterial", 1);
    applySafeMaxSimultaneousLights(mat);
    expect(mat.maxSimultaneousLights).toBe(1);
  });
});
