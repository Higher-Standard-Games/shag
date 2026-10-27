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

/** The images a merged material takes from arrays; base is always one. */
export interface SurfaceArrays {
  base: BaseTexture;
  bump: BaseTexture | null;
  /** Gloss: a Standard material's specular map, a PBR material's reflectivity map */
  gloss: BaseTexture | null;
}

/**
 * Draws several map textures in one draw: the base, normal-map and gloss
 * images are layers of texture arrays, and each vertex names its layer.
 * Babylon's own base and gloss samples are replaced and the normal is
 * perturbed again from its array, so lighting, fog and every other plugin see
 * exactly what the surface's own texture would have given them. The material
 * keeps one of its surfaces' textures in its usual slots, which keeps
 * Babylon's texture paths (UVs, bump frame, reflectivity) switched on.
 *
 * `BSP_SURFACE_GLOSS_ARRAY` and the `bspGlossArray` / `vBspLayer` names are
 * shared with `BspBakedLightingPlugin`, whose gloss term reads the same layer.
 */
export class BspSurfaceArrayPlugin extends MaterialPluginBase {
  constructor(
    material: StandardMaterial | PBRMaterial,
    private readonly arrays: SurfaceArrays,
  ) {
    super(
      material,
      "BspSurfaceArray",
      50,
      { BSP_SURFACE_ARRAY: false, BSP_SURFACE_BUMP_ARRAY: false, BSP_SURFACE_GLOSS_ARRAY: false },
      true,
      false,
    );
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
    // Babylon's plugin constructor can ask before the arrays are assigned
    defines.BSP_SURFACE_BUMP_ARRAY = defines.BSP_SURFACE_ARRAY && !!this.arrays?.bump;
    defines.BSP_SURFACE_GLOSS_ARRAY = defines.BSP_SURFACE_ARRAY && !!this.arrays?.gloss;
  }
  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(SURFACE_LAYER_KIND)) attributes.push(SURFACE_LAYER_KIND);
  }
  override getSamplers(samplers: string[]): void {
    samplers.push("bspBaseArray", "bspBumpArray", "bspGlossArray");
  }
  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine): boolean {
    return this.images().every((image) => image.isReady());
  }
  override getActiveTextures(textures: BaseTexture[]): void {
    textures.push(...this.images());
  }
  override hardBindForSubMesh(buffer: UniformBuffer): void {
    buffer.setTexture("bspBaseArray", this.arrays.base);
    if (this.arrays.bump) buffer.setTexture("bspBumpArray", this.arrays.bump);
    if (this.arrays.gloss) buffer.setTexture("bspGlossArray", this.arrays.gloss);
  }
  private images(): BaseTexture[] {
    if (!this.arrays) return [];
    return [this.arrays.base, this.arrays.bump, this.arrays.gloss].filter((image) => image !== null);
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
    // Babylon collects injection points while constructing the plugin, before
    // its own fields are set: the material, set first, tells the shader apart
    const pbr = this._material.getClassName() === "PBRMaterial";
    const f = wgsl ? "fragmentInputs." : "";
    const sample = (array: string, uv: string) => surfaceArraySample(array, uv, wgsl);
    const literal = (code: string) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Babylon's samples, as its main shaders write them, semicolon included:
    // a replacement spans lines, which must not split the statement
    const babylonSample = (sampler: string, uv: string) =>
      wgsl ? `TEXRD(${sampler},${sampler}Sampler,fragmentInputs.${uv}+uvOffset);` : `TEXRD(${sampler},${uv}+uvOffset);`;
    // Babylon collects a plugin's injection points once, while constructing it:
    // every rule is always present, and a define picks the array or Babylon's sample
    const replace = (code: Record<string, string>, sampler: string, uv: string, array: string, define: string) => {
      const babylon = babylonSample(sampler, uv);
      code[`!${literal(babylon)}`] = `
#ifdef ${define}
${sample(array, `${f}${uv}+uvOffset`)};
#else
${babylon}
#endif`;
    };

    // The bump sample sits in an include a replacement cannot reach, so the
    // normal is perturbed again from the array once Babylon's bump code has
    // run, with its frame and offset, and finished as Babylon finishes it
    const front = wgsl ? "fragmentInputs.frontFacing" : "gl_FrontFacing";
    const facing = (towards: string, away: string) =>
      wgsl ? `select(${away}, ${towards}, ${front})` : `${front} ? ${towards} : ${away}`;
    const finish = pbr
      ? `#if defined(FORCENORMALFORWARD) && defined(NORMAL)
normalW *= sign(dot(normalW, faceNormal));
#endif
#if defined(TWOSIDEDLIGHTING) && defined(NORMAL)
#if defined(MIRRORED)
normalW = ${facing("-normalW", "normalW")};
#else
normalW = ${facing("normalW", "-normalW")};
#endif
#endif`
      : `#ifdef TWOSIDEDLIGHTING
normalW = ${facing("normalW", "-normalW")};
#endif`;
    const bump = `#ifdef BSP_SURFACE_BUMP_ARRAY
normalW = perturbNormal(TBN, ${sample("bspBumpArray", `${f}vBumpUV + uvOffset`)}.xyz, ${wgsl ? "uniforms." : ""}vBumpInfos.y);
${finish}
#endif`;

    const array = (name: string, define?: string) => {
      const declaration = wgsl
        ? `var ${name}: texture_2d_array<f32>;\nvar ${name}Sampler: sampler;`
        : `uniform highp sampler2DArray ${name};`;
      return define ? `#ifdef ${define}\n${declaration}\n#endif` : declaration;
    };
    const code: Record<string, string> = {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef BSP_SURFACE_ARRAY
${wgsl ? "varying vBspLayer: f32;" : "varying float vBspLayer;"}
${array("bspBaseArray")}
${array("bspBumpArray", "BSP_SURFACE_BUMP_ARRAY")}
${array("bspGlossArray", "BSP_SURFACE_GLOSS_ARRAY")}
#endif`,
      // After the bump code in both shaders, before anything reads the normal
      [pbr ? "CUSTOM_FRAGMENT_BEFORE_LIGHTS" : "CUSTOM_FRAGMENT_UPDATE_DIFFUSE"]: bump,
    };
    if (pbr) {
      replace(code, "albedoSampler", "vAlbedoUV", "bspBaseArray", "BSP_SURFACE_ARRAY");
      replace(code, "reflectivitySampler", "vReflectivityUV", "bspGlossArray", "BSP_SURFACE_GLOSS_ARRAY");
    } else {
      replace(code, "diffuseSampler", "vDiffuseUV", "bspBaseArray", "BSP_SURFACE_ARRAY");
      replace(code, "specularSampler", "vSpecularUV", "bspGlossArray", "BSP_SURFACE_GLOSS_ARRAY");
    }
    return code;
  }
}

/** A sample of a surface array at the fragment's layer, in either shader language. */
export function surfaceArraySample(array: string, uv: string, wgsl: boolean): string {
  return wgsl
    ? `textureSample(${array}, ${array}Sampler, ${uv}, i32(floor(fragmentInputs.vBspLayer + 0.5)))`
    : `texture(${array}, vec3(${uv}, floor(vBspLayer + 0.5)))`;
}
