/**
 * FilterBlendShaderMaterial - Custom shader for Q3 filter/multiply blend
 *
 * Q3's blendFunc filter (GL_DST_COLOR, GL_ZERO) multiplies source with destination.
 * White becomes transparent (1 * dst = dst), colored pixels tint the background.
 *
 * Since Babylon.js doesn't have a direct equivalent, this shader computes
 * alpha from inverse luminance: white = transparent, dark/colored = opaque.
 */

import { Constants } from "@babylonjs/core/Engines/constants";
import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { ATM_FOG_GLSL, ATM_FOG_SHADER_UNIFORMS, bindAtmosphericFog } from "../../rendering/AtmosphericFogShader";

// Register the custom shader
Effect.ShadersStore.filterBlendVertexShader = `
precision highp float;

// Attributes
attribute vec3 position;
attribute vec2 uv;

// Uniforms
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform mat4 diffuseMatrix;

// Varyings
varying vec2 vUV;
varying vec3 vAtmWorld;

void main() {
  vAtmWorld = (world * vec4(position, 1.0)).xyz;
  vUV = (diffuseMatrix * vec4(uv, 1.0, 0.0)).xy;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

Effect.ShadersStore.filterBlendFragmentShader = `
precision highp float;

// Varyings
varying vec2 vUV;

// Uniforms
uniform sampler2D diffuseTexture;
uniform float alphaThreshold;
uniform float alphaPower;
uniform float colorDarken;
uniform float alphaMultiplier;

${ATM_FOG_GLSL}
void main() {
  vec4 texColor = texture2D(diffuseTexture, vUV);
  
  // Compute luminance (how bright/white the pixel is)
  float luminance = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
  
  // Invert: white (high luminance) = transparent, dark/colored = opaque
  // Apply power curve to control falloff
  float alpha = pow(1.0 - luminance, alphaPower);
  
  // Apply threshold to cut off near-white pixels completely
  if (luminance > alphaThreshold) {
    alpha = 0.0;
  }
  
  // Darken colors to simulate Q3 multiply blend effect
  // In Q3, graffiti multiplies with wall, making it darker
  vec3 darkenedColor = texColor.rgb * colorDarken;
  
  // Reduce overall alpha to make effect more subtle like Q3
  float finalAlpha = alpha * alphaMultiplier;
  
  gl_FragColor = vec4(darkenedColor, finalAlpha);
  // World fog: a filter fades toward no change, as Warfork's filter passes
  gl_FragColor.a *= 1.0 - atmFogEvaluate(vAtmWorld, atmFogEye).a;
}
`;

export interface FilterBlendOptions {
  /** Luminance threshold above which pixels are fully transparent (default: 0.9) */
  alphaThreshold?: number;
  /** Power curve for alpha falloff (default: 1.5) */
  alphaPower?: number;
  /** Color darkening multiplier - lower = darker (default: 0.6) */
  colorDarken?: number;
  /** Alpha multiplier for overall opacity (default: 0.7) */
  alphaMultiplier?: number;
}

/**
 * Create a filter blend shader material
 */
export function createFilterBlendMaterial(
  name: string,
  scene: Scene,
  texture: Texture,
  options: FilterBlendOptions = {},
): ShaderMaterial {
  const { alphaThreshold = 0.9, alphaPower = 1.5, colorDarken = 0.6, alphaMultiplier = 0.7 } = options;

  const material = new ShaderMaterial(
    name,
    scene,
    {
      vertex: "filterBlend",
      fragment: "filterBlend",
    },
    {
      attributes: ["position", "uv"],
      uniforms: [
        "worldViewProjection",
        "world",
        ...ATM_FOG_SHADER_UNIFORMS,
        "diffuseMatrix",
        "alphaThreshold",
        "alphaPower",
        "colorDarken",
        "alphaMultiplier",
      ],
      samplers: ["diffuseTexture"],
      needAlphaBlending: true,
    },
  );

  // Set texture
  material.setTexture("diffuseTexture", texture);
  // Match StandardMaterial's texture coordinates, including the loader's
  // orientation transform. Bind the current matrix even when the material is
  // frozen; this observer is owned and cleared by the material itself.
  material.onBindObservable.add(() => {
    material.getEffect()?.setMatrix("diffuseMatrix", texture.getTextureMatrix());
  });

  // Set uniforms
  material.setFloat("alphaThreshold", alphaThreshold);
  material.setFloat("alphaPower", alphaPower);
  material.setFloat("colorDarken", colorDarken);
  material.setFloat("alphaMultiplier", alphaMultiplier);

  // Enable alpha blending
  material.alphaMode = Constants.ALPHA_COMBINE;
  material.backFaceCulling = false;

  // Disable depth write for proper overlay
  material.disableDepthWrite = true;

  // Z-offset to prevent z-fighting with underlying wall
  material.zOffset = -4;

  bindAtmosphericFog(material);
  return material;
}

/**
 * Check if a material is a FilterBlendShaderMaterial
 */
export function isFilterBlendMaterial(material: unknown): material is ShaderMaterial {
  return (
    material instanceof ShaderMaterial && (material.name.includes("filterBlend") || material.name.includes("decal"))
  );
}
