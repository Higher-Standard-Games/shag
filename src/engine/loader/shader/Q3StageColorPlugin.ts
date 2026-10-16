import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";

/** A stage's RGB multiplier belongs to its source contribution, before blending. */
export class Q3StageColorPlugin extends MaterialPluginBase {
  private readonly pbr: boolean;
  constructor(
    material: StandardMaterial | PBRMaterial,
    private readonly rgb: readonly number[],
    private readonly vertex = false,
  ) {
    super(material, "Q3StageColor", 300, {}, true, false);
    this.pbr = material instanceof PBRMaterial;
    this._enable(true);
  }
  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }
  override getUniforms(language?: ShaderLanguage) {
    return {
      ubo: [{ name: "q3StageRgb", size: 3, type: "vec3" }],
      fragment: language === ShaderLanguage.WGSL ? "" : "uniform vec3 q3StageRgb;\n",
    };
  }
  override bindForSubMesh(buffer: UniformBuffer): void {
    buffer.updateFloat3("q3StageRgb", this.rgb[0], this.rgb[1], this.rgb[2]);
  }
  override getCustomCode(type: string, language?: ShaderLanguage): Record<string, string> | null {
    if (type !== "fragment") return null;
    const wgsl = language === ShaderLanguage.WGSL;
    const output = this.pbr ? "finalColor" : "color";
    const factor = `${wgsl ? "uniforms." : ""}q3StageRgb`;
    const vertex = this.vertex
      ? `\n#ifdef VERTEXCOLOR\n${output} = ${wgsl ? "vec4f" : "vec4"}(${output}.rgb * ${wgsl ? "fragmentInputs." : ""}vColor.rgb, ${output}.a);\n#endif`
      : "";
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `${output} = ${wgsl ? "vec4f" : "vec4"}(${output}.rgb * ${factor}, ${output}.a);${vertex}`,
    };
  }
}
