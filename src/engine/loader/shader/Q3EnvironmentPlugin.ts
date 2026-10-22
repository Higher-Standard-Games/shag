import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";

/** An authored cubemap pass: surround follows the view ray; cubemap reflects it. */
export class Q3EnvironmentPlugin extends MaterialPluginBase {
  constructor(
    material: StandardMaterial,
    private readonly texture: BaseTexture,
    private readonly surround: boolean,
  ) {
    super(material, "Q3Environment", 190, { Q3_ENVIRONMENT: true, Q3_ENVIRONMENT_SURROUND: surround }, true, false);
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  override getClassName(): string {
    return "Q3EnvironmentPlugin";
  }
  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("q3EnvironmentSampler");
  }
  override getActiveTextures(textures: BaseTexture[]): void {
    textures.push(this.texture);
  }
  override isReadyForSubMesh(): boolean {
    return this.texture.isReady();
  }
  override hardBindForSubMesh(buffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine): void {
    buffer.setTexture("q3EnvironmentSampler", this.texture);
  }
  override getCustomCode(type: string, language?: ShaderLanguage): Record<string, string> | null {
    if (type !== "fragment") return null;
    const wgsl = language === ShaderLanguage.WGSL;
    const direction = this.surround ? "-viewDirectionW" : "reflect(-viewDirectionW, normalW)";
    const sample = wgsl
      ? `textureSample(q3EnvironmentSampler, q3EnvironmentSamplerSampler, ${direction})`
      : `textureCube(q3EnvironmentSampler, ${direction})`;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl
        ? "var q3EnvironmentSampler: texture_cube<f32>;\nvar q3EnvironmentSamplerSampler: sampler;"
        : "uniform samplerCube q3EnvironmentSampler;",
      CUSTOM_FRAGMENT_BEFORE_FOG: `color = ${wgsl ? "vec4f" : "vec4"}(${sample}.rgb, color.a);`,
    };
  }
}
