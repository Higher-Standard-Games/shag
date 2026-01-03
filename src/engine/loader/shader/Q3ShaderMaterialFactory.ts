/**
 * Q3ShaderMaterialFactory - Pattern detection and material routing for Q3/Warsow shaders
 *
 * Detects common shader patterns and routes to optimized material implementations:
 * - StandardMaterial for simple base + lightmap
 * - GlowOverlayShaderMaterial for base + lightmap + additive glow
 * - Q3NodeMaterialBuilder for complex multi-stage shaders
 */

import {
  Scene,
  Material,
  StandardMaterial,
  Texture,
  Constants,
} from 'babylonjs';
import type { Q3Shader, Q3ShaderStage } from './Q3ShaderTypes';
import { GlowOverlayShaderMaterial } from './GlowOverlayShaderMaterial';

// ============================================================================
// Pattern Types
// ============================================================================

export type ShaderPattern =
  | 'base_only'           // Single texture, no lightmap
  | 'base_lightmap'       // Base + lightmap (standard)
  | 'glow_overlay'        // Base + lightmap + additive glow
  | 'nolightmap_emissive' // surfaceparm nolightmap with emissive look
  | 'alpha_blend'         // Transparent with alpha blending
  | 'additive'            // Fully additive (no lightmap)
  | 'scrolling'           // Has tcMod scroll animation
  | 'complex';            // Needs full NodeMaterial

export interface PatternAnalysis {
  pattern: ShaderPattern;
  baseStageIndex: number;
  lightmapStageIndex: number;
  glowStageIndex: number;
  hasAlpha: boolean;
  hasTcMod: boolean;
  tcModStages: number[];
}

// ============================================================================
// Pattern Detection
// ============================================================================

/**
 * Check if a blend func is additive (GL_ONE, GL_ONE)
 */
function isAdditiveBlend(stage: Q3ShaderStage): boolean {
  if (!stage.blendFunc) return false;
  const [src, dst] = stage.blendFunc;
  return (src === 'GL_ONE' && dst === 'GL_ONE') ||
         (src === 'GL_SRC_ALPHA' && dst === 'GL_ONE');
}

/**
 * Check if a texture name looks like a glow texture
 * Common patterns: _glow, _add, _bloom, _light
 */
function isGlowTextureName(map: string): boolean {
  const lower = map.toLowerCase();
  return lower.includes('_glow') ||
         lower.includes('_add') ||
         lower.includes('_bloom') ||
         lower.endsWith('glow');
}

/**
 * Check if a blend func is alpha blend
 */
function isAlphaBlend(stage: Q3ShaderStage): boolean {
  if (!stage.blendFunc) return false;
  const [src, dst] = stage.blendFunc;
  return src === 'GL_SRC_ALPHA' && dst === 'GL_ONE_MINUS_SRC_ALPHA';
}

/**
 * Analyze a Q3 shader to determine its pattern
 */
export function analyzeShaderPattern(shader: Q3Shader): PatternAnalysis {
  const stages = shader.stages;

  const result: PatternAnalysis = {
    pattern: 'base_only',
    baseStageIndex: -1,
    lightmapStageIndex: -1,
    glowStageIndex: -1,
    hasAlpha: false,
    hasTcMod: false,
    tcModStages: [],
  };

  // Find special stages
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];

    // Lightmap stage
    if (stage.map === '$lightmap') {
      result.lightmapStageIndex = i;
      continue;
    }

    // Skip whiteimage
    if (stage.map === '$whiteimage') continue;

    // Check for tcMod
    if (stage.tcMod && stage.tcMod.length > 0) {
      result.hasTcMod = true;
      result.tcModStages.push(i);
    }

    // Check for alpha
    if (stage.alphaFunc || isAlphaBlend(stage)) {
      result.hasAlpha = true;
    }

    // Classify texture stages
    if (result.baseStageIndex === -1) {
      // First real texture is base
      result.baseStageIndex = i;
    } else if (isAdditiveBlend(stage) || isGlowTextureName(stage.map)) {
      // Additive after base = glow
      // Also detect by texture name pattern (_glow, _add, etc.)
      result.glowStageIndex = i;
    }
  }

  // Determine pattern
  const hasLightmap = result.lightmapStageIndex !== -1;
  const hasGlow = result.glowStageIndex !== -1;
  const hasBase = result.baseStageIndex !== -1;
  const isNoLightmap = shader.surfaceParms.has('nolightmap');

  // Count real texture stages (excluding lightmap/whiteimage)
  const textureStageCount = stages.filter(s =>
    s.map && s.map !== '$lightmap' && s.map !== '$whiteimage'
  ).length;

  if (!hasBase) {
    result.pattern = 'base_only';
  } else if (isNoLightmap && textureStageCount === 1) {
    result.pattern = 'nolightmap_emissive';
  } else if (hasLightmap && hasGlow && textureStageCount <= 3) {
    // Classic glow overlay: base + lightmap + glow
    result.pattern = 'glow_overlay';
  } else if (hasLightmap && textureStageCount === 1) {
    result.pattern = 'base_lightmap';
  } else if (!hasLightmap && isAdditiveBlend(stages[result.baseStageIndex])) {
    result.pattern = 'additive';
  } else if (result.hasAlpha) {
    result.pattern = 'alpha_blend';
  } else if (result.hasTcMod && textureStageCount === 1) {
    result.pattern = 'scrolling';
  } else if (textureStageCount > 2) {
    result.pattern = 'complex';
  } else {
    result.pattern = 'base_lightmap';
  }

  return result;
}

// ============================================================================
// Material Factory
// ============================================================================

export interface MaterialFactoryOptions {
  /** Pre-loaded textures by stage path */
  textures: Map<string, Texture>;
  /** Lightmap texture for this mesh */
  lightmapTexture?: Texture;
  /** Lightmap intensity multiplier */
  lightmapIntensity?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface MaterialFactoryResult {
  material: Material;
  pattern: ShaderPattern;
  /** Whether this material needs animation updates */
  needsAnimation: boolean;
}

/**
 * Create the appropriate material for a Q3 shader
 */
export function createQ3Material(
  shader: Q3Shader,
  scene: Scene,
  options: MaterialFactoryOptions
): MaterialFactoryResult | null {

  const analysis = analyzeShaderPattern(shader);

  if (options.debug) {
    console.log(`[Q3ShaderMaterialFactory] ${shader.name} -> pattern: ${analysis.pattern}`);
    console.log(`  baseStage: ${analysis.baseStageIndex}, lightmapStage: ${analysis.lightmapStageIndex}, glowStage: ${analysis.glowStageIndex}`);
  }

  const stages = shader.stages;

  switch (analysis.pattern) {
    case 'glow_overlay': {
      // Get textures
      const baseStage = stages[analysis.baseStageIndex];
      const glowStage = stages[analysis.glowStageIndex];

      const baseTexture = options.textures.get(baseStage.map);
      const glowTexture = options.textures.get(glowStage.map);
      const lightmapTexture = options.lightmapTexture;

      if (!baseTexture || !glowTexture) {
        console.warn(`[Q3ShaderMaterialFactory] Missing textures for glow overlay: ${shader.name}`);
        return createFallbackMaterial(shader, scene, options, analysis);
      }

      if (!lightmapTexture) {
        console.warn(`[Q3ShaderMaterialFactory] Missing lightmap for glow overlay: ${shader.name}`);
        // Could still work without lightmap - just base + glow
      }

      const material = GlowOverlayShaderMaterial.create(
        shader.name,
        scene,
        baseTexture,
        lightmapTexture || null,
        glowTexture,
        options.lightmapIntensity || 2.0
      );

      // Handle culling
      if (shader.cull === 'none' || shader.cull === 'disable') {
        material.backFaceCulling = false;
      }

      if (options.debug) {
        console.log(`[Q3ShaderMaterialFactory] Created GlowOverlayShaderMaterial for ${shader.name}`);
      }

      return {
        material,
        pattern: 'glow_overlay',
        needsAnimation: analysis.hasTcMod,
      };
    }

    case 'nolightmap_emissive':
    case 'additive': {
      // Simple emissive material
      const baseStage = stages[analysis.baseStageIndex];
      const baseTexture = options.textures.get(baseStage.map);

      if (!baseTexture) {
        return null;
      }

      const mat = new StandardMaterial(shader.name, scene);
      mat.emissiveTexture = baseTexture;
      mat.disableLighting = true;

      if (analysis.pattern === 'additive') {
        mat.alphaMode = Constants.ALPHA_ADD;
      }

      if (shader.cull === 'none' || shader.cull === 'disable') {
        mat.backFaceCulling = false;
      }

      return {
        material: mat,
        pattern: analysis.pattern,
        needsAnimation: analysis.hasTcMod,
      };
    }

    case 'base_only':
    case 'base_lightmap':
    case 'alpha_blend':
    case 'scrolling':
    default: {
      // Use standard material (fallback)
      return createFallbackMaterial(shader, scene, options, analysis);
    }
  }
}

/**
 * Create a StandardMaterial fallback
 */
function createFallbackMaterial(
  shader: Q3Shader,
  scene: Scene,
  options: MaterialFactoryOptions,
  analysis: PatternAnalysis
): MaterialFactoryResult | null {

  const stages = shader.stages;

  if (analysis.baseStageIndex === -1) {
    return null;
  }

  const baseStage = stages[analysis.baseStageIndex];
  const baseTexture = options.textures.get(baseStage.map);

  if (!baseTexture) {
    return null;
  }

  const mat = new StandardMaterial(shader.name, scene);
  mat.diffuseTexture = baseTexture;

  // Apply lightmap if available
  if (options.lightmapTexture && analysis.lightmapStageIndex !== -1) {
    mat.lightmapTexture = options.lightmapTexture;
    mat.useLightmapAsShadowmap = true;
  }

  // Handle alpha
  if (analysis.hasAlpha) {
    mat.useAlphaFromDiffuseTexture = true;
    if (baseStage.alphaFunc === 'GE128' || baseStage.alphaFunc === 'GT0') {
      mat.alphaMode = Constants.ALPHA_COMBINE;
    } else {
      mat.alphaMode = Constants.ALPHA_COMBINE;
    }
  }

  // Handle culling
  if (shader.cull === 'none' || shader.cull === 'disable') {
    mat.backFaceCulling = false;
  }

  return {
    material: mat,
    pattern: analysis.pattern,
    needsAnimation: analysis.hasTcMod,
  };
}

/**
 * Check if a shader would benefit from the glow overlay pattern
 */
export function isGlowOverlayShader(shader: Q3Shader): boolean {
  const analysis = analyzeShaderPattern(shader);
  return analysis.pattern === 'glow_overlay';
}

/**
 * Get debug info about pattern detection
 */
export function debugShaderPattern(shader: Q3Shader): string {
  const analysis = analyzeShaderPattern(shader);
  const lines = [
    `Shader: ${shader.name}`,
    `Pattern: ${analysis.pattern}`,
    `Base stage: ${analysis.baseStageIndex}`,
    `Lightmap stage: ${analysis.lightmapStageIndex}`,
    `Glow stage: ${analysis.glowStageIndex}`,
    `Has alpha: ${analysis.hasAlpha}`,
    `Has tcMod: ${analysis.hasTcMod}`,
    `tcMod stages: [${analysis.tcModStages.join(', ')}]`,
    `Surface parms: ${Array.from(shader.surfaceParms).join(', ') || 'none'}`,
    '',
    'Stages:',
  ];

  shader.stages.forEach((stage, i) => {
    const blend = stage.blendFunc ? `[${stage.blendFunc.join(', ')}]` : '[none]';
    const flags: string[] = [];
    if (isAdditiveBlend(stage)) flags.push('ADDITIVE');
    if (isGlowTextureName(stage.map)) flags.push('GLOW_NAME');
    if (stage.rgbGen) flags.push(`rgbGen:${stage.rgbGen.type}`);
    if (stage.alphaGen) flags.push(`alphaGen:${stage.alphaGen.type}`);
    if (stage.alphaFunc) flags.push(`alphaFunc:${stage.alphaFunc}`);
    if (stage.tcMod?.length) flags.push(`tcMod:${stage.tcMod.length}`);

    const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    lines.push(`  ${i}: ${stage.map}`);
    lines.push(`     blend=${blend}${flagStr}`);
  });

  return lines.join('\n');
}
