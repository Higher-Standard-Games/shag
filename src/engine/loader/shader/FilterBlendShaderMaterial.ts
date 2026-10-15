/**
 * FilterBlendShaderMaterial - Custom shader for Q3 filter/multiply blend
 *
 * Q3's blendFunc filter (GL_DST_COLOR, GL_ZERO) multiplies source with destination.
 * White becomes transparent (1 * dst = dst), colored pixels tint the background.
 *
 * The source RGB is passed unchanged to Babylon's multiplicative blend mode.
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
varying vec3 vAtmWorld;

// Uniforms
uniform sampler2D diffuseTexture;

${ATM_FOG_GLSL}
void main() {
  vec4 texColor = texture2D(diffuseTexture, vUV);
  
  // Multiplication ignores source alpha. Fog tends to white, its identity.
  float fog = atmFogEvaluate(vAtmWorld, atmFogEye).a;
  gl_FragColor = vec4(mix(texColor.rgb, vec3(1.0), fog), 1.0);
}
`;

/**
 * Create a filter blend shader material
 */
export function createFilterBlendMaterial(name: string, scene: Scene, texture: Texture): ShaderMaterial {
  const material = new ShaderMaterial(
    name,
    scene,
    {
      vertex: "filterBlend",
      fragment: "filterBlend",
    },
    {
      attributes: ["position", "uv"],
      uniforms: ["worldViewProjection", "world", ...ATM_FOG_SHADER_UNIFORMS, "diffuseMatrix"],
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

  // GL_DST_COLOR, GL_ZERO: source RGB times the framebuffer RGB.
  material.alphaMode = Constants.ALPHA_MULTIPLY;
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
