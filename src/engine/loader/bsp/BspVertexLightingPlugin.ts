import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

/** Vertex-lit material passes retain baked RGB while accepting additive game lights. */
export class BspVertexLightingPlugin extends MaterialPluginBase {
  constructor(material: StandardMaterial) {
    super(material, "BspVertexLighting", 200, {}, true, false);
    this._enable(true);
  }
  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }
  override getCustomCode(type: string, language?: ShaderLanguage): Record<string, string> | null {
    if (type !== "fragment") return null;
    const wgsl = language === ShaderLanguage.WGSL;
    const uv = `${wgsl ? "fragmentInputs." : ""}vDiffuseUV + uvOffset`;
    const sample = wgsl
      ? `textureSample(diffuseSampler, diffuseSamplerSampler, ${uv})`
      : `texture2D(diffuseSampler, ${uv})`;
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `
#if defined(DIFFUSE) && defined(VERTEXCOLOR)
color = ${wgsl ? "vec4f" : "vec4"}(baseColor.rgb * diffuseColor + ${sample}.rgb * diffuseColor * diffuseBase + finalSpecular + emissiveColor, color.a);
#endif`,
    };
  }
}
