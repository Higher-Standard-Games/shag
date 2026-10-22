import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";
import type { DistanceRamp, Q3ShaderStage } from "./Q3ShaderTypes";

export function configureQ3DistanceRamp(material: StandardMaterial | PBRMaterial, stage?: Q3ShaderStage): void {
  const rgb = stage?.rgbGen?.distanceRamp,
    alpha = stage?.alphaGen?.distanceRamp;
  if ((!rgb && !alpha) || material.pluginManager?.getPlugin("Q3DistanceRamp")) return;
  new Q3DistanceRampPlugin(material, rgb, alpha);
}

/** Qfusion evaluates distance ramps per vertex along the deformed surface normal. */
class Q3DistanceRampPlugin extends MaterialPluginBase {
  private readonly pbr: boolean;
  constructor(
    material: StandardMaterial | PBRMaterial,
    private readonly rgb?: DistanceRamp,
    private readonly alpha?: DistanceRamp,
  ) {
    super(material, "Q3DistanceRamp", 310, { Q3_DISTANCE_RAMP: true }, true, false);
    this.pbr = material instanceof PBRMaterial;
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  override getClassName(): string {
    return "Q3DistanceRampPlugin";
  }
  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }
  override prepareDefinesBeforeAttributes(defines: MaterialDefines): void {
    defines._needNormals = true;
  }
  override getUniforms(language?: ShaderLanguage) {
    return {
      ubo: ["q3RampRgb", "q3RampAlpha", "q3RampCamera"].map((name) => ({ name, size: 4, type: "vec4" })),
      vertex:
        language === ShaderLanguage.WGSL
          ? ""
          : "uniform vec4 q3RampRgb;\nuniform vec4 q3RampAlpha;\nuniform vec4 q3RampCamera;\n",
    };
  }
  override hardBindForSubMesh(buffer: UniformBuffer, scene: Scene, _engine: AbstractEngine): void {
    for (const [name, ramp] of [
      ["q3RampRgb", this.rgb],
      ["q3RampAlpha", this.alpha],
    ] as const)
      buffer.updateFloat4(name, ramp?.from ?? 1, ramp?.to ?? 1, ramp?.near ?? 0, ramp?.far ?? 1);
    const camera = scene.activeCamera;
    if (camera) {
      camera.getViewMatrix();
      const p = camera.globalPosition;
      buffer.updateFloat4("q3RampCamera", p.x, p.y, p.z, 0);
    }
  }
  override getCustomCode(type: string, language?: ShaderLanguage): Record<string, string> {
    const wgsl = language === ShaderLanguage.WGSL,
      u = wgsl ? "uniforms." : "";
    const varying = wgsl ? "varying q3DistanceFade: vec2f;\n" : "varying vec2 q3DistanceFade;\n";
    if (type === "vertex") {
      const out = wgsl ? "vertexOutputs." : "";
      const variable = wgsl ? "var q3Depth: f32 =" : "float q3Depth =";
      let code = `${variable} dot(${u}q3RampCamera.xyz - ${out}vPositionW, normalize(${out}vNormalW));\n`;
      for (const [index, name] of [
        ["x", "q3RampRgb"],
        ["y", "q3RampAlpha"],
      ]) {
        const ramp = `${u}${name}`;
        code += `${wgsl ? `var q3T${index}: f32` : `float q3T${index}`} = clamp((q3Depth - ${ramp}.z) / max(${ramp}.w - ${ramp}.z, 0.0001), 0.0, 1.0);\n`;
        code += `${out}q3DistanceFade.${index} = mix(${ramp}.x, ${ramp}.y, q3T${index} * q3T${index} * (3.0 - 2.0 * q3T${index}));\n`;
      }
      return { CUSTOM_VERTEX_DEFINITIONS: varying, CUSTOM_VERTEX_MAIN_END: code };
    }
    const color = this.pbr ? "finalColor" : "color",
      fade = `${wgsl ? "fragmentInputs." : ""}q3DistanceFade`;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: varying,
      CUSTOM_FRAGMENT_BEFORE_FOG: `${color} = ${wgsl ? "vec4f" : "vec4"}(${color}.rgb * ${fade}.x, ${color}.a * ${fade}.y);`,
    };
  }
}
