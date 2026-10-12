import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { fogFragmentDeclaration } from "@babylonjs/core/Shaders/ShadersInclude/fogFragmentDeclaration";
import { geometryPixelShaderWGSL } from "@babylonjs/core/ShadersWGSL/geometry.fragment";
import { fogFragmentDeclarationWGSL } from "@babylonjs/core/ShadersWGSL/ShadersInclude/fogFragmentDeclaration";
import { describe, expect, it } from "vitest";
import { fixFogStartForExp, fixGeometryShaderWGSL } from "../rendering/BabylonShaderFixes";

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

  it("counts EXP fog from scene.fogStart in both shader languages, once", () => {
    ShaderStore.IncludesShadersStore[fogFragmentDeclaration.name] = fogFragmentDeclaration.shader;
    ShaderStore.IncludesShadersStoreWGSL[fogFragmentDeclarationWGSL.name] = fogFragmentDeclarationWGSL.shader;

    expect(fixFogStartForExp()).toBe(2);
    for (const source of [
      ShaderStore.IncludesShadersStore[fogFragmentDeclaration.name],
      ShaderStore.IncludesShadersStoreWGSL[fogFragmentDeclarationWGSL.name],
    ]) {
      expect(source).toContain("{fogCoeff=1.0/pow(E,max(0.0,fogDistance-fogStart)*fogDensity);}");
      // EXP2 is left as Babylon ships it
      expect(source).toContain("fogDistance*fogDistance*fogDensity*fogDensity");
    }
    expect(fixFogStartForExp()).toBe(0);
  });
});
