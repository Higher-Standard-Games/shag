/**
 * Corrections to Babylon shaders that fail to compile on WebGPU, applied to
 * the shader store before first use. Each replaces one exact line. When a
 * Babylon update changes that line, the correction finds nothing to replace
 * and the shader compiles as shipped.
 */

import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { geometryPixelShaderWGSL } from "@babylonjs/core/ShadersWGSL/geometry.fragment";

const GAMMA_ALBEDO_VEC4 = "#ifdef GAMMAALBEDO\ncolor=toLinearSpaceVec4(color);";
const GAMMA_ALBEDO_VEC3 = "#ifdef GAMMAALBEDO\ncolor=toLinearSpaceVec3(color);";

/**
 * Babylon 9.17's WGSL geometry-buffer shader converts a gamma-space albedo
 * (`GAMMAALBEDO`, which our BSP textures are) by passing its `vec3f` colour to
 * the vec4 conversion, and WGSL rejects the call. Screen-space reflections
 * draw through that geometry buffer, so on WebGPU every frame they render is
 * lost. GLSL accepts the same line through overloading, so WebGL is unaffected.
 *
 * Returns true when the line was found and corrected.
 */
export function fixGeometryShaderWGSL(): boolean {
  const source = ShaderStore.ShadersStoreWGSL[geometryPixelShaderWGSL.name];
  if (!source?.includes(GAMMA_ALBEDO_VEC4)) return false;
  ShaderStore.ShadersStoreWGSL[geometryPixelShaderWGSL.name] = source.replace(GAMMA_ALBEDO_VEC4, GAMMA_ALBEDO_VEC3);
  return true;
}
