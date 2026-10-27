import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

/** Per-vertex index of the surface's layer in the material's texture arrays. */
export const SURFACE_LAYER_KIND = "bspSurfaceLayer";

/**
 * Draws several map textures in one draw: the base and normal-map images are
 * layers of texture arrays, and each vertex names its layer. Babylon's own
 * base and bump samples are replaced, so lighting, fog and every other plugin
 * see exactly what the surface's own texture would have given them. The
 * material keeps one of its surfaces' textures in its usual slots, which keeps
 * Babylon's texture paths (UVs, bump frame) switched on.
 */
export class BspSurfaceArrayPlugin extends MaterialPluginBase {
  constructor(
    material: StandardMaterial | PBRMaterial,
    private readonly base: BaseTexture,
    private readonly bump: BaseTexture | null,
    private readonly pbr: boolean,
  ) {
    super(material, "BspSurfaceArray", 50, { BSP_SURFACE_ARRAY: false, BSP_SURFACE_BUMP_ARRAY: false }, true, false);
    // Binding the arrays is an extra event
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  override getClassName(): string {
    return "BspSurfaceArrayPlugin";
  }
  override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }
  override prepareDefinesBeforeAttributes(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    defines.BSP_SURFACE_ARRAY = mesh.isVerticesDataPresent(SURFACE_LAYER_KIND);
    defines.BSP_SURFACE_BUMP_ARRAY = defines.BSP_SURFACE_ARRAY && !!this.bump;
  }
  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(SURFACE_LAYER_KIND)) attributes.push(SURFACE_LAYER_KIND);
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("bspBaseArray", "bspBumpArray");
  }
  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine): boolean {
    return this.base.isReady() && (!this.bump || this.bump.isReady());
  }
  override getActiveTextures(textures: BaseTexture[]): void {
    textures.push(this.base);
    if (this.bump) textures.push(this.bump);
  }
  override hardBindForSubMesh(buffer: UniformBuffer): void {
    buffer.setTexture("bspBaseArray", this.base);
    if (this.bump) buffer.setTexture("bspBumpArray", this.bump);
  }
  override getCustomCode(shaderType: string, language?: ShaderLanguage): Record<string, string> | null {
    const wgsl = language === ShaderLanguage.WGSL;
    if (shaderType === "vertex") {
      return wgsl
        ? {
            CUSTOM_VERTEX_DEFINITIONS: `#ifdef BSP_SURFACE_ARRAY\nattribute ${SURFACE_LAYER_KIND}: f32;\nvarying vBspLayer: f32;\n#endif`,
            CUSTOM_VERTEX_MAIN_END: `#ifdef BSP_SURFACE_ARRAY\nvertexOutputs.vBspLayer = vertexInputs.${SURFACE_LAYER_KIND};\n#endif`,
          }
        : {
            CUSTOM_VERTEX_DEFINITIONS: `#ifdef BSP_SURFACE_ARRAY\nattribute float ${SURFACE_LAYER_KIND};\nvarying float vBspLayer;\n#endif`,
            CUSTOM_VERTEX_MAIN_END: `#ifdef BSP_SURFACE_ARRAY\nvBspLayer = ${SURFACE_LAYER_KIND};\n#endif`,
          };
    }
    if (shaderType !== "fragment") return null;
    const baseSampler = this.pbr ? "albedoSampler" : "diffuseSampler";
    const baseUV = this.pbr ? "vAlbedoUV" : "vDiffuseUV";
    const f = wgsl ? "fragmentInputs." : "";
    const layer = wgsl ? "i32(floor(fragmentInputs.vBspLayer + 0.5))" : "floor(vBspLayer + 0.5)";
    const sample = (array: string, uv: string) =>
      wgsl ? `textureSample(${array}, ${array}Sampler, ${uv}, ${layer})` : `texture(${array}, vec3(${uv}, ${layer}))`;
    const literal = (code: string) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Babylon's base sample, as its main shader writes it, semicolon included:
    // the replacement ends in a line break, which must not split the statement
    const baseSample = wgsl
      ? `TEXRD(${baseSampler},${baseSampler}Sampler,fragmentInputs.${baseUV}+uvOffset);`
      : `TEXRD(${baseSampler},${baseUV}+uvOffset);`;
    // The bump sample sits in an include the replacement cannot reach, so the
    // normal is perturbed again from the array once Babylon's bump code has run,
    // with its frame and offset, and turned for the back face as Babylon does
    const flip = wgsl
      ? "normalW = select(-normalW, normalW, fragmentInputs.frontFacing);"
      : "normalW = gl_FrontFacing ? normalW : -normalW;";
    const bump = `#ifdef BSP_SURFACE_BUMP_ARRAY
normalW = perturbNormal(TBN, ${sample("bspBumpArray", `${f}vBumpUV + uvOffset`)}.xyz, ${wgsl ? "uniforms." : ""}vBumpInfos.y);
#ifdef TWOSIDEDLIGHTING
${flip}
#endif
#endif`;
    const code: Record<string, string> = {
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl
        ? `#ifdef BSP_SURFACE_ARRAY
varying vBspLayer: f32;
var bspBaseArray: texture_2d_array<f32>;
var bspBaseArraySampler: sampler;
#ifdef BSP_SURFACE_BUMP_ARRAY
var bspBumpArray: texture_2d_array<f32>;
var bspBumpArraySampler: sampler;
#endif
#endif`
        : `#ifdef BSP_SURFACE_ARRAY
varying float vBspLayer;
uniform highp sampler2DArray bspBaseArray;
#ifdef BSP_SURFACE_BUMP_ARRAY
uniform highp sampler2DArray bspBumpArray;
#endif
#endif`,
      [`!${literal(baseSample)}`]: `${sample("bspBaseArray", `${f}${baseUV}+uvOffset`)};`,
      [this.pbr ? "CUSTOM_FRAGMENT_UPDATE_ALBEDO" : "CUSTOM_FRAGMENT_UPDATE_DIFFUSE"]: bump,
    };
    return code;
  }
}
