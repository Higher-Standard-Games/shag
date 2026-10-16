/**
 * BspMeshBuilder - Convert BSP faces to Babylon.js meshes
 *
 * Handles:
 * - Polygon faces (type 1) - pre-triangulated meshes
 * - Patch faces (type 2) - bezier surfaces (tessellation)
 * - Mesh faces (type 3) - triangle soups (misc_model)
 * - Billboard faces (type 4) - flares/sprites
 */

import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Constants } from "@babylonjs/core/Engines/constants";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { applySafeMaxSimultaneousLights } from "../../lighting/DynamicLightSafety";
import { RenderVars } from "../../rendering/RenderVars";
import { configureQ3Alpha, q3AlphaMode } from "../shader/Q3Blend";
import { configureQ3DistanceRamp } from "../shader/Q3DistanceRampPlugin";
import { Q3ShaderRegistry } from "../shader/Q3ShaderRegistry";
import { DEFAULT_SKY_HEIGHT, type ResolvedMaterialProps } from "../shader/Q3ShaderTypes";
import { configureQ3SoftParticle } from "../shader/Q3SoftParticlePlugin";
import { Q3StageColorPlugin } from "../shader/Q3StageColorPlugin";
import { configureBspBakedLighting } from "./BspBakedLightingPlugin";
import { bspLightingProfile, scaleBspLighting } from "./BspLightingProfile";
import type { BspFile } from "./BspLoader";
import { classifyLiquids, DEFAULT_LIQUID_OVERRIDES, liquidKindFromSurfaceParms } from "./LiquidClassifier";
import { createAutosprite2Geometry, updateAutosprite2Geometry } from "./mesh/autosprite2";
import { buildMeshFace, buildPatchFace, buildPolygonFace } from "./mesh/faceBuilders";
import { createRadialGradientTexture, createSolidColorTexture } from "./mesh/fallbackTextures";
import { createBspLightmapTexture, neutralizeFallbackVertexRgb, scaleBspVertexColors } from "./mesh/lightmaps";
import { buildFaceClusters } from "./mesh/pvs";
import { cloudLayersFromStages } from "./mesh/skyClouds";
import { faceSpatialCell, MIN_SPATIAL_BATCH_TRIANGLES, normalizeSpatialCellSize } from "./mesh/spatialBatching";
import { buildBspTangents } from "./mesh/tangents";
import type { BspMeshBuildResult, BuildOptions } from "./mesh/types";

export { buildBrushModel } from "./mesh/brushModelBuilder";
export { q3ToBabylonVec3, reverseTriangleWinding } from "./mesh/coordinates";
export { getVisibleFaces } from "./mesh/pvs";
export type { BspMeshBuildResult, BuildOptions } from "./mesh/types";

// ============================================================================
// BspMeshBuilder Class
// ============================================================================

// Textures that should not be rendered (tool textures)
const NON_DRAWABLE_TEXTURES = [
  "common/nodraw",
  "common/clip",
  "common/caulk",
  "common/trigger",
  "common/hint",
  "common/skip",
  "common/areaportal",
  "common/clusterportal",
  "common/donotenter",
  "common/origin",
  "common/noimpact",
  "common/invisible",
  "textures/common/",
  "noshader",
];

export class BspMeshBuilder {
  /** Last successful billboard upload; weak keys do not retain disposed maps. */
  private static readonly autospriteCameraPositions = new WeakMap<Mesh, [number, number, number]>();

  private bsp: BspFile;
  private scene: Scene;
  private options: BuildOptions;

  private constructor(bsp: BspFile, scene: Scene, options: BuildOptions = {}) {
    this.bsp = bsp;
    this.scene = scene;
    this.options = {
      filterTextures: true,
      ...options,
    };
  }

  /**
   * Build meshes from BSP file
   */
  public static build(bsp: BspFile, scene: Scene, options?: BuildOptions): BspMeshBuildResult {
    const builder = new BspMeshBuilder(bsp, scene, options);
    return builder.buildAll();
  }

  /**
   * Check if a texture should be rendered
   */
  private shouldRenderTexture(textureIndex: number): boolean {
    if (!this.options.filterTextures) return true;
    if (textureIndex < 0 || textureIndex >= this.bsp.textures.length) return false;

    const texName = this.bsp.textures[textureIndex].name.toLowerCase();

    for (const skip of NON_DRAWABLE_TEXTURES) {
      if (texName.includes(skip)) {
        return false;
      }
    }

    return true;
  }

  private buildAll(): BspMeshBuildResult {
    console.log(`[BspMeshBuilder] Building meshes from ${this.bsp.faces.length} faces`);
    const vertexGain = this.bsp.header.isFBSP ? bspLightingProfile(this.bsp).gain : 1;

    const stats = {
      totalFaces: this.bsp.faces.length,
      polygonFaces: 0,
      patchFaces: 0,
      meshFaces: 0,
      billboardFaces: 0,
      skippedSkyFaces: 0,
      totalVertices: 0,
      totalTriangles: 0,
    };

    // Group faces by (texture + lightmap) for correct lightmap UV alignment
    // Each face's UV2 coords reference a specific lightmap, so we must not mix them
    interface TextureGroup {
      textureIndex: number;
      textureName: string;
      lightmapIndex: number;
      shaderProps: ResolvedMaterialProps;
      positions: number[];
      normals: number[];
      uvs: number[];
      uv2s: number[];
      colors: number[];
      indices: number[];
      indexOffset: number;
      pvsClusters: Set<number>;
      spatialCell: string | null;
      baseKey: string;
      // Fog params if any face in this group has a fog effect
      fogParams?: { color: [number, number, number]; depthForOpaque: number };
    }

    // Key: "textureIndex_lightmapIndex" for unique (texture, lightmap) pairs
    const textureGroups = new Map<string, TextureGroup>();
    const faceClusters = buildFaceClusters(this.bsp);
    const spatialCellSize = normalizeSpatialCellSize(this.options.spatialCellSize);
    /**
     * Fog is associated per material: one fogged face gives its whole batch
     * `fogParams`. Splitting that batch by cell would leave the fog on whichever
     * cell happened to contain that face and drop it from the rest, so a split
     * has to carry the association to every cell of the same base key.
     *
     * This used to be handled by refusing to split any texture that had a fogged
     * face anywhere. On `wbomb6` that excluded 12,651 of 21,584 faces while only
     * 1,546 are in a fog volume at all — 51% of the map held back as collateral,
     * some textures over a single fogged face. `wdm2` has no fog volumes, which
     * is why it never showed there.
     */
    const fogByBaseKey = new Map<string, { color: [number, number, number]; depthForOpaque: number }>();
    const shaderRegistry = Q3ShaderRegistry.getInstance();
    const liquidDescriptors = classifyLiquids(this.bsp, {
      overrides: DEFAULT_LIQUID_OVERRIDES,
      surfaceParm: (shaderName) => liquidKindFromSurfaceParms(shaderRegistry.getShader(shaderName)?.surfaceParms ?? []),
      environmentMap: (shaderName) => {
        const shader = shaderRegistry.getShader(shaderName);
        if (!shader) return null;
        const stages = [
          ...(shader.unconditionalStages ?? shader.stages),
          ...(shader.conditionalBlocks?.flatMap((block) => block.stages) ?? []),
        ];
        return stages.find((stage) => stage.cubeMap)?.cubeMap ?? null;
      },
    });
    const liquidByTextureIndex = new Map(liquidDescriptors.map((descriptor) => [descriptor.textureIndex, descriptor]));

    if (liquidDescriptors.length > 0) {
      console.log(`[BspMeshBuilder] Classified ${liquidDescriptors.length} liquid shader descriptor(s)`);
    }

    // Track individual autosprite faces (not merged, each becomes its own mesh)
    interface AutospriteFace {
      faceIndex: number;
      textureIndex: number;
      textureName: string;
      shaderProps: ResolvedMaterialProps;
      positions: number[];
      normals: number[];
      uvs: number[];
      uv2s: number[];
      colors: number[];
      indices: number[];
      center: [number, number, number];
    }
    const autospriteFaces: AutospriteFace[] = [];

    // Track fog effects found
    let _fogFacesCount = 0;

    // Track sky shaders found
    const skyShaders: BspMeshBuildResult["skyShaders"] = [];
    const foundSkyTextures = new Set<number>();
    const skyFaces: number[] = [];

    // Build first model only (model 0 = world geometry)
    const worldModel = this.bsp.models[0];
    if (!worldModel) {
      throw new Error("[BspMeshBuilder] No world model found");
    }

    let skippedTextures = 0;
    let skippedFaceTypes = 0;

    let detailFaceCount = 0;
    let detailFaceSkipped = 0;
    for (let i = worldModel.firstFace; i < worldModel.firstFace + worldModel.numFaces; i++) {
      const face = this.bsp.faces[i];
      if (!face) continue;

      // Check if this face belongs to a detail brush (for debugging)
      const faceTexture = this.bsp.textures[face.textureIndex];
      const isDetail = faceTexture && (faceTexture.contentFlags & 0x8000000) !== 0;
      if (isDetail) {
        detailFaceCount++;
        if (detailFaceCount <= 3) {
          console.log(
            `[BspMeshBuilder] Detail face ${i}: tex="${faceTexture.name}" texIdx=${face.textureIndex} contentFlags=0x${faceTexture.contentFlags.toString(16)} surfaceFlags=0x${faceTexture.surfaceFlags.toString(16)}`,
          );
        }
      }

      // Skip non-drawable textures
      if (!this.shouldRenderTexture(face.textureIndex)) {
        skippedTextures++;
        if (isDetail) detailFaceSkipped++;
        continue;
      }

      // Skip face types if filtering is enabled
      if (this.options.faceTypes && !this.options.faceTypes.includes(face.faceType)) {
        skippedFaceTypes++;
        continue;
      }

      // Sky shader detection - track for skybox creation
      // Check both Q3 shader registry (surfaceparm sky / skyparms) and BSP surface flags (SURF_SKY = 0x4)
      const textureName = this.bsp.textures[face.textureIndex]?.name || "";
      const shaderProps = shaderRegistry.resolveMaterialProps(textureName, {
        deluxe: this.options.deluxe,
        worldSurface: true,
      });
      const bspSurfaceFlags = this.bsp.textures[face.textureIndex]?.surfaceFlags ?? 0;
      const isSkyFace = shaderProps.isSky || (bspSurfaceFlags & 0x4) !== 0;
      if (isSkyFace) {
        if (!foundSkyTextures.has(face.textureIndex)) {
          foundSkyTextures.add(face.textureIndex);
          // Get full shader to extract stage textures for fallback skybox
          const shader = shaderRegistry.getShader(textureName);
          const stageTextures = shader?.stages
            ?.map((s: { map?: string }) => s.map)
            .filter((m: string | undefined): m is string => !!m && m !== "$lightmap");
          skyShaders.push({
            textureName,
            skyParms: shaderProps.skyParms,
            stageTextures,
            editorImage: shader?.editorImage,
            cloudLayers: cloudLayersFromStages(shader?.stages),
          });
          if (shaderProps.skyParms?.farbox) {
            console.log(`[BspMeshBuilder] Found sky shader: ${textureName} -> farbox: ${shaderProps.skyParms.farbox}`);
          } else if (stageTextures?.length) {
            console.log(`[BspMeshBuilder] Found sky shader: ${textureName} -> textured sky: ${stageTextures[0]}`);
          } else {
            console.log(`[BspMeshBuilder] Found sky shader: ${textureName} (no skybox textures)`);
          }
        }
        skyFaces.push(i);
        stats.skippedSkyFaces++;
        continue; // Skip sky faces - will be rendered as skybox
      }

      // Autosprite faces need to be individual meshes (not merged)
      // Each sprite must rotate around its own center
      if (shaderProps.autosprite || shaderProps.autosprite2) {
        let faceData: {
          positions: number[];
          normals: number[];
          uvs: number[];
          uv2s: number[];
          colors: number[];
          indices: number[];
        } | null = null;

        switch (face.faceType) {
          case 1:
            faceData = buildPolygonFace(this.bsp, face);
            break;
          case 2:
            faceData = buildPatchFace(this.bsp, face);
            break;
          case 3:
            faceData = buildMeshFace(this.bsp, face);
            break;
        }

        if (faceData && faceData.positions.length > 0) {
          // Calculate center of this sprite face
          let cx = 0,
            cy = 0,
            cz = 0;
          const numVerts = faceData.positions.length / 3;
          for (let v = 0; v < numVerts; v++) {
            cx += faceData.positions[v * 3];
            cy += faceData.positions[v * 3 + 1];
            cz += faceData.positions[v * 3 + 2];
          }
          cx /= numVerts;
          cy /= numVerts;
          cz /= numVerts;

          autospriteFaces.push({
            faceIndex: i,
            textureIndex: face.textureIndex,
            textureName,
            shaderProps,
            positions: faceData.positions,
            normals: faceData.normals,
            uvs: faceData.uvs,
            uv2s: faceData.uv2s,
            colors: faceData.colors,
            indices: faceData.indices,
            center: [cx, cy, cz],
          });

          stats.totalVertices += numVerts;
          stats.totalTriangles += faceData.indices.length / 3;
        }
        continue; // Don't add to regular texture groups
      }

      // Get or create texture+lightmap group (key by both to preserve UV2 alignment)
      // Patch faces get their own group with two-sided rendering (Q3 patches are always two-sided)
      const lmIdx = face.lightmapIndex >= 0 ? face.lightmapIndex : -1;
      const isPatch = face.faceType === 2;
      const spatialCell =
        spatialCellSize &&
        !shaderProps.isTransparent &&
        shaderProps.alphaMode === "opaque" &&
        !shaderProps.needsAnimation &&
        !shaderProps.polygonOffset &&
        !liquidByTextureIndex.has(face.textureIndex) &&
        !shaderRegistry.getShader(textureName)?.deformVertexes?.length &&
        !faceClusters[i].includes(-1)
          ? faceSpatialCell(this.bsp, face, spatialCellSize)
          : null;
      const baseKey = `${face.textureIndex}_${lmIdx}${isPatch ? "_patch" : ""}`;
      const groupKey = `${baseKey}${spatialCell === null ? "" : `_cell_${spatialCell}`}`;
      let group = textureGroups.get(groupKey);
      if (!group) {
        // For patches, force two-sided rendering: bezier normals can face inward at edges
        const patchShaderProps = isPatch
          ? { ...shaderProps, backFaceCulling: false, twoSidedLighting: true }
          : shaderProps;

        // Debug: log transparent/special shaders (only once per texture)
        if ((shaderProps.isTransparent || shaderProps.alphaMode !== "opaque") && lmIdx === -1) {
          console.log(
            `[BspMeshBuilder] Transparent texture: ${textureName} -> alphaMode=${shaderProps.alphaMode}, backFaceCulling=${shaderProps.backFaceCulling}`,
          );
        }

        group = {
          textureIndex: face.textureIndex,
          textureName,
          lightmapIndex: lmIdx,
          shaderProps: patchShaderProps,
          positions: [],
          normals: [],
          uvs: [],
          uv2s: [],
          colors: [],
          indices: [],
          indexOffset: 0,
          pvsClusters: new Set(),
          spatialCell,
          baseKey,
        };
        textureGroups.set(groupKey, group);
      }

      // Check for fog effect on this face
      if (face.effectIndex >= 0 && face.effectIndex < this.bsp.effects.length && !group.fogParams) {
        const effect = this.bsp.effects[face.effectIndex];
        const fogShader = shaderRegistry.getShader(effect.name);
        if (fogShader?.fogParms) {
          group.fogParams = {
            color: fogShader.fogParms.color,
            depthForOpaque: fogShader.fogParms.depthForOpaque,
          };
          // Remembered against the unsplit key so sibling cells inherit it below.
          if (!fogByBaseKey.has(group.baseKey)) fogByBaseKey.set(group.baseKey, group.fogParams);
          _fogFacesCount++;
          console.log(
            `[BspMeshBuilder] Face ${i} has fog effect: ${effect.name} -> color=(${fogShader.fogParms.color.join(",")}), depth=${fogShader.fogParms.depthForOpaque}`,
          );
        }
      }

      let faceData: {
        positions: number[];
        normals: number[];
        uvs: number[];
        uv2s: number[];
        colors: number[];
        indices: number[];
      } | null = null;

      switch (face.faceType) {
        case 1: // Polygon
          stats.polygonFaces++;
          faceData = buildPolygonFace(this.bsp, face);
          break;
        case 2: // Patch
          stats.patchFaces++;
          faceData = buildPatchFace(this.bsp, face);
          break;
        case 3: // Mesh
          stats.meshFaces++;
          faceData = buildMeshFace(this.bsp, face);
          break;
        case 4: // Billboard
          stats.billboardFaces++;
          // Skip billboards for now
          break;
      }

      if (faceData) {
        // Add to texture group
        const numVerts = faceData.positions.length / 3;
        for (const cluster of faceClusters[i]) group.pvsClusters.add(cluster);

        for (const p of faceData.positions) group.positions.push(p);
        for (const n of faceData.normals) group.normals.push(n);
        for (const uv of faceData.uvs) group.uvs.push(uv);
        for (const uv2 of faceData.uv2s) group.uv2s.push(uv2);
        for (const c of faceData.colors) group.colors.push(c);

        // Add indices with offset
        for (const idx of faceData.indices) {
          group.indices.push(idx + group.indexOffset);
        }
        group.indexOffset += numVerts;

        stats.totalVertices += numVerts;
        stats.totalTriangles += faceData.indices.length / 3;
      }
    }

    // Log detail face statistics
    if (detailFaceCount > 0) {
      console.log(
        `[BspMeshBuilder] Detail faces: ${detailFaceCount} total, ${detailFaceSkipped} skipped (non-drawable), ${detailFaceCount - detailFaceSkipped} rendered`,
      );
    }

    // Splitting tiny material batches creates many draws for little triangle
    // savings. Restore those groups after their actual tessellated size is known.
    // Only the opt-in build pays for this; authored vertex/index data is retained.
    if (spatialCellSize) {
      // A cell that holds none of the fogged faces still belongs to a fogged
      // material, and must look the same as it did unsplit.
      for (const group of textureGroups.values()) {
        if (!group.fogParams) group.fogParams = fogByBaseKey.get(group.baseKey);
      }
      const triangleCounts = new Map<string, number>();
      for (const group of textureGroups.values()) {
        triangleCounts.set(group.baseKey, (triangleCounts.get(group.baseKey) ?? 0) + group.indices.length / 3);
      }
      const mergedGroups = new Map<string, TextureGroup>();
      for (const [key, group] of textureGroups) {
        const keepSplit =
          group.spatialCell !== null && triangleCounts.get(group.baseKey)! >= MIN_SPATIAL_BATCH_TRIANGLES;
        const targetKey = keepSplit ? key : group.baseKey;
        if (!keepSplit) group.spatialCell = null;
        const target = mergedGroups.get(targetKey);
        if (!target) {
          mergedGroups.set(targetKey, group);
          continue;
        }
        for (const channel of ["positions", "normals", "uvs", "uv2s", "colors"] as const) {
          for (const value of group[channel]) target[channel].push(value);
        }
        for (const index of group.indices) target.indices.push(index + target.indexOffset);
        target.indexOffset += group.indexOffset;
        for (const cluster of group.pvsClusters) target.pvsClusters.add(cluster);
      }
      textureGroups.clear();
      for (const [key, group] of mergedGroups) textureGroups.set(key, group);
    }

    // Separate opaque and transparent groups
    const opaqueGroups: TextureGroup[] = [];
    const transparentGroups: TextureGroup[] = [];

    for (const group of textureGroups.values()) {
      if (group.indices.length === 0) continue;

      if (group.shaderProps.isTransparent) {
        transparentGroups.push(group);
      } else {
        opaqueGroups.push(group);
      }
    }

    console.log(
      `[BspMeshBuilder] Texture groups: ${opaqueGroups.length} opaque, ${transparentGroups.length} transparent`,
    );

    // Create a parent mesh to hold all texture group meshes
    const worldMesh = new Mesh("bsp_world", this.scene);
    worldMesh.checkCollisions = true;
    worldMesh.isPickable = true; // Enable raycasting for gravity/picking

    // Combine all groups (opaque first, then transparent for proper sorting)
    const allGroups = [...opaqueGroups, ...transparentGroups];
    const childMeshes: Mesh[] = [];

    // Track alpha index for transparent meshes (higher = render later)
    let alphaIndex = 0;

    // Create a separate mesh for each texture group
    for (const group of allGroups) {
      if (group.indices.length === 0) continue;

      const meshName = `bsp_tex_${group.textureIndex}`;
      const mesh = new Mesh(meshName, this.scene);
      mesh.isPickable = true; // Ensure pickable

      const meshVertexData = new VertexData();
      meshVertexData.positions = group.positions;
      meshVertexData.normals = group.normals;
      meshVertexData.uvs = group.uvs;
      if (group.uv2s.length > 0) {
        meshVertexData.uvs2 = group.uv2s;
      }
      if (group.colors.length > 0) {
        meshVertexData.colors = scaleBspVertexColors(group.colors, vertexGain);
      }
      meshVertexData.indices = group.indices;
      meshVertexData.applyToMesh(mesh);
      mesh.hasVertexAlpha = group.shaderProps.usesVertexAlpha ?? false;

      // Create material with shader properties
      const meshMaterial = this.createMaterialFromShaderProps(
        `bsp_mat_${group.textureIndex}`,
        group.shaderProps,
        group.textureName,
      );
      mesh.material = meshMaterial;

      // Store texture name, lightmap info, and fog params in metadata
      // Each group now has exactly one lightmap (grouped by texture+lightmap)
      const texFlags = this.bsp.textures[group.textureIndex];
      const liquid = liquidByTextureIndex.get(group.textureIndex);
      mesh.metadata = {
        textureName: group.textureName,
        usesVertexRgb: group.shaderProps.usesVertexRgb ?? false,
        usesLightmap: group.shaderProps.useLightmap,
        glossIntensity: group.shaderProps.glossIntensity,
        glossExponent: group.shaderProps.glossExponent,
        preserveVertexLighting: group.shaderProps.usesVertexRgb ?? false,
        textureIndex: group.textureIndex,
        lightmapIndex: group.lightmapIndex,
        // Only model-0 surfaces carry this annotation; movers stay outside
        // static PVS even when gameplay parents them under the world root.
        bspPvsClusters: [...group.pvsClusters],
        bspSpatialCell: group.spatialCell,
        bspSpatialCellSize: group.spatialCell === null ? 0 : spatialCellSize,
        contentFlags: texFlags?.contentFlags ?? 0,
        surfaceFlags: texFlags?.surfaceFlags ?? 0,
        fogParams: group.fogParams,
        autosprite: group.shaderProps.autosprite,
        autosprite2: group.shaderProps.autosprite2,
        // Which liquid this surface draws, if any. An annotation only — the
        // material above is still the ordinary one, so nothing about how the
        // map looks changes until a liquid renderer exists to claim these.
        // A NODRAW liquid brush produces no drawn group at all and so never
        // reaches here, which is the correct answer for a volume with no
        // surface.
        liquidKind: liquid?.kind ?? null,
        liquidSignals: liquid?.signals ?? [],
        liquidProfile: liquid?.profile ?? null,
        liquidEnvironmentMap: liquid?.environmentMap ?? null,
      };

      // Note: Per-face fog detection works, but applying global scene fog here is wrong
      // for Warsow maps with localized fog volumes (hallways, pits, etc.)
      // True per-volume fog would require custom shaders with volume bounds checking.
      // For now, just log that fog was detected - use 'fog on' command for global testing.
      if (group.fogParams) {
        console.log(`[BspMeshBuilder] Mesh ${meshName} has fog effect (use 'fog on' for global fog testing)`);
      }

      // Handle transparency sorting
      if (group.shaderProps.isTransparent) {
        // Additive blending (halos, lights) should render last
        if (group.shaderProps.alphaMode === "add") {
          mesh.alphaIndex = 1000 + alphaIndex;
        } else {
          mesh.alphaIndex = alphaIndex;
        }
        alphaIndex++;

        // Use back-to-front sorting for transparent meshes
        mesh.mustDepthSortFacets = true;
      }

      // Parent to world mesh for easy disposal
      mesh.parent = worldMesh;
      childMeshes.push(mesh);

      // Add Physics Body (Havok)
      // Only for opaque meshes that aren't specifically non-solid (we assume visible = solid for now)
      // TODO: Check surface flags for non-solid surfaces (noimpact, nomarks etc might still be solid)
      if (!group.shaderProps.isTransparent) {
        import("../../physics/PhysicsSystem").then(({ PhysicsSystem }) => {
          import("@babylonjs/core/Physics/v2/IPhysicsEnginePlugin").then(({ PhysicsShapeType }) => {
            PhysicsSystem.getInstance().createStaticBody(mesh, PhysicsShapeType.MESH);
          });
        });
      }
    }

    console.log(`[BspMeshBuilder] Created ${childMeshes.length} texture group meshes`);

    // Create individual meshes for autosprite faces with per-frame billboard updates
    const autospriteMeshData: BspMeshBuildResult["autospriteMeshes"] = [];

    for (let si = 0; si < autospriteFaces.length; si++) {
      const sprite = autospriteFaces[si];
      const spriteMeshName = `bsp_sprite_${sprite.textureIndex}_${si}`;
      const spriteMesh = new Mesh(spriteMeshName, this.scene);

      // Calculate sprite dimensions from original geometry
      // Find bounding box to get width/height
      let minX = Infinity,
        maxX = -Infinity;
      let minY = Infinity,
        maxY = -Infinity;
      let minZ = Infinity,
        maxZ = -Infinity;
      const numVerts = sprite.positions.length / 3;
      for (let v = 0; v < numVerts; v++) {
        const x = sprite.positions[v * 3];
        const y = sprite.positions[v * 3 + 1];
        const z = sprite.positions[v * 3 + 2];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }

      // Calculate half-dimensions (sprite is a quad, find largest extent)
      const extentX = (maxX - minX) / 2;
      const extentY = (maxY - minY) / 2;
      const extentZ = (maxZ - minZ) / 2;
      // For a quad, two dimensions will be large, one will be ~0
      // halfWidth = horizontal extent, halfHeight = vertical extent
      const halfWidth = Math.max(extentX, extentZ);
      const halfHeight = extentY > 0.01 ? extentY : Math.max(extentX, extentZ);

      // Apply original geometry initially
      const spriteVertexData = new VertexData();
      spriteVertexData.positions = [...sprite.positions]; // Copy for modification
      spriteVertexData.normals = sprite.normals;
      spriteVertexData.uvs = sprite.uvs;
      if (sprite.uv2s.length > 0) {
        spriteVertexData.uvs2 = sprite.uv2s;
      }
      if (sprite.colors.length > 0) {
        spriteVertexData.colors = scaleBspVertexColors(sprite.colors, vertexGain);
      }
      spriteVertexData.indices = sprite.indices;
      spriteVertexData.applyToMesh(spriteMesh, true); // updatable = true

      // Create material
      const spriteMaterial = this.createMaterialFromShaderProps(
        `bsp_sprite_mat_${sprite.textureIndex}_${si}`,
        sprite.shaderProps,
        sprite.textureName,
      );
      spriteMesh.material = spriteMaterial;

      // Store metadata for texture loading
      spriteMesh.metadata = {
        textureName: sprite.textureName,
        textureIndex: sprite.textureIndex,
        lightmapIndex: -1, // Sprites typically don't use lightmaps
        bspPvsClusters: faceClusters[sprite.faceIndex],
        autosprite: sprite.shaderProps.autosprite,
        autosprite2: sprite.shaderProps.autosprite2,
      };

      // Transparency handling
      if (sprite.shaderProps.isTransparent) {
        if (sprite.shaderProps.alphaMode === "add") {
          spriteMesh.alphaIndex = 2000 + si; // After regular transparent meshes
        } else {
          spriteMesh.alphaIndex = 1500 + si;
        }
      }

      spriteMesh.parent = worldMesh;
      childMeshes.push(spriteMesh);

      // Calculate normalized vertex offsets from original positions relative to center
      // This allows proper interpolation for triangulated sprites (not just 4 corners)
      const [cx, cy, cz] = sprite.center;

      // Collect all vertex offsets from center
      const offsets: [number, number, number][] = [];
      for (let v = 0; v < numVerts; v++) {
        offsets.push([
          sprite.positions[v * 3] - cx,
          sprite.positions[v * 3 + 1] - cy,
          sprite.positions[v * 3 + 2] - cz,
        ]);
      }

      // Find max extent on each axis to determine sprite orientation
      let maxExtentX = 0,
        maxExtentY = 0,
        maxExtentZ = 0;
      for (const [ox, oy, oz] of offsets) {
        maxExtentX = Math.max(maxExtentX, Math.abs(ox));
        maxExtentY = Math.max(maxExtentY, Math.abs(oy));
        maxExtentZ = Math.max(maxExtentZ, Math.abs(oz));
      }

      // Calculate normalized offsets for each vertex
      // Maps each vertex position to a fraction of the quad (-1 to 1 range)
      const vertexOffsets: [number, number][] = [];
      for (const [ox, oy, oz] of offsets) {
        let rightFrac: number, upFrac: number;

        if (maxExtentY < maxExtentX && maxExtentY < maxExtentZ) {
          // Horizontal sprite (XZ plane) - Y is normal
          rightFrac = maxExtentX > 0.001 ? ox / maxExtentX : 0;
          upFrac = maxExtentZ > 0.001 ? oz / maxExtentZ : 0;
        } else if (maxExtentX < maxExtentY && maxExtentX < maxExtentZ) {
          // YZ plane - X is normal
          rightFrac = maxExtentZ > 0.001 ? oz / maxExtentZ : 0;
          upFrac = maxExtentY > 0.001 ? oy / maxExtentY : 0;
        } else {
          // XY plane or default - Z is normal (most common for vertical sprites)
          rightFrac = maxExtentX > 0.001 ? ox / maxExtentX : 0;
          upFrac = maxExtentY > 0.001 ? oy / maxExtentY : 0;
        }

        vertexOffsets.push([rightFrac, upFrac]);
      }

      // Track for per-frame billboard updates
      autospriteMeshData.push({
        mesh: spriteMesh,
        center: sprite.center,
        halfWidth,
        halfHeight,
        isAutosprite2: sprite.shaderProps.autosprite2,
        axisGeometry: sprite.shaderProps.autosprite2
          ? createAutosprite2Geometry(sprite.positions, sprite.indices)
          : undefined,
        vertexOffsets,
      });
    }

    if (autospriteFaces.length > 0) {
      console.log(`[BspMeshBuilder] Created ${autospriteFaces.length} autosprite meshes (billboarded)`);
      // Debug: log sprite info with orientation details
      for (let sdi = 0; sdi < autospriteMeshData.length; sdi++) {
        const spriteData = autospriteMeshData[sdi];
        const sprite = autospriteFaces[sdi];
        const numVerts = spriteData.vertexOffsets.length;

        // Recalculate extents for logging
        const [cx, cy, cz] = spriteData.center;
        let maxX = 0,
          maxY = 0,
          maxZ = 0;
        for (let v = 0; v < numVerts; v++) {
          maxX = Math.max(maxX, Math.abs(sprite.positions[v * 3] - cx));
          maxY = Math.max(maxY, Math.abs(sprite.positions[v * 3 + 1] - cy));
          maxZ = Math.max(maxZ, Math.abs(sprite.positions[v * 3 + 2] - cz));
        }
        const orient = maxY < maxX && maxY < maxZ ? "XZ(horiz)" : maxX < maxY && maxX < maxZ ? "YZ" : "XY(vert)";

        console.log(
          `[BspMeshBuilder] Sprite "${spriteData.mesh.name}": ${numVerts}v, extents=[${maxX.toFixed(1)},${maxY.toFixed(1)},${maxZ.toFixed(1)}], orient=${orient}, hw=${spriteData.halfWidth.toFixed(1)}, hh=${spriteData.halfHeight.toFixed(1)}, as2=${spriteData.isAutosprite2}`,
        );
      }
    }

    // Create lightmap textures
    const lightmapTextures = this.buildLightmapTextures();

    console.log(
      `[BspMeshBuilder] Built world mesh: ${stats.totalVertices} vertices, ${stats.totalTriangles} triangles`,
    );
    console.log(
      `[BspMeshBuilder] Face breakdown: ${stats.polygonFaces} polygons, ${stats.patchFaces} patches, ${stats.meshFaces} meshes, ${stats.billboardFaces} billboards`,
    );
    if (skippedTextures > 0) {
      console.log(`[BspMeshBuilder] Skipped ${skippedTextures} faces with non-drawable textures`);
    }
    if (skippedFaceTypes > 0) {
      console.log(`[BspMeshBuilder] Skipped ${skippedFaceTypes} faces due to face type filter`);
    }

    // Collect texture group info for later loading (including autosprite textures)
    const allTextureGroups = [
      ...new Map(
        [...opaqueGroups, ...transparentGroups]
          .filter((g) => g.indices.length > 0)
          .map((g) => [g.textureIndex, { textureIndex: g.textureIndex, textureName: g.textureName }]),
      ).values(),
    ];

    // Add autosprite textures (deduplicated)
    const seenTextureIndices = new Set(allTextureGroups.map((g) => g.textureIndex));
    for (const sprite of autospriteFaces) {
      if (!seenTextureIndices.has(sprite.textureIndex)) {
        seenTextureIndices.add(sprite.textureIndex);
        allTextureGroups.push({ textureIndex: sprite.textureIndex, textureName: sprite.textureName });
      }
    }

    // Surfaces whose shader says `nofog` stay clear of world fog
    for (const mesh of worldMesh.getChildMeshes()) {
      const index = /^bsp_(?:tex|sprite)_(\d+)/.exec(mesh.name)?.[1];
      const name = index === undefined ? undefined : this.bsp.textures[Number(index)]?.name;
      if (name && shaderRegistry.getShader(name)?.noFog) mesh.applyFog = false;
    }

    if (skyShaders.length > 0) {
      const hasCubemap = skyShaders.some((s) => s.skyParms?.farbox);
      const hasTextured = skyShaders.some((s) => !s.skyParms?.farbox && s.stageTextures?.length);
      if (hasCubemap) {
        console.log(
          `[BspMeshBuilder] Found ${skyShaders.length} sky shader(s), skipped ${stats.skippedSkyFaces} sky faces for cubemap skybox`,
        );
      } else if (hasTextured) {
        console.log(
          `[BspMeshBuilder] Found ${skyShaders.length} sky shader(s), skipped ${stats.skippedSkyFaces} sky faces for textured skybox`,
        );
      } else {
        console.log(`[BspMeshBuilder] Found ${skyShaders.length} sky shader(s) with no skybox textures`);
      }
    }

    return {
      worldMesh,
      lightmapTextures,
      textureGroups: allTextureGroups,
      skyShaders,
      skyFaces,
      stats,
      bspData: this.bsp,
      clusterInfo: {
        numClusters: this.bsp.visData?.numClusters ?? 0,
        hasPVS: this.bsp.visData !== null,
      },
      autospriteMeshes: autospriteMeshData.length > 0 ? autospriteMeshData : undefined,
    };
  }

  /**
   * Billboard for each world camera after frame-level PVS, before mesh selection.
   * The weapon-only camera must not overwrite the world's sprite orientation.
   */
  public static registerAutospriteUpdates(result: BspMeshBuildResult): void {
    if (!result.autospriteMeshes?.length) return;
    const world = result.worldMesh;
    const scene = world.getScene();
    const observer = scene.onBeforeCameraRenderObservable.add((camera) => {
      if ((camera.layerMask & ~0x10000000) === 0) return;
      camera.getViewMatrix();
      BspMeshBuilder.updateAutosprites(result, camera.globalPosition);
    });
    const cleanup = () => {
      scene.onBeforeCameraRenderObservable.remove(observer);
      scene.onDisposeObservable.remove(sceneDispose);
      world.onDisposeObservable.remove(worldDispose);
    };
    const sceneDispose = scene.onDisposeObservable.addOnce(cleanup);
    const worldDispose = world.onDisposeObservable.addOnce(cleanup);
  }

  /**
   * Update autosprite meshes to face the camera (call each frame)
   * Q3 autosprite: full billboard, always faces camera
   * Q3 autosprite2: rotates authored quads around their longest edge axis
   * Returns the number of position-buffer uploads, for headless auditing.
   */
  public static updateAutosprites(result: BspMeshBuildResult, cameraPosition: Vector3): number {
    if (!result.autospriteMeshes?.length) return 0;
    if (!Number.isFinite(cameraPosition.x) || !Number.isFinite(cameraPosition.y) || !Number.isFinite(cameraPosition.z))
      return 0;
    let uploads = 0;

    for (const sprite of result.autospriteMeshes) {
      const { mesh, center, halfWidth, halfHeight, isAutosprite2 } = sprite;
      if (mesh.isDisposed() || !mesh.isVisible || mesh.visibility <= 0 || !mesh.isEnabled()) {
        // Re-entering visibility must upload before the first visible draw.
        BspMeshBuilder.autospriteCameraPositions.delete(mesh);
        continue;
      }
      const previous = BspMeshBuilder.autospriteCameraPositions.get(mesh);
      if (
        previous &&
        previous[0] === cameraPosition.x &&
        previous[1] === cameraPosition.y &&
        previous[2] === cameraPosition.z
      )
        continue;

      if (isAutosprite2) {
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
        if (!positions) continue;
        sprite.axisGeometry ??= createAutosprite2Geometry(positions, mesh.getIndices() ?? []);
        const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
        if (!updateAutosprite2Geometry(sprite.axisGeometry, positions, normals, cameraPosition)) continue;
        mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
        if (normals) mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
        mesh.refreshBoundingInfo();
        BspMeshBuilder.autospriteCameraPositions.set(mesh, [cameraPosition.x, cameraPosition.y, cameraPosition.z]);
        uploads++;
        continue;
      }

      // Calculate direction from sprite center to camera
      const cx = center[0],
        cy = center[1],
        cz = center[2];
      let dx = cameraPosition.x - cx;
      let dy = cameraPosition.y - cy;
      let dz = cameraPosition.z - cz;

      // Normalize direction
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.001) continue; // Camera at sprite center, skip
      dx /= dist;
      dy /= dist;
      dz /= dist;

      // Calculate right and up vectors for the sprite quad
      let rightX: number, rightY: number, rightZ: number;
      let upX: number, upY: number, upZ: number;

      {
        // Autosprite: full billboard (face camera on all axes)
        // Up vector: world up projected onto plane perpendicular to view direction
        // Right = cross(worldUp, viewDir), then Up = cross(viewDir, right)
        const worldUpX = 0,
          worldUpY = 1,
          worldUpZ = 0;

        // Right = cross(worldUp, forward)
        rightX = worldUpY * dz - worldUpZ * dy;
        rightY = worldUpZ * dx - worldUpX * dz;
        rightZ = worldUpX * dy - worldUpY * dx;

        // Normalize right
        const rightLen = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ);
        if (rightLen < 0.001) {
          // Looking straight up/down, use default
          rightX = 1;
          rightY = 0;
          rightZ = 0;
          upX = 0;
          upY = 0;
          upZ = -1;
        } else {
          rightX /= rightLen;
          rightY /= rightLen;
          rightZ /= rightLen;

          // Up = cross(forward, right)
          upX = dy * rightZ - dz * rightY;
          upY = dz * rightX - dx * rightZ;
          upZ = dx * rightY - dy * rightX;
        }
      }

      // Reconstruct all vertices using pre-calculated normalized offsets
      // This handles both simple quads and triangulated sprites correctly
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions || positions.length < 12) continue;

      const numVerts = positions.length / 3;
      const hw = halfWidth,
        hh = halfHeight;

      // Use normalized offsets to position each vertex on the billboard
      for (let v = 0; v < numVerts; v++) {
        const [rightFrac, upFrac] = sprite.vertexOffsets[v] ?? [0, 0];
        // Position = center + right * (rightFrac * halfWidth) + up * (upFrac * halfHeight)
        positions[v * 3] = cx + rightX * (rightFrac * hw) + upX * (upFrac * hh);
        positions[v * 3 + 1] = cy + rightY * (rightFrac * hw) + upY * (upFrac * hh);
        positions[v * 3 + 2] = cz + rightZ * (rightFrac * hw) + upZ * (upFrac * hh);
      }

      // Update mesh vertices
      mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
      const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
      if (normals) {
        for (let v = 0; v < numVerts; v++) {
          normals[v * 3] = dx;
          normals[v * 3 + 1] = dy;
          normals[v * 3 + 2] = dz;
        }
        mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
      }
      if (previous) {
        previous[0] = cameraPosition.x;
        previous[1] = cameraPosition.y;
        previous[2] = cameraPosition.z;
      } else {
        BspMeshBuilder.autospriteCameraPositions.set(mesh, [cameraPosition.x, cameraPosition.y, cameraPosition.z]);
      }
      uploads++;
    }
    return uploads;
  }

  /**
   * Apply textures to a rendered BSP from PK3
   * Call this after bsp render to load actual textures
   */
  public static async applyTextures(
    result: BspMeshBuildResult,
    _bsp: BspFile, // Reserved for future use
    scene: Scene,
    progressCallback?: (loaded: number, total: number, name: string) => void,
    options?: { deluxe?: boolean; pbr?: boolean },
  ): Promise<number> {
    const { PK3TextureLoader } = await import("../pk3/PK3TextureLoader");
    const texLoader = PK3TextureLoader.getInstance();
    const engine = scene.getEngine();

    // Initialize texture loader if needed
    // biome-ignore lint/suspicious/noExplicitAny: BSP mesh builder internals
    texLoader.init(engine as any, scene);

    if (!result.textureGroups || result.textureGroups.length === 0) {
      console.log("[BspMeshBuilder] No texture groups to load");
      return 0;
    }

    let loadedCount = 0;
    const total = result.textureGroups.length;

    // Get all materials from world mesh and children
    const meshes = [result.worldMesh, ...result.worldMesh.getChildMeshes()];

    // Get shader registry for looking up actual texture paths
    const { Q3ShaderRegistry } = await import("../shader/Q3ShaderRegistry");
    const shaderRegistry = Q3ShaderRegistry.getInstance();
    const stripTextureExtension = (path: string): string => path.replace(/\.(tga|jpg|jpeg|png|ktx)$/i, "");
    const normalizeTexturePath = (path: string): string => path.replace(/\\/g, "/");
    const isSpecialTextureToken = (path?: string): boolean => Boolean(path?.startsWith("$"));
    const addTexturePrefixes = (path: string): string[] => {
      const normalized = normalizeTexturePath(path);
      if (isSpecialTextureToken(normalized)) {
        return [];
      }

      const paths = [normalized];
      const lower = normalized.toLowerCase();
      if (!lower.startsWith("textures/") && !lower.startsWith("models/")) {
        paths.push(`textures/${normalized}`);
      }
      return paths;
    };
    const dedupePaths = (paths: string[]): string[] => {
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const path of paths) {
        const normalized = normalizeTexturePath(path);
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) continue;
        seen.add(key);
        deduped.push(normalized);
      }
      return deduped;
    };
    const buildTextureNameFallbacks = (textureName: string): string[] => {
      const paths: string[] = [textureName];
      if (textureName.includes("_") && !textureName.includes("/")) {
        const parts = textureName.split("_");
        if (parts.length >= 2) {
          paths.push(parts.join("/"));
          if (parts.length >= 3) {
            paths.push(`${parts[0]}/${parts[1]}/${parts.slice(2).join("_")}`);
          }
          if (parts.length >= 4) {
            paths.push(`${parts[0]}/${parts[1]}/${parts[2]}/${parts.slice(3).join("_")}`);
          }
        }
      }
      return paths;
    };
    const buildDiffuseCandidates = (textureName: string, shaderProps: ResolvedMaterialProps): string[] => {
      const candidates: string[] = [];

      if (shaderProps.hasMaterialMetadata) {
        if (shaderProps.diffuseTexture && !isSpecialTextureToken(shaderProps.diffuseTexture)) {
          candidates.push(...addTexturePrefixes(shaderProps.diffuseTexture));
        } else if (!shaderProps.diffuseTexture) {
          for (const fallback of buildTextureNameFallbacks(textureName)) {
            candidates.push(...addTexturePrefixes(fallback));
          }
        }
        return dedupePaths(candidates);
      }

      if (shaderProps.diffuseTexture && !isSpecialTextureToken(shaderProps.diffuseTexture)) {
        candidates.push(...addTexturePrefixes(shaderProps.diffuseTexture));
      }
      for (const fallback of buildTextureNameFallbacks(textureName)) {
        candidates.push(...addTexturePrefixes(fallback));
      }
      return dedupePaths(candidates);
    };
    const loadFirstTexture = async (
      candidates: string[],
    ): Promise<{ texture: Texture | null; resolvedBasePath: string }> => {
      for (const candidate of candidates) {
        const texture = await texLoader.resolveAndLoadTexture(candidate);
        if (texture) {
          return {
            texture,
            resolvedBasePath: stripTextureExtension(candidate),
          };
        }
      }
      return { texture: null, resolvedBasePath: "" };
    };
    const loadOptionalTexture = async (
      explicitPath: string | undefined,
      explicitBlank: boolean,
      fallbackBasePath: string,
      suffixes: string[],
    ): Promise<Texture | null> => {
      if (explicitBlank) {
        return null;
      }

      if (explicitPath) {
        const { texture } = await loadFirstTexture(addTexturePrefixes(explicitPath));
        return texture;
      }

      if (!fallbackBasePath) {
        return null;
      }

      const candidates: string[] = [];
      for (const suffix of suffixes) {
        candidates.push(...addTexturePrefixes(`${fallbackBasePath}${suffix}`));
      }
      const { texture } = await loadFirstTexture(dedupePaths(candidates));
      return texture;
    };

    const privateTextures = new Set<Texture>();
    const ownTexture = (texture: Texture | null): Texture | null => {
      if (!texture) return null;
      const copy = texture.clone();
      copy.name = texture.name;
      privateTextures.add(copy);
      return copy;
    };
    result.worldMesh.onDisposeObservable.addOnce(() => {
      for (const texture of privateTextures) texture.dispose();
      privateTextures.clear();
    });
    const textureJobs = result.textureGroups.flatMap((group) => {
      const originals = meshes.filter(
        (m) => m.name === `bsp_tex_${group.textureIndex}` || m.name.startsWith(`bsp_sprite_${group.textureIndex}_`),
      );
      const passes = shaderRegistry.resolveMaterialPasses(group.textureName, {
        deluxe: options?.deluxe,
        worldSurface: true,
      });
      return passes.map((props, passIndex) => {
        const targets =
          passes.length === 1
            ? originals
            : originals.map((original) => {
                if (!(original instanceof Mesh)) return original;
                const mesh =
                  passIndex === 0
                    ? original
                    : original.clone(`${original.name}_pass_${passIndex}`, original.parent, true);
                if (passIndex > 0) {
                  mesh.makeGeometryUnique();
                  mesh.isPickable = false;
                  mesh.checkCollisions = false;
                }
                if (passIndex === 0) mesh.material?.dispose();
                mesh.material = BspMeshBuilder.createMaterialFromProps(
                  `${mesh.name}_material_pass_${passIndex}`,
                  scene,
                  props,
                );
                mesh.onDisposeObservable.addOnce(() => mesh.material?.dispose());
                mesh.hasVertexAlpha = props.usesVertexAlpha ?? false;
                mesh.metadata = {
                  ...original.metadata,
                  materialPass: passIndex,
                  usesLightmap: props.useLightmap,
                  isFullbright: props.isFullbright,
                  usesVertexRgb: props.usesVertexRgb,
                  preserveVertexLighting: props.usesVertexRgb,
                  preserveEmissive: false,
                };
                mesh.alphaIndex = passIndex;
                return mesh;
              });
        return { ...group, props, targets, layered: passes.length > 1 };
      });
    });
    for (const group of textureJobs) {
      const texName = group.textureName;
      if (!texName || texName.toLowerCase().includes("common/")) continue;

      progressCallback?.(loadedCount, total, texName);

      const shaderProps = group.props;
      if (shaderProps.environmentMap) {
        const { SkyboxLoader } = await import("../texture/SkyboxLoader");
        const { Q3EnvironmentPlugin } = await import("../shader/Q3EnvironmentPlugin");
        const loader = SkyboxLoader.getInstance();
        loader.init(scene);
        const environment = await loader.loadEnvironmentCubemap(shaderProps.environmentMap);
        if (environment.texture) {
          const cube = environment.texture;
          result.worldMesh.onDisposeObservable.addOnce(() => cube.dispose());
          for (const mesh of group.targets) {
            const mat = mesh.material;
            if (!(mat instanceof StandardMaterial)) continue;
            mat.disableLighting = true;
            new Q3EnvironmentPlugin(mat, cube, shaderProps.tcGen?.mode === "surround");
            mesh.metadata = { ...mesh.metadata, isFullbright: true, usesLightmap: false };
          }
          loadedCount++;
          continue;
        }
        console.warn(`[BspMeshBuilder] ${environment.error}`);
      }
      const shader = shaderRegistry.getShader(texName);
      const diffuseCandidates = buildDiffuseCandidates(texName, shaderProps);
      let texture: Texture | null = null;
      let foundCleanPath = "";
      const diffuseResult = await loadFirstTexture(diffuseCandidates);
      texture = diffuseResult.texture;
      if (group.layered) texture = ownTexture(texture);
      foundCleanPath = diffuseResult.resolvedBasePath;

      // If no texture found, check if we should generate a fallback
      if (!texture && shaderProps.alphaMode === "add") {
        // Additive shader with missing texture = generate radial gradient for halo effect
        texture = createRadialGradientTexture(scene);
        console.log(`[BspMeshBuilder] Using fallback radial gradient for: ${texName}`);
      } else if (!texture && shaderProps.diffuseTexture?.includes("$whiteimage")) {
        texture = createSolidColorTexture(scene, 255, 255, 255);
        console.log(`[BspMeshBuilder] Using fallback $whiteimage for: ${texName}`);
      } else if (!texture && shaderProps.diffuseTexture?.includes("$blackimage")) {
        texture = createSolidColorTexture(scene, 0, 0, 0);
        console.log(`[BspMeshBuilder] Using fallback $blackimage for: ${texName}`);
      }

      if (texture) {
        // Find ALL meshes for this texture index (there may be multiple with different lightmaps)
        // Also include sprite meshes which have names like bsp_sprite_${textureIndex}_*
        const matchingMeshes = group.targets;

        if (matchingMeshes.length === 0) continue;

        // Apply texture to all matching meshes
        for (const mesh of matchingMeshes) {
          if (loadedCount < 5) {
            console.log(
              `[BspMeshBuilder] Processing texture ${texName} for mesh ${mesh.name} (Material: ${mesh.material?.getClassName()})`,
            );
            if (shader) console.log(`[BspMeshBuilder] Shader props: ${JSON.stringify(shaderProps)}`);
          }

          // Check if this shader needs special material (glow overlay, etc.)
          if (
            shader &&
            !group.layered &&
            !shaderProps.hasMaterialMetadata &&
            shaderProps.resolvedBranch === "default" &&
            !shader.conditionalBlocks?.length
          ) {
            const { analyzeShaderPattern, createQ3Material } = await import("../shader/Q3ShaderMaterialFactory");
            const analysis = analyzeShaderPattern(shader);

            if (analysis.pattern === "glow_overlay") {
              // Load all required textures for glow overlay
              const stages = shader.stages;
              const baseStage = stages[analysis.baseStageIndex];
              const glowStage = stages[analysis.glowStageIndex];

              // Load glow texture
              let glowTexture: Texture | null = null;
              if (glowStage?.map) {
                const glowResult = await loadFirstTexture(addTexturePrefixes(glowStage.map));
                glowTexture = glowResult.texture;
              }

              if (texture && glowTexture) {
                // Create glow overlay material
                const textureMap = new Map<string, Texture>();
                textureMap.set(baseStage.map, texture);
                textureMap.set(glowStage.map, glowTexture);

                const materialResult = createQ3Material(shader, scene, {
                  textures: textureMap,
                  lightmapTexture: undefined, // Will be set in applyLightmaps
                  lightmapIntensity: 2.0,
                  debug: false,
                });

                if (materialResult) {
                  mesh.material = materialResult.material;
                  // Store info for lightmap application later
                  if (!mesh.metadata) mesh.metadata = {};
                  mesh.metadata.isGlowOverlay = true;
                  mesh.metadata.needsAnimation = materialResult.needsAnimation;
                  console.log(`[BspMeshBuilder] Created glow overlay material: ${texName}`);
                  loadedCount++;
                  continue; // Skip StandardMaterial path
                }
              } else if (!glowTexture) {
                console.warn(`[BspMeshBuilder] Glow texture not found for: ${texName}`);
              }
            }
          }

          // Standard material path (fallback and non-glow shaders)
          if (mesh.material instanceof StandardMaterial) {
            const mat = mesh.material;
            mat.diffuseTexture = texture;
            let hasNormalMap = false;
            let hasGlossMap = false;

            let normalTexture = await loadOptionalTexture(
              shaderProps.normalTexture,
              shaderProps.normalTextureExplicitlyBlank,
              foundCleanPath,
              ["_norm", "_normal", "_bump"],
            );
            if (group.layered) normalTexture = ownTexture(normalTexture);
            if (normalTexture) {
              if (mesh instanceof Mesh && !mesh.isVerticesDataPresent(VertexBuffer.TangentKind)) {
                const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
                const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
                const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
                const indices = mesh.getIndices();
                if (positions && normals && uvs && indices)
                  mesh.setVerticesData(VertexBuffer.TangentKind, buildBspTangents(positions, normals, uvs, indices));
              }
              mat.bumpTexture = normalTexture;
              mat.bumpTexture.level = 1.0;
              hasNormalMap = true;
              console.log(`[BspMeshBuilder] Loaded normal map for: ${texName}`);
            }

            let glossTexture = await loadOptionalTexture(
              shaderProps.glossTexture,
              shaderProps.glossTextureExplicitlyBlank,
              foundCleanPath,
              ["_gloss", "_spec"],
            );
            if (group.layered) glossTexture = ownTexture(glossTexture);
            if (glossTexture) {
              mat.specularTexture = glossTexture;
              hasGlossMap = true;
              console.log(`[BspMeshBuilder] Loaded gloss map for: ${texName}`);
            }

            BspMeshBuilder.tuneCompanionSurfaceMaterial(mat, { hasNormalMap, hasGlossMap }, shaderProps);

            let glowTexture = await loadOptionalTexture(
              shaderProps.glowTexture,
              shaderProps.glowTextureExplicitlyBlank,
              "",
              [],
            );
            if (shaderProps.glowStage) glowTexture = ownTexture(glowTexture);
            if (glowTexture) {
              mat.emissiveTexture = glowTexture;
              mat.emissiveColor = new Color3(0, 0, 0);
              mat.useEmissiveAsIllumination = true;
              if (!mesh.metadata) mesh.metadata = {};
              mesh.metadata.preserveEmissive = true;
              console.log(`[BspMeshBuilder] Loaded glow map for: ${texName}`);
            }
            const registerGlowAnimation = async (material: StandardMaterial | PBRMaterial) => {
              const stage = shaderProps.glowStage;
              if (!glowTexture || !stage) return;
              if (mesh instanceof Mesh) {
                // Qfusion adds shine after the base alpha blend: the base image's
                // transparent portal cutout must not mask the luminous rim.
                const overlay = mesh.clone(`${mesh.name}_shine`, mesh.parent, true);
                const shine = new StandardMaterial(`${material.name}_shine`, scene);
                shine.disableLighting = true;
                shine.diffuseColor.set(0, 0, 0);
                shine.emissiveTexture = glowTexture;
                shine.emissiveColor.set(0, 0, 0);
                shine.useEmissiveAsIllumination = true;
                shine.transparencyMode = 2;
                shine.alphaMode = Constants.ALPHA_ONEONE;
                shine.disableDepthWrite = true;
                shine.backFaceCulling = material.backFaceCulling;
                shine.zOffset = -1;
                overlay.material = shine;
                overlay.onDisposeObservable.addOnce(() => shine.dispose());
                overlay.isPickable = false;
                overlay.hasVertexAlpha = false;
                overlay.metadata = { ...mesh.metadata, lightmapIndex: -1, isFullbright: true, preserveEmissive: true };
                material.emissiveTexture = null;
                material.emissiveColor.set(0, 0, 0);
                material = shine;
              }
              if (stage.rgbGen?.type === "const" && stage.rgbGen.color)
                new Q3StageColorPlugin(material, stage.rgbGen.color);
              const { ShaderAnimationSystem } = await import("../shader/ShaderAnimationSystem");
              const animations = ShaderAnimationSystem.getInstance();
              animations.init(scene);
              const frames = stage.animMap
                ? {
                    frequency: stage.animMap.frequency,
                    textures: (
                      await Promise.all(
                        stage.animMap.frames.map(async (path) =>
                          ownTexture((await loadFirstTexture(addTexturePrefixes(path))).texture),
                        ),
                      )
                    ).filter((tex): tex is Texture => !!tex),
                  }
                : undefined;
              animations.registerMaterial(
                `${texName}:${material.uniqueId}:glow`,
                material,
                glowTexture,
                stage.tcMod ?? [],
                stage.rgbGen,
                undefined,
                "emissive",
                frames,
              );
              const animationId = `${texName}:${material.uniqueId}:glow`;
              material.onDisposeObservable.addOnce(() => animations.unregisterMaterial(animationId));
            };

            const registerBaseAnimation = async (material: StandardMaterial | PBRMaterial) => {
              const stage = shaderProps.primaryStage;
              configureQ3DistanceRamp(material, stage);
              configureQ3SoftParticle(material, shaderProps);
              if (stage?.alphaGen?.type === "const") material.alpha = stage.alphaGen.value ?? 1;
              if (!shaderProps.needsAnimation || !stage) return;
              const { ShaderAnimationSystem } = await import("../shader/ShaderAnimationSystem");
              const animations = ShaderAnimationSystem.getInstance();
              animations.init(scene);
              const frames = stage.animMap
                ? {
                    frequency: stage.animMap.frequency,
                    textures: (
                      await Promise.all(
                        stage.animMap.frames.map(async (path) =>
                          ownTexture((await loadFirstTexture(addTexturePrefixes(path))).texture),
                        ),
                      )
                    ).filter((image): image is Texture => !!image),
                  }
                : undefined;
              const id = `${texName}:${material.uniqueId}:base`;
              animations.registerMaterial(
                id,
                material,
                texture,
                stage.tcMod ?? [],
                stage.rgbGen,
                stage.alphaGen,
                shaderProps.alphaMode === "add" ||
                  (shaderProps.isFullbright && !shaderProps.usesVertexRgb && shaderProps.alphaMode === "opaque")
                  ? "emissive"
                  : "diffuse",
                frames,
              );
              material.onDisposeObservable.addOnce(() => animations.unregisterMaterial(id));
            };
            if (options?.pbr && BspMeshBuilder.shouldUseGeneratedPBR(shaderProps, hasNormalMap, hasGlossMap)) {
              const pbrMat = BspMeshBuilder.createGeneratedPBRMaterial(
                `${mesh.name}_pbr`,
                scene,
                shaderProps,
                texture,
                normalTexture,
                glossTexture,
                glowTexture,
              );
              mesh.material = pbrMat;
              mat.dispose();
              if (shaderProps.rgbGen?.type === "const" && shaderProps.rgbGen.color)
                new Q3StageColorPlugin(pbrMat, shaderProps.rgbGen.color);
              await registerGlowAnimation(pbrMat);
              await registerBaseAnimation(pbrMat);
              if (!mesh.metadata) mesh.metadata = {};
              mesh.metadata.usesBspPbr = true;
              if (glowTexture) {
                mesh.metadata.preserveEmissive = true;
              }
              console.log(`[BspMeshBuilder] Created generated PBR material for: ${texName}`);
              loadedCount++;
              continue;
            }

            configureQ3Alpha(mat, shaderProps);
            if (shaderProps.alphaCutoff !== undefined && shaderProps.alphaCutoff > 0) {
              // Cutout stages can also blend their surviving texture alpha.
              texture.hasAlpha = true;
            } else if (shaderProps.alphaMode === "blend") {
              mat.transparencyMode = 2; // MATERIAL_ALPHABLEND
              mat.alphaMode = Constants.ALPHA_COMBINE;
              mat.useAlphaFromDiffuseTexture = true;
              texture.hasAlpha = true;
            } else if (shaderProps.alphaMode === "add") {
              // Additive blending for glow effects (halos, flares, glass)
              mat.transparencyMode = 2; // MATERIAL_ALPHABLEND — enables alpha pipeline
              mat.alphaMode = q3AlphaMode(shaderProps);
              mat.useAlphaFromDiffuseTexture = true;
              texture.hasAlpha = true;
              // Emissive makes bright pixels glow, diffuse=0 prevents double lighting
              mat.emissiveTexture = glowTexture ?? texture;
              mat.emissiveColor = new Color3(0, 0, 0);
              mat.useEmissiveAsIllumination = true;
              mat.disableLighting = true;
              mat.diffuseColor = new Color3(0, 0, 0);
              if (!mesh.metadata) mesh.metadata = {};
              mesh.metadata.preserveEmissive = true;
            } else if (shaderProps.alphaMode === "multiply") {
              // Multiply/filter blending for decals (blendFunc filter = GL_DST_COLOR, GL_ZERO)
              // Preserve authored RGB with true multiplicative framebuffer blending.
              const { createFilterBlendMaterial } = await import("../shader/FilterBlendShaderMaterial");
              const filterMat = createFilterBlendMaterial(`filterBlend_${texName}`, scene, texture);
              mesh.material = filterMat;
              // Skip the rest of the texture application for this mesh
              loadedCount++;
              continue;
            } else {
              // CRITICAL FIX: Explicitly force OPAQUE mode for everything else
              // This prevents Babylon from guessing transparency based on texture memory
              mat.transparencyMode = 0; // MATERIAL_OPAQUE
              mat.alpha = 1.0;
              texture.hasAlpha = false;

              if (loadedCount < 3) {
                console.log(`[BspMeshBuilder] Enforced OPAQUE for ${texName} (Mode: ${mat.transparencyMode})`);
              }
            }

            // Fullbright surfaces (lamps, light panels) - appear self-lit
            // These have surfaceparm nolightmap - they ARE the light sources
            if (shaderProps.isFullbright) {
              mat.emissiveTexture = glowTexture ?? texture;
              mat.emissiveColor = new Color3(1, 1, 1);
              mat.diffuseColor = new Color3(1, 1, 1);
              mat.disableLighting = true; // Immune to scene lights — renders at full brightness
              const constant = shaderProps.rgbGen?.type === "const" ? shaderProps.rgbGen.color : undefined;
              const grayConstant = constant && constant[0] === constant[1] && constant[1] === constant[2];
              if (
                !shaderProps.usesVertexRgb &&
                (shaderProps.alphaMode === "opaque" || shaderProps.alphaMode === "add" || grayConstant)
              ) {
                mat.useEmissiveAsIllumination = true;
                mat.emissiveColor.set(0, 0, 0);
              }
              // Mark mesh to skip lightmap application
              if (mesh.metadata) {
                mesh.metadata.isFullbright = true;
                mesh.metadata.preserveEmissive = true;
              } else {
                mesh.metadata = { isFullbright: true, preserveEmissive: true };
              }
              console.log(`[BspMeshBuilder] Fullbright surface: ${texName}`);
            }

            if (
              shaderProps.hasMaterialMetadata &&
              shaderProps.usesVertexRgb &&
              shaderProps.isFullbright &&
              shaderProps.alphaMode === "opaque"
            ) {
              const { BspVertexLightingPlugin } = await import("./BspVertexLightingPlugin");
              const { excludeBspFillLights } = await import("./BspBakedLightingPlugin");
              mat.disableLighting = false;
              mat.emissiveTexture = glowTexture;
              mat.emissiveColor.set(glowTexture ? 1 : 0, glowTexture ? 1 : 0, glowTexture ? 1 : 0);
              excludeBspFillLights(mesh);
              new BspVertexLightingPlugin(mat);
            }

            // tcGen environment - spherical environment mapping for reflective surfaces
            await registerGlowAnimation(mat);
            if (shaderProps.tcGen?.mode === "environment") {
              // Use texture as reflection texture with spherical coordinates
              mat.reflectionTexture = texture;
              texture.coordinatesMode = Texture.SPHERICAL_MODE;
              // Clear diffuse since we're using reflection
              mat.diffuseTexture = null;
              // Slight ambient to prevent total darkness
              mat.ambientColor = new Color3(0.1, 0.1, 0.1);
              console.log(`[BspMeshBuilder] Environment mapping: ${texName}`);
            }

            if (shaderProps.rgbGen?.type === "const" && shaderProps.rgbGen.color)
              new Q3StageColorPlugin(mat, shaderProps.rgbGen.color);
            else if (shaderProps.alphaMode === "add" && shaderProps.usesVertexRgb)
              new Q3StageColorPlugin(mat, [1, 1, 1], true);

            await registerBaseAnimation(mat);

            loadedCount++;
          }
        } // end for (const mesh of matchingMeshes)
      }
    }

    // Also try to apply texture to main world mesh (first opaque texture)
    // For now, just count what we loaded
    console.log(`[BspMeshBuilder] Applied ${loadedCount} textures`);
    return loadedCount;
  }

  /**
   * Apply lightmaps to BSP materials using Babylon.js lightmapTexture
   * Uses useLightmapAsShadowmap=true for Q3-style texture × lightmap multiplication
   *
   * The multiplicative flag is set IMMEDIATELY (not deferred). To avoid first-frame
   * flicker, the EffectPreloader pre-compiles the lightmap shader variant during
   * map load, and scene.whenReadyAsync() gates the loading screen until ready.
   */
  /**
   * Freeze world matrices + bounding info on the STATIC BSP world meshes
   * (`bsp_world` + `bsp_tex_*`), which never transform after build. This skips
   * the per-frame world-matrix recompute and bounding-info sync Babylon does for
   * every mesh, a pure CPU win that scales with the map's texture-group count.
   *
   * Safe because: PVS toggles `isVisible` (not transforms), and static geometry's
   * bounds never change. Autosprites are excluded — they billboard by rewriting
   * vertex positions every frame, so their world matrix must stay live. Returns
   * the number of meshes frozen. Gated by `r_bsp_freeze`; applied at map build.
   *
   * Eligibility is the `bspPvsClusters` annotation this builder puts on authored
   * world surfaces — the same opt-in PVS registration uses, so both systems agree
   * on what "static world" means. It matters on the playable path, where gameplay
   * movers are parented under the world root: `buildBrushModel` does not write
   * that annotation, so a lift and its per-material children are excluded whatever
   * order they are attached in. Freezing one would pin its world matrix and stop
   * it moving. Opting in beats an exclusion list — a mover type added later is
   * safe by default rather than by remembering to list it.
   */
  public static freezeStaticWorld(result: BspMeshBuildResult): number {
    if (!result?.worldMesh) return 0;
    let frozen = 0;
    const freezeOne = (mesh: AbstractMesh): void => {
      if (mesh.metadata?.autosprite || mesh.metadata?.autosprite2) return;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
      frozen++;
    };
    // The root is the static container itself, and carries no face annotation.
    freezeOne(result.worldMesh);
    for (const child of result.worldMesh.getChildMeshes()) {
      if (!Array.isArray(child.metadata?.bspPvsClusters)) continue;
      freezeOne(child);
    }
    return frozen;
  }

  public static applyLightmaps(result: BspMeshBuildResult, options?: { intensity?: number }): number {
    const { intensity = 2.0 } = options || {};
    const lightmaps = result.lightmapTextures;
    const fbsp = result.bspData?.header?.isFBSP === true;
    const profile = fbsp ? scaleBspLighting(bspLightingProfile(result.bspData), intensity) : null;

    if (lightmaps.length === 0) {
      console.log("[BspMeshBuilder] No lightmaps to apply");
      return 0;
    }

    // Get all meshes from world mesh and children
    const meshes = [result.worldMesh, ...result.worldMesh.getChildMeshes()];
    let appliedCount = 0;

    for (const mesh of meshes) {
      const meshLightmapIndex = mesh.metadata?.lightmapIndex;
      if (meshLightmapIndex === undefined || meshLightmapIndex === null || meshLightmapIndex < 0) continue;

      // Skip fullbright surfaces - they should not receive lightmap darkening
      if (mesh.metadata?.isFullbright || mesh.metadata?.usesLightmap === false) continue;

      const lightmapIndex = meshLightmapIndex;
      if (lightmapIndex >= lightmaps.length) continue;

      const lightmapTex = lightmaps[lightmapIndex];
      const mat = mesh.material;
      if (
        profile &&
        (mat instanceof StandardMaterial || mat instanceof PBRMaterial) &&
        mesh.metadata?.usesLightmap !== false
      ) {
        const direction =
          profile.deluxe && (RenderVars.getInstance().get("r_deluxe") ?? 1) >= 0.5
            ? lightmaps[lightmapIndex + 1]
            : null;
        configureBspBakedLighting(mat, mesh, profile, direction);
      }

      if (mat instanceof StandardMaterial) {
        if (mesh instanceof Mesh) neutralizeFallbackVertexRgb(mesh);
        // Q3 lighting formula: finalColor = diffuseTexture × lightmap × overbright
        // Babylon.js lightmapTexture with useLightmapAsShadowmap=true does texture × lightmap
        mat.lightmapTexture = lightmapTex;
        mat.lightmapTexture.coordinatesIndex = 1; // Use UV2 (lightmap UVs)
        mat.lightmapTexture.level = fbsp ? 1 : intensity;
        mat.useLightmapAsShadowmap = true; // Multiplicative — set immediately

        // Pre-allocate light slots so dynamic PointLights (projectiles, explosions)
        // work without shader recompilation (which frozen materials can't do)
        applySafeMaxSimultaneousLights(mat);

        // Ensure diffuse is white so lightmap modulates at full range
        mat.diffuseColor = new Color3(1, 1, 1);

        // Clear stale emissive unless this surface deliberately uses a glow map.
        if (!mesh.metadata?.preserveEmissive) {
          mat.emissiveTexture = null;
          mat.emissiveColor = new Color3(0, 0, 0);
        }

        if (appliedCount === 0) {
          console.log(`[BspMeshBuilder] Applied first lightmap to ${mesh.name} (intensity: ${intensity})`);
        }

        appliedCount++;
      } else if (mat instanceof PBRMaterial) {
        if (mesh instanceof Mesh) neutralizeFallbackVertexRgb(mesh);
        mat.lightmapTexture = lightmapTex;
        mat.lightmapTexture.coordinatesIndex = 1; // Use UV2 (lightmap UVs)
        // A page is shared by all materials. FBSP gain belongs to each baked
        // lighting plugin, not to this shared texture's level.
        mat.lightmapTexture.level = fbsp ? 1 : intensity;
        const pbrWithShadowmap = mat as PBRMaterial & { useLightmapAsShadowmap?: boolean };
        pbrWithShadowmap.useLightmapAsShadowmap = true;

        applySafeMaxSimultaneousLights(mat);
        mat.albedoColor = new Color3(1, 1, 1);

        if (!mesh.metadata?.preserveEmissive) {
          mat.emissiveTexture = null;
          mat.emissiveColor = new Color3(0, 0, 0);
        }

        if (appliedCount === 0) {
          console.log(`[BspMeshBuilder] Applied first PBR lightmap to ${mesh.name} (intensity: ${intensity})`);
        }

        appliedCount++;
      } else if (mesh.metadata?.isGlowOverlay) {
        // Glow overlay ShaderMaterial - update lightmap texture
        if (mat instanceof ShaderMaterial) {
          mat.setTexture("lightmapSampler", lightmapTex);
          mat.setFloat("hasLightmap", 1.0);
          mat.setFloat("lightmapIntensity", intensity);
          console.log(`[BspMeshBuilder] Applied lightmap to glow overlay: ${mesh.name}`);
          appliedCount++;
        }
      }
    }

    console.log(`[BspMeshBuilder] Applied ${appliedCount} lightmaps (intensity: ${intensity})`);
    return appliedCount;
  }

  /**
   * Apply skybox from BSP sky shaders
   * Call this after bsp render to create skybox from detected sky shaders
   * Supports both cubemap skyboxes (skyparms farbox) and textured skyboxes (stage textures)
   */
  public static async applySkybox(
    result: BspMeshBuildResult,
    scene: Scene,
  ): Promise<{ success: boolean; skybox?: Mesh; error?: string }> {
    if (result.skyShaders.length === 0) {
      return { success: false, error: "No sky shaders found in BSP" };
    }

    const { SkyboxLoader } = await import("../texture/SkyboxLoader");
    const skyboxLoader = SkyboxLoader.getInstance();
    skyboxLoader.init(scene);

    // Dispose existing skybox
    skyboxLoader.disposeSkybox();

    // Try cubemap skybox first (skyparms farbox), with the shader's cloud
    // layers over it as Quake 3 draws them
    const cubemapShader = result.skyShaders.find((s) => s.skyParms?.farbox);
    if (cubemapShader?.skyParms?.farbox) {
      const loadResult = await skyboxLoader.loadSkybox(cubemapShader.skyParms.farbox);
      if (loadResult.success) {
        console.log(`[BspMeshBuilder] Created cubemap skybox from: ${cubemapShader.textureName}`);
        if (cubemapShader.cloudLayers?.length) {
          await skyboxLoader.loadCloudLayers(cubemapShader.cloudLayers, cubemapShader.skyParms.skyHeight);
        }
        return loadResult;
      }
    }

    // A sky with cloud layers and no far box: the layers are the sky
    const cloudShader = result.skyShaders.find((s) => s.cloudLayers?.length);
    if (cloudShader?.cloudLayers?.length) {
      const loadResult = await skyboxLoader.loadCloudLayers(
        cloudShader.cloudLayers,
        cloudShader.skyParms?.skyHeight ?? DEFAULT_SKY_HEIGHT,
      );
      if (loadResult.success) {
        console.log(`[BspMeshBuilder] Created cloud sky from: ${cloudShader.textureName}`);
        return loadResult;
      }
    }

    // Fallback: textured skybox from shader stage textures
    const texturedShader = result.skyShaders.find((s) => s.stageTextures?.length);
    if (texturedShader?.stageTextures?.length) {
      const skyTexture = texturedShader.stageTextures[0];
      const loadResult = await skyboxLoader.loadSkyboxFromTexture(skyTexture);
      if (loadResult.success) {
        console.log(`[BspMeshBuilder] Created textured skybox from: ${skyTexture}`);
        return loadResult;
      }
    }

    // Fallback: try qer_editorimage as sky sphere texture
    // (tried before raw texture name because editorImage is a curated preview
    // while the BSP texture name might match a tiny star/dot texture)
    for (const sky of result.skyShaders) {
      if (!sky.editorImage) continue;

      console.log(`[BspMeshBuilder] Trying editorImage as sky texture: ${sky.editorImage}`);
      const editorResult = await skyboxLoader.loadSkyboxFromTexture(sky.editorImage);
      if (editorResult.success) {
        console.log(`[BspMeshBuilder] Created sky sphere from editorImage: ${sky.editorImage}`);
        return editorResult;
      }
    }

    // Last resort: try sky texture name as cubemap prefix only
    for (const sky of result.skyShaders) {
      const texName = sky.textureName;
      if (!texName) continue;

      console.log(`[BspMeshBuilder] Trying sky texture name as cubemap: ${texName}`);
      const loadResult = await skyboxLoader.loadSkybox(texName);
      if (loadResult.success) {
        console.log(`[BspMeshBuilder] Created cubemap skybox from texture name: ${texName}`);
        return loadResult;
      }
    }

    return {
      success: false,
      error: `No skybox textures found for ${result.skyShaders.length} sky shader(s): ${result.skyShaders.map((s) => s.textureName).join(", ")}`,
    };
  }

  /**
   * Create a Babylon material from resolved shader properties
   */
  private createMaterialFromShaderProps(
    name: string,
    props: ResolvedMaterialProps,
    _textureName: string, // Will be used for texture loading later
  ): StandardMaterial {
    return BspMeshBuilder.createMaterialFromProps(name, this.scene, props);
  }

  private static createMaterialFromProps(name: string, scene: Scene, props: ResolvedMaterialProps): StandardMaterial {
    const mat = new StandardMaterial(name, scene);

    // Base color - white so texture shows properly
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    mat.emissiveColor = new Color3(0, 0, 0);

    // Culling
    mat.backFaceCulling = props.backFaceCulling;
    mat.twoSidedLighting = props.twoSidedLighting;

    configureQ3Alpha(mat, props);
    if (props.alphaMode === "add") {
      mat.emissiveColor = new Color3(1, 1, 1);
      mat.diffuseColor = new Color3(0, 0, 0);
    }
    // Cap light slots to avoid shader uniform block overflow (WebGL2 limit)
    applySafeMaxSimultaneousLights(mat);

    // Polygon offset for decals
    // NOTE: polygonOffset with multiply blend (decals) still has z-fighting issues
    // TODO: Investigate proper decal rendering with depth sorting or stencil buffer
    if (props.polygonOffset) {
      mat.zOffset = -2;
    }

    return mat;
  }

  /**
   * Qfusion gloss RGB controls strength; its exponent controls the lobe.
   */
  private static tuneCompanionSurfaceMaterial(
    mat: StandardMaterial,
    options: {
      hasNormalMap: boolean;
      hasGlossMap: boolean;
    },
    props?: ResolvedMaterialProps,
  ): void {
    // BSP meshes supply Qfusion's explicit image-space tangent frame.
    mat.invertNormalMapX = false;
    mat.invertNormalMapY = false;
    if (options.hasGlossMap && mat.specularTexture) {
      mat.specularTexture.level = 1;
      const specularStrength = props?.glossIntensity ?? 1.5;
      mat.specularColor = new Color3(specularStrength, specularStrength, specularStrength);
      mat.specularPower = props?.glossExponent ?? 24;
      return;
    }

    mat.specularColor = Color3.Black();
  }

  private static shouldUseGeneratedPBR(
    props: ResolvedMaterialProps,
    hasNormalMap: boolean,
    hasGlossMap: boolean,
  ): boolean {
    if (!hasNormalMap || !hasGlossMap) return false;
    if (props.isTransparent || props.alphaMode !== "opaque") return false;
    if (props.alphaCutoff !== undefined) return false;
    if (props.isSky || props.isFullbright) return false;
    return true;
  }

  private static createGeneratedPBRMaterial(
    name: string,
    scene: Scene,
    props: ResolvedMaterialProps,
    diffuseTexture: Texture,
    normalTexture: Texture | null,
    glossTexture: Texture | null,
    glowTexture: Texture | null,
  ): PBRMaterial {
    const mat = new PBRMaterial(name, scene);
    mat.albedoTexture = diffuseTexture;
    mat.albedoColor = new Color3(1, 1, 1);
    mat.backFaceCulling = props.backFaceCulling;
    mat.twoSidedLighting = props.twoSidedLighting;
    applySafeMaxSimultaneousLights(mat);
    mat.usePhysicalLightFalloff = false;
    // BSP surfaces are primarily driven by baked lightmaps plus the fixed BSP
    // sun. Synthetic environment lighting tends to over-brighten and flatten
    // these materials, so keep it off for the generated path.
    mat.environmentIntensity = 0.0;
    // Null metallic/roughness selects Babylon's actual specular/gloss workflow.
    // RGB strength must not multiply roughness in the metallic workflow.
    mat.metallic = null;
    mat.roughness = null;
    const exponent = props.glossExponent ?? 24;
    mat.microSurface = 1 - Math.sqrt(2 / (exponent + 2));

    if (normalTexture) {
      mat.bumpTexture = normalTexture;
      mat.bumpTexture.level = 1.0;
      mat.invertNormalMapX = false;
      mat.invertNormalMapY = false;
    }

    if (glossTexture) {
      mat.reflectivityTexture = glossTexture;
      const intensity = props.glossIntensity ?? 1.5;
      mat.reflectivityColor = new Color3(intensity, intensity, intensity);
      const pbrAny = mat as PBRMaterial & {
        useMicroSurfaceFromReflectivityMapAlpha?: boolean;
        useAutoMicroSurfaceFromReflectivityMap?: boolean;
      };
      pbrAny.useMicroSurfaceFromReflectivityMapAlpha = false;
      pbrAny.useAutoMicroSurfaceFromReflectivityMap = false;
    }

    if (glowTexture) {
      mat.emissiveTexture = glowTexture;
      mat.emissiveColor = new Color3(1, 1, 1);
    }

    return mat;
  }

  // ============================================================================
  // Lightmap Building
  // ============================================================================

  /**
   * Convert raw lightmap data to Babylon textures
   */
  private buildLightmapTextures(): Texture[] {
    const textures: Texture[] = [];
    const size = this.bsp.lightmapSize;
    const profile = bspLightingProfile(this.bsp);

    for (let i = 0; i < this.bsp.lightmaps.length; i++) {
      textures.push(
        createBspLightmapTexture(
          this.bsp.lightmaps[i],
          size,
          this.scene,
          `lightmap_${i}`,
          this.bsp.header.isFBSP,
          profile.deluxe && i % 2 === 1,
        ),
      );
    }

    console.log(`[BspMeshBuilder] Created ${textures.length} lightmap textures (${size}x${size})`);

    return textures;
  }

  /**
   * Apply fog volumes from BSP effects
   * Call this after bsp render to create fog volume meshes
   */
  public static async applyFogVolumes(
    result: BspMeshBuildResult,
    scene: Scene,
  ): Promise<{ success: boolean; fogMeshes: Mesh[]; error?: string }> {
    try {
      const { FogVolumeManager } = await import("./BspFogVolume");
      const fogManager = new FogVolumeManager();
      const fogResult = await fogManager.buildFogVolumes(result.bspData, scene);

      if (fogResult.meshes.length > 0) {
        result.fogVolumes = fogResult.meshes;
        return { success: true, fogMeshes: fogResult.meshes };
      } else {
        return { success: false, fogMeshes: [], error: "No fog volumes found in BSP" };
      }
    } catch (error) {
      console.error("[BspMeshBuilder] Failed to apply fog volumes:", error);
      return { success: false, fogMeshes: [], error: String(error) };
    }
  }
}
