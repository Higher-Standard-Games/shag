import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { geometryPixelShaderWGSL } from "@babylonjs/core/ShadersWGSL/geometry.fragment";
import { describe, expect, it } from "vitest";
import { fixGeometryShaderWGSL } from "../rendering/BabylonShaderFixes";

describe("Babylon shader fixes", () => {
  it("converts the WGSL geometry shader's gamma albedo as the vec3 it is, once", () => {
    // Babylon loads once per test process and other files apply the fix too;
    // start from the shader as Babylon ships it.
    ShaderStore.ShadersStoreWGSL.geometryPixelShader = geometryPixelShaderWGSL.shader;
    const before = ShaderStore.ShadersStoreWGSL.geometryPixelShader;
    expect(before).toContain("var color: vec3f");

    expect(fixGeometryShaderWGSL()).toBe(true);
    const after = ShaderStore.ShadersStoreWGSL.geometryPixelShader;
    expect(after).toContain("#ifdef GAMMAALBEDO\ncolor=toLinearSpaceVec3(color);");
    expect(after).not.toContain("#ifdef GAMMAALBEDO\ncolor=toLinearSpaceVec4(color);");
    // Nothing else in the shader changes.
    expect(after.length).toBe(before.length);

    // Already corrected (or a Babylon that fixed it): nothing to do.
    expect(fixGeometryShaderWGSL()).toBe(false);
    expect(ShaderStore.ShadersStoreWGSL.geometryPixelShader).toBe(after);
  });
});
