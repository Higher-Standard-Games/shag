import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { Scene } from "@babylonjs/core/scene";
import { RenderVars } from "../../rendering/RenderVars";
import type { BspLightingProfile } from "./BspLightingProfile";

const STATIC_LIGHTS = new Set(["worldFillLight", "sunLight", "moonLight", "ambientLight", "bsp_ambient"]);
const plugins = new WeakMap<StandardMaterial | PBRMaterial, BspBakedLightingPlugin>();

export function configureBspBakedLighting(
  material: StandardMaterial | PBRMaterial,
  mesh: AbstractMesh,
  profile: BspLightingProfile,
  direction: BaseTexture | null,
  /** Lightmap pages as array layers; the face's layer rides in lightmap U as `u + 2 * layer`. */
  layers: BaseTexture | null = null,
): void {
  excludeBspFillLights(mesh);
  const existing = plugins.get(material);
  if (existing) {
    existing.profile = profile;
    return;
  }
  const gloss = material instanceof PBRMaterial ? material.reflectivityTexture : material.specularTexture;
  const plugin = new BspBakedLightingPlugin(
    material,
    profile,
    direction,
    layers,
    gloss,
    mesh.metadata?.glossIntensity ?? 1.5,
    mesh.metadata?.glossExponent ?? 24,
  );
  plugins.set(material, plugin);
  plugin.setGlossScale(RenderVars.getInstance().get("r_glossmap") ?? 1);
  plugin.setAmbientScale(RenderVars.getInstance().get("r_ambient") ?? 1);
  plugin.setLightmapScale(RenderVars.getInstance().get("r_lightmap") ?? 1);
  if (material instanceof PBRMaterial) material.brdf.useSpecularGlossinessInputEnergyConservation = false;
}

/** Baked world lighting replaces the synthetic sun/fill; game lights remain additive. */
export function excludeBspFillLights(mesh: AbstractMesh): void {
  if (mesh.metadata?.bspBakedLighting) return;
  mesh.metadata ??= {};
  mesh.metadata.bspBakedLighting = true;
  const scene = mesh.getScene();
  const exclude = (light: Scene["lights"][number]) => {
    if (STATIC_LIGHTS.has(light.name) && !light.excludedMeshes.includes(mesh)) light.excludedMeshes.push(mesh);
  };
  scene.lights.forEach(exclude);
  const observer = scene.onNewLightAddedObservable.add(exclude);
  mesh.onDisposeObservable.addOnce(() => {
    scene.onNewLightAddedObservable.remove(observer);
    for (const light of scene.lights) {
      const index = light.excludedMeshes.indexOf(mesh);
      if (index >= 0) light.excludedMeshes.splice(index, 1);
    }
  });
}

/** Qfusion's primary lightstyle, deluxe normal and classic Blinn-Phong gloss. */
export class BspBakedLightingPlugin extends MaterialPluginBase {
  private readonly pbr: boolean;
  private glossScale = 1;
  private ambientScale = 1;
  private lightmapScale = 1;
  setGlossScale(scale: number): void {
    this.glossScale = scale;
  }
  setAmbientScale(scale: number): void {
    this.ambientScale = scale;
  }
  setLightmapScale(scale: number): void {
    this.lightmapScale = scale;
  }
  constructor(
    material: StandardMaterial | PBRMaterial,
    public profile: BspLightingProfile,
    private readonly direction: BaseTexture | null,
    private readonly layers: BaseTexture | null,
    private readonly gloss: BaseTexture | null,
    private readonly strength: number,
    private readonly exponent: number,
  ) {
    super(
      material,
      "BspBakedLighting",
      200,
      { BSP_BAKED: true, BSP_DELUXE: !!direction, BSP_GLOSS: !!gloss && !!direction, BSP_LAYERED: !!layers },
      true,
      false,
    );
    this.pbr = material instanceof PBRMaterial;
    this.registerForExtraEvents = true;
    this._enable(true);
    // Old effects have a different sampler/UBO layout during map-light changes.
    material.allowShaderHotSwapping = false;
    material.markDirty(true);
  }

  override getClassName(): string {
    return "BspBakedLightingPlugin";
  }
  override prepareDefinesBeforeAttributes(defines: MaterialDefines): void {
    defines._needNormals = true;
    defines._needUVs = true;
  }
  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("bspLightmapSampler", "bspDirectionSampler", "bspGlossSampler");
  }
  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine): boolean {
    return (!this.direction || this.direction.isReady()) && (!this.gloss || this.gloss.isReady());
  }
  override getActiveTextures(textures: BaseTexture[]): void {
    if (this.direction) textures.push(this.direction);
    if (this.gloss) textures.push(this.gloss);
  }
  override getUniforms(language?: ShaderLanguage) {
    return {
      ubo: [
        { name: "bspLighting", size: 4, type: "vec4" },
        { name: "bspAmbient", size: 4, type: "vec4" },
        { name: "bspWorld", size: 16, type: "mat4" },
      ],
      fragment:
        language === ShaderLanguage.WGSL
          ? ""
          : "uniform vec4 bspLighting;\nuniform vec4 bspAmbient;\nuniform mat4 bspWorld;\n",
    };
  }
  override hardBindForSubMesh(buffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    buffer.updateFloat4(
      "bspLighting",
      this.profile.gain * this.lightmapScale,
      this.strength * this.glossScale,
      this.exponent,
      0,
    );
    buffer.updateFloat4(
      "bspAmbient",
      this.profile.ambient[0] * this.ambientScale,
      this.profile.ambient[1] * this.ambientScale,
      this.profile.ambient[2] * this.ambientScale,
      0,
    );
    buffer.updateMatrix("bspWorld", subMesh.getRenderingMesh().getWorldMatrix());
    buffer.setTexture(
      "bspLightmapSampler",
      this.layers ?? (this._material as StandardMaterial | PBRMaterial).lightmapTexture,
    );
    if (this.direction) buffer.setTexture("bspDirectionSampler", this.direction);
    if (this.gloss) buffer.setTexture("bspGlossSampler", this.gloss);
  }
  override getCustomCode(shaderType: string, language?: ShaderLanguage): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    const wgsl = language === ShaderLanguage.WGSL;
    const u = wgsl ? "uniforms." : "";
    const f = wgsl ? "fragmentInputs." : "";
    const v3 = wgsl ? "vec3f" : "vec3";
    const variable = (name: string, type: string, value: string) =>
      wgsl ? `var ${name}: ${type} = ${value};` : `${type} ${name} = ${value};`;
    const sample = (sampler: string, uv: string) =>
      wgsl ? `textureSample(${sampler}, ${sampler}Sampler, ${uv})` : `texture2D(${sampler}, ${uv})`;
    // A layered page: the layer in lightmap U above 1, the page's own U below it
    const layered = !!this.layers;
    const lightmapSample = (sampler: string) =>
      !layered
        ? sample(sampler, `${f}vLightmapUV`)
        : wgsl
          ? `textureSample(${sampler}, ${sampler}Sampler, bspLayerUV, i32(bspLayer))`
          : `texture(${sampler}, vec3(bspLayerUV, bspLayer))`;
    const layerSetup = !layered
      ? ""
      : `${variable("bspLayer", wgsl ? "f32" : "float", `floor(${f}vLightmapUV.x * 0.5)`)}
${variable("bspLayerUV", wgsl ? "vec2f" : "vec2", `${wgsl ? "vec2f" : "vec2"}(${f}vLightmapUV.x - bspLayer * 2.0, ${f}vLightmapUV.y)`)}
`;
    const baseUV = this.pbr ? "vAlbedoUV" : "vDiffuseUV";
    const baseDefine = this.pbr ? "ALBEDO" : "DIFFUSE";
    const spec = this.pbr ? `finalSpecularScaled` : "finalSpecular";
    const base = this.pbr ? "surfaceAlbedo" : "(baseColor.rgb * diffuseColor)";
    const final = this.pbr ? "finalColor" : "color";
    let code = `
#if defined(BSP_BAKED) && defined(LIGHTMAP)
${layerSetup}${variable("bspLight", v3, `${lightmapSample("bspLightmapSampler")}.rgb * ${u}bspLighting.x`)}
${variable("bspSpec", v3, `${v3}(0.0)`)}
#ifdef BSP_DELUXE
${variable("bspEncoded", v3, `${lightmapSample("bspDirectionSampler")}.rgb - ${v3}(0.5)`)}
${variable("bspDir", v3, `bspEncoded / max(length(bspEncoded), 0.0001)`)}
${variable("bspWorldDir", v3, `normalize((${u}bspWorld * ${wgsl ? "vec4f" : "vec4"}(bspDir, 0.0)).xyz)`)}
${variable("bspNdotL", wgsl ? "f32" : "float", (this._material as StandardMaterial | PBRMaterial).twoSidedLighting ? "abs(dot(normalW, bspWorldDir))" : "max(dot(normalW, bspWorldDir), 0.0)")}
bspLight = bspLight * bspNdotL + ${u}bspAmbient.rgb * (1.0 - bspNdotL);
#if defined(BSP_GLOSS) && defined(${baseDefine})
${variable("bspGloss", v3, `${sample("bspGlossSampler", `${f}${baseUV} + uvOffset`)}.rgb`)}
${variable("bspHalf", v3, "normalize(bspWorldDir + viewDirectionW)")}
bspSpec = bspGloss * ${u}bspLighting.y * pow(max(dot(normalW, bspHalf), 0.0), ${u}bspLighting.z);
#endif
#endif
`;
    if (this.pbr) {
      // PBR's base/dynamic terms are linear. Qfusion multiplies its baked terms in display space.
      code += `${variable("bspResult", v3, `pow(max(pow(max(${base}, ${v3}(0.0)), ${v3}(1.0 / 2.2)) * (bspLight + bspSpec), ${v3}(0.0)), ${v3}(2.2)) + finalDiffuse + finalEmissive`)}
#ifdef SPECULARTERM
bspResult += ${spec};
#endif
`;
    } else {
      code += `${variable("bspResult", v3, `${base} * (bspLight + bspSpec + diffuseBase) + finalSpecular + emissiveColor`)}\n`;
    }
    code += wgsl ? `${final} = vec4f(bspResult, ${final}.a);\n#endif` : `${final}.rgb = bspResult;\n#endif`;
    const layerTexture = layered ? "texture_2d_array<f32>" : "texture_2d<f32>";
    const layerSampler = layered ? "highp sampler2DArray" : "sampler2D";
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl
        ? `var bspLightmapSampler: ${layerTexture};\nvar bspLightmapSamplerSampler: sampler;\n#ifdef BSP_DELUXE\nvar bspDirectionSampler: ${layerTexture};\nvar bspDirectionSamplerSampler: sampler;\n#endif\n#ifdef BSP_GLOSS\nvar bspGlossSampler: texture_2d<f32>;\nvar bspGlossSamplerSampler: sampler;\n#endif`
        : `uniform ${layerSampler} bspLightmapSampler;\n#ifdef BSP_DELUXE\nuniform ${layerSampler} bspDirectionSampler;\n#endif\n#ifdef BSP_GLOSS\nuniform sampler2D bspGlossSampler;\n#endif`,
      CUSTOM_FRAGMENT_BEFORE_FOG: code,
    };
  }
}
