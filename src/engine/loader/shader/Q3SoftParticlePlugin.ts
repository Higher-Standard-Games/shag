import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";
import type { ResolvedMaterialProps } from "./Q3ShaderTypes";
import { Q3_SOFT_FADE_RATE, Q3SoftParticleDepth } from "./Q3SoftParticleDepth";

export function configureQ3SoftParticle(material: StandardMaterial | PBRMaterial, props: ResolvedMaterialProps): void {
  if (props.softParticle && props.isTransparent && !material.pluginManager?.getPlugin("Q3SoftParticle"))
    new Q3SoftParticlePlugin(material, props.blendFunc?.[0] === "GL_ONE");
}

class Q3SoftParticlePlugin extends MaterialPluginBase {
  private readonly depth: Q3SoftParticleDepth;
  private readonly pbr: boolean;
  constructor(material: StandardMaterial | PBRMaterial, fadeRgb: boolean) {
    super(material, "Q3SoftParticle", 320, { Q3_SOFT_PARTICLE: true, Q3_SOFT_RGB: fadeRgb }, true, false);
    this.depth = Q3SoftParticleDepth.acquire(material);
    this.pbr = material instanceof PBRMaterial;
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  override getClassName(): string {
    return "Q3SoftParticlePlugin";
  }
  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("q3SoftDepthSampler");
  }
  override getUniforms(language?: ShaderLanguage) {
    return {
      ubo: [
        { name: "q3SoftParams", size: 4, type: "vec4" },
        { name: "q3SoftView", size: 16, type: "mat4" },
      ],
      vertex: language === ShaderLanguage.WGSL ? "" : "uniform mat4 q3SoftView;\n",
      fragment: language === ShaderLanguage.WGSL ? "" : "uniform vec4 q3SoftParams;\n",
    };
  }
  override hardBindForSubMesh(buffer: UniformBuffer, scene: Scene, engine: AbstractEngine): void {
    const map = this.depth.mapFor(scene.activeCamera);
    buffer.setTexture("q3SoftDepthSampler", map ?? this.depth.fallback);
    buffer.updateFloat4(
      "q3SoftParams",
      engine.getRenderWidth(),
      engine.getRenderHeight(),
      Q3_SOFT_FADE_RATE,
      map ? 1 : 0,
    );
    if (scene.activeCamera) buffer.updateMatrix("q3SoftView", scene.activeCamera.getViewMatrix());
  }
  override getCustomCode(type: string, language?: ShaderLanguage): Record<string, string> {
    const wgsl = language === ShaderLanguage.WGSL;
    const varying = wgsl ? "varying q3SoftZ: f32;\n" : "varying float q3SoftZ;\n";
    if (type === "vertex")
      return {
        CUSTOM_VERTEX_DEFINITIONS: varying,
        CUSTOM_VERTEX_MAIN_END: wgsl
          ? "vertexOutputs.q3SoftZ = (uniforms.q3SoftView * vec4f(vertexOutputs.vPositionW, 1.0)).z;"
          : "q3SoftZ = (q3SoftView * vec4(vPositionW, 1.0)).z;",
      };
    const u = wgsl ? "uniforms." : "";
    const params = `${u}q3SoftParams`;
    const sample = wgsl
      ? `textureSample(q3SoftDepthSampler, q3SoftDepthSamplerSampler, fragmentInputs.position.xy / ${params}.xy).r`
      : `texture2D(q3SoftDepthSampler, gl_FragCoord.xy / ${params}.xy).r`;
    const color = this.pbr ? "finalColor" : "color";
    const variable = (name: string, value: string) =>
      wgsl ? `var ${name}: f32 = ${value};` : `float ${name} = ${value};`;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS:
        varying +
        (wgsl
          ? "var q3SoftDepthSampler: texture_2d<f32>;\nvar q3SoftDepthSamplerSampler: sampler;\n"
          : "uniform sampler2D q3SoftDepthSampler;\n"),
      CUSTOM_FRAGMENT_BEFORE_FOG: `
        ${variable("q3SceneZ", sample)}
        ${variable("q3SoftD", `clamp((q3SceneZ - ${wgsl ? "fragmentInputs." : ""}q3SoftZ) * ${params}.z, 0.0, 1.0)`)}
        ${variable("q3Softness", `1.0 - pow(1.0 - q3SoftD, 4.0)`)}
        // Zero depth denotes the cleared background, with no opaque intersection.
        if (q3SceneZ <= 0.0 || ${params}.w < 0.5) { q3Softness = 1.0; }
        #ifdef Q3_SOFT_RGB
        ${color} = ${wgsl ? "vec4f" : "vec4"}(${color}.rgb * q3Softness, ${color}.a);
        #else
        ${color}.a *= q3Softness;
        #endif
      `,
    };
  }
}
