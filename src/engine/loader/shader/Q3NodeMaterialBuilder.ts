/**
 * Q3NodeMaterialBuilder - Generates NodeMaterial for multi-stage Q3/Warsow shaders
 *
 * Converts Q3 shader stages into a Babylon.js NodeMaterial with proper
 * texture blending, UV animation support, and lightmap integration.
 */

import { AddBlock } from "@babylonjs/core/Materials/Node/Blocks/addBlock";
import { TextureBlock } from "@babylonjs/core/Materials/Node/Blocks/Dual/textureBlock";
import { FragmentOutputBlock } from "@babylonjs/core/Materials/Node/Blocks/Fragment/fragmentOutputBlock";
import { InputBlock } from "@babylonjs/core/Materials/Node/Blocks/Input/inputBlock";
import { LerpBlock } from "@babylonjs/core/Materials/Node/Blocks/lerpBlock";
import { MultiplyBlock } from "@babylonjs/core/Materials/Node/Blocks/multiplyBlock";
import { TransformBlock } from "@babylonjs/core/Materials/Node/Blocks/transformBlock";
import { VertexOutputBlock } from "@babylonjs/core/Materials/Node/Blocks/Vertex/vertexOutputBlock";
import { VectorMergerBlock } from "@babylonjs/core/Materials/Node/Blocks/vectorMergerBlock";
import { NodeMaterialSystemValues } from "@babylonjs/core/Materials/Node/Enums/nodeMaterialSystemValues";
import { NodeMaterial } from "@babylonjs/core/Materials/Node/nodeMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { Q3ShaderStage } from "./Q3ShaderTypes";

// ============================================================================
// Types
// ============================================================================

export interface NodeMaterialBuildResult {
  material: NodeMaterial;
  /** Uniform blocks for animation (uOffset, vOffset per stage) */
  animationInputs: Map<number, { uOffset: InputBlock; vOffset: InputBlock; rotation?: InputBlock }>;
  /** Stage count */
  stageCount: number;
}

export interface NodeMaterialBuildOptions {
  /** Include lightmap as final multiply stage */
  includeLightmap: boolean;
  /** Lightmap texture (if pre-loaded) */
  lightmapTexture?: Texture;
  /** Lightmap intensity multiplier */
  lightmapIntensity?: number;
}

// ============================================================================
// Blend Function Helpers
// ============================================================================

type BlendMode = "replace" | "blend" | "add" | "multiply" | "filter";

/**
 * Determine blend mode from Q3 blendFunc
 */
function getBlendMode(stage: Q3ShaderStage): BlendMode {
  if (!stage.blendFunc) return "replace";

  const [src, dst] = stage.blendFunc;

  // Common presets
  if (src === "GL_ONE" && dst === "GL_ZERO") return "replace";
  if (src === "GL_ONE" && dst === "GL_ONE") return "add";
  if (src === "GL_DST_COLOR" && dst === "GL_ZERO") return "filter"; // multiply
  if (src === "GL_ZERO" && dst === "GL_SRC_COLOR") return "filter"; // multiply
  if (src === "GL_SRC_ALPHA" && dst === "GL_ONE_MINUS_SRC_ALPHA") return "blend";
  if (src === "GL_ONE" && dst === "GL_SRC_ALPHA") return "add"; // additive with alpha

  // Default to blend for unknown
  return "blend";
}

// ============================================================================
// Q3NodeMaterialBuilder
// ============================================================================

export class Q3NodeMaterialBuilder {
  /**
   * Build a NodeMaterial from Q3 shader stages
   *
   * @param name Material name
   * @param stages Q3 shader stages (textures + blend modes)
   * @param textures Pre-loaded textures for each stage
   * @param scene Babylon scene
   * @param options Build options (lightmap, etc.)
   */
  static build(
    name: string,
    stages: Q3ShaderStage[],
    textures: (Texture | null)[],
    scene: Scene,
    options: NodeMaterialBuildOptions = { includeLightmap: false },
  ): NodeMaterialBuildResult | null {
    // Filter to stages with valid textures
    const validStages: { stage: Q3ShaderStage; texture: Texture; index: number }[] = [];
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const texture = textures[i];

      // Skip lightmap stage (handled separately)
      if (stage.map === "$lightmap") continue;
      // Skip whiteimage (just use white)
      if (stage.map === "$whiteimage") continue;

      if (texture) {
        validStages.push({ stage, texture, index: i });
      }
    }

    if (validStages.length === 0) {
      console.warn(`[Q3NodeMaterialBuilder] No valid stages for ${name}`);
      return null;
    }

    console.log(`[Q3NodeMaterialBuilder] Building ${name} with ${validStages.length} stages`);

    const nodeMaterial = new NodeMaterial(name, scene, { emitComments: false });
    const animationInputs = new Map<number, { uOffset: InputBlock; vOffset: InputBlock; rotation?: InputBlock }>();

    // ========================================================================
    // Vertex Shader
    // ========================================================================

    // Position
    const positionInput = new InputBlock("position");
    positionInput.setAsAttribute("position");

    // World-View-Projection transform
    const worldPos = new TransformBlock("worldPos");
    worldPos.complementZ = 0;
    worldPos.complementW = 1;

    const world = new InputBlock("world");
    world.setAsSystemValue(NodeMaterialSystemValues.World);

    const viewProjection = new InputBlock("viewProjection");
    viewProjection.setAsSystemValue(NodeMaterialSystemValues.ViewProjection);

    const worldPosTransform = new TransformBlock("worldPosTransform");

    positionInput.output.connectTo(worldPos.vector);
    world.output.connectTo(worldPos.transform);
    worldPos.output.connectTo(worldPosTransform.vector);
    viewProjection.output.connectTo(worldPosTransform.transform);

    // Vertex output
    const vertexOutput = new VertexOutputBlock("vertexOutput");
    worldPosTransform.output.connectTo(vertexOutput.vector);

    // ========================================================================
    // UV Coordinates
    // ========================================================================

    // Primary UV (for texture stages)
    const uv = new InputBlock("uv");
    uv.setAsAttribute("uv");

    // Secondary UV (for lightmap)
    const uv2 = new InputBlock("uv2");
    uv2.setAsAttribute("uv2");

    // ========================================================================
    // Build Texture Stages
    // ========================================================================

    // biome-ignore lint/suspicious/noExplicitAny: Babylon.js internal API access
    let currentColor: any = null; // Output connection to chain

    for (let i = 0; i < validStages.length; i++) {
      const { stage, texture, index } = validStages[i];

      // Create UV offset inputs for animation
      const uOffsetInput = new InputBlock(`uOffset${index}`);
      uOffsetInput.value = 0;
      uOffsetInput.isConstant = false;

      const vOffsetInput = new InputBlock(`vOffset${index}`);
      vOffsetInput.value = 0;
      vOffsetInput.isConstant = false;

      // Store for animation system
      animationInputs.set(index, { uOffset: uOffsetInput, vOffset: vOffsetInput });

      // Build UV with offset: uv + vec2(uOffset, vOffset)
      const uvMerger = new VectorMergerBlock(`uvOffset${index}`);
      uOffsetInput.output.connectTo(uvMerger.x);
      vOffsetInput.output.connectTo(uvMerger.y);

      const uvAdd = new AddBlock(`uvAdd${index}`);
      uv.output.connectTo(uvAdd.left);
      uvMerger.xy.connectTo(uvAdd.right);

      // Texture block
      const texBlock = new TextureBlock(`tex${index}`);
      texBlock.texture = texture;
      uvAdd.output.connectTo(texBlock.uv);

      // Blend with previous
      const blendMode = getBlendMode(stage);

      if (currentColor === null) {
        // First stage - just use texture RGB (not RGBA to avoid component mismatch)
        currentColor = texBlock.rgb;
      } else {
        // Blend with previous based on blend mode
        switch (blendMode) {
          case "add": {
            const addBlend = new AddBlock(`blend${index}`);
            currentColor.connectTo(addBlend.left);
            texBlock.rgb.connectTo(addBlend.right);
            currentColor = addBlend.output;
            break;
          }
          case "multiply":
          case "filter": {
            const mulBlend = new MultiplyBlock(`blend${index}`);
            currentColor.connectTo(mulBlend.left);
            texBlock.rgb.connectTo(mulBlend.right);
            currentColor = mulBlend.output;
            break;
          }
          case "blend": {
            // Lerp by texture alpha
            const lerpBlend = new LerpBlock(`blend${index}`);
            currentColor.connectTo(lerpBlend.left);
            texBlock.rgb.connectTo(lerpBlend.right);
            texBlock.a.connectTo(lerpBlend.gradient);
            currentColor = lerpBlend.output;
            break;
          }
          default:
            currentColor = texBlock.rgb;
            break;
        }
      }
    }

    // ========================================================================
    // Lightmap Stage (optional)
    // ========================================================================

    if (options.includeLightmap && options.lightmapTexture) {
      const lightmapTex = new TextureBlock("lightmap");
      lightmapTex.texture = options.lightmapTexture;
      uv2.output.connectTo(lightmapTex.uv);

      // Multiply lightmap with current color
      const lightmapMul = new MultiplyBlock("lightmapBlend");
      currentColor.connectTo(lightmapMul.left);
      lightmapTex.rgb.connectTo(lightmapMul.right);

      // Optional intensity boost
      if (options.lightmapIntensity && options.lightmapIntensity !== 1) {
        const intensityInput = new InputBlock("lightmapIntensity");
        intensityInput.value = options.lightmapIntensity;

        const intensityMul = new MultiplyBlock("intensityMul");
        lightmapMul.output.connectTo(intensityMul.left);
        intensityInput.output.connectTo(intensityMul.right);
        currentColor = intensityMul.output;
      } else {
        currentColor = lightmapMul.output;
      }
    }

    // ========================================================================
    // Fragment Output
    // ========================================================================

    const fragmentOutput = new FragmentOutputBlock("fragmentOutput");
    currentColor.connectTo(fragmentOutput.rgb);

    // Alpha from first stage texture
    if (validStages.length > 0) {
      // For now, use first stage alpha
      // Could be improved to respect alphaGen
    }

    // ========================================================================
    // Build Material
    // ========================================================================

    try {
      nodeMaterial.addOutputNode(vertexOutput);
      nodeMaterial.addOutputNode(fragmentOutput);
      nodeMaterial.build(false);

      console.log(`[Q3NodeMaterialBuilder] Built ${name} successfully`);

      return {
        material: nodeMaterial,
        animationInputs,
        stageCount: validStages.length,
      };
    } catch (err) {
      console.error(`[Q3NodeMaterialBuilder] Failed to build ${name}:`, err);
      return null;
    }
  }

  /**
   * Check if a shader needs NodeMaterial (has multiple non-lightmap stages)
   */
  static needsNodeMaterial(stages: Q3ShaderStage[]): boolean {
    let textureStageCount = 0;
    for (const stage of stages) {
      if (stage.map && stage.map !== "$lightmap" && stage.map !== "$whiteimage") {
        textureStageCount++;
      }
    }
    return textureStageCount > 1;
  }

  /**
   * Get texture paths needed for all stages
   */
  static getRequiredTextures(stages: Q3ShaderStage[]): string[] {
    const paths: string[] = [];
    for (const stage of stages) {
      if (stage.map && stage.map !== "$lightmap" && stage.map !== "$whiteimage") {
        paths.push(stage.map);
      }
    }
    return paths;
  }
}
