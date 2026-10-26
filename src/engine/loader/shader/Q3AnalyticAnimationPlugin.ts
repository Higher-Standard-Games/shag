import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { TcModScroll, WaveFunc } from "./Q3ShaderTypes";

/**
 * Narrow comparison adapter for UV1 base-image scroll and diffuse sine waves.
 * Callers own elapsed/registration phase, identity UV transforms and opaque state.
 * This is not the automatic route for arbitrary authored material stages.
 */
export class Q3AnalyticAnimationPlugin extends MaterialPluginBase {
  private elapsed = 0;

  constructor(
    material: StandardMaterial | PBRMaterial,
    private readonly scroll: TcModScroll | null,
    private readonly wave: WaveFunc | null,
  ) {
    if (wave && wave.func !== "sin") throw new Error("Analytic comparison supports sine waves only");
    super(
      material,
      "Q3AnalyticAnimation",
      320,
      { Q3_ANALYTIC_SCROLL: !!scroll, Q3_ANALYTIC_WAVE: !!wave },
      true,
      false,
    );
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  override getClassName(): string {
    return `Q3AnalyticAnimation${this._material instanceof PBRMaterial ? "PBR" : "Standard"}Plugin`;
  }

  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }

  setTime(seconds: number): void {
    this.elapsed = seconds;
  }

  override getUniforms(language?: ShaderLanguage) {
    const declaration = "uniform vec4 q3AnalyticScroll;\nuniform vec4 q3AnalyticWave;\nuniform float q3AnalyticTime;\n";
    return {
      ubo: [
        { name: "q3AnalyticScroll", size: 4, type: "vec4" },
        { name: "q3AnalyticWave", size: 4, type: "vec4" },
        { name: "q3AnalyticTime", size: 1, type: "float" },
      ],
      vertex: language === ShaderLanguage.WGSL ? "" : declaration,
      fragment: language === ShaderLanguage.WGSL ? "" : declaration,
    };
  }

  override hardBindForSubMesh(buffer: UniformBuffer): void {
    buffer.updateFloat4("q3AnalyticScroll", this.scroll?.sSpeed ?? 0, this.scroll?.tSpeed ?? 0, 0, 0);
    buffer.updateFloat4(
      "q3AnalyticWave",
      this.wave?.base ?? 1,
      this.wave?.amplitude ?? 0,
      this.wave?.phase ?? 0,
      this.wave?.frequency ?? 0,
    );
    buffer.updateFloat("q3AnalyticTime", this.elapsed);
  }

  override getCustomCode(type: string, language?: ShaderLanguage): Record<string, string> {
    const wgsl = language === ShaderLanguage.WGSL;
    const pbr = this._material instanceof PBRMaterial;
    const u = wgsl ? "uniforms." : "";
    if (type === "vertex") {
      const varying = wgsl ? "varying q3AnalyticUV: vec2f;" : "varying vec2 q3AnalyticUV;";
      const offset = `${u}q3AnalyticScroll.xy * ${u}q3AnalyticTime`;
      // Preserve signed remainder, including negative scroll rates.
      const wrapped = wgsl
        ? `q3Offset - trunc(q3Offset / vec2f(1000.0)) * vec2f(1000.0)`
        : `sign(q3Offset) * mod(abs(q3Offset), vec2(1000.0))`;
      return {
        CUSTOM_VERTEX_DEFINITIONS: varying,
        CUSTOM_VERTEX_MAIN_END: `${wgsl ? "let q3Offset =" : "vec2 q3Offset ="} ${offset};\n${wgsl ? "vertexOutputs." : ""}q3AnalyticUV = uvUpdated + ${wrapped};`,
      };
    }
    const textureUv = pbr ? "vAlbedoUV" : "vDiffuseUV";
    const prefix = wgsl ? "fragmentInputs." : "";
    const result: Record<string, string> = {
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl ? "varying q3AnalyticUV: vec2f;" : "varying vec2 q3AnalyticUV;",
    };
    result[`!${wgsl ? "fragmentInputs\\." : ""}${textureUv}\\+uvOffset`] = `${prefix}q3AnalyticUV+uvOffset`;
    const w = `${u}q3AnalyticWave`;
    const value = `clamp(${w}.x + ${w}.y * sin(6.28318530718 * (${w}.z + ${w}.w * ${u}q3AnalyticTime)), 0.0, 1.0)`;
    result[pbr ? "CUSTOM_FRAGMENT_BEFORE_LIGHTS" : "CUSTOM_FRAGMENT_UPDATE_DIFFUSE"] =
      `#ifdef Q3_ANALYTIC_WAVE\n${pbr ? "surfaceAlbedo" : "diffuseColor"} *= ${value};\n#endif`;
    return result;
  }
}
