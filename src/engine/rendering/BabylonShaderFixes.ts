/**
 * Changes to Babylon shaders, applied to the shader store before first use:
 * corrections for shaders that fail on WebGPU, and the fog start distance
 * world fog needs. Each replaces one exact line. When a Babylon update changes
 * that line, the change finds nothing to replace and the shader runs as shipped.
 */

import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { fogFragmentDeclaration } from "@babylonjs/core/Shaders/ShadersInclude/fogFragmentDeclaration";
import { geometryPixelShaderWGSL } from "@babylonjs/core/ShadersWGSL/geometry.fragment";
import { fogFragmentDeclarationWGSL } from "@babylonjs/core/ShadersWGSL/ShadersInclude/fogFragmentDeclaration";

const EXP_FOG = "{fogCoeff=1.0/pow(E,fogDistance*fogDensity);}";
const EXP_FOG_FROM_START = "{fogCoeff=1.0/pow(E,max(0.0,fogDistance-fogStart)*fogDensity);}";

/**
 * Babylon's EXP fog is Warfork's world fog curve, e^(-distance × density), but
 * starts at the camera. Warfork's starts at `mindist`. Babylon already passes
 * `scene.fogStart` to every fog shader and uses it only for linear fog; this
 * makes EXP fog count distance from it. `fogStart` 0 (the default) changes
 * nothing, and EXP2 and linear fog are untouched. GLSL and WGSL alike.
 *
 * Returns how many of the two shader languages were changed.
 */
export function fixFogStartForExp(): number {
  let changed = 0;
  const glsl = ShaderStore.IncludesShadersStore;
  const wgsl = ShaderStore.IncludesShadersStoreWGSL;
  for (const [store, name] of [
    [glsl, fogFragmentDeclaration.name],
    [wgsl, fogFragmentDeclarationWGSL.name],
  ] as const) {
    const source = store[name];
    if (!source?.includes(EXP_FOG)) continue;
    store[name] = source.replace(EXP_FOG, EXP_FOG_FROM_START);
    changed++;
  }
  return changed;
}

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
