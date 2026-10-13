/**
 * GlowOverlayShaderMaterial - Optimized shader for Q3 glow overlay pattern
 *
 * Implements the common 3-stage pattern:
 *   finalColor = (baseTexture * lightmapTexture) + glowTexture
 *
 * This is used for light fixtures, glowing panels, and other emissive surfaces
 * that still receive lightmap shadows on non-emissive parts.
 */

import { Effect } from "@babylonjs/core/Materials/effect";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import {
  ATM_FOG_GLSL,
  ATM_FOG_SHADER_UNIFORMS,
  atmFogMixGlsl,
  bindAtmosphericFog,
} from "../../rendering/AtmosphericFogShader";

// ============================================================================
// GLSL Shaders
// ============================================================================

const VERTEX_SHADER = `
precision highp float;

// Attributes
attribute vec3 position;
attribute vec2 uv;
attribute vec2 uv2;

// Uniforms
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform mat4 baseMatrix;
uniform mat4 glowMatrix;
uniform vec2 uvOffset;    // For tcMod scroll animation
uniform vec2 glowUvOffset; // Separate offset for glow (if needed)

// Varyings
varying vec2 vUV;
varying vec2 vUV2;
varying vec2 vGlowUV;
varying vec3 vAtmWorld;

void main() {
  vAtmWorld = (world * vec4(position, 1.0)).xyz;
  // Animate in authored UV space, then apply each texture's loader transform.
  vUV = (baseMatrix * vec4(uv + uvOffset, 1.0, 0.0)).xy;
  vUV2 = uv2;
  vGlowUV = (glowMatrix * vec4(uv + glowUvOffset, 1.0, 0.0)).xy;

  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

// Varyings
varying vec2 vUV;
varying vec2 vUV2;
varying vec2 vGlowUV;
varying vec3 vAtmWorld;

// Samplers
uniform sampler2D baseSampler;
uniform sampler2D lightmapSampler;
uniform sampler2D glowSampler;

// Parameters
uniform float lightmapIntensity;
uniform float glowIntensity;
uniform float hasLightmap;  // 0.0 or 1.0 (GLSL bool from float uniform)
uniform float glowBlendMode; // 0.0 = additive, 1.0 = alpha blend

${ATM_FOG_GLSL}
void main() {
  // Sample textures
  vec4 baseColor = texture2D(baseSampler, vUV);
  vec4 glowColor = texture2D(glowSampler, vGlowUV);

  vec3 litBase;

  if (hasLightmap > 0.5) {
    // Apply lightmap to base
    vec3 lightmap = texture2D(lightmapSampler, vUV2).rgb * lightmapIntensity;
    litBase = baseColor.rgb * lightmap;
  } else {
    litBase = baseColor.rgb;
  }

  vec3 finalColor;

  if (glowBlendMode > 0.5) {
    // Alpha blend mode: mix(base, glow, glow.alpha)
    // This is for shaders using blendFunc blend on glow
    finalColor = mix(litBase, glowColor.rgb, glowColor.a * glowIntensity);
  } else {
    // Additive mode: base + glow
    // This is for shaders using blendFunc add on glow
    finalColor = litBase + glowColor.rgb * glowIntensity;
  }

  gl_FragColor = vec4(finalColor, baseColor.a);
  ${atmFogMixGlsl("gl_FragColor", "vAtmWorld")}
}
`;

// ============================================================================
// Shader Registration
// ============================================================================

let shaderRegistered = false;

function ensureShaderRegistered(): void {
  if (shaderRegistered) return;

  Effect.ShadersStore.glowOverlayVertexShader = VERTEX_SHADER;
  Effect.ShadersStore.glowOverlayFragmentShader = FRAGMENT_SHADER;

  shaderRegistered = true;
}

// ============================================================================
// GlowOverlayShaderMaterial
// ============================================================================

export class GlowOverlayShaderMaterial {
  /**
   * Create a glow overlay shader material
   *
   * @param name Material name
   * @param scene Babylon scene
   * @param baseTexture Base/diffuse texture
   * @param lightmapTexture Lightmap texture (can be null)
   * @param glowTexture Additive glow texture
   * @param lightmapIntensity Lightmap brightness multiplier (default 2.0)
   * @param glowIntensity Glow brightness multiplier (default 1.0)
   * @param useAlphaBlend If true, use alpha blend mode instead of additive
   */
  static create(
    name: string,
    scene: Scene,
    baseTexture: Texture,
    lightmapTexture: Texture | null,
    glowTexture: Texture,
    lightmapIntensity: number = 2.0,
    glowIntensity: number = 1.0,
    useAlphaBlend: boolean = false,
  ): ShaderMaterial {
    ensureShaderRegistered();

    const material = new ShaderMaterial(
      name,
      scene,
      {
        vertex: "glowOverlay",
        fragment: "glowOverlay",
      },
      {
        attributes: ["position", "uv", "uv2"],
        uniforms: [
          "worldViewProjection",
          "world",
          ...ATM_FOG_SHADER_UNIFORMS,
          "baseMatrix",
          "glowMatrix",
          "uvOffset",
          "glowUvOffset",
          "lightmapIntensity",
          "glowIntensity",
          "hasLightmap",
          "glowBlendMode",
        ],
        samplers: ["baseSampler", "lightmapSampler", "glowSampler"],
      },
    );

    // Set textures
    material.setTexture("baseSampler", baseTexture);
    material.setTexture("glowSampler", glowTexture);
    // Match the StandardMaterial UV contract, including independently oriented
    // compressed textures. Rebind even when frozen; Babylon owns this observer's
    // lifetime. BSP lightmaps retain their dedicated, untransformed UV2 path.
    material.onBindObservable.add(() => {
      const effect = material.getEffect();
      effect?.setMatrix("baseMatrix", baseTexture.getTextureMatrix());
      effect?.setMatrix("glowMatrix", glowTexture.getTextureMatrix());
    });

    if (lightmapTexture) {
      material.setTexture("lightmapSampler", lightmapTexture);
      material.setFloat("hasLightmap", 1.0);
    } else {
      // Need a dummy texture for the sampler
      material.setTexture("lightmapSampler", baseTexture);
      material.setFloat("hasLightmap", 0.0);
    }

    // Set uniforms
    material.setFloat("lightmapIntensity", lightmapIntensity);
    material.setFloat("glowIntensity", glowIntensity);
    material.setFloat("glowBlendMode", useAlphaBlend ? 1.0 : 0.0);
    material.setVector2("uvOffset", { x: 0, y: 0 });
    material.setVector2("glowUvOffset", { x: 0, y: 0 });

    // Default settings
    material.backFaceCulling = true;

    bindAtmosphericFog(material);
    return material;
  }

  /**
   * Update UV offset for animation (tcMod scroll)
   */
  static setUvOffset(material: ShaderMaterial, u: number, v: number): void {
    material.setVector2("uvOffset", { x: u, y: v });
  }

  /**
   * Update glow UV offset separately (if glow has different animation)
   */
  static setGlowUvOffset(material: ShaderMaterial, u: number, v: number): void {
    material.setVector2("glowUvOffset", { x: u, y: v });
  }

  /**
   * Update lightmap intensity
   */
  static setLightmapIntensity(material: ShaderMaterial, intensity: number): void {
    material.setFloat("lightmapIntensity", intensity);
  }

  /**
   * Update glow intensity
   */
  static setGlowIntensity(material: ShaderMaterial, intensity: number): void {
    material.setFloat("glowIntensity", intensity);
  }

  /**
   * Toggle between additive (0) and alpha blend (1) modes
   */
  static setGlowBlendMode(material: ShaderMaterial, useAlphaBlend: boolean): void {
    material.setFloat("glowBlendMode", useAlphaBlend ? 1.0 : 0.0);
  }
}
